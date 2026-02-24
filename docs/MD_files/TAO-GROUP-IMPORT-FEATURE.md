# Tao Group Hospitality – Events & Venues Import

## Overview

Feature to import **events** and **venues** from Tao Group Hospitality’s public events page into THE1: create or update **Location** (venue) records and **Event** records, and expose a single “Import all data” action from the EJS test dashboard.

## Goals

- **Single action:** One button on the server-side EJS test UI that runs the full import/sync.
- **Venues:** For each distinct venue from the source, ensure a **Location** exists; if not, create it with all available data (name, city, address, etc.).
- **Events:** For each event from the source, **create or update** the corresponding **Event** and link it to the correct **Location**.
- **Drill-down:** Use the listing page first, then follow each event’s “more details” (or equivalent) to get full event data before persisting.

## Data Source

- **Listing URL:**  
  `https://taogroup.com/events/?event_venue=122,123,263,313,314,325,895&event_city=81&`
- **Behavior:**  
  - Fetch the listing page (and, if needed, pagination).  
  - For each event, open the event detail page (drill down) to obtain full event data.  
  - No authentication; public pages only.  
- **Note:** The site may be client-rendered (e.g. React/Next.js). Implementation may need to parse embedded JSON (e.g. `__NEXT_DATA__`) or use a headless browser if HTML alone does not contain the list.

## Data Mapping

### Venues → Location

- **Match:** By external id (e.g. `taoVenueId` from URL or API) or by **name + city** if no id is available.
- **Create when missing:** If no matching Location exists, create one with:
  - `name`, `address` (line1, city, state, country, postalCode if available), `type` (e.g. `night_club` / `day_club` from context), `description`, `contact`, `media`, and any other fields the source provides.
- **Update:** If a match exists, optionally update a subset of fields (e.g. name, address) to keep data current.

### Events → Event

- **Match:** By external id (e.g. `taoEventId` or event slug) or by **location + name + start date** to avoid duplicates.
- **Create/Update:**  
  - Set or update: `name`, `description`, `start_datetime`, `end_datetime`, `timezone`, `location_id` (THE1 Location), `type`, `status`, `media`, `total_capacity` / `total_available`, `base_price`, etc., from the detail page.
  - Required fields in THE1 (e.g. `created_by`) use the admin user triggering the import.

## Technical Approach

### Service

- **Module:** e.g. `services/taoGroupImportService.js`.
- **Steps:**
  1. Fetch the listing URL (and handle pagination if present).
  2. Parse response (HTML and/or embedded JSON) to get event list and, for each, venue name/id and link to detail page.
  3. For each event, fetch the detail page and parse full event (and venue) data.
  4. For each venue: find or create **Location**; collect a map of venue key → THE1 `location_id`.
  5. For each event: find or create/update **Event** with `location_id` from that map.
- **Idempotency:** Use stable external identifiers (or name+date+venue) so re-running the import updates existing records instead of duplicating.

### API

- **Endpoint:** e.g. `POST /v1/tao/import`.
- **Auth:** Admin only (e.g. `authenticateToken`, `requireAdmin`).
- **Body:** Optional (e.g. `{ fullSync: true }` or future options).
- **Response:** JSON with summary: counts of venues/events created, updated, failed, and optional list of errors.

### EJS Button

- **Where:** Test dashboard (or dedicated test page) on the server-side EJS.
- **Label:** e.g. “Import from Tao Group” or “Import all data”.
- **Action:** Call `POST /v1/tao/import` (e.g. via `makeApiRequest` or form submit) and show success/error and summary (e.g. “X venues created/updated, Y events created/updated”).

## Error Handling & Resilience

- **Try/catch** around fetch and parse; log errors with context; return partial success (e.g. “N venues and M events imported, K failed”) where possible.
- **Rate limiting:** Optional small delay between detail-page requests to avoid overloading the source.
- **Validation:** Validate required fields (e.g. event name, start date, location_id) before create/update; skip or record as failed with a clear reason.

## Future Enhancements (Optional)

- Cron or scheduled job to run the import periodically.
- Configurable URL or filters (e.g. venue ids, city) via env or request body.
- Storing raw payload or last sync timestamp for debugging or incremental sync.
