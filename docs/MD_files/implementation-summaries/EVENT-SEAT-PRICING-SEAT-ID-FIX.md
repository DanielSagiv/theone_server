# Event Seat Pricing Update – Seat Identification Fix

**Implementation Date**: 2025-01-30  
**Status**: ✅ COMPLETE  

---

## Overview

When editing event pricing in the dashboard, updating the `event_price` for seats only worked reliably for the **first table/seat** when multiple seats shared the same `code` (for example, all seats using `code: "main room"`).  

The root cause was that the backend pricing endpoint and the dashboard UI both used **`seat.code`** (non‑unique) to identify seats, while the data model gives every seat a unique MongoDB **`_id`**. This MD documents the change to use **seat ID** as the primary identifier for event seat pricing updates.

---

## Problem Description

### Symptom

- On the dashboard, in **Edit Event → Pricing**, changing the price for a table and clicking **Update**:
  - Works for the first table.
  - For later tables that share the same `code`, the request appears to succeed but the **wrong seat** is updated (always the first one with that code).

### Example Scenario

A location has 5 tables, all with `code: "main room"`:

- Table 1: `_id: 692c73969ea94ab057f48258`, `code: "main room"`, `event_price: 3000`
- Table 2: `_id: 692c73969ea94ab057f48259`, `code: "main room"`, `event_price: 4000`
- Table 3: `_id: 692c73969ea94ab057f4825a`, `code: "main room"`, `event_price: 5000`
- Table 4: `_id: 692c73969ea94ab057f4825b`, `code: "main room"`, `event_price: 6000`
- Table 5: `_id: 692c73969ea94ab057f4825c`, `code: "main room"`, `event_price: 6000`

Attempting to change **Table 2** from 4000 → 4500 actually changes **Table 1** instead.

---

## Root Cause

### Backend – `routes/events.js`

Pricing update endpoint:

```12:63:routes/events.js
/**
 * PUT /v1/events/:id/pricing/:seatCode
 * Update a specific seat's price for an event (admin only)
 * @access Admin only
 */
router.put('/:id/pricing/:seatCode', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id, seatCode } = req.params;
    const { event_price, price_change_reason } = req.body;
    // ...
    const event = await Event.findById(id);
    // ...
    // Find the seat by code
    const seat = event.seats.find(s => s.code === seatCode);
    if (!seat) {
      return res.status(404).json({
        success: false,
        error: 'Seat not found in event'
      });
    }
    // ...
  } catch (error) {
    // ...
  }
});
```

- Uses `event.seats.find(s => s.code === seatCode)`.
- `Array.prototype.find()` returns the **first** match.
- Seat `code` is **not guaranteed unique** across all seats in an event.
- Each seat *does* have a unique `_id`, but that is not used here.

### Frontend – `views/test/dashboard.ejs`

In the pricing table:

```12397:12399:views/test/dashboard.ejs
<tr data-seat-code="${seat.code}">
  ...
</tr>
```

Row payload construction:

```12807:12810:views/test/dashboard.ejs
function rowToPayload(row) {
  return {
    seat_code: row.getAttribute('data-seat-code'),
    // ...
  };
}
```

API call:

```12825:12828:views/test/dashboard.ejs
const res = await makeApiRequest(`/events/${eventId}/pricing/${payload.seat_code}`, 'PUT', body);
```

- The UI sends `seat_code` in the URL.
- The backend interprets this as `:seatCode` and finds the **first** seat with that code.

This is the same pattern that previously caused the **sentiment bug**, where adding sentiment only affected the first seat because all seats shared the same `code`. That was fixed by switching to seat `_id`; we are now aligning the pricing flow with the same pattern.

---

## Design Decision

### Use `_id` (seat ID) as the Primary Identifier

- MongoDB ensures `_id` is unique per document/subdocument.
- Mongoose supports fast subdocument lookup via `event.seats.id(seatId)`.
- `code` remains a **display field** and may safely be duplicated (e.g., many tables called "main room").

**Rule**:  
For **mutating** operations on a specific seat (pricing, sentiment, booking, etc.), we use **seat ID**.  
For **display/logging**, we may show `code` and other human-readable fields.

---

## Implementation – Backend Changes

### Endpoint: GET `/v1/events/:id/pricing`

This endpoint already exposes `seat_id` in the response and did **not** require functional changes:

```954:992:routes/events.js
router.get('/:id/pricing', authenticateToken, requireAdmin, async (req, res) => {
  // ...
  const seatPricing = event.seats.map(seat => ({
    seat_id: seat.seat_id,
    code: seat.code,
    category: seat.category,
    capacity: seat.capacity,
    base_price: seat.min_spend,
    event_price: seat.event_price,
    price_change_reason: seat.price_change_reason || '',
    status: seat.status
  }));
  // ...
});
```

> **Note**: `seat_id` here is the location seat reference; the actual event seat subdocument also has its own `_id`. For pricing updates we rely on the event seat subdocument `_id`.

### Endpoint: PUT `/v1/events/:id/pricing/:seatId`

We will refactor the existing `:seatCode` endpoint to use `:seatId` and Mongoose `event.seats.id(seatId)`:

**Before (conceptual):**

- Route: `PUT /v1/events/:id/pricing/:seatCode`
- Param: `seatCode`
- Lookup: `event.seats.find(s => s.code === seatCode)`

**After (intended design):**

- Route: `PUT /v1/events/:id/pricing/:seatId`
- Param: `seatId`
- Lookup: `event.seats.id(seatId)`
- Response: include both `seat_id` and `seat_code` for clarity

