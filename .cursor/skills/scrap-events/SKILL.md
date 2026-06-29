---
name: scrap-events
description: >-
  R&D guide for THE1 "scrap events" — complete venue set: LIV Las Vegas Night + Beach, OMNIA Night + Dayclub,
  Hakkasan Las Vegas, TAO Beach, Palm Tree Beach, Marquee Dayclub (Booketing), and Marquee Nightclub (taogroup.com).
  Listing scrape, detail inventory, import, undo, and prod rollout via the EJS Events Import console.
---

# Scrap Events

## Status

**Phase: R&D — venue set complete (9 THE1 locations, 7 Events Import cards).**

All target venues for this phase are implemented: **LIV Night + Beach**, **OMNIA Night + Dayclub**, **Hakkasan**, **TAO Beach**, **Palm Tree Beach**, **Marquee Dayclub**, **Marquee Nightclub**. No additional scrap-events venues are planned until validation / prod rollout or a new scope is defined in `PLANS.md`.

| Capability | LIV Night (`Nightlife`) | LIV Beach (`Daylife`) | OMNIA Night | OMNIA Dayclub | Hakkasan Night | TAO Beach Day | Palm Tree Beach Day | Marquee Dayclub Day | Marquee Nightclub Night |
|------------|----------------------|----------------------|-------------|---------------|----------------|----------------|---------------|---------------------|-------------------------|
| Listing preview | yes | yes (same page) | yes (current + next month) | yes (separate calendar) | yes (current + next month) | yes (current + next month) | yes (current + next month) | yes (current + next month) | yes (taogroup venue tiles) |
| Import → Create Event | **yes, validated** | **yes, pilot** | **yes, pilot** | **yes, pilot** | **yes, pilot** | **yes, pilot** | **yes, pilot** | **yes, pilot** | **yes, pilot** |
| Undo import (Remove) | yes | yes | yes | yes | yes | yes | yes | yes | yes |
| Resync pricing | — | — | yes | yes | yes | yes | yes | yes | yes |

Location per row: LIV — `venueName` + `category` → `LIV_NIGHT_LOCATION_ID` / `LIV_BEACH_LOCATION_ID`. OMNIA — `category` + `venueType` → `OMNIA_LOCATION_ID` / `OMNIA_DAY_LOCATION_ID` via `resolveOmniaVenue()`. UI **scope** (Night / Day / Both) filters the table; **Import** resolves location from the row, not scope alone.

## Trigger

When the user says **scrap events** (or equivalent), always:

1. Read this skill (`server/.cursor/skills/scrap-events/SKILL.md`).
2. Read and follow `server/.cursor/skills/scrap-events/PLANS.md`.
3. Prefer small, reversible changes; do not wire production imports until PLANS marks a venue **production-ready**.
4. For **prod rollout** (env IDs, parity scripts, smoke tests), follow **Prod rollout (reference)** in this skill.

## Goal

Scrape events from venue websites and populate them into THE1 (locations → events), starting narrow and growing capability over time.

**Flow (target):**

1. List / select venues (mapped to our `Location` records).
2. Drill into one venue.
3. Fetch that venue’s external event listings.
4. Preview, dedupe, map fields, then import into our events API.

**Rollout strategy:** one venue at a time → prove a subset of events → expand parsers and venues → graduate to production.

**LIV pilot (R&D):** Events Import → **Show Live Events** (full scrape once) → primary table (**new** rows only) + **Imported into THE1** section → per-row **Import** or **Remove**. Import: detail scrape + Create Event modal → `POST /v1/events`. Remove: `DELETE /liv/import/:livEventCode` when not in a COE. After import/remove, UI patches local cache — **do not** re-scrape.

**OMNIA pilot (R&D):** Card below LIV — **Night / Day / Both** scope (mirror LIV). Two Booketing calendars: Night (`61/1089/omnia`) + Dayclub (`61/40911541686/omnia-dayclub`). Detail: **Tables** accordion. Dedupe: `omniaEventCode`. Remove: `DELETE /omnia/import/:omniaEventCode`. Resync: `POST /omnia/resync-pricing/:omniaEventCode`.

**Hakkasan pilot (R&D):** Card below OMNIA — single Night calendar (`61/1085/hakkasan-las-vegas`). Detail: **Tables** accordion (same UrVenue DOM as OMNIA night). Dedupe: `hakkasanEventCode`. Studio / R&Bae events excluded in v1. Remove: `DELETE /hakkasan/import/:hakkasanEventCode`. Resync: `POST /hakkasan/resync-pricing/:hakkasanEventCode`.

**TAO Beach pilot (R&D):** Card below Hakkasan — single Dayclub calendar (`61/1113/tao-beach`). Detail: **Tables** accordion. Dedupe: `taoBeachEventCode` (not `taoEventId` — reserved for Tao Group Hospitality). Generic **Book** placeholder days excluded in v1. Remove: `DELETE /tao-beach/import/:taoBeachEventCode`. Resync: `POST /tao-beach/resync-pricing/:taoBeachEventCode`.

**Palm Tree Beach pilot (R&D):** Card below TAO Beach — single Dayclub calendar (`61/1117/palm-tree-beach-club`). Detail: **Tables** accordion. Dedupe: `palmTreeBeachEventCode`. v1 imports all `EVE1117…` rows with TABLES inventory. Remove: `DELETE /palm-tree-beach/import/:palmTreeBeachEventCode`. Resync: `POST /palm-tree-beach/resync-pricing/:palmTreeBeachEventCode`.

**Marquee Dayclub pilot (R&D):** Card below Palm Tree Beach — single Dayclub calendar (`61/1109/marquee-dayclub`). Detail: **Tables** accordion. Dedupe: `marqueeDayclubEventCode`. v1 imports all `EVE1109…` rows with TABLES inventory. Remove: `DELETE /marquee-dayclub/import/:marqueeDayclubEventCode`. Resync: `POST /marquee-dayclub/resync-pricing/:marqueeDayclubEventCode`.

**Marquee Nightclub pilot (R&D):** Card below Marquee Dayclub — taogroup.com venue calendar. Detail: click **VIP Reservations** on listing tile, expand **Tables**. Dedupe: `marqueeNightclubEventId`. v1 imports VIP-capable events only. Remove: `DELETE /marquee-nightclub/import/:marqueeNightclubEventId`. Resync: `POST /marquee-nightclub/resync-pricing/:marqueeNightclubEventId`. **Not** `taoEventId` (bulk Tao import).

## What works today (LIV Night + Beach)

**Listing:** https://www.livnightclub.com/las-vegas/events/ — one URL, two THE1 locations.

| LIV listing row | THE1 location | `type` |
|-----------------|---------------|--------|
| LIV Las Vegas + **Nightlife** | LIV LAS VEGAS Night club | `night_club` |
| LIV Beach + **Daylife** | LIV LAS VEGAS Beach club | `day_club` |

**Important:** UI scope (Night / Beach / Both) filters the table only. **Import** always resolves `location_id` from that row’s `venueName` + `category` via `resolveLivLocation()` — never from scope alone.

1. **Show Live Events** — full scrape once; primary table = **new** importable rows only; **Imported into THE1** section below for undo.
2. **Import** — `POST /liv/prepare-import` with listing row → detail scrape by `venueType` (`night_club` | `day_club`).
3. **Night** — detail sections: Stage, Dance Floor, Balcony; 7 seats (`Stage`, `df`, `cdf`, `cudf`, `udf`, `pb`, `2nrb`).
4. **Beach** — detail sections: Cabanas, Couches, Daybeds, Club Area, Terrace; seat map in `livLasVegasEventDetailScraperService` (pilot: Cloonee). Duplicate `bc` disambiguated via `the1Category` (`beach_cabana` vs `beach_couch`).
5. **Prefill + Create Event modal** — same flow both venues; `livEventCode` dedupe (global per `EVE` code).
6. **Undo import** — **Imported into THE1** section → **Remove** deletes THE1 event when not used in any COE; row returns to primary table for re-import. After import/remove, UI patches local cache (no re-scrape).

Prod location IDs: set `LIV_NIGHT_LOCATION_ID` / `LIV_BEACH_LOCATION_ID` after `node scripts/verify-liv-location-parity.js`.

## What works today (OMNIA Night + Dayclub)

| OMNIA listing row | THE1 location | `type` | Listing URL |
|-------------------|---------------|--------|-------------|
| OMNIA + **Nightlife** | OMNIA Night Club (`OMNIA_LOCATION_ID`) | `night_club` | `.../61/1089/omnia` |
| Omnia DayClub + **Daylife** | Omnia DayClub (`OMNIA_DAY_LOCATION_ID`) | `day_club` | `.../61/40911541686/omnia-dayclub` |

**UI scope:** `#omniaEventsScope` — Night / Day / Both → `GET /omnia/events?scope=`. Default **nightlife** (night behavior unchanged).

| Aspect | Night | Dayclub |
|--------|-------|---------|
| Listing scope | Current + next calendar month | Same |
| Detail section | **Tables** accordion | **Tables** accordion |
| Default start time | 10:30pm fallback `22:00` | 11:00am fallback `11:00` |
| Seat map | `OMNIA_NIGHT_TABLE_TO_SEAT_CODE` | `OMNIA_DAY_TABLE_TO_SEAT_CODE` |
| Pilot events | Tiësto `EVE108900020260710` | Steve Aoki `EVE4091154168600020260628`; Vandelux `EVE4091154168600020260703` (pricing validated) |

