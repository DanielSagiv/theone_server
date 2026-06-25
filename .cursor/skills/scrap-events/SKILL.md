---
name: scrap-events
description: >-
  R&D and implementation guide for THE1 "scrap events" — importing events from
  venue websites into the platform via the EJS Events Import console. Use whenever
  the user says "scrap events", events import, venue scraping, or work on pulling
  external venue calendars into our events system.
---

# Scrap Events

## Status

**Phase: R&D** — not production. Iterate venue-by-venue; expand coverage only after a venue path is validated.

## Trigger

When the user says **scrap events** (or equivalent), always:

1. Read this skill (`server/.cursor/skills/scrap-events/SKILL.md`).
2. Read and follow `server/.cursor/skills/scrap-events/PLANS.md`.
3. Prefer small, reversible changes; do not wire production imports until PLANS marks a venue **production-ready**.

## Goal

Scrape events from venue websites and populate them into THE1 (locations → events), starting narrow and growing capability over time.

**Flow (target):**

1. List / select venues (mapped to our `Location` records).
2. Drill into one venue.
3. Fetch that venue’s external event listings.
4. Preview, dedupe, map fields, then import into our events API.

**Rollout strategy:** one venue at a time → prove a subset of events → expand parsers and venues → graduate to production.

## EJS console

| Item | Path |
|------|------|
| Sidebar label | **Events Import** |
| Section id | `events-importSection` |
| Nav `data-section` | `events-import` |
| View | `server/views/test/dashboard.ejs` |

Admin test dashboard: `/test/dashboard` (same auth as other console sections).

**LIV pilot (R&D):** Events Import → **Show Live Events** → `GET /v1/scrap-events/liv/events` (admin, preview only, no DB writes). Requires `puppeteer-core` and Chrome (`PUPPETEER_EXECUTABLE_PATH` on non-Mac).

## Repo layout (evolve as we build)

```
server/
├── .cursor/skills/scrap-events/
│   ├── SKILL.md          # This file — agent workflow
│   └── PLANS.md          # Living roadmap, venue matrix, abilities log
├── utils/venueScraperBrowser.js   # Shared puppeteer fetch + Load More
├── services/scrapEvents/
│   └── livLasVegasScraperService.js
├── routes/scrapEvents.js            # GET /v1/scrap-events/liv/events (preview)
└── views/test/dashboard.ejs         # Events Import UI — Show Live Events
```

Before adding endpoints: scan `server/routes/` for existing import patterns (e.g. GXN, Tao Group on Events / Locations).

## Implementation rules

- **Reuse** existing event create/update flows and validation (`routes/events.js`, models, timezone helpers).
- **JSON-only** API responses; try/catch + logging on all async work.
- **No emoji** in EJS UI.
- **Preserve behavior** of existing Events section and GXN/Tao imports — Events Import is additive.
- **Document** every new venue parser, selector strategy, and field mapping in `PLANS.md` under **Abilities log**.

## R&D checklist (per venue)

1. Document source URL(s) and listing vs detail pages in PLANS.
2. Spike fetch + parse (HTML, JSON-LD, API behind site, etc.).
3. Map external fields → THE1 event schema (name, start/end, location_id, type, status, timezone).
4. Manual preview on Events Import page before any bulk write.
5. Record limitations (pagination, JS-rendered DOM, rate limits).
6. Update PLANS venue row status when stable.

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

Prefer shared normalization utilities over copy-paste parsers.
