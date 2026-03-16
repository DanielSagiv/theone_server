# Handling Payments When Selected Section Has No Available Tables

## 1. Goal

- **Current behavior (after HOLD-SEATS-ON-PAYMENT plan):**
  - Before payment, `preparePaymentForCOE`:
    - Re-checks seat availability for each `selected_seats` entry.
    - If no available table exists in the **same section** for an event:
      - Removes that event's seats from `selected_seats`.
      - Sets that event's `total_price` to `0` in the COE.
      - Recalculates `subtotal`, `taxes`, `total` and reduces the amount to pay.
      - Notifies the client (`seat_section_unavailable`) and returns `coe_updated` so the client can pay the reduced total.
  - After payment, `holdSeatsForCOE`:
    - Re-runs similar logic, again dropping events with no tables in section and reducing totals.

- **Target behavior (this document):**
  - When payment is attempted and we discover that an event’s **selected section has no available tables**, we:
    - **Do not remove the event from the COE.**
    - **Do not reduce** the COE financial totals for that event.
    - **Allow payment to proceed with the original cost.**
    - Visually and operationally flag that event as “needs manual resolution” for both client and admin.

This MD only defines the new behavior; implementation comes in a separate step.

---

## 2. Scope and Non-Goals

- **In scope:**
  - Payment flows where a client pays for a COE (deposit or full).
  - The specific case where:
    - A COE has at least one event with `selected_seats` in a given section.
    - At payment time, there is **no available table** in that same section for the event.
  - Client UI state for such events **after** payment.
  - Admin notification + visibility for COEs that contain at least one such event.

- **Not in scope (for this MD):**
  - How AI or admins pick original seats or sections.
  - Any changes to “normal” availability flow when seats are available or when alternative seats exist in the same section.
  - Changes to Global Payments integration, webhook handling, or refund logic beyond what is needed to respect the new behavior.

---

## 3. Desired Behavior – Narrative

1. **Client attempts to pay** for a COE (deposit or full).
2. System re-checks each `selected_seats` entry:
   - If a table in the selected section is still available → normal behavior (seat is held after payment, as today).
   - If the originally selected table is not available but an **alternative table in the same section** is available → switch to that table and proceed normally.
   - If there is **no table available in the selected section** for a given event:
     - **Do not remove** the event or its pricing from the COE.
     - **Do not change** the COE `subtotal`, `taxes`, or `total` because of this event.
     - **Allow payment to proceed** with the full original amount (including that event).
3. After payment succeeds:
   - The COE still includes the event in question and its financial contribution.
   - That event is **visually marked in the COE UI**:
     - A **red frame** around the event card.
     - An inline text on/under that event:  
       **“There are no available tables in the selected section. The1 team is working on a solution.”**
4. In parallel, system sends a **high-visibility notification to admin**:
   - Type: a dedicated type (e.g. `coe_event_section_unavailable_after_payment`) or use an extended existing one.
   - Content:
     - Which COE (id + name).
     - Which event(s) have no available tables in the selected section.
     - That the client **has already paid** for this COE and The1 must resolve seating manually.
   - Marked as **red / critical / prominent** in admin notifications list.
5. The1 team resolves the issue offline:
   - Manually reassigns seats in a different section **or** restructures the COE as needed.
   - (Future work, not defined here: how we clear the “red frame” once resolved.)

---

## 4. Technical Behavior Changes (Conceptual Only)

### 4.1 Pre-Payment Check (`preparePaymentForCOE`)

- **Current:** When no seat is available in the selected section:
  - Event’s `total_price` set to `0`.
  - `selected_seats` for that event removed.
  - COE `subtotal` / `taxes` / `total` reduced.
  - Client is notified and must re-initiate payment for the lower amount.

- **Desired new behavior:**
  - For events with **no table available in the selected section**:
    - **Do not modify:**
      - `coe.events[*].total_price` for that event.
      - `coe.subtotal`, `coe.taxes`, `coe.total`.
      - `coe.selected_seats` entries for that event (keep the logical intent).
    - Instead:
      - Flag the event in the COE data structure as **“section unavailable at payment time”** (e.g. an extra field on the `events` array entry, or a per-seat flag).
      - Return metadata to the caller so the client can show better messaging if needed, but **do not** block payment or reduce totals.
  - `createPaymentIntent`:
    - Should no longer return `coe_updated:true` + reduced totals for this specific scenario.
    - Instead, it proceeds to create the Global Payments transaction as long as the overall total is > 0.

