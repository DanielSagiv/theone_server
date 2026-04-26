# Plan: Set Event Seats to Held Only When COE Is Paid

## 1. Goal

- **Current behavior:** Event seats are set to `held` as soon as the COE is created or updated (create, update, add-event, replace-seat, replace-event, merge, unmerge). They are set to `booked` when the COE becomes paid.
- **Target behavior:** Event seats remain **available** until the COE has **payment** (deposit or full). Only when payment is recorded do we set those seats to `held`. When COE status becomes `paid`, seats move to `booked` as today. Listing and display of tables in the COE stay as today (from `coe.selected_seats`).

### Scope: What Stays the Same vs. What Changes

- **What stays the same:** We continue to relate all objects in COE and events exactly as today: COE `events` and `selected_seats`, `event_id` / `seat_id` references, merge metadata, and any other links. Create/update/add-event/replace/merge/unmerge flows still update the COE and link to events/seats the same way; UI and APIs still list and use those relationships from `coe.selected_seats` and `coe.events`.
- **What changes:** The **only** change is **when** we set the event table (seat) to `held`: we do it only when the COE is paid (deposit or full), not at creation or update. No other relationship or object structure changes.

---

## 2. Where to Stop Setting Seats to Held

Remove or skip the "set event seat to held" step in every path that runs *before* payment:

