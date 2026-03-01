# Tao Group Hospitality – Events & Venues Import

## Overview

Feature to import **events** and **venues** from Tao Group Hospitality’s public events page into THE1: create or update **Location** (venue) records and **Event** records, and expose a single “Import all data” action from the EJS test dashboard.

**Current behavior (events-only when Tao location exists):** If a Location exists with **`taoVenueId: "121"`** or **name "Tao Night club"**, the importer uses that location for **all** scraped events and **does not create a new venue**. Each import run only creates/updates **Event** records and links them to that location; the location’s seats (e.g. the five manual categories) are left unchanged. If no such location exists, the importer falls back to find-or-create per venue as before.

## Goals

- **Single action:** One button on the server-side EJS test UI that runs the full import/sync.
- **Venues:** For each distinct venue from the source, ensure a **Location** exists; if not, create it with all available data (name, city, address, etc.).
- **Events:** For each event from the source, **create or update** the corresponding **Event** and link it to the correct **Location**.
- **Drill-down:** Use the listing page first, then follow each event’s “more details” (or equivalent) to get full event data before persisting.

## Data Source

- **Listing URL (default in code):**  
  `https://taogroup.com/events/?event_venue=121&event_city=81&`  
  Override with **`TAO_EVENTS_URL`** in `.env` if needed (e.g. multiple venues: `event_venue=122,123,263,313,314,325,895&event_city=81`).
- **Behavior:**  
  - Fetch the listing page (and, if needed, pagination).  
  - For each event, open the event detail page (drill down) to obtain full event data.  
  - No authentication; public pages only.  
- **Note:** The site is client-rendered (Next.js). A plain HTTP request returns HTML without the event list. The importer uses a headless browser (Puppeteer) to load the page so events are present in the DOM or in `window.__NEXT_DATA__`.

## Data Mapping

### Venues → Location

- **Prefer existing “Tao Night club” location (events-only import):** Before creating or matching any venue, the importer looks up a Location by **`taoVenueId: "121"`** (Tao Vegas from the listing URL) or by **name `"Tao Night club"`**. If found, **all** scraped events are attached to that location and **no new venue is ever created**. This allows a manually created location (e.g. from JSON with correct seats) to be the single target for Tao imports.
- **Match when no existing Tao location:** By external id (e.g. `taoVenueId` from URL or API) or by **name + city** if no id is available.
- **Create when missing:** If no matching Location exists and no “Tao Night club” exists, create one with placeholder seats (see Table categories below).
- **Update:** If a match exists, optionally update a subset of fields (e.g. name, address) to keep data current.
- **Seats:** If the resolved location **already has seats** (e.g. manually created with five categories), the importer **does not** merge scraped table categories into it. Table merging only runs when the location has no seats (e.g. was auto-created by a previous import).

### Events → Event

- **Match:** By external id (e.g. `taoEventId` or event slug) or by **location + name + start date** to avoid duplicates.
- **Create/Update:**  
  - Set or update: `name`, `description`, `start_datetime`, `end_datetime`, `timezone`, `location_id` (THE1 Location), `type`, `status`, `media`, `total_capacity` / `total_available`, `base_price`, etc., from the detail page.
  - Required fields in THE1 (e.g. `created_by`) use the admin user triggering the import.
- **Event date/time (`start_datetime` / `end_datetime`):**
  - **Primary:** Taken from the event detail page when available (from `__NEXT_DATA__` when using the browser flow, or from the detail fetch when not using the browser).
  - **Fallback:** If the detail page does not provide a date, the importer parses a leading date from the event name (e.g. `2/21/2026 - Jerzy - TAO Nightclub` → 21 Feb 2026 at 22:00). This ensures each event gets a distinct date when the listing shows dates in the name but the detail API does not.
  - **Default:** If neither source has a date, the event uses a single default (today 22:00); re-running the import after fixing the source will update existing events.

## Technical Approach

### Service

- **Module:** e.g. `services/taoGroupImportService.js`.
- **Steps:**
  1. Fetch the listing URL (and handle pagination if present).
  2. Parse response (HTML and/or embedded JSON) to get event list and, for each, venue name/id and link to detail page.
  3. For each event, fetch the detail page and parse full event (and venue) data. When using the browser (Puppeteer), the detail page HTML is also parsed for `__NEXT_DATA__` to read `start_datetime` / `end_datetime` so each event gets the correct date.
  4. **Resolve venue → Location:** Call `getExistingTaoLocation()` (find by `taoVenueId: "121"` or name `"Tao Night club"`). If found, use that Location for **all** venue keys (events-only; no new venue created). Otherwise, for each venue call `findOrCreateVenue` and build venue key → `location_id`.
  5. For each event: find or create/update **Event** with `location_id` from that map. If the detail page did not provide a date, the service parses a leading `M/D/YYYY` from the event name and uses it (at 22:00) so the Event Management UI shows the correct date per event. When attaching to an existing location that already has seats, **do not** merge scraped table categories into the location (preserve manual seats).