**Event code → venue routing (most reliable):** `inferOmniaVenueTypeFromEventCode()` in `omniaVenueConfig.js` — day codes embed `40911541686`, night codes embed `1089`. Used by `resolveOmniaVenue()` and `resync-pricing` so listing metadata alone cannot mis-route a row.

**Dayclub location seats:** Run `node scripts/sync-omnia-dayclub-seats.js` before first day import (adds Premium Villa + Stage Cabana). Script **must** assign MongoDB `_id` on each seat subdocument (raw `$push` without `_id` breaks `GET /v1/events/:id/seats`). Idempotent repair pass fixes seats missing `_id`.

**Dayclub seat map:** Premium Villa, Villa, Stage Cabana, Poolside Couch, Dance Floor, Upper Dance Floor, Daybed, Front Row Skyline Table, Skyline Table, Skybar Table.

**Table title normalization (`normalizeTableName` in `omniaEventDetailScraperService.js`):** strip `More Info`, trailing `Table`, capacity + arrival/time suffix, then lowercase for map lookup.

| Booketing title pattern | Example | Normalized key |
|-------------------------|---------|----------------|
| Night — `Arrive by` | `Main Room Dance Floor 12 Arrive by 12:00am` | `main room dance floor` |
| Dayclub — capacity + time | `Premium Villa 15 11:00am` | `premium villa` |
| Dayclub — with Arrive | `Poolside Couch 10 Arrive by 11:00am` | `poolside couch` |

If a new Booketing title format appears, update `normalizeTableName` **and** add a unit test in `scrapEventsVenueCatalogPrice.test.js` before shipping.

**Booketing DOM (listing):**

- Calendar shell: `.uv-calendar`, month links: `a.uvjs-calendar-loadmonth`
- Event links: `a[href*="eventcode="]` → parse `eventcode=EVE...`
- Cookie banner: `button.trustarc-agree-btn`; overlays: `.uwsjs-closepop`

**Booketing DOM (detail — TABLES):**

- Wait for async **Loading Experiences…** to clear before scrape
- Click accordion label **Tables** (case-insensitive exact match)
- Poll until inventory rows with **Minimum Spend** are visible (`waitForUrvenueInventoryRows` in `urvenueInventoryDom.js`); retry accordion once if parse returns 0 rows
- Inventory rows: `.uwsinv-item` — name `.uwsinv-name`, **Minimum Spend** (not Pay Now); parser accepts `Minimum Spend $3,000.00` and amount on the following line
- Exclude non-standard: Bachelorette Packages, Table Share Experience
- Unmapped scraped tables → warning; **zero** seats receiving catalog pricing → `OMNIA_PRICING_NOT_APPLIED` on prepare-import (blocks silent `$1,000` template fallback)

**Detail URL (required):** Booketing TABLES inventory loads only when the scrape URL includes `?eventcode=EVE...` (or `&eventcode=`). `prepare-import` and `resync-pricing` call `ensureOmniaEventCodeOnDetailUrl()` — appends `eventcode` from the listing row / `omniaEventCode` when notes or listing `detailUrl` omit it. **Without eventcode, scrape returns 0 rows** and `prepare-import` fails with `OMNIA_EMPTY_INVENTORY`.

**Seat map** (`omniaEventDetailScraperService.js`): `resolveOmniaSeatMapping(key, venueType)` — `night_club` vs `day_club`.

**Already imported — refresh venue catalog prices:** `POST /v1/scrap-events/omnia/resync-pricing/:omniaEventCode` re-scrapes Booketing TABLES and updates `event_price` / `event_min_spend` / `base_price` on available seats (skips `booked` / `held`). Uses `Source:` URL from event `notes` + `omniaEventCode` fallback.

Prod parity: `node scripts/verify-omnia-location-parity.js` — checks **both** `OMNIA_LOCATION_ID` and `OMNIA_DAY_LOCATION_ID` seat codes (stage vs prod). Run `sync-omnia-dayclub-seats.js` on prod before day import.

### OMNIA import pitfalls (learned in R&D)

| Symptom | Cause | Fix |
|---------|-------|-----|
| COE shows `$1,000` on all sections | Detail URL missing `?eventcode=EVE...` → 0 inventory rows; event saved with location template prices | `ensureOmniaEventCodeOnDetailUrl`; `OMNIA_EMPTY_INVENTORY` on prepare-import; **resync-pricing** for existing events |
| COE shows `$1,000` on dayclub sections (eventcode present) | Dayclub table titles use `15 11:00am` not `Arrive by 11:00am` → seat map miss → inventory never applied | `normalizeTableName` strips capacity + time; `inferOmniaVenueTypeFromEventCode`; `OMNIA_PRICING_NOT_APPLIED` guard |
| `GET /v1/events/:id/seats` 500 after dayclub seat sync | Location seats added via raw Mongo `$push` without `_id` | `sync-omnia-dayclub-seats.js` assigns `ObjectId`; repair pass; `eventSeatService` skips seats without `_id` |
| `OMNIA_PRICING_NOT_APPLIED` on Import | Scraped TABLES tiers exist but none matched location seat codes | Fix `normalizeTableName` / seat map / `venueType`; verify with CLI detail scrape below |
| `OMNIA_EMPTY_INVENTORY` on Import | TABLES accordion not expanded or page not ready | `waitForUrvenueInventoryRows` + accordion retry; confirm URL has `eventcode` |
| Balcony tier missing / wrong seat | Booketing lists **Balcony Small**; THE1 seat is **Balcony Large** | Map `main room balcony small` → `Main Room Balcony Large` |
| Extra THE1 seats stay at `$1,000` | Location has seats not sold on this Booketing event (e.g. Dance Floor, Sky Box) | Expected — only matched scraped tables get `event_price`; warnings list unmapped location seats |
| `alreadyImported` on Import | `omniaEventCode` already on a THE1 event | Use **resync-pricing** or Remove then re-import |

### OMNIA APIs

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/v1/scrap-events/omnia/events` | Full scrape + partition |
| POST | `/v1/scrap-events/omnia/prepare-import` | Scrape detail + return prefill (no DB write); fails on `OMNIA_EMPTY_INVENTORY` or `OMNIA_PRICING_NOT_APPLIED` |
| POST | `/v1/scrap-events/omnia/resync-pricing/:omniaEventCode` | Re-scrape TABLES min spend onto existing event |
| DELETE | `/v1/scrap-events/omnia/import/:omniaEventCode` | Undo import — delete THE1 event (COE + booking guards) |
| POST | `/v1/events` | Create event (accepts `seats` + `omniaEventCode` from import prefill) |

### OMNIA quick test (CLI)

**Dayclub detail scrape + seat codes + min spend:**

```bash
cd server && node -e "
require('dotenv').config();
const { fetchOmniaEventDetailInventory } = require('./services/scrapEvents/omniaEventDetailScraperService');
const code = 'EVE4091154168600020260703';
const url = 'https://booketing.com/microsite/house/event/61/40911541686/vandelux-dj-set-fourth-of-july-weekend?eventcode=' + code;
fetchOmniaEventDetailInventory(url, { venueType: 'day_club' })
  .then(r => console.log(r.items?.map(i => ({ name: i.name, seatCode: i.seatCode, minSpend: i.minSpend })), r.warnings));
"
```

Expect mapped `seatCode` on every TABLES row and `minSpend` from **Minimum Spend** (not Pay Now). Re-sync an already-imported event:

```bash
# POST /v1/scrap-events/omnia/resync-pricing/EVE4091154168600020260703
```

### OMNIA testing checklist (Night + Dayclub)

1. **Night regression:** `scope=nightlife` — Tiësto import unchanged; `eventcode` on detail URL.
2. **Dayclub:** `scope=daylife` — import lands on Omnia DayClub (`day_club`); COE shows scraped Minimum Spend per section (not flat `$1,000`).
3. **Both:** table shows night + day rows; each Import uses correct `location_id` via `resolveOmniaVenue` / event code.
4. **Pricing guard:** if seat map breaks, prepare-import returns `OMNIA_PRICING_NOT_APPLIED` (not a silent create).
5. **Resync:** `POST /omnia/resync-pricing/:omniaEventCode` refreshes `event_price` on existing imports.
6. **Location seats:** `sync-omnia-dayclub-seats.js` + `verify-omnia-location-parity.js` on stage and prod before prod env IDs.
7. **No re-scrape:** after Import or Remove, OMNIA UI patches local cache only (`patchOmniaCacheAfterImport`).

## What works today (Hakkasan Las Vegas)

| Hakkasan listing row | THE1 location | `type` | Listing URL |
|----------------------|---------------|--------|-------------|
| Hakkasan Las Vegas + **Nightlife** | Hakkasan (`HAKKASAN_LOCATION_ID`) | `night_club` | `.../61/1085/hakkasan-las-vegas` |

**v1 scope:** Main nightclub events only. **Studio / R&Bae** rows are marked `isStudioEvent` and excluded from importable partition (`HAKKASAN_NOT_IMPORTABLE` on prepare-import).

| Aspect | Hakkasan Night |
|--------|----------------|
| Listing scope | Current + next calendar month |
| Detail section | **Tables** accordion |
| Default start time | 10:30pm fallback `22:00` |
| Seat map | `HAKKASAN_TABLE_TO_SEAT_CODE` (8 human labels) |
| Pilot event | Laidback Luke `EVE108500020260702` — Owners $4,000, Stage $3,500, Lower Dance Floor $3,000 |

**Event code routing:** `inferHakkasanFromEventCode()` — codes embed site id `1085` (distinct from OMNIA `1089` / day `40911541686`).

**Hakkasan seat map (Booketing → THE1 `code`):** Main Room Owners, Main Room Stage, Main Room Lower Dance Floor, Main Room Upper Dancefloor, Main Room 3rd/4th Rows, Mezzanine Center, Mezzanine Side, Mezzanine Skybox.

**Table title normalization:** Night-style `Arrive by` strip (same rules as OMNIA night `normalizeTableName` in `hakkasanEventDetailScraperService.js`).

**Pricing guards:** `ensureHakkasanEventCodeOnDetailUrl`; `HAKKASAN_EMPTY_INVENTORY`; `HAKKASAN_PRICING_NOT_APPLIED`; `assertScrapInventoryPricingApplied` with reason `'Hakkasan scrap import'`.

### Hakkasan APIs

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/v1/scrap-events/hakkasan/events` | Full scrape + partition |
| POST | `/v1/scrap-events/hakkasan/prepare-import` | Scrape detail + return prefill |
| POST | `/v1/scrap-events/hakkasan/resync-pricing/:hakkasanEventCode` | Re-scrape TABLES min spend onto existing event |
| DELETE | `/v1/scrap-events/hakkasan/import/:hakkasanEventCode` | Undo import |
| POST | `/v1/events` | Create event (accepts `seats` + `hakkasanEventCode`) |