| # | File | Location | Current behavior | Change |
|---|------|----------|------------------|--------|
| 1 | `services/coeService.js` | `createCOE` (~379–381) | After creating COE, calls `updateSelectedSeatsStatus(..., 'held')` | Remove this call (or guard with "only if already paid"). |
| 2 | `services/coeService.js` | `updateCOE` (~652–654) | When `updateData.selected_seats` is set, calls `updateSelectedSeatsStatus(..., 'held')` | Remove this call (or same guard). |
| 3 | `services/coeService.js` | `adminReplaceSeat` single-seat path (~1482–1487) | Calls `updateSelectedSeatsStatus([newSeat], coeId, 'held')` | Remove this call. |
| 4 | `services/coeService.js` | `adminReplaceSeat` merged path (~1512–1542) | `Event.bulkWrite` sets new seat to `seats.$.status: 'held'` | Remove or skip this update (don't set held here). |
| 5 | `services/coeService.js` | `replaceEventInCOE` (~2649–2651) | After adding new seats, calls `updateSelectedSeatsStatus(newSeats, coeId, 'held')` | Remove this call. |
| 6 | `services/coeService.js` | `addEventToCOEWithSeat` (~3504–3505) | After adding event+seat, calls `updateSelectedSeatsStatus(..., 'held')` | Remove this call. |
| 7 | `services/mergeService.js` | `executeMerge` (~590–602) | `Event.updateOne` sets target seat to `seats.$[seat].status: 'held'` | Remove this update (or set to available; hold only on payment). |
| 8 | `services/mergeService.js` | `unmergeSingle` (~768–772) | Calls `coeService.updateSelectedSeatsStatus(..., 'held')` for the new seat | Remove this call. |

**Optional:** Events API (`PUT /v1/events/:id/seats/:seatId/status`, `PUT /v1/events/seats/bulk-status`) — decide if admins may still set `held` manually before payment; if not, restrict or document.

---

## 3. Where to Set Seats to Held (Only When COE Is Paid)

Use a **single** place: when payment is recorded (first time the COE has deposit or full payment).

**In `services/paymentService.js`, inside `updateCOEPaymentStatus`:**

- After computing the new `payment_status` and **before** calling `coeService.updateCOEStatus` (and before notifications):
  - If the COE **was** `unpaid` and **is now** `deposit_paid` or `paid`:
    - Call `coeService.updateSelectedSeatsStatus(coe.selected_seats, coeId, 'held')` (or a new helper e.g. `coeService.holdSeatsForCOE(coeId)` that does the same).
  - Only run this when transitioning **into** a paid state so we don't hold twice on second payment.

Result:

- **Deposit paid** → seats become `held` (and get `booking_reference` etc.).
- **Full payment** (first payment) → same transition triggers hold.
- **Later full payment** (after deposit) → no second hold.

Existing logic remains:

- When COE status is set to `'paid'`, `updateCOEStatus` already calls `updateSeatStatusesToBooked(coeId)`, which moves those seats from `held` to `booked`. So: **hold on first payment (deposit or full), booked when status is paid.**

---

## 4. Refunds (Release When Unpaid Again)

- In `updateCOEPaymentStatus`, when setting `payment_status` back to `'unpaid'` (e.g. deposit refund):
  - Call `coeService.releaseSelectedSeats(coeId)` so any seats that were held for this COE are released.
- `releaseSelectedSeats` already finds seats by `booking_reference`; if we never held, it no-ops.

---

## 5. Edge Cases

- **Merged COEs:** Only the COE that pays triggers the hold in `updateCOEPaymentStatus`; that call holds the seats in `coe.selected_seats` (including the shared seat for the primary). No need to hold in `executeMerge` or `unmergeSingle`.
- **Seat changes after approval but before payment:** If the client/admin changes seats (replace seat, replace event, add event, merge, unmerge) and then pays, `coe.selected_seats` is already updated; the single "hold on payment" step will hold whatever is in `selected_seats` at payment time.
- **Double payment (e.g. deposit then final):** Only hold when transitioning from `unpaid` to `deposit_paid` or `paid`; no second hold on final payment.
- **Display:** No change: COE listing and table display continue to use `coe.selected_seats`; only the Event document's `seats[].status` (and `booking_reference`) change at payment time.

---

## 6. Implementation Order

1. **Add "hold on first payment"** in `paymentService.updateCOEPaymentStatus`: when `payment_status` goes from `unpaid` to `deposit_paid` or `paid`, call `updateSelectedSeatsStatus(coe.selected_seats, coeId, 'held')`.
2. **Add "release on revert to unpaid"** in the same function: when `payment_status` becomes `unpaid`, call `releaseSelectedSeats(coeId)`.
3. **Remove or guard** all the "set to held" steps in the table in section 2 (createCOE, updateCOE, adminReplaceSeat, replaceEventInCOE, addEventToCOEWithSeat, executeMerge, unmergeSingle).
4. **Test:** Create/update COE (no payment) → event seats stay available; pay deposit or full → seats become held (then booked when status is paid); refund deposit → seats released.
5. Optionally **restrict** Events API so COE-linked seats only get `held` via this payment path, if desired.

---

## 7. Availability Check and Fallback When Holding on Payment

When the COE is paid (deposit or full), **before** setting a seat to `held`, the system will check again whether that specific table is still **available** in the event. Only if it is available will the system switch it to `held` for the event.

**If the specific table is not available:**

1. **Try to find another table in the same event in the same section.**  
   Use the same section (e.g. `category` or section name) as the originally selected seat.
2. **If there is another available table in the same section**  
   → The system will hold **this** table (update COE `selected_seats` to point to it and set that event seat to `held`).
3. **If there are no available seats in the same section**  
   - Reduce the amount (remove or zero that event's contribution from the COE totals).  
   - Notify the user: no available tables in the selected section; contact The1 if they want the event in a different seat section; total amount was updated (from X to Y).  
   - **Only then** let the user complete payment (with the reduced amount): the system runs this check **before** creating the payment intent. If the COE was reduced, the API returns `coe_updated` with the message and new total so the client can show the message and let the user complete payment on the next attempt with the updated amount.

**Flow summary:** User tries to pay → system runs availability check **before** payment (prepare step). If no available table in the section for an event → reduce amount → message user (no tables in section, contact The1, total updated from X to Y) → return `coe_updated` to client → client shows message → user completes payment with the new amount on next attempt.