- **Table categories (Location seats):** The Tao drill-down “TABLES” section lists **table categories** (e.g. Prime, Entry Level, Dance Floor, Standard, Small 1st Tier Prime), not individual table instances. On import we do **not** create one seat per scraped row. For each **category** we create **3 seats** with labels `<Category>, TABLE A`, `<Category>, TABLE B`, `<Category>, TABLE C`, using that category’s capacity and minimum spend. Events then use these location seats as already implemented.
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

## No events / Troubleshooting

- **Tao Group’s events listing is client-rendered.** A plain HTTP request returns HTML with no event list (no `__NEXT_DATA__`, no event links). The importer **must** use a headless browser (Puppeteer) to get events.
- **“Failed to launch the browser process” / no events:**  
  1. Install Chrome (or Chromium) if needed.  
  2. Set **`PUPPETEER_EXECUTABLE_PATH`** in `.env` to the Chrome executable (e.g. on Mac: `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`).  
  3. Ensure `puppeteer-core` is installed (`npm install puppeteer-core`).  
  4. Restart the server and run the import again.  
  If the browser launches but you still see 0 events, the page structure may have changed; check server logs for parse details.

## Issues and Fixes (History)

This section documents issues encountered with the Tao Group import and the fixes applied.

### 1. Same date for all events on Event Management (EJS)

- **Issue:** The Event Management table showed the same “Date & Time” (e.g. 2/22/2026 10:00 PM) for every event, while event names contained different dates (e.g. 2/21/2026, 2/26/2026).
- **Cause:** The EJS table correctly displays `event.start_datetime`. The problem was in the backend: when creating/updating events from Tao, `start_datetime` was not set per event (e.g. a single default was used, or the browser detail flow did not return dates).
- **Fix:**
  - When using the browser for event details, the service now parses `__NEXT_DATA__` on the detail page and extracts `start_datetime`, `end_datetime`, and `timezone` for each event.
  - Added a **name fallback:** if the detail page does not provide a date, the importer parses a leading `M/D/YYYY` from the event name (e.g. `2/21/2026 - Jerzy - TAO Nightclub`) and uses it at 22:00 so each event has a distinct date.

### 2. “No events” after changes (default URL and error message)

- **Issue:** After adjusting the import, users saw no events. The default listing URL had been changed to a multi-venue URL, and the “no events” message was updated to require Puppeteer.
- **Cause:** Changing the default URL could return different or empty data in some environments. The stronger Puppeteer message was correct for client-rendered content but was perceived as a new, unnecessary requirement.
- **Fix:** Reverted the default listing URL to `event_venue=121&event_city=81`. Kept clear error messaging when the browser is missing or fails, without implying Puppeteer was newly required.

### 3. Browser fetch return value and user-facing errors

- **Issue:** When the browser failed to launch or the listing returned 0 events, the UI did not show why (e.g. Chrome not found, Puppeteer not installed).
- **Cause:** `fetchHtmlWithBrowser` returned only `html` (or null). Callers could not show an actionable error.
- **Fix:** `fetchHtmlWithBrowser` now returns `{ html, browserError }`. When 0 events are parsed, the import summary includes the browser error (e.g. “Chrome not found. Set PUPPETEER_EXECUTABLE_PATH in .env”) so users know how to fix it.

### 4. Wait strategy caused 0 events (page captured too early)

- **Issue:** Import had been working; after making the browser “more resilient,” no events were found even when the browser ran.
- **Cause:** The wait strategy was changed from `networkidle2` to `domcontentloaded`. With `domcontentloaded`, the HTML is captured before the client-side JavaScript has rendered the event list, so the parser saw no events.
- **Fix:** Reverted to `waitUntil: 'networkidle2'` (timeout 30s), kept waiting for the event-link selector (15s), and added an extra 5s delay so the page has time to hydrate and expose event data.

### 5. Tao site is client-rendered (plain HTTP returns no events)

- **Issue:** With no browser (or when the browser was not used), the importer got 0 events.
- **Cause:** Tao’s listing page is client-rendered. A plain HTTP (axios) request receives HTML that does not contain the event list (no `__NEXT_DATA__`, and the only “event” link in the static HTML is e.g. “View Calendar,” which is filtered out).
- **Fix:** Documented that a headless browser is required. The importer tries the browser first; if it fails, it falls back to axios and then shows a clear error (e.g. install `puppeteer-core`, set `PUPPETEER_EXECUTABLE_PATH`). No code path can get events from the listing without the browser when the site is fully client-rendered.

### 6. Event data from client-side state (`window.__NEXT_DATA__`)

- **Issue:** Even with the browser, the listing HTML sometimes had no `__NEXT_DATA__` script tag (data is set by the client after load).
- **Cause:** Next.js may inject or populate `window.__NEXT_DATA__` after the initial HTML; the parser only looked at the static HTML.
- **Fix:** After loading the listing page, the service uses `page.evaluate()` to read `window.__NEXT_DATA__` (or `document.getElementById('__NEXT_DATA__')`). If present and not already in the HTML, it injects that JSON into the HTML as a script tag so the existing parser can use it. Parser also checks `props.pageProps?.events` and `props.pageProps?.venues` as fallbacks.

