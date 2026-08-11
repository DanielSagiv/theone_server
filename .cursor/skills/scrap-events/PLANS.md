# Scrap Events — Plans (living document)

Update this file whenever we gain a new ability, finish a venue spike, or change scope.

**Last updated:** 2026-08-11  
**Phase:** R&D — **venue set complete** + **platform target / Big Gun bulk** (local scrape → Local/Stage/Prod commit). Next: validation, prod rollout, production hardening.

---

## Vision

Import events from venue websites into THE1, venue by venue, via the EJS **Events Import** console. Start with a small event sample per venue; expand parsers and automation once mapping and quality are acceptable.

---

## Current scope (R&D)

| Done | Item |
|------|------|
| yes | Skill + plans declared (`scrap-events`) |
| yes | EJS sidebar entry **Events Import** |
| yes | Diff-only listing + date range filter |
| yes | Scope selector Night / Beach / Both |
| yes | Env-based `LIV_NIGHT_LOCATION_ID` / `LIV_BEACH_LOCATION_ID` |
| yes | `GET /v1/scrap-events/liv/events` + `POST /liv/prepare-import` |
| yes | LIV Night detail scrape + 7-seat map (validated) |
| yes | LIV Beach detail scrape + seat map (pilot: Cloonee Daylife) |
| yes | Per-row Import → Create Event modal → `POST /v1/events` |
| yes | `livEventCode` dedupe |
| yes | Primary diff-only table + **Imported into THE1** section |
| yes | `DELETE /v1/scrap-events/liv/import/:livEventCode` undo (COE + booking guards) |
| yes | Local cache patch after import/remove (no re-scrape) |
| yes | `scripts/verify-liv-location-parity.js` |
| yes | OMNIA Booketing listing (current + next month) |
| yes | `GET /v1/scrap-events/omnia/events` + `POST /omnia/prepare-import` |
| yes | OMNIA TABLES detail scrape + human-label seat map (pilot: Deorro) |
| yes | `omniaEventCode` dedupe + undo `DELETE /omnia/import/:omniaEventCode` |
| yes | OMNIA EJS card + local cache patch |
| yes | `scripts/verify-omnia-location-parity.js` |
| yes | Venue catalog pricing rule — Minimum Spend → `event_price` (shared `urvenueInventoryDom.js`) |
| yes | Upcoming-only import — past events excluded from listing; blocked on prepare-import |
| yes | OMNIA detail URL `eventcode` guard + inventory wait + `OMNIA_EMPTY_INVENTORY` |
| yes | OMNIA resync pricing — `POST /omnia/resync-pricing/:omniaEventCode` |
| yes | OMNIA Balcony Small → Balcony Large seat map alias |
| yes | OMNIA Dayclub listing + import (`scope=daylife|both`) |
| yes | OMNIA Dayclub TABLES seat map + `venueType` on detail scrape |
| yes | `OMNIA_DAY_EVENTS_LISTING_URL` / `OMNIA_DAY_LOCATION_ID` env |
| yes | OMNIA scope selector Night / Day / Both (EJS) |
| yes | `scripts/sync-omnia-dayclub-seats.js` (Premium Villa, Stage Cabana) |
| yes | `verify-omnia-location-parity.js` — night + day locations |
| yes | Hakkasan Booketing listing (current + next month) |
| yes | `GET /v1/scrap-events/hakkasan/events` + `POST /hakkasan/prepare-import` |
| yes | Hakkasan TABLES detail scrape + 8-seat map (pilot: Laidback Luke) |
| yes | `hakkasanEventCode` dedupe + undo + resync-pricing |
| yes | Hakkasan EJS card + local cache patch |
| yes | Studio / R&Bae excluded from importable partition (v1) |
| yes | `scripts/verify-hakkasan-location-parity.js` |
| yes | TAO Beach Booketing listing (current + next month) |
| yes | `GET /v1/scrap-events/tao-beach/events` + `POST /tao-beach/prepare-import` |
| yes | TAO Beach TABLES detail scrape + 6-seat map (pilot: Jonas Blue) |
| yes | `taoBeachEventCode` dedupe + undo + resync-pricing |
| yes | TAO Beach EJS card + local cache patch |
| yes | Generic Book placeholder days excluded (v1) |
| yes | `scripts/verify-tao-beach-location-parity.js` |
| yes | Palm Tree Beach Booketing listing (current + next month) |
| yes | `GET /v1/scrap-events/palm-tree-beach/events` + `POST /palm-tree-beach/prepare-import` |
| yes | Palm Tree Beach TABLES detail scrape + 8-seat map (pilot: Tiësto) |
| yes | `palmTreeBeachEventCode` dedupe + undo + resync-pricing |
| yes | Palm Tree Beach EJS card + local cache patch |
| yes | All EVE1117 rows importable (no generic-Book filter) |
| yes | `scripts/verify-palm-tree-beach-location-parity.js` |
| yes | Marquee Dayclub Booketing listing (current + next month) |
| yes | `GET /v1/scrap-events/marquee-dayclub/events` + `POST /marquee-dayclub/prepare-import` |
| yes | Marquee Dayclub TABLES detail scrape + 5-seat map (pilot: DJ Pauly D) |
| yes | `marqueeDayclubEventCode` dedupe + undo + resync-pricing |
| yes | Marquee Dayclub EJS card + local cache patch |
| yes | All EVE1109 rows importable |
| yes | `scripts/verify-marquee-dayclub-location-parity.js` |
| yes | Marquee Nightclub taogroup.com listing |
| yes | `GET /v1/scrap-events/marquee-nightclub/events` + `POST /marquee-nightclub/prepare-import` |
| yes | Marquee Nightclub VIP Reservations tile + TABLES scrape + 6-seat map |
| yes | `marqueeNightclubEventId` dedupe + undo + resync-pricing |
| yes | Marquee Nightclub EJS card + local cache patch |
| yes | VIP-only importable partition (Buy Tickets-only skipped) |
| yes | `scripts/verify-marquee-nightclub-location-parity.js` |
| yes | Marquee Nightclub DOM listing parser (`.event-list__item` — not `parseListingPage`) |
| yes | Encore Beach Club wynnsocial.com listing (Day + Night, XS/Field Club excluded) |
| yes | `GET /v1/scrap-events/encore-beach/events` + `POST /encore-beach/prepare-import` |
| yes | Encore SEATING tab scrape (F&B Minimum) + 16-seat map + dual-location resolve |
| yes | `encoreEventId` dedupe + undo + resync-pricing |
| yes | Encore Beach EJS card (scope Day/Night/Both) + local cache patch |
| yes | `scripts/verify-encore-beach-location-parity.js` |
| yes | Import target selector Local / Stage / Prod + Connect (remote admin token) |
| yes | Platform proxy: login, partition, commit-import (flyer re-host + location remap) |
| yes | `POST /scrap-events/lookup-external-ids` for remote partition |
| yes | Dual dedupe: external id **or** location + date + normalized name (`scrapImportDedupe.js`) |
| yes | `POST /scrap-events/lookup-event-identities` for identity partition/commit |
| yes | Big Gun bulk runner (Encore-first venue order, pause Continue/Abort) |
| yes | Event flyer AI clean on commit (text removal, keep AR; fallback to original) |
| no | Hakkasan Studio / R&Bae seat map |
| no | Production hardening (audit, rate limits) |
| no | Additional scrap-events venues (current set complete) |