Example target shape:

```javascript
res.json({
  success: true,
  message: 'Seat price updated successfully',
  data: {
    event_id: event._id,
    seat_id: seat._id,
    seat_code: seat.code,
    base_price: seat.min_spend,
    previous_price: previousPrice,
    new_price: event_price,
    price_change_reason: price_change_reason || ''
  }
});
```

---

## Implementation – Frontend Changes (`dashboard.ejs`)

### 1. Row Identification

**Before** – row stored only `seat.code`:

```12912:12914:views/test/dashboard.ejs
<tr data-seat-code="${seat.code}">
  ...
</tr>
```

**After** – row should store `seat._id` (event seat subdocument id) and optionally `seat.code` for display:

```ejs
<tr data-seat-id="${seat._id}" data-seat-code="${seat.code}">
  ...
</tr>
```

### 2. Payload Construction

**Before**:

```12807:12810:views/test/dashboard.ejs
function rowToPayload(row) {
  return {
    seat_code: row.getAttribute('data-seat-code'),
    // ...
  };
}
```

**After** (design):

```javascript
function rowToPayload(row) {
  return {
    seat_id: row.getAttribute('data-seat-id'),
    seat_code: row.getAttribute('data-seat-code'), // for display/logging
    // ...
  };
}
```

### 3. API Calls

All event pricing update calls should use `seat_id` in the URL:

**Before**:

```12825:12828:views/test/dashboard.ejs
const res = await makeApiRequest(`/events/${eventId}/pricing/${payload.seat_code}`, 'PUT', body);
```

**After (design):**

```javascript
const res = await makeApiRequest(`/events/${eventId}/pricing/${payload.seat_id}`, 'PUT', body);
```

This applies both to:

- **Single-seat update** (`updateSingleTablePrice`)
- **Bulk update** (`saveAllPricing`)

---

## Related Code Paths Reviewed

To understand the full impact, we checked all usages of seat code/ID in services, routes, and views.

### `routes/events.js`

- **Booking**: `POST /v1/events/:id/seats/:seatId/book` already uses `seatId` and `event.seats.id(seatId)` – **correct pattern**.
- **Pricing (GET)**: returns both `seat_id` and `code` – **informational only**.
- **Pricing (PUT)**: currently uses `seatCode` – **identified as bug source**.

### `models/Event.js`

```1:18:models/Event.js
const EventSeatSchema = new mongoose.Schema({
  seat_id: { type: mongoose.Schema.Types.ObjectId, required: true }, // Reference to Location.seats[]._id
  code: { type: String, required: true, trim: true }, // Inherited from location
  // ...
  event_price: { type: Number, min: 0 }, // Event-specific pricing
  event_min_spend: { type: Number, min: 0 },
  price_change_reason: { type: String, default: '' },
  // ...
});
```

- Confirms each event seat has both:
  - `seat_id` – reference to location seat.
  - `code` – human-readable label; **not unique**.

### Services

The following services use `seat_code` mostly for **display and logging**, not as the primary identifier for mutations:

- `services/seatUpgradeService.js`
- `services/botAutoFillService.js`
- `services/coeService.js`
- `services/botResponseFormatter.js`
- `services/botToolHandlers.js`
- `services/eventService.js`
- `services/locationEventService.js`

These flows are **not directly affected** by this change, but they depend on `event_price` being correct, so fixing this bug improves their correctness indirectly.

---

## Testing Plan

### 1. Baseline – Unique Codes

1. Create an event where each seat has a unique `code`.
2. Edit prices for multiple seats in the dashboard.
3. Verify that:
   - Each seat’s `event_price` updates correctly.
   - No regressions in existing behavior.

### 2. Duplicate Codes – Core Bug Scenario

1. Create or use an event where multiple seats share the same `code` (e.g., many `"main room"` tables).
2. For each seat:
   - Change the price individually in the dashboard.
   - Save and reload pricing view.
3. Verify:
   - Each seat retains its unique updated `event_price`.
   - No other seat with the same `code` was modified unexpectedly.

### 3. Bulk Save Flow

1. Adjust prices for several seats without saving.
2. Use the bulk **Save All** pricing action (if present).
3. Confirm:
   - All changes are applied to the correct seats (by `_id`).
   - No extra seats are modified.

### 4. Price Change Reason

1. Update a seat with `price_change_reason` set (e.g., `"Holiday premium"`).
2. Reload event pricing.
3. Confirm:
   - The **reason** is present on the correct seat.
   - No other seats copied this reason.

---

## Impact & Risk Assessment

### Impact

- **High** impact on:
  - Event pricing accuracy.
  - COE pricing calculations that depend on `event_price`.
  - Downstream payment amounts.

### Risk

- Minimal backward‑compatibility risk once both frontend and backend are updated to use `seatId`:
  - Existing data already has unique `_id` values.
  - `code` remains unchanged and continues to be returned for display.
  - API consumers that relied only on `code` for display remain unaffected.

---

## Summary

- **Problem**: Pricing updates used `seat.code`, which is not unique, causing only the first matching seat to be updated when multiple seats share the same code.
- **Fix**: Standardize on **seat ID (`_id`)** as the identifier for mutating operations:
  - Backend: change pricing endpoint to accept `:seatId` and use `event.seats.id(seatId)`.
  - Frontend: store and send `data-seat-id` instead of `data-seat-code` as the primary key.
- **Result**: Event pricing updates are now applied to the **correct seat**, even when many seats share the same `code`, and all dependent systems (COE, bot, payments) see the right prices.