**EJS card (below OMNIA):** `#hakkasanLiveEventsBtn` → `loadHakkasanLiveEvents()`; `importHakkasanEvent` / `removeHakkasanImport`; `window.hakkasanImportPrefill`; `patchHakkasanCacheAfterImport`.

Prod parity: `node scripts/verify-hakkasan-location-parity.js`.

## What works today (TAO Beach)

| TAO Beach listing row | THE1 location | `type` | Listing URL |
|-----------------------|---------------|--------|-------------|
| TAO Beach + **Daylife** | TAO Beach (`TAO_BEACH_LOCATION_ID`) | `day_club` | `.../61/1113/tao-beach` |

**v1 scope:** Named flyer events only. Generic **Book** placeholder calendar rows excluded (`TAO_BEACH_NOT_IMPORTABLE` on prepare-import).

| Aspect | TAO Beach Dayclub |
|--------|-------------------|
| Listing scope | Current + next calendar month |
| Detail section | **Tables** accordion |
| Default start time | 11:00am fallback `11:00` |
| Seat map | `TAO_BEACH_TABLE_TO_SEAT_CODE` (6 human labels) |
| Pilot event | Jonas Blue `EVE111300020260710` |

**Event code routing:** `inferTaoBeachFromEventCode()` — codes embed site id `1113`.

**TAO Beach seat map:** Bungalow, Lotus Cabana, Tendai Lounge, Prime Daybed, Daybed, Terrace Table.

**Table title normalization:** Dayclub-style — strip capacity + `Arrive by` and capacity + time (`15 11:00am`) per OMNIA dayclub lessons.

**Pricing guards:** `ensureTaoBeachEventCodeOnDetailUrl`; `TAO_BEACH_EMPTY_INVENTORY`; `TAO_BEACH_PRICING_NOT_APPLIED`; reason `'TAO Beach scrap import'`.

### TAO Beach APIs

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/v1/scrap-events/tao-beach/events` | Full scrape + partition |
| POST | `/v1/scrap-events/tao-beach/prepare-import` | Scrape detail + return prefill |
| POST | `/v1/scrap-events/tao-beach/resync-pricing/:taoBeachEventCode` | Re-scrape TABLES min spend |
| DELETE | `/v1/scrap-events/tao-beach/import/:taoBeachEventCode` | Undo import |
| POST | `/v1/events` | Create event (accepts `seats` + `taoBeachEventCode`) |

**EJS card (below Hakkasan):** `#taoBeachLiveEventsBtn` → `loadTaoBeachLiveEvents()`; `importTaoBeachEvent` / `removeTaoBeachImport`; `window.taoBeachImportPrefill`; `patchTaoBeachCacheAfterImport`.

Prod parity: `node scripts/verify-tao-beach-location-parity.js`.

**Do not confuse with Tao Group Hospitality** (`taoGroupImportService.js`, `taoEventId` on events from taogroup.com).

## What works today (Palm Tree Beach)

| Palm Tree Beach listing row | THE1 location | `type` | Listing URL |
|-----------------------------|---------------|--------|-------------|
| Palm Tree Beach + **Daylife** | Palm Tree Beach (`PALM_TREE_BEACH_LOCATION_ID`) | `day_club` | `.../61/1117/palm-tree-beach-club` |

**v1 scope:** All `EVE1117…` calendar rows with TABLES inventory (no generic-Book filter).

| Aspect | Palm Tree Beach Dayclub |
|--------|-------------------------|
| Listing scope | Current + next calendar month |
| Detail section | **Tables** accordion |
| Default start time | 11:00am fallback `11:00` |
| Seat map | 8 human labels (Premium Beach Villa … Ocean Bed) |
| Pilot event | Tiësto `EVE111700020260711` |

**Event code routing:** `inferPalmTreeBeachFromEventCode()` — codes embed site id `1117`.

**Palm Tree Beach seat map:** Premium Beach Villa, Beach Villa, Coastal Cabana, Cabana, Seaside Tables, Shore Table, Boardwalk Table, Ocean Bed.

**Pricing guards:** `ensurePalmTreeBeachEventCodeOnDetailUrl`; `PALM_TREE_BEACH_EMPTY_INVENTORY`; `PALM_TREE_BEACH_PRICING_NOT_APPLIED`; reason `'Palm Tree Beach scrap import'`.

### Palm Tree Beach APIs

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/v1/scrap-events/palm-tree-beach/events` | Full scrape + partition |
| POST | `/v1/scrap-events/palm-tree-beach/prepare-import` | Scrape detail + return prefill |
| POST | `/v1/scrap-events/palm-tree-beach/resync-pricing/:palmTreeBeachEventCode` | Re-scrape TABLES min spend |
| DELETE | `/v1/scrap-events/palm-tree-beach/import/:palmTreeBeachEventCode` | Undo import |
| POST | `/v1/events` | Create event (accepts `seats` + `palmTreeBeachEventCode`) |

**EJS card (below TAO Beach):** `#palmTreeBeachLiveEventsBtn` → `loadPalmTreeBeachLiveEvents()`; `importPalmTreeBeachEvent` / `removePalmTreeBeachImport`; `window.palmTreeBeachImportPrefill`; `patchPalmTreeBeachCacheAfterImport`.

Prod parity: `node scripts/verify-palm-tree-beach-location-parity.js`.

## What works today (Marquee Dayclub)

| Marquee Dayclub listing row | THE1 location | `type` | Listing URL |
|-----------------------------|---------------|--------|-------------|
| Marquee Dayclub + **Daylife** | Marquee Dayclub (`MARQUEE_DAYCLUB_LOCATION_ID`) | `day_club` | `.../61/1109/marquee-dayclub` |

**v1 scope:** All `EVE1109…` calendar rows with TABLES inventory.

| Aspect | Marquee Dayclub |
|--------|-----------------|
| Listing scope | Current + next calendar month |
| Detail section | **Tables** accordion |
| Default start time | 11:00am fallback `11:00` |
| Seat map | 5 human labels (Grand Cabana, Prime Cabana, Prime Daybed, Cabana, Daybed) |
| Pilot event | DJ Pauly D `EVE110900020260711` |

**Event code routing:** `inferMarqueeDayclubFromEventCode()` — codes embed site id `1109`.

**Marquee Dayclub seat map:** Grand Cabana, Prime Cabana, Prime Daybed, Cabana, Daybed (longest-match-first).

**Pricing guards:** `ensureMarqueeDayclubEventCodeOnDetailUrl`; `MARQUEE_DAYCLUB_EMPTY_INVENTORY`; `MARQUEE_DAYCLUB_PRICING_NOT_APPLIED`; reason `'Marquee Dayclub scrap import'`.

### Marquee Dayclub APIs

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/v1/scrap-events/marquee-dayclub/events` | Full scrape + partition |
| POST | `/v1/scrap-events/marquee-dayclub/prepare-import` | Scrape detail + return prefill |
| POST | `/v1/scrap-events/marquee-dayclub/resync-pricing/:marqueeDayclubEventCode` | Re-scrape TABLES min spend |
| DELETE | `/v1/scrap-events/marquee-dayclub/import/:marqueeDayclubEventCode` | Undo import |
| POST | `/v1/events` | Create event (accepts `seats` + `marqueeDayclubEventCode`) |

**EJS card (below Palm Tree Beach):** `#marqueeDayclubLiveEventsBtn` → `loadMarqueeDayclubLiveEvents()`; `importMarqueeDayclubEvent` / `removeMarqueeDayclubImport`; `window.marqueeDayclubImportPrefill`; `patchMarqueeDayclubCacheAfterImport`.

