# COE / Experience Request Form – Available Events in Dates

## Overview

When a user (admin or client) fills out an experience request form in the mobile app, once **dates** and **city** are set, the app loads **events available in that city and date range** and shows them at the **bottom of the request card**. The same event data as in **Search events** is used, but the list is designed to be **compact** so the request card does not become huge. This feature is available for **all users**: admins (Create experience form) and clients (Request Experience / preferences form).

## Goals

- After the user selects **city**, **start date**, and **end date**, automatically load events for that city and date range.
- Display events at the **bottom of the request card**, above the Submit button.
- Use the **same data source** as Search events (`GET /v1/events/search` with `city`, `start_date`, `end_date`).
- **Compact layout**: small image | venue name | date | event name; no large cards.
- Include a **checkbox** per event row for **future use** (e.g. “attach to this request”); not wired to behavior yet.
- Keep the request card from growing too large (limit number of events shown, small image size).

## User Flow

1. **Admin:** Opens “Create experience” for a client (from client list) and sees COECreateForm. **Client:** Taps “Request Experience” and sees COEPreferencesForm (Step 1: dates, city, budget, party size).
2. User selects **start date** and **end date** (DateRangePicker).
3. User selects **city** (CityPicker).
4. Once all three are set, the app calls `GET /v1/events/search?city=...&start_date=...&end_date=...` (same as Search events). This endpoint is available to any authenticated user (admin or client).
5. A section **“Events in your dates”** appears at the bottom of the form (above Next/Submit).
6. Each event is shown as a **compact row**: checkbox (future) | small image | venue name | date | event name.
7. Tapping a row opens the event’s seat selection screen (`/event-seats`).
8. User continues to fill the rest of the form and submits the request as before.

## Design

- **Section title:** “Events in your dates” (uppercase, secondary text, small font).
- **Row layout:** Horizontal: checkbox | 48×48 image (rounded) | text block (venue name in accent; date in muted; event name in primary). Single line for venue and date; up to two lines for event name.
- **Checkbox:** Empty box, left of image; reserved for future selection (e.g. “link this event to my request”). No behavior attached for now.
- **Image:** Small (48×48), rounded corners; event media or location media; placeholder if none.
- **Loading:** Spinner + “Loading events...” while the search request is in flight.
- **Empty:** “No events in this city and date range.” if the API returns no events.
- **Error:** Show API/network error message if the request fails.
- **Limit:** Show at most **5** events to keep the card height reasonable.

## Technical

### Mobile

- **Component: `COEFormEventRow`**  
  - Path: `mobile/src/components/COEFormEventRow.js`  
  - Props: `event` (same shape as search: `id`, `name`, `location`, `start_datetime`, `media`).  
  - Renders: checkbox (visual only) | small image | venue | date | event name.  
  - Row is tappable: navigates to `/event-seats` with `eventId`.

- **Component: `COECreateForm`** (admin creating COE for a client, or client request from that form)  
  - Path: `mobile/src/components/COECreateForm.js`  
  - State: `availableEvents`, `loadingEvents`, `eventsError`.  
  - Effect: when `formData.city`, `formData.startDate`, `formData.endDate` are all set, call `apiGet('/events/search?city=...&start_date=...&end_date=...')`, format response (same as bot search: `id`, `name`, `location`, `start_datetime`, `media`), store up to 5 in `availableEvents`.  
  - UI: after Notes, before Submit button, conditionally render “Events in your dates” section; list of `COEFormEventRow` or loading/empty/error.

- **Component: `COEPreferencesForm`** (client “Request Experience” flow)  
  - Path: `mobile/src/components/COEPreferencesForm.js`  
  - Same behavior: state `availableEvents`, `loadingEvents`, `eventsError`; effect when city + dates set; calls same `apiGet('/events/search?...')`; formats response and stores up to 5 events.  
  - UI: in Step 1, after Party Size, before the Next button, conditionally render “Events in your dates” section; list of `COEFormEventRow` or loading/empty/error. Ensures the feature works for clients as well as admins.

### API

- **Endpoint:** `GET /v1/events/search` (existing).  
- **Auth:** Any authenticated user (admin or client); no admin-only restriction.  
- **Query:** `city`, `start_date`, `end_date` (ISO 8601).  
- **Response:** `{ success: true, data: [ events ] }`; each event has `_id`, `name`, `start_datetime`, `location_id` (populated), `media`, etc.  
- No backend changes required; reuse existing event search.

## Future Use (Checkbox)

- The checkbox is present in the row for a future feature (e.g. “Select events to attach to this request” or “Prefer these events when building my experience”).  
- No selection state or API is implemented yet; behavior can be added later without changing the layout.

## Files

| Area    | File |
|--------|------|
| Mobile | `src/components/COEFormEventRow.js` – compact event row (checkbox, image, venue, date, name). |
| Mobile | `src/components/COECreateForm.js` – effect to fetch events when city + dates set; “Events in your dates” section and list (admin flow). |
| Mobile | `src/components/COEPreferencesForm.js` – same events fetch and “Events in your dates” section in Step 1 (client “Request Experience” flow). |
| Server | None (uses existing `GET /v1/events/search`; available to all authenticated users). |