### 7. Listing link fallback

- **Behavior:** When `__NEXT_DATA__` is absent (or has no events array), the parser falls back to scraping links: `a[href*="/events/"]` and `a[href*="/event/"]`. Links whose path after `/events/` or `/event/` is empty (e.g. query-only) are skipped so that listing/filter links are not treated as events. With the correct wait strategy, the browser-rendered page contains many such event links (e.g. 118), so the import can succeed even when `__NEXT_DATA__` is not available in the HTML.

### 8. Wrong “tens of tables” (nav/footer items as tables)

- **Issue:** The import was adding many incorrect “tables” to the venue (e.g. About, News, Careers, Gift-Cards, Restaurants, Nightlife, Privacy, Terms), all with the same placeholder (e.g. Capacity 4, Section VIP). These are site navigation/footer links, not VIP table tiers.
- **Cause:** Table extraction used a broad selector (`li`, `[role="listitem"]`, `div[class*="table"]`, etc.) and scraped the whole page, so any list item or row with a dollar amount was treated as a table.
- **Fix:**
  - **Scope to TABLES section:** In the browser, after opening “VIP table reservations” and “Tables”, the code now finds a section that contains both “TABLES” and (“Pay Now” or “Minimum Spend”) and only parses content within that section.
  - **Parse real table tiers:** Extraction looks for lines/cards with “Pay Now $X” and “Minimum Spend $X”, and for known tier names (Prime, Entry Level, Dance Floor, Standard, Premium). Minimum Spend is used as the table price when present.
  - **Blocklist:** A blocklist of non-table terms (about, news, careers, gift-cards, contact, privacy, terms, rewards, restaurants, nightlife, etc.) is applied so scraped results are filtered before being merged into the venue. Only real table tiers or items with a positive price and a non-blocklisted name are kept.

### 9. Import creating a new location instead of using the existing “Tao Night club”

- **Issue:** The Tao import was creating a **new** Location and attaching all events to it, instead of using the manually created “Tao Night club” location (with correct address, seats, and categories).
- **Cause:** The scraper may return a venue id in a different format (e.g. number, slug, or missing), so lookup by `taoVenueId` failed and the code fell through to “create new venue.”
- **Fix:**
  - **Resolve existing Tao location first:** At import time the service calls `getExistingTaoLocation()`, which finds a Location by **`taoVenueId: "121"`** or by **name `"Tao Night club"`** (case-insensitive). If found, that location is used for **all** scraped events; `findOrCreateVenue` is **not** called, so no new venue is ever created.
  - **Events-only import:** When the existing Tao location is used, the import only creates/updates **Event** records and links them to that location. Venue count in the summary shows 0 created.
  - **Seats preserved:** If the resolved location already has seats (e.g. the five categories from the manual JSON), the importer **does not** run `mergeTablesIntoLocation`. Table merging only runs when the location has no seats (e.g. an auto-created placeholder venue).
  - **Normalize `taoVenueId` in findOrCreateVenue:** When falling back to find-or-create (no existing Tao location), `taoVenueId` is normalized with `String(venue.taoVenueId)` so numeric `121` from the page still matches a document with `taoVenueId: "121"`.

### 10. One-off setup: create “Tao Night club” and link it to Tao import

- **Goal:** Have a single Location that represents Tao (Las Vegas) with the correct name, address, attributes, and five seat categories (Prime, Entry Level, Dance Floor, Standard, Small 1st Tier Prime), and have every Tao import attach events to that location.
- **Scripts (run once from `server/`):**
  1. **Create the location from JSON:**  
     `node scripts/create-tao-location.js`  
     Creates the “Tao Night club” Location with the predefined payload (name, type, address, attributes, five seats with `code`, `category`, `the1Category`, `capacity`, `minSpendUSD`, `qualityScore`, `priceTier`). Uses an admin user for `createdBy` / `updatedBy` if available.
  2. **Set Tao venue id on the location:**  
     `node scripts/set-tao-venue-id.js`  
     Finds the Location by name “Tao Night club” and sets `taoVenueId: "121"` so that `getExistingTaoLocation()` can find it by id as well as by name.
- **Create Location (EJS) categories:** The same five Tao categories (`prime`, `entry_level`, `dance_floor`, `standard`, `small_1st_tier_prime`) were added to the Create Location flow: dropdown in the test dashboard (step 3 INVENTORY) and to the Location/seat schema and validation so manually created locations can use these categories and stay consistent with Tao import.

---

## Future Enhancements (Optional)

- Cron or scheduled job to run the import periodically.
- Configurable URL or filters (e.g. venue ids, city) via env or request body.
- Storing raw payload or last sync timestamp for debugging or incremental sync.
