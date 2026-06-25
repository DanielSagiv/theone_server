# Scrap Events — Plans (living document)

Update this file whenever we gain a new ability, finish a venue spike, or change scope.

**Last updated:** 2026-06-09  
**Phase:** R&D

---

## Vision

Import events from venue websites into THE1, venue by venue, via the EJS **Events Import** console. Start with a small event sample per venue; expand parsers and automation once mapping and quality are acceptable.

---

## Current scope (R&D)

| Done | Item |
|------|------|
| yes | Skill + plans declared (`scrap-events`) |
| yes | EJS sidebar entry **Events Import** |
| yes | LIV pilot: **Show Live Events** preview (listing, images, no DB write) |
| yes | `GET /v1/scrap-events/liv/events` admin API |
| yes | `livLasVegasScraperService` + `venueScraperBrowser` util |
| no | Venue picker (multi-venue) |
| no | Select events to import |
| no | Detail-page scrape (tables / sections / prices) |
| no | Import into `Event` collection |
| no | Production hardening (dedupe on import, audit, rate limits) |

---

## Venue matrix

| Venue (display) | THE1 location | Source URL(s) | Parser notes | Status |
|-----------------|---------------|---------------|--------------|--------|
| LIV Las Vegas (+ LIV Beach on same listing) | TBD | https://www.livnightclub.com/las-vegas/events/ | puppeteer-core; `.uws-event-list-item[data-eventcode]`; Load More; fields: name, venue, category (Daylife/Nightlife), date, time, flyer image, detail URL | `spike` |

---

## Target event field mapping

| THE1 field | LIV listing source | Notes |
|------------|-------------------|-------|
| `name` | `.uv-event-name-title` | |
| `location` / `location_id` | `.uv-ev-venue` (LIV Las Vegas / LIV Beach) | Map to THE1 Location later |
| `start_date` / `end_date` | `data-eventcode` YYYYMMDD + `.uwsdtime` | Vegas timezone on import phase |
| `type` | `.venueurl span` category | day_club vs night_club TBD |
| `status` | — | Default `draft` when importing |
| External dedupe key | `eventCode` (e.g. `EVE121488100020260626`) | |

---

## Abilities log

| Date | Ability | Notes |
|------|---------|-------|
| 2026-06-09 | Project bootstrap | Skill, PLANS, EJS menu + placeholder Events Import section |
| 2026-06-09 | LIV live listing preview | Show Live Events button; ~127 events with images; `GET /v1/scrap-events/liv/events` |

---

## Next steps (suggested)

1. Map LIV Las Vegas / LIV Beach to existing THE1 Location records.
2. Detail-page scrape per selected event (tables, sections, prices).
3. Select-and-import UI on Events Import page.
4. Dry-run then commit via existing event create API.

---

## Open questions

- ~~Which venue is first pilot?~~ **LIV Las Vegas listing (includes LIV Beach)**
- ~~Static HTML vs client-rendered?~~ **Client-rendered; puppeteer-core + Chrome required**
- Default import status: `draft` vs `active`?
- Dedupe strategy across re-imports?

---

## Environment

| Variable | Default |
|----------|---------|
| `LIV_EVENTS_LISTING_URL` | `https://www.livnightclub.com/las-vegas/events/` |
| `PUPPETEER_EXECUTABLE_PATH` | Mac: `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` |