Prod parity: `node scripts/verify-marquee-dayclub-location-parity.js` — see **Prod rollout (reference)** → Marquee Dayclub prod rollout.

## What works today (Marquee Nightclub)

| Marquee Nightclub listing row | THE1 location | `type` | Listing URL |
|-------------------------------|---------------|--------|-------------|
| Marquee Nightclub + **Nightlife** | Marquee Nightclub (`MARQUEE_NIGHTCLUB_LOCATION_ID`) | `night_club` | `https://taogroup.com/venues/marquee-nightclub-las-vegas/events/` |

**v1 scope:** Calendar events with **VIP Reservations** / TABLES inventory; Buy Tickets-only rows skipped.

| Aspect | Marquee Nightclub |
|--------|-------------------|
| Listing scope | Puppeteer + **DOM tiles** (`.event-list__item`) — ~70+ upcoming rows |
| Detail flow | Hover tile → **VIP Reservations** → expand **Tables** |
| Default start time | 22:00 fallback |
| Seat map | 6 human labels (Cloud … Full Upper Dance Floor) |
| Pilot events | DJ Sourmilk — Marquee Mondays `6-29-2026-marquee-mondays-marquee-nightclub`; Twenty Six — Lowkey `7-1-2026-lowkey-in-the-library-marquee-nightclub`; DJ Pauly D `7-3-2026-dj-pauly-d-marquee-nightclub` |

**Dedupe field:** `marqueeNightclubEventId` — taogroup event **slug** from `/event/{slug}/` (e.g. `7-3-2026-dj-pauly-d-marquee-nightclub`). **Not** `taoEventId` (bulk Tao Group Hospitality import).

**Listing parser (`marqueeNightclubScraperService.js`):** Do **not** use `parseListingPage()` from `taoGroupImportService.js` for this venue. That page has no `__NEXT_DATA__`; the fallback grabs unrelated `/events/` links (Booketing microsite, all-Vegas links) with no dates → all rows fail `filterScrapEventsNotInPast`.

Instead, `parseMarqueeNightclubListingFromDom()` reads each `.event-list__item`:

| DOM target | Field |
|------------|-------|
| `a[href*="taogroup.com/event/"]` | `detailUrl`, slug → `eventId` |
| `.event-list-post__content` text lines | `name` (line 1), `dateDisplay` (line 2, e.g. `Mon, Jun 29 2026`) |
| `a[href*="booketing.com"]` with `eventcode=` | optional Booketing code on tile |
| Buttons matching `VIP Reservations` | `hasVipReservations` |

**`isoDate` resolution (required for upcoming filter):** slug prefix `M-D-YYYY` (`isoDateFromTaoSlug`) → listing date line (`isoDateFromListingDateDisplay`) → leading `M/D/YYYY` in name (`isoDateFromEventName`). Rows without `isoDate` are excluded as past.

**Detail tile matching:** VIP click uses `a[href*="/event/"]` (singular), not `/events/`. `slugFromDetailUrl()` accepts both `/event/` and `/events/`.

**Seat map:** Full Upper Dance Floor, Upper Dance Floor, Third Tier Main Room, Dance Floor, Cloud, Salon (longest-match-first).

**Pricing guards:** `MARQUEE_NIGHTCLUB_EMPTY_INVENTORY`; `MARQUEE_NIGHTCLUB_PRICING_NOT_APPLIED`; reason `'Marquee Nightclub scrap import'`.

### Marquee Nightclub pitfalls (learned in R&D)

| Symptom | Cause | Fix |
|---------|-------|-----|
| `0 new` · `150 scraped` · `150 past excluded` | `parseListingPage` fallback — no dates on rows | DOM tile parser only; never `parseListingPage` for Marquee Nightclub |
| Summary says "scraped from Booketing" | Reused `buildOmniaEventsSummaryText` | `buildMarqueeNightclubEventsSummaryText` → "taogroup.com" |
| VIP tile click fails | Matcher looked for `/events/` links | Use `/event/` (taogroup singular path) |
| All events marked past | Missing `isoDate` on normalized rows | Parse date from slug + tile date line |

### Marquee Nightclub APIs

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/v1/scrap-events/marquee-nightclub/events` | Full scrape + partition |
| POST | `/v1/scrap-events/marquee-nightclub/prepare-import` | VIP tile click + TABLES scrape → prefill |
| POST | `/v1/scrap-events/marquee-nightclub/resync-pricing/:marqueeNightclubEventId` | Re-scrape TABLES min spend |
| DELETE | `/v1/scrap-events/marquee-nightclub/import/:marqueeNightclubEventId` | Undo import |
| POST | `/v1/events` | Create event (accepts `seats` + `marqueeNightclubEventId`) |

**EJS card (below Marquee Dayclub):** `#marqueeNightclubLiveEventsBtn` → `loadMarqueeNightclubLiveEvents()`; `importMarqueeNightclubEvent` / `removeMarqueeNightclubImport`; `window.marqueeNightclubImportPrefill`; `patchMarqueeNightclubCacheAfterImport`; summary via `buildMarqueeNightclubEventsSummaryText`.

Prod parity: `node scripts/verify-marquee-nightclub-location-parity.js` — see **Prod rollout (reference)**.

### Marquee Nightclub quick test (CLI)

**Listing preview (~70 upcoming VIP rows):**

```bash
cd server && node -e "
const { fetchMarqueeNightclubEventsPreview } = require('./services/scrapEvents/marqueeNightclubScraperService');
fetchMarqueeNightclubEventsPreview().then(r => {
  console.log('count', r.events.length);
  console.log(r.events.slice(0, 3).map(e => ({ name: e.name, isoDate: e.isoDate, id: e.eventId, vip: e.hasVipReservations })));
});
"
```

Expect non-zero count, valid `isoDate` on each row, `hasVipReservations: true` for importable tiles.

## Venue catalog pricing rule (all scrap venues)

**Venue cost on import = Minimum Spend from the venue detail page** — not Pay Now deposit, not THE1 negotiated pricing.

| Source (venue site) | Stored on event seat | Mobile display | COE / THE1 |
|---------------------|----------------------|----------------|------------|
| `Minimum Spend` | `event_price`, `event_min_spend` | `EventSeatCard` Price (`event_price` first) | `venue_catalog_price` when admin sets THE1 pricing |
| `Pay Now` | **never** | — | — |
| THE1 negotiated | **never on import** | — | `the1_base_price` on COE rows |

**Implementation (required for LIV, OMNIA, and every new scrap venue):**

1. Parse rows with [`urvenueInventoryDom.js`](server/services/scrapEvents/urvenueInventoryDom.js) — `parseUrvenueMinimumSpendFromItemText` (supports `$` and next-line amounts), `parseUrvenueInventoryItemFromRaw`, `waitForUrvenueInventoryRows`.
2. Overlay with [`applyInventoryToSeats`](server/services/scrapEvents/scrapEventsShared.js) + `venueCatalogMinSpendFromInventoryItem` — sets **`event_price`** / **`event_min_spend`** only; **`min_spend`** stays location baseline.
3. Call [`assertScrapInventoryPricingApplied`](server/services/scrapEvents/scrapEventsShared.js) on OMNIA prepare-import — fail when priced inventory exists but **no** seat received `price_change_reason` (OMNIA uses `OMNIA_PRICING_NOT_APPLIED`).
4. Do not use `payNow` for catalog price. Rows without Minimum Spend are skipped.

**Upcoming only:** Past events (`isoDate` before today in `America/Los_Angeles`) are excluded from listing tables and blocked on `prepare-import` (`LIV_EVENT_IN_PAST` / `OMNIA_EVENT_IN_PAST`). Use `filterScrapEventsNotInPast` for all scrap venues.

**OMNIA empty inventory guard:** `prepare-import` throws `OMNIA_EMPTY_INVENTORY` when detail scrape returns 0 TABLES rows.

**OMNIA pricing-applied guard:** `prepare-import` throws `OMNIA_PRICING_NOT_APPLIED` when scraped tiers have Minimum Spend but `applyInventoryToSeats` matched zero seats (prevents saving location template `$1,000` placeholders).

Tests: `node tests/scrapEventsVenueCatalogPrice.test.js` (Minimum Spend parse, dayclub title normalize, Hakkasan seat map + URL guard, `inferOmniaVenueTypeFromEventCode`, Marquee Nightclub `isoDateFromTaoSlug` / `isoDateFromListingDateDisplay`, inventory apply)

### Safety (do not harm)

- Default API/EJS scope = `nightlife` — OMNIA Night and LIV Night behavior unchanged unless user picks Day/Beach/Both.
- Additive only — no changes to GXN/Tao imports, mobile, or existing Events section.
- Night seat maps and detail sections unchanged; Beach / OMNIA Dayclub are separate `venueType` paths.
- No venue-only fallback in `resolveLivLocation()` or `resolveOmniaVenue()` (prevents row → wrong location).

### Import pipeline

```
Show Live Events (full scrape once)
  → partition by scope + livEventCode diff
  → primary table: newEvents only
  → imported section: alreadyImported (+ canRemove)
  → Import row → prepare-import → Create Event → POST /v1/events → patch local cache
  → Remove row → DELETE /liv/import/:livEventCode → patch local cache (row back in primary)
```