### 4.2 Post-Payment Hold (`holdSeatsForCOE`)

- **Current:** If an event has no seats in section at hold time, we again:
  - Drop its seats from `selected_seats`.
  - Zero its `total_price`.
  - Recalculate totals and send a `seat_section_unavailable` notification.

- **Desired new behavior:**
  - When `holdSeatsForCOE` discovers no available table in the selected section:
    - **Do not** drop the event or change its financial values.
    - **Do not** try to hold any seat for that event (since there is none in that section).
    - Mark the event as:
      - “No seats available in selected section after payment.”
    - Send the new **admin-only, red/critical notification** (see Section 5).
    - For the client, rely on the COE UI marking (red frame + text) to communicate that The1 is working on a solution.

> Important: Seats for other events in the COE, where we do find an available table (original or alternative in same section), should still be held as today.

---

## 5. Notifications and UX Changes

### 5.1 Client Experience (Post-Payment)

- **Visual marking on the COE detail screen (client view):**
  - Any event whose selected section has no available tables **after payment**:
    - Event card is wrapped in a **red frame** (style to be defined in mobile app).
    - Text displayed on/under that event:
      - **“There are no available tables in the selected section. The1 team is working on a solution.”**
- **No change to amount paid:**
  - The client sees the COE with the same total they agreed to pay.
  - They understand that The1 is handling seating for that event.

### 5.2 Admin Notification (High Visibility)

- New or extended notification for admins, triggered **after successful payment** if at least one event has no tables in the selected section:
  - **Payload:**
    - `coe_id`, `coe.name`
    - List of `event_ids` and `event_names` with section unavailability.
    - Possibly the client’s name and payment details (amount, payment type).
  - **UI requirements:**
    - Notification is **marked in red / prominent**, separated visually from normal notifications.
    - Copy example:
      - Title: **“Action required: event section unavailable after payment”**
      - Body: **“COE <Name> includes event(s) whose selected section has no available tables. The client has already paid. Please resolve seating and update the COE.”**

---

## 6. Data Model & Flags (Conceptual)

*(Exact schema and field names to be decided during implementation.)*

- **On COE events:**
  - Add a boolean or status field per event, e.g.:
    - `events[*].section_unavailable_after_payment: boolean`
    - or `events[*].section_status: 'ok' | 'section_unavailable_after_payment' | ...`
- **On selected seats (optional):**
  - Could also mark per-seat metadata, but the primary need is event-level UI & notifications.
- **Important:**  
  - These flags must **not** interfere with existing status fields (`status: 'draft' | 'approved' | 'request' | ...`) or seat status (`available`, `held`, `booked`).

---

## 7. Open Questions / Follow-Ups

1. **Clearing the red flag:**
   - How and when do we remove the red frame / `section_unavailable_after_payment` flag?
   - Options:
     - When an admin manually assigns a different section and saves the COE.
     - When we successfully hold a seat in some alternative section.
2. **Client re-communication:**
   - Do we send a follow-up notification to the client when The1 resolves the issue and assigns a new table?
3. **Multiple payments / partial refunds:**
   - If the COE is partially or fully refunded later, do we keep or clear the red event flag?

These will be addressed in later MD / implementation steps.

---

## 8. Summary

- **Key change:**  
  When an event’s selected section has no available tables at payment time, we **do not** remove that event or reduce the COE total. Payment proceeds with the **original cost**.

- **Client:**  
  Sees the event in the COE, marked with a **red frame** and a clear message that there are no tables available in the selected section and **The1 is working on a solution**.

- **Admin:**  
  Receives a **red / critical notification** that a paid COE includes events whose selected sections have no available tables and require manual handling.

Implementation will update `preparePaymentForCOE`, `holdSeatsForCOE`, notification logic, and the COE detail UI accordingly in a separate step.