---

## Venue matrix

| Venue (display) | THE1 location | Source | Parser notes | Status |
|-----------------|---------------|--------|--------------|--------|
| LIV Las Vegas Nightlife | **LIV LAS VEGAS Night club** (`LIV_NIGHT_LOCATION_ID`) | listing + `/event/EVE.../` | Stage, df, cdf, cudf, udf, pb, 2nrb | **validated** |
| LIV Beach Daylife | **LIV LAS VEGAS Beach club** (`LIV_BEACH_LOCATION_ID`) | same listing | Sections: Cabanas, Couches, Daybeds, Club Area, Terrace; `bc` disambiguated by `the1Category` | **pilot** |
| OMNIA Night Club | **OMNIA** (`OMNIA_LOCATION_ID`, `night_club`) | Booketing `61/1089/omnia` | TABLES accordion; human seat labels; months: current + next | **pilot** |
| Omnia DayClub | **Omnia DayClub** (`OMNIA_DAY_LOCATION_ID`, `day_club`) | Booketing `61/40911541686/omnia-dayclub` | TABLES accordion; day seat map (Premium Villa, Stage Cabana, …) | **pilot** |
| Hakkasan Las Vegas | **Hakkasan** (`HAKKASAN_LOCATION_ID`, `night_club`) | Booketing `61/1085/hakkasan-las-vegas` | TABLES accordion; 8 main-room seats; Studio/R&Bae excluded v1 | **pilot** |
| TAO Beach | **TAO Beach** (`TAO_BEACH_LOCATION_ID`, `day_club`) | Booketing `61/1113/tao-beach` | TABLES accordion; 6 seats; generic Book rows excluded v1 | **pilot** |
| Palm Tree Beach | **Palm Tree Beach** (`PALM_TREE_BEACH_LOCATION_ID`, `day_club`) | Booketing `61/1117/palm-tree-beach-club` | TABLES accordion; 8 seats; all EVE1117 rows | **pilot** |
| Marquee Dayclub | **Marquee Dayclub** (`MARQUEE_DAYCLUB_LOCATION_ID`, `day_club`) | Booketing `61/1109/marquee-dayclub` | TABLES accordion; 5 seats; all EVE1109 rows | **pilot** |
| Marquee Nightclub | **Marquee Nightclub** (`MARQUEE_NIGHTCLUB_LOCATION_ID`, `night_club`) | taogroup.com venue calendar | DOM `.event-list__item` tiles; VIP Reservations + TABLES; 6 seats; slug dedupe | **pilot** |
| Encore Beach Club | **Encore Beach Club** (`ENCORE_DAY_LOCATION_ID`, `day_club`) | wynnsocial.com/events | `li.eventitem`; SEATING / F&B Minimum; site id `1103` | **pilot** |
| Encore Beach Club At Night | **Encore Beach Club At Night** (`ENCORE_NIGHT_LOCATION_ID`, `night_club`) | same calendar | venue label / site id `1163`; same SEATING DOM | **pilot** |