Date inputs re-filter **both** sections from `allNewEvents` / `allImportedEvents` without re-scraping.

## EJS console

**Events Import cards (top to bottom in `dashboard.ejs`):**

| Card | Button id | API prefix | Dedupe field |
|------|-----------|------------|--------------|
| LIV Las Vegas | `#livLiveEventsBtn` | `/scrap-events/liv` | `livEventCode` |
| OMNIA | `#omniaLiveEventsBtn` | `/scrap-events/omnia` | `omniaEventCode` |
| Hakkasan | `#hakkasanLiveEventsBtn` | `/scrap-events/hakkasan` | `hakkasanEventCode` |
| TAO Beach | `#taoBeachLiveEventsBtn` | `/scrap-events/tao-beach` | `taoBeachEventCode` |
| Palm Tree Beach | `#palmTreeBeachLiveEventsBtn` | `/scrap-events/palm-tree-beach` | `palmTreeBeachEventCode` |
| Marquee Dayclub | `#marqueeDayclubLiveEventsBtn` | `/scrap-events/marquee-dayclub` | `marqueeDayclubEventCode` |
| Marquee Nightclub | `#marqueeNightclubLiveEventsBtn` | `/scrap-events/marquee-nightclub` | `marqueeNightclubEventId` |

| Item | Path / handler |
|------|----------------|
| Sidebar label | **Events Import** |
| Section id | `events-importSection` |
| Nav `data-section` | `events-import` |
| View | `server/views/test/dashboard.ejs` |
| Show Live Events | `#livLiveEventsBtn` + `#livEventsScope` + optional date inputs → `GET /v1/scrap-events/liv/events?diffOnly=true` |
| Import (new row) | `importLivEvent(index)` → `POST /v1/scrap-events/liv/prepare-import` |
| Remove (imported row) | `removeLivImport(index)` → `DELETE /v1/scrap-events/liv/import/:livEventCode` |
| Create Event | `submitCreateEvent()` → `POST /v1/events` (local cache patch, no re-scrape) |

**OMNIA card (below LIV):**

| Item | Handler |
|------|---------|
| Show Live Events | `#omniaLiveEventsBtn` + `#omniaEventsScope` (Night / Day / Both) + date inputs → `GET /v1/scrap-events/omnia/events?scope=&diffOnly=true` |
| Import | `importOmniaEvent(index)` → `POST /v1/scrap-events/omnia/prepare-import` |
| Remove | `removeOmniaImport(index)` → `DELETE /v1/scrap-events/omnia/import/:omniaEventCode` |
| Resync pricing (API) | `POST /v1/scrap-events/omnia/resync-pricing/:omniaEventCode` — already-imported events only |
| Caches | `omniaLiveEventsCacheAll`, `omniaImportedEventsCacheAll`, `patchOmniaCacheAfterImport` |

Admin test dashboard: `/test/dashboard` (same auth as other console sections).

### Two-section UI + local cache

| UI element | DOM / handler |
|------------|----------------|
| Primary table (new only) | `#livLiveEventsTable`, `#livLiveEventsTableBody` |
| Imported section | `#livImportedEventsSection`, `#livImportedEventsTableBody` |
| New rows cache (full scrape) | `window.livLiveEventsCacheAll` |
| Imported rows cache (full scrape) | `window.livImportedEventsCacheAll` |
| Display caches (date-filtered) | `window.livLiveEventsCache`, `window.livImportedEventsCache` |
| Re-render both sections | `refreshLivEventsDisplayLocal()` |
| After create (LIV prefill) | `patchLivCacheAfterImport(createdEvent)` — moves row new → imported |
| After Remove | `patchLivCacheAfterRemove(importedRow)` — moves row imported → new |

**Re-scrape rule:** only **Show Live Events** calls `loadLivLiveEvents()` (puppeteer). Never call it after successful Import or Remove.

**What is excluded from both tables:** custom promos (`isCustomPromo`), non-importable rows (`skipped` in partition stats) — not the raw ~128-tile LIV listing.

## Repo layout

```
server/
├── .cursor/skills/scrap-events/
│   ├── SKILL.md          # This file — agent workflow + venue knowledge
│   └── PLANS.md          # Living roadmap, venue matrix, abilities log
├── utils/livVenueConfig.js          # Env-based LIV location IDs + scope normalize
├── utils/omniaVenueConfig.js        # OMNIA night + day listing URLs, location IDs, scope
├── utils/hakkasanVenueConfig.js      # Hakkasan listing URL, location ID, event code inference
├── utils/taoBeachVenueConfig.js      # TAO Beach listing URL, location ID, event code inference
├── utils/palmTreeBeachVenueConfig.js # Palm Tree Beach listing URL, location ID, event code inference
├── utils/marqueeDayclubVenueConfig.js  # Marquee Dayclub listing URL, location ID, event code inference
├── utils/marqueeNightclubVenueConfig.js  # Marquee Nightclub taogroup listing URL, location ID
├── utils/venueScraperBrowser.js   # Shared puppeteer fetch + Load More
├── services/scrapEvents/
│   ├── scrapEventsShared.js         # Date parse, COE lookup, applyInventory (LIV + OMNIA + Hakkasan)
│   ├── urvenueInventoryDom.js       # UrVenue Minimum Spend parse (shared LIV + OMNIA + Hakkasan)
│   ├── livLasVegasScraperService.js
│   ├── livLasVegasEventDetailScraperService.js
│   ├── livLasVegasEventImportService.js
│   ├── omniaScraperService.js
│   ├── omniaEventDetailScraperService.js
│   ├── omniaEventImportService.js
│   ├── hakkasanScraperService.js
│   ├── hakkasanEventDetailScraperService.js
│   ├── hakkasanEventImportService.js
│   ├── taoBeachScraperService.js
│   ├── taoBeachEventDetailScraperService.js
│   ├── taoBeachEventImportService.js
│   ├── palmTreeBeachScraperService.js
│   ├── palmTreeBeachEventDetailScraperService.js
│   ├── palmTreeBeachEventImportService.js
│   ├── marqueeDayclubScraperService.js
│   ├── marqueeDayclubEventDetailScraperService.js
│   ├── marqueeDayclubEventImportService.js
│   ├── marqueeNightclubScraperService.js
│   ├── marqueeNightclubEventDetailScraperService.js
│   └── marqueeNightclubEventImportService.js
├── scripts/verify-liv-location-parity.js
├── scripts/verify-omnia-location-parity.js   # Night + day location seat parity
├── scripts/verify-hakkasan-location-parity.js
├── scripts/verify-tao-beach-location-parity.js
├── scripts/verify-palm-tree-beach-location-parity.js
├── scripts/verify-marquee-dayclub-location-parity.js
├── scripts/verify-marquee-nightclub-location-parity.js
├── scripts/sync-omnia-dayclub-seats.js       # Idempotent Premium Villa + Stage Cabana push
├── routes/scrapEvents.js            # LIV + OMNIA + Hakkasan + TAO Beach + Palm Tree Beach + Marquee Dayclub + Marquee Nightclub listing, prepare-import, resync-pricing, undo-import
└── views/test/dashboard.ejs         # Events Import UI — Show Live Events
```

Before adding endpoints: scan `server/routes/` for existing import patterns (e.g. GXN, Tao Group on Events / Locations).

## Environment

| Variable | Default | Notes |
|----------|---------|-------|
| `LIV_EVENTS_LISTING_URL` | `https://www.livnightclub.com/las-vegas/events/` | LIV listing page |
| `LIV_NIGHT_LOCATION_ID` | `69d947ac8ae9a8c036318759` | Night club location |
| `LIV_BEACH_LOCATION_ID` | `69d9143e8ae9a8c036317fb7` | Beach club location |
| `OMNIA_EVENTS_LISTING_URL` | `https://booketing.com/microsite/house/events/61/1089/omnia` | OMNIA Night calendar |
| `OMNIA_LOCATION_ID` | `6a26ff4254364f05884f74ce` | OMNIA Night club (stage default) |
| `OMNIA_DAY_EVENTS_LISTING_URL` | `https://booketing.com/microsite/house/events/61/40911541686/omnia-dayclub` | OMNIA Dayclub calendar |
| `OMNIA_DAY_LOCATION_ID` | `6a35172263c07e4f7521d24b` | Omnia DayClub (stage default) |
| `HAKKASAN_EVENTS_LISTING_URL` | `https://booketing.com/microsite/house/events/61/1085/hakkasan-las-vegas` | Hakkasan calendar |
| `HAKKASAN_LOCATION_ID` | `6a3bd15f2c7e0f72e498b8a1` | Hakkasan Las Vegas (stage default) |
| `TAO_BEACH_EVENTS_LISTING_URL` | `https://booketing.com/microsite/house/events/61/1113/tao-beach` | TAO Beach calendar |
| `TAO_BEACH_LOCATION_ID` | `6a3aba3c092d0d12566c49a1` | TAO Beach (stage default) |
| `PALM_TREE_BEACH_EVENTS_LISTING_URL` | `https://booketing.com/microsite/house/events/61/1117/palm-tree-beach-club` | Palm Tree Beach calendar |
| `PALM_TREE_BEACH_LOCATION_ID` | `6a3aca44bdbdad91c9fd0ee5` | Palm Tree Beach (stage default) |
| `MARQUEE_DAYCLUB_EVENTS_LISTING_URL` | `https://booketing.com/microsite/house/events/61/1109/marquee-dayclub` | Marquee Dayclub calendar |
| `MARQUEE_DAYCLUB_LOCATION_ID` | `6a3ae2f9b7e4c059eb79880e` | Marquee Dayclub (stage default) |
| `MARQUEE_NIGHTCLUB_EVENTS_LISTING_URL` | `https://taogroup.com/venues/marquee-nightclub-las-vegas/events/` | Marquee Nightclub calendar |
| `MARQUEE_NIGHTCLUB_LOCATION_ID` | `6a3bc1894bf82ca19711bbbd` | Marquee Nightclub (stage default) |
| `PUPPETEER_EXECUTABLE_PATH` | Mac: `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` | Required for puppeteer-core |