**Beach spike event:** Cloonee — `EVE121488100020260627` — https://www.livnightclub.com/las-vegas/event/EVE121488100020260627/cloonee/

**OMNIA spike events:** Tiësto — `EVE108900020260710` (night pricing validated). Deorro — `EVE108900020260718`. Dayclub: Steve Aoki — `EVE4091154168600020260628`; Vandelux — `EVE4091154168600020260703` (dayclub pricing validated in COE)

**Hakkasan spike event:** Laidback Luke — `EVE108500020260702` — Owners $4,000, Stage $3,500, Lower Dance Floor $3,000

**TAO Beach spike event:** Jonas Blue — `EVE111300020260710`

**Palm Tree Beach spike event:** Tiësto — `EVE111700020260711`

**Marquee Dayclub spike event:** DJ Pauly D — `EVE110900020260711`; Adventure Club — `EVE110900020260725`

**Marquee Nightclub spike events:** DJ Sourmilk — Marquee Mondays (`6-29-2026-marquee-mondays-marquee-nightclub`); Twenty Six — Lowkey (`7-1-2026-lowkey-in-the-library-marquee-nightclub`); DJ Pauly D (`7-3-2026-dj-pauly-d-marquee-nightclub`)

---

## Abilities log

| Date | Ability | Notes |
|------|---------|-------|
| 2026-06-09 | Project bootstrap | Skill, PLANS, EJS menu + Events Import |
| 2026-06-09 | LIV live listing preview | `GET /liv/events` |
| 2026-06-25 | LIV scrape reliability + completeness | Load More, custom promos, calendar fallback |
| 2026-06-25 | LIV import prefill + `livEventCode` | Night club pilot |
| 2026-06-09 | Diff-only + date range filter | `partitionLivEventsByImportStatus`, From/To pickers |
| 2026-06-28 | LIV Night + Beach dual import | Env location map, scope selector, beach detail scraper, `verify-liv-location-parity.js` |
| 2026-06-09 | Diff-only + undo import | Imported section, `DELETE /liv/import/:livEventCode`, COE guard, local cache patch |
| 2026-06-09 | OMNIA Night Club import | Booketing listing + TABLES detail, `omniaEventCode`, shared `scrapEventsShared.js`, verify script |
| 2026-06-09 | Venue catalog pricing rule | Minimum Spend → `event_price` / `event_min_spend`; `urvenueInventoryDom.js` |
| 2026-06-09 | Upcoming-only scrap import | `filterScrapEventsNotInPast`; LIV + OMNIA listing + prepare-import guard |
| 2026-06-28 | OMNIA pricing reliability | `eventcode` on detail URL; `waitForUrvenueInventoryRows`; `OMNIA_EMPTY_INVENTORY`; Balcony Small map; `resync-pricing` API |
| 2026-06-09 | OMNIA Dayclub import | Dual calendar + scope; day seat map; `sync-omnia-dayclub-seats.js`; extended verify script |
| 2026-06-09 | OMNIA Dayclub pricing reliability | `normalizeTableName` for `15 11:00am` titles; `inferOmniaVenueTypeFromEventCode`; `OMNIA_PRICING_NOT_APPLIED`; Minimum Spend `$` parse; Vandelux spike validated |
| 2026-06-09 | Hakkasan Las Vegas import | Booketing `61/1085` calendar + TABLES detail; `hakkasanEventCode`; Studio/R&Bae skip; pricing guards; verify script |
| 2026-06-09 | TAO Beach import | Booketing `61/1113` dayclub calendar + TABLES detail; `taoBeachEventCode`; generic Book skip; dayclub title normalize; verify script |
| 2026-06-09 | Palm Tree Beach import | Booketing `61/1117` dayclub calendar + TABLES detail; `palmTreeBeachEventCode`; all EVE1117 rows; 8-seat map; verify script |
| 2026-06-09 | Marquee Dayclub import | Booketing `61/1109` dayclub calendar + TABLES detail; `marqueeDayclubEventCode`; all EVE1109 rows; 5-seat map; verify script |
| 2026-06-09 | Marquee Nightclub import | taogroup.com venue calendar + VIP Reservations tile + TABLES; `marqueeNightclubEventId`; 6-seat map; VIP-only; verify script |
| 2026-06-09 | Marquee Nightclub listing fix | Replaced `parseListingPage` (150 junk links, 0 importable) with DOM `.event-list__item` parser; `isoDateFromTaoSlug` + `isoDateFromListingDateDisplay`; `/event/` VIP tile matching |

---

## Next steps (suggested)

**Venue build-out is done** — focus on quality and prod:

1. Validate imports + COE pricing per venue (pilot events in venue matrix above).
2. Run all parity scripts and set prod `*_LOCATION_ID` — see **Prod rollout (reference)** in `SKILL.md`.
3. Run `sync-omnia-dayclub-seats.js` on prod before first OMNIA dayclub import.
4. Validate more Beach events beyond Cloonee; add `Premium Terrace West` mapping if needed.
5. Optional: show scraped seat prices in Create Event review step.
6. Graduate to production-ready import (audit log, bulk import, rate limits).
7. New venues only when product scope expands — add row to venue matrix + follow `SKILL.md` R&D checklist.

---

## Environment

| Variable | Default |
|----------|---------|
| `LIV_EVENTS_LISTING_URL` | `https://www.livnightclub.com/las-vegas/events/` |
| `LIV_NIGHT_LOCATION_ID` | `69d947ac8ae9a8c036318759` |
| `LIV_BEACH_LOCATION_ID` | `69d9143e8ae9a8c036317fb7` |
| `OMNIA_EVENTS_LISTING_URL` | `https://booketing.com/microsite/house/events/61/1089/omnia` |
| `OMNIA_LOCATION_ID` | `6a26ff4254364f05884f74ce` |
| `OMNIA_DAY_EVENTS_LISTING_URL` | `https://booketing.com/microsite/house/events/61/40911541686/omnia-dayclub` |
| `OMNIA_DAY_LOCATION_ID` | `6a35172263c07e4f7521d24b` |
| `HAKKASAN_EVENTS_LISTING_URL` | `https://booketing.com/microsite/house/events/61/1085/hakkasan-las-vegas` |
| `HAKKASAN_LOCATION_ID` | `6a3bd15f2c7e0f72e498b8a1` |
| `TAO_BEACH_EVENTS_LISTING_URL` | `https://booketing.com/microsite/house/events/61/1113/tao-beach` |
| `TAO_BEACH_LOCATION_ID` | `6a3aba3c092d0d12566c49a1` |
| `PALM_TREE_BEACH_EVENTS_LISTING_URL` | `https://booketing.com/microsite/house/events/61/1117/palm-tree-beach-club` |
| `PALM_TREE_BEACH_LOCATION_ID` | `6a3aca44bdbdad91c9fd0ee5` |
| `MARQUEE_DAYCLUB_EVENTS_LISTING_URL` | `https://booketing.com/microsite/house/events/61/1109/marquee-dayclub` |
| `MARQUEE_DAYCLUB_LOCATION_ID` | `6a3ae2f9b7e4c059eb79880e` |
| `MARQUEE_NIGHTCLUB_EVENTS_LISTING_URL` | `https://taogroup.com/venues/marquee-nightclub-las-vegas/events/` |
| `MARQUEE_NIGHTCLUB_LOCATION_ID` | `6a3bc1894bf82ca19711bbbd` |
| `PUPPETEER_EXECUTABLE_PATH` | Mac: `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` |