## LIV Las Vegas — listing (shared page)

**Source:** https://www.livnightclub.com/las-vegas/events/ — **one listing** for LIV Las Vegas (Nightlife) and LIV Beach (Daylife). Import supports **both** when row matches venue + category map.

**Why puppeteer:** Page is client-rendered; plain HTTP gets Cloudflare / empty DOM. Use `puppeteer-core` + system Chrome (same pattern as Tao Group import).

**Expected counts (as of 2026-06):**

| Metric | Typical value | Meaning |
|--------|---------------|---------|
| Bookable `EVE*` events | ~127 | Standard tiles with `data-eventcode` |
| Custom promo tiles | ~2 visible | Same promo shown twice; dedupe to 1 |
| **Unique scraped events** | **~128** | 127 bookable + 1 custom promo |
| Widget class `uws-events-count-N` | ~129 | Counts visible tiles incl. duplicate promos |
| Visible list tiles | ~129 | Matches widget |

Do **not** treat widget count as unique event count — 2 tiles can be the same custom promo.

### LIV scrape pipeline (`scrapeLivListingPage`)

Order matters. Implemented in `livLasVegasScraperService.js`:

1. **`prepareLivListingPage`**
   - Wait for `.uws-integration.uws-events` (widget shell only — not enough alone).
   - Dismiss newsletter popup: `.uwsjs-closepop`, `.uws-closepop`.
   - Click **Agenda** tab (fallback **List** if 0 cards).
   - Poll until `.uws-event-list-item[data-eventcode]` exists (up to ~20s).
2. **`clickLoadMoreUntilDone`** (`venueScraperBrowser.js`)
   - Scroll to bottom, click **Load More** until gone or body shows "No More Events To Show".
   - Default cap: **100** clicks (was 20 — caused missing events).
   - Returns `{ clicks, exhausted, hitMaxCap }`; warn if `hitMaxCap`.
3. **`scrollListingToRenderLazyCards`**
   - Full-page scroll to trigger lazy-rendered cards.
4. **Extract from three sources, then merge:**
   - **Agenda:** `.uws-event-list-item[data-eventcode]`
   - **Custom promos:** visible `.uws-event-list-item:not([data-eventcode])` (e.g. `/special-events/...`)
   - **Calendar fallback:** `a.uws-cal-single-link[href*="/event/"]`
5. **`mergeLivEventRows`** — dedupe by `EVE` code or normalized URL (keep richer row).
6. **Sanity checks:** `readLivWidgetEventCount` (class `uws-events-count-N`), `countVisibleEventTiles`.

### LIV DOM structure

**Standard bookable event card:**

```html
<div class="uws-event-list-item" data-eventcode="EVE121488100020260626">
  <span class="venueurl"><span>Daylife|Nightlife</span></span>
  <img ... />
  <div class="uv-event-name-title">...</div>
  <div class="uv-ev-venue">LIV Las Vegas | LIV Beach</div>
  <div class="uwsdtime">...</div>
  <a class="hd-link" href=".../event/EVE.../slug/">...</a>
</div>
```

**Custom promo card** (no `data-eventcode`, no `/event/EVE` URL):

```html
<div class="uws-event-list-item uv-custom-event ...">
  <a href=".../las-vegas/special-events/experts-only-festival/">...</a>
</div>
```

**Calendar cards:** `a.uws-cal-single-link[href*="/event/"]`

**Event code date:** trailing `YYYYMMDD` in `EVE...` code → `isoDate` (e.g. `EVE121488100020260626` → `2026-06-26`).

### LIV preview API

`GET /v1/scrap-events/liv/events` — `authenticateToken` + `requireAdmin`.

**Query params (defaults for EJS):**

| Param | Default | Behavior |
|-------|---------|----------|
| `diffOnly` | `true` | `events` = not-yet-imported rows for scope |
| `scope` | `nightlife` | `nightlife` \| `daylife` \| `both` |
| `fromDate` | — | Optional `YYYY-MM-DD`; must be paired with `toDate` |
| `toDate` | — | Optional `YYYY-MM-DD`; inclusive range on `isoDate` |

Full puppeteer scrape runs every request; optional date filter applies before scope/diff; diff is against `Event.livEventCode` in DB.

**Success response:**

```json
{
  "success": true,
  "sourceUrl": "https://www.livnightclub.com/las-vegas/events/",
  "scrapedAt": "ISO-8601",
  "count": 3,
  "events": [ /* new rows (primary table), date-filtered when fromDate/toDate set */ ],
  "alreadyImported": [ /* imported rows with canRemove, removeBlockedReason */ ],
  "allNewEvents": [ /* all new rows (client date re-filter, primary) */ ],
  "allImportedEvents": [ /* all imported rows (client date re-filter, imported section) */ ],
  "stats": {
    "totalScraped": 128,
    "inDateRangeTotal": 12,
    "importableTotal": 10,
    "newCount": 3,
    "alreadyImportedCount": 7,
    "skippedCount": 2
  },
  "dateFilter": { "fromDate": "2026-06-01", "toDate": "2026-06-30", "active": true },
  "diffOnly": true,
  "scope": "nightlife",
  "warnings": [ /* optional strings */ ]
}
```

Set `diffOnly=false` to merge new + already imported into `events` (legacy). EJS uses `diffOnly=true` and reads `alreadyImported` / `allImportedEvents` separately.

### Undo LIV import

`DELETE /v1/scrap-events/liv/import/:livEventCode` — `authenticateToken` + `requireAdmin`.

1. Find `Event` by `livEventCode`.
2. Block if referenced in **any** COE (`events`, `selected_seats`, `pricing_breakdown.events`, `seat_upgrade_offers`) → `409 LIV_EVENT_IN_COE_USE`.
3. Block if event seats/units are `booked` → `409 EVENT_HAS_BOOKINGS`.
4. Hard-delete event → row can be imported again.

Partition attaches `canRemove` / `removeBlockedReason` on `alreadyImported` rows for EJS.

**Imported row fields** (on `alreadyImported` / `allImportedEvents`):

| Field | Meaning |
|-------|---------|
| `alreadyImported` | `true` |
| `the1EventId` | THE1 `Event._id` string |
| `the1EventName` | THE1 event name |
| `canRemove` | `false` when referenced in any COE |
| `removeBlockedReason` | e.g. `Used in COE "…" (draft)` — tooltip on disabled Remove |

**Undo error codes:** `404 LIV_EVENT_NOT_FOUND` | `409 LIV_EVENT_IN_COE_USE` | `409 EVENT_HAS_BOOKINGS`

**Scope values:** `nightlife` (default) | `daylife` | `both`

**Preview event DTO** (`normalizeLivEvent`):

| Field | Source |
|-------|--------|
| `externalKey` | `liv|{eventCode}` or slug fallback |
| `eventCode` | `data-eventcode` or parsed from `/event/EVE.../` URL |
| `name` | `.uv-event-name-title`, `.uwsname`, or img `alt` |
| `venueName` | `.uv-ev-venue`, `.uwsvenuename` |
| `category` | `.venueurl span` (Daylife / Nightlife) |
| `dateDisplay` | `.uwsddate` or parsed from event code |
| `isoDate` | from event code `YYYYMMDD` |
| `startTime` | `.uwsdtime` |
| `imageUrl` | flyer `img[src]` |
| `detailUrl` / `bookUrl` | `a.hd-link` or special-events link |
| `isCustomPromo` | `true` for non-`EVE` promo tiles |

**503** when browser unavailable (`SCRAP_BROWSER_UNAVAILABLE`). Check `warnings` for Load More cap, widget/tile mismatch, or empty scrape diagnostics.

### LIV pitfalls (learned in R&D)

| Symptom | Cause | Fix |
|---------|-------|-----|
| 0 events | `waitForSelector('.uws-events')` matches container before cards load | Use `prepareLivListingPage` + poll `[data-eventcode]` |
| ~127 vs ~129 on site | Load More capped at 20 | Raise cap; stop when exhausted |
| 2 “missing” vs widget | Custom promo tiles without `EVE` code | `extractLivCustomEventsFromPage` |
| Duplicate promo in count | Same custom event rendered twice | Dedupe by URL; explain in `warnings` |
| Cloudflare / empty | No headless browser | puppeteer-core + Chrome |

### Quick test (CLI)

**Listing preview:**

```bash
cd server && node -e "
const { fetchLivLasVegasEventsPreview } = require('./services/scrapEvents/livLasVegasScraperService');
fetchLivLasVegasEventsPreview().then(r => console.log(r.count, r.warnings));
"
```

**Prepare import** (admin token + listing row with `detailUrl`):

```bash
# POST /v1/scrap-events/liv/prepare-import
# Body: full listing row DTO (must include eventCode, venueName, category, detailUrl)
# Nightlife row → night_club detail scrape; Daylife row → day_club detail scrape
```

**Beach detail scrape (CLI):**

```bash
cd server && node -e "
require('dotenv').config();
const { fetchLivEventDetailInventory } = require('./services/scrapEvents/livLasVegasEventDetailScraperService');
fetchLivEventDetailInventory('https://www.livnightclub.com/las-vegas/event/EVE121488100020260627/cloonee/', { venueType: 'day_club' })
  .then(r => console.log(r.items?.map(i => ({ name: i.name, seatCode: i.seatCode, the1Category: i.the1Category })), r.warnings));
"
```

## LIV import → Create Event modal (prefill) — Night + Beach

Per-row **Import** on Events Import table. User reviews the existing 4-step **Create Event** modal; no auto-create.

**Location rule:** `resolveLivLocation(listingEvent)` uses `venueName` + `category` only (env-based IDs). `prepare-import` returns `LIV_NOT_IMPORTABLE` for custom promos or unmapped rows.

### Flow

1. **Import** → `POST /v1/scrap-events/liv/prepare-import` with listing row DTO
2. Duplicate check via `Event.livEventCode` → skip if already imported
3. Detail scrape (`fetchLivEventDetailInventory(detailUrl, { venueType })`)
   - **Night:** expand Stage, Dance Floor, Balcony
   - **Beach:** expand Cabanas, Couches, Daybeds, Club Area, Terrace
4. Map venue → THE1 `location_id`, overlay scraped min spends on inherited seats (`applyInventoryToSeats`; Beach `bc` uses `the1Category`)
5. Open **Create Event** modal pre-filled (`openCreateEventPrefilled`)
6. User walks steps 1–4 → **Create Event** → `POST /v1/events` with `seats`, `livEventCode`, flyer `media`

### Venue → location map (stage R&D)

| LIV `venueName` + `category` | THE1 location | `location_id` | Import status |
|------------------------------|---------------|---------------|-----------------|
| LIV Las Vegas + **Nightlife** | **LIV LAS VEGAS Night club** | `LIV_NIGHT_LOCATION_ID` | **validated** |
| LIV Beach + **Daylife** | **LIV LAS VEGAS Beach club** | `LIV_BEACH_LOCATION_ID` | **pilot** (Cloonee spike) |

**LIV Night club seats (7):** `Stage`, `df`, `cdf`, `cudf`, `udf`, `pb`, `2nrb` — aligned 1:1 with LIV site Stage / Dance Floor / Balcony tables.

### LIV Beach table → seat code map (pilot — Cloonee)

Detail sections: **Cabanas**, **Couches**, **Daybeds**, **Club Area**, **Terrace**.

| LIV site table | THE1 seat `code` | Notes |
|----------------|------------------|-------|
| Stage Cabana | `sc` | |
| Beach Cabana | `bc` | `the1Category` `beach_cabana` |
| Beach Couch | `bc` | `the1Category` `beach_couch` |
| Pool Couch | `pc` | |
| Daybeds | `db` | |
| Upper Club | `uc` | |
| Premium Terrace East | `pte` | |
| Terrace Tables | `tt` | |
| Terrace Daybed | `tdb` | |
| 2nd Row Premium Terrace | `2nrpt` | |
| Beach Villa, Dance Floor, Lower/Center Club, etc. | `bv`, `df`, `lc`, `cc`, `puc`, `tr` | mapped when present on LIV |

`Premium Terrace West` — unmapped (warning only until location seat exists).

**Beach spike reference:** Cloonee — `EVE121488100020260627` — https://www.livnightclub.com/las-vegas/event/EVE121488100020260627/cloonee/

### LIV Night club table → seat code map

| LIV site table | THE1 seat `code` |
|----------------|------------------|
| Stage | `Stage` |
| Dance Floor | `df` |
| Center Dance Floor | `cdf` |
| Center Upper Dance Floor | `cudf` |
| Upper Dance Floor | `udf` |
| Premium Balcony | `pb` |
| 2nd Row Balcony | `2nrb` |

### APIs

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/v1/scrap-events/liv/events` | Full scrape + partition (`events`, `alreadyImported`, caches) |
| POST | `/v1/scrap-events/liv/prepare-import` | Scrape detail + return prefill (no DB write) |
| DELETE | `/v1/scrap-events/liv/import/:livEventCode` | Undo import — delete THE1 event (COE + booking guards) |
| POST | `/v1/events` | Create event (accepts `seats` + `livEventCode` from import prefill) |

Custom promo rows (`isCustomPromo`) — not shown in either table.

Dedupe: `livEventCode` on Event model (sparse index). Active import blocks duplicate; **Remove** clears THE1 event so the same `EVE` code can be imported again.

### Import pitfalls (learned in R&D)

| Symptom | Cause | Fix |
|---------|-------|-----|
| Create Event appears to do nothing | `POST /v1/events` 400 — `eventSeatSchema` rejected inherited seat fields (`gxnItemCode`, etc.) | Schema must allow fields copied from location seats on import |
| Error hidden behind modal | `alert()` under modal z-index | Inline `#ce_submit_error` in modal footer; `getApiErrorMessage()` |
| Description has accessibility junk | AudioEye / widget boilerplate in DOM | Filter in detail scraper |
| Wrong venue / seats | Venue-only fallback or wrong scope | Strict `venueName` + `category` match; verify Venue/Category columns before Import |
| Detail scrape empty inventory | Sections not expanded | Night: Stage, Dance Floor, Balcony. Beach: Cabanas, Couches, Daybeds, Club Area, Terrace. Ignore Fontainebleau Restaurants |
| Beach `bc` wrong min spend | Two seats share code `bc` | Match by `the1Category` (`beach_cabana` vs `beach_couch`) in `applyInventoryToSeats` |
| `scope is not defined` in EJS | `loadLivLiveEvents` used `scope` before `getLivEventsScopeFromInputs()` | Read scope from `#livEventsScope` before building URL |
| Full re-scrape after every Import | `submitCreateEvent` called `loadLivLiveEvents()` | Use `patchLivCacheAfterImport` only |
| Remove disabled greyed out | Event referenced in any COE status | Expected — `removeBlockedReason` on row; undo blocked server-side too |
| Remove 409 | Booked seats on event | Same guard as generic `DELETE /v1/events/:id` |

### Files touched by import flow

| Area | Path |
|------|------|
| Env config | `utils/livVenueConfig.js` — `LIV_*_LOCATION_ID`, `normalizeLivScope` |
| Event model | `models/Event.js` — `livEventCode` |
| Validation | `createEventSchema` / `eventSeatSchema` — allow import seat fields |
| Listing scrape | `livLasVegasScraperService.js` |
| Detail scrape | `livLasVegasEventDetailScraperService.js` — `venueType` night_club / day_club |
| Prepare import / diff / undo | `livLasVegasEventImportService.js` — `partitionLivEventsByImportStatus`, `undoLivEventImport`, `findCoesReferencingEventIds`, `attachLivRemoveEligibility` |
| Routes | `routes/scrapEvents.js` (GET listing, POST prepare-import, DELETE undo-import), `routes/events.js` (accept client `seats`) |
| EJS | `dashboard.ejs` — primary diff table, `#livImportedEventsSection`, `removeLivImport`, `patchLivCacheAfterImport`, local cache (no post-import re-scrape) |
| Prod parity | `scripts/verify-liv-location-parity.js` |

### Prod parity (before prod env IDs)

See **Prod rollout (reference)** for the full per-venue checklist. LIV example:

```bash
cd server
STAGE_MONGODB_URI=... PROD_MONGODB_URI=... node scripts/verify-liv-location-parity.js
```

Confirms both LIV locations exist and seat codes match stage vs prod. Then set `LIV_NIGHT_LOCATION_ID` and `LIV_BEACH_LOCATION_ID` in prod `.env` (IDs may differ from stage — verify, do not assume).

### Testing checklist (LIV Night + Beach)

1. **Night regression:** `scope=nightlife` — diff, date filter, import, dedupe unchanged.
2. **Beach:** Daylife import → Beach `location_id`, `type=day_club`, seats + min spends.
3. **Both:** table shows new Night + Beach; each Import lands on correct location.
4. **Scope filter:** Daylife hidden when scope=nightlife; Night hidden when scope=daylife.
5. **Re-import:** Remove unused import → row back in primary table → Import again.
6. **Remove blocked:** event in any COE → disabled Remove + `removeBlockedReason`.
7. **No re-scrape:** after Import or Remove, UI updates from cache only.
8. **Env:** `LIV_*_LOCATION_ID` overrides target the correct location doc.

## Implementation rules

- **Reuse** existing event create/update flows and validation (`routes/events.js`, models, timezone helpers).
- **JSON-only** API responses; try/catch + logging on all async work.
- **No emoji** in EJS UI.
- **Preserve behavior** of existing Events section and GXN/Tao imports — Events Import is additive.
- **Document** every new venue parser, selector strategy, and field mapping in `PLANS.md` under **Abilities log**.

## R&D checklist (per venue)

**Venue implementation phase is complete** — use this checklist only when adding a **new** venue to scope (update `PLANS.md` first).

1. Document source URL(s) and listing vs detail pages in PLANS.
2. Spike fetch + parse (HTML, JSON-LD, API behind site, etc.).
3. Map external fields → THE1 event schema (name, start/end, location_id, type, status, timezone).
4. Manual preview on Events Import page before any bulk write.
5. Record limitations (pagination, JS-rendered DOM, rate limits, custom promos).
6. Update PLANS venue row status when stable.

## Prod rollout (reference)

Use this section when promoting a scrap-events venue from **stage R&D** to **prod**. Stage defaults in code/env work locally; prod `_id` values and seat catalogs **must be verified** — do not assume stage IDs match prod.

### Prerequisites

1. Deploy server build that includes the venue’s scrap-events stack (config, scrapers, routes, `Event` dedupe field).
2. Set `STAGE_MONGODB_URI` and `PROD_MONGODB_URI` in your shell or `.env` (read-only parity scripts only).
3. Run the venue’s parity script from `server/` — exit code `0` required before first prod import.

```bash
cd server
STAGE_MONGODB_URI='mongodb+srv://...' PROD_MONGODB_URI='mongodb+srv://...' node scripts/verify-<venue>-location-parity.js
```

Optional: pass the prod location `_id` if it differs from stage default, e.g. `MARQUEE_DAYCLUB_LOCATION_ID=<prodObjectId>`.

### Per-venue checklist

| Venue | Prod env vars | Stage default location `_id` | Parity script | Manual smoke (pilot event) |
|-------|---------------|------------------------------|---------------|----------------------------|
| LIV Night | `LIV_NIGHT_LOCATION_ID` | `69d947ac8ae9a8c036318759` | `verify-liv-location-parity.js` | Night import regression |
| LIV Beach | `LIV_BEACH_LOCATION_ID` | `69d9143e8ae9a8c036317fb7` | (same script — both locations) | Cloonee `EVE121488100020260627` |
| OMNIA Night | `OMNIA_LOCATION_ID` | `6a26ff4254364f05884f74ce` | `verify-omnia-location-parity.js` | Tiësto `EVE108900020260710` |
| OMNIA Dayclub | `OMNIA_DAY_LOCATION_ID` | `6a35172263c07e4f7521d24b` | (same script — night + day) | Run `sync-omnia-dayclub-seats.js` on prod first if Premium Villa / Stage Cabana missing |
| Hakkasan | `HAKKASAN_LOCATION_ID` | `6a3bd15f2c7e0f72e498b8a1` | `verify-hakkasan-location-parity.js` | Laidback Luke `EVE108500020260702` |
| TAO Beach | `TAO_BEACH_LOCATION_ID` | `6a3aba3c092d0d12566c49a1` | `verify-tao-beach-location-parity.js` | Jonas Blue `EVE111300020260710` |
| Palm Tree Beach | `PALM_TREE_BEACH_LOCATION_ID` | `6a3aca44bdbdad91c9fd0ee5` | `verify-palm-tree-beach-location-parity.js` | Tiësto `EVE111700020260711` |
| **Marquee Dayclub** | `MARQUEE_DAYCLUB_LOCATION_ID`, optional `MARQUEE_DAYCLUB_EVENTS_LISTING_URL` | `6a3ae2f9b7e4c059eb79880e` | `verify-marquee-dayclub-location-parity.js` | DJ Pauly D `EVE110900020260711` or Adventure Club `EVE110900020260725` |
| **Marquee Nightclub** | `MARQUEE_NIGHTCLUB_LOCATION_ID`, optional `MARQUEE_NIGHTCLUB_EVENTS_LISTING_URL` | `6a3bc1894bf82ca19711bbbd` | `verify-marquee-nightclub-location-parity.js` | Twenty Six — Lowkey; DJ Pauly D |

Listing URLs rarely change between stages; override `*_EVENTS_LISTING_URL` only if Booketing path differs.

### Expected seat codes (parity scripts)

Scripts fail if stage or prod location is missing codes or stage ≠ prod. Expected `code` values per venue:

| Venue | Expected seat codes |
|-------|---------------------|
| TAO Beach | Bungalow, Lotus Cabana, Tendai Lounge, Prime Daybed, Daybed, Terrace Table |
| Palm Tree Beach | Premium Beach Villa, Beach Villa, Coastal Cabana, Cabana, Seaside Tables, Shore Table, Boardwalk Table, Ocean Bed |
| **Marquee Dayclub** | **Daybed, Cabana, Grand Cabana, Prime Cabana, Prime Daybed** |
| **Marquee Nightclub** | **Cloud, Dance Floor, Full Upper Dance Floor, Salon, Third Tier Main Room, Upper Dance Floor** |
| Hakkasan | Main Room Owners, Main Room Stage, Main Room Lower Dance Floor, Main Room Upper Dancefloor, Main Room 3rd/4th Rows, Mezzanine Center, Mezzanine Side, Mezzanine Skybox |
| LIV / OMNIA | See script output — night + beach / night + day each checked separately |

### Marquee Dayclub prod rollout (step-by-step)

1. **Deploy** server with Marquee stack (`marqueeDayclubVenueConfig`, scrapers, import service, routes, `marqueeDayclubEventCode` on `Event`, dashboard card).
2. **Find prod location** — locate Marquee Dayclub `day_club` in prod MongoDB; copy its `_id` (may differ from stage `6a3ae2f9b7e4c059eb79880e`).
3. **Parity check** (required before first import):

```bash
cd server
STAGE_MONGODB_URI='...' PROD_MONGODB_URI='...' \
  MARQUEE_DAYCLUB_LOCATION_ID='<prodMarqueeDayclubObjectId>' \
  node scripts/verify-marquee-dayclub-location-parity.js
```

Confirm all five codes exist on **both** stage and prod and match: Daybed, Cabana, Grand Cabana, Prime Cabana, Prime Daybed.

4. **Set prod `.env`** on the deployed server:

```
MARQUEE_DAYCLUB_LOCATION_ID=<prodMarqueeDayclubObjectId>
# MARQUEE_DAYCLUB_EVENTS_LISTING_URL=https://booketing.com/microsite/house/events/61/1109/marquee-dayclub
```

5. **Restart** server so `getMarqueeDayclubVenueConfig()` picks up prod location.
6. **Smoke test** on prod admin Events Import:
   - Marquee Dayclub → **Show Live Events**
   - **Import** DJ Pauly D (`EVE110900020260711`) → Create Event → confirm **5 seats** have Minimum Spend pricing
   - **Remove** import → row returns to new list
7. **Resync** (if pricing drifts): `POST /v1/scrap-events/marquee-dayclub/resync-pricing/EVE110900020260711`

**Dedupe field:** `marqueeDayclubEventCode` (Booketing site `1109` → `EVE1109…`). **Do not** confuse with `taoEventId` (Tao Group Hospitality).

### Marquee Nightclub prod rollout (step-by-step)

1. **Deploy** server with Marquee Nightclub stack (`marqueeNightclubVenueConfig`, scrapers, import service, routes, `marqueeNightclubEventId` on `Event`, dashboard card).
2. **Find prod location** — Marquee Nightclub `night_club` in prod MongoDB (may differ from stage `6a3bc1894bf82ca19711bbbd`).
3. **Parity check:**

```bash
cd server
STAGE_MONGODB_URI='...' PROD_MONGODB_URI='...' \
  MARQUEE_NIGHTCLUB_LOCATION_ID='<prodMarqueeNightclubObjectId>' \
  node scripts/verify-marquee-nightclub-location-parity.js
```

Expected codes: Cloud, Dance Floor, Full Upper Dance Floor, Salon, Third Tier Main Room, Upper Dance Floor.

4. **Set prod `.env`:** `MARQUEE_NIGHTCLUB_LOCATION_ID=<prodObjectId>`
5. **Smoke test:** Events Import → Marquee Nightclub → import VIP event → confirm 6 seats priced → Remove.

**Dedupe field:** `marqueeNightclubEventId` — **not** `taoEventId`.

### Prod rollout order (suggested)

Run parity scripts and set prod env IDs **before** enabling imports for each venue. Suggested batch after deploy:

```bash
node scripts/verify-liv-location-parity.js
node scripts/verify-omnia-location-parity.js   # night + day; sync dayclub seats on prod if needed
node scripts/verify-hakkasan-location-parity.js
node scripts/verify-tao-beach-location-parity.js
node scripts/verify-palm-tree-beach-location-parity.js
node scripts/verify-marquee-dayclub-location-parity.js
node scripts/verify-marquee-nightclub-location-parity.js
```

Then set the corresponding `*_LOCATION_ID` values in prod `.env` and smoke one pilot event per venue.

## When adding production capability

Only after PLANS explicitly marks a venue **production-ready**:

- Idempotent imports (external id or stable hash dedupe).
- Admin-only routes + auth middleware.
- Dry-run vs commit modes.
- Audit log of imported / skipped / failed rows.

## Related existing imports

Study before duplicating:

- Events: `importGXNEvents()`, `importTaoGroup()` in `dashboard.ejs`
- Locations: `importGXNVenues()`, `importTaoGroup()` on Locations section
- Browser util: `utils/venueScraperBrowser.js` (shared with Tao-style scraping)

Prefer shared normalization utilities over copy-paste parsers.
