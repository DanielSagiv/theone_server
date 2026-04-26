# Admin: manage COE events (planning doc)

**Status:** Product / engineering specification only — **no implementation** in this step.

This document captures how we understand the task of changing **how an admin adds and removes events** from an **existing** COE when viewing **COE details**. The desired experience should mirror the **reference flow** used from the COE request / create path (see §5). **§6** documents what that reference flow **actually does in code today** (so alignment work is not based on assumptions). **§7** lists **gaps** between that reference and **admin Manage Events on COE details**. **§2** **reins in** what **admin vs client** may do from the **request / create card** so roles are not blurred.

---

## 1. How we understand the task

### 1.1 Audience and entry point

- **Who:** Admin only (today and going forward).
- **Where:** COE **details** screen (Experience details), where the admin currently sees each attached event and actions to change the lineup.

### 1.2 Current behavior (to replace at UX level)

- **Remove:** A **bin** control on the event card (annotation A1 in the “FLOW A (desired)” wireframe) removes the event from the COE (with whatever release / pricing / validation the backend already enforces).
- **Add:** A button (annotation A2), currently labeled like **Add Event**, sends the admin through a flow: pick an event from a list, then pick a **table** explicitly.

We are **not** asking to remove the underlying capabilities — only to **relocate and unify** them into a single flow that **looks and behaves like** the reference **Screen B → Screen C** pattern.

### 1.3 Desired behavior (high level)

1. **Rename** the primary action from “Add Event” to **Manage Events** (exact final copy can be aligned with design; wireframes also mention “Manage Experience Events”).
2. **Remove** the **bin** from the COE details event card. **Removing** an event from the COE happens **inside** the manage flow by **unselecting** that event on **Screen B** (equivalent outcome to today’s remove, including seat release and any server-side side effects).
3. Tapping **Manage Events** opens **Screen B** — a **Select Events** experience **aligned with** `coe-event-selection` (reference attachment 2: same *kind* of list, grouping, and “VIEW TABLES SECTIONS” affordance).
4. **Screen B** must show:
   - Events **already attached** to this COE (clearly indicated as selected / on the experience).
   - Events **available to add** in the relevant city + date range (same conceptual universe as today’s “available to add” for that COE).
5. On **Screen B**, the admin can:
   - **Unselect** an attached event → **remove** it from the COE (replaces the bin).
   - **Select** an event that is not on the COE → mark it for inclusion; completing the lineup may require **section/table resolution** via **Screen C** (see below).
6. **Screen C** is the **Tables Sections** experience **aligned with** `event-seats` (reference: user taps **VIEW TABLES SECTIONS** on Screen B for that event).
   - **Product intent:** user chooses a **section** (not necessarily an individual table row on the device); a **concrete table/seat** may be chosen automatically or by downstream logic.
   - **Important — current app behavior (see §6):** in `coeCategorySelect` mode, the client only persists **`seatCategory`** into **`coeSelectionStore`** and returns to Screen B; it does **not** assign a **`seat_id`** on the device. Bot / `create_coe_draft` may interpret category later. **Admin Manage Events on an existing COE** likely still needs a **real `seat_id`** via existing **add-with-seat** (or equivalent) APIs unless product adds a server-side auto-assign path.
   - **Grey / disabled state:** today, **per-section** unavailability is shown on **Screen C** (“No tables available for this section”). Product may additionally **grey out the whole event row on Screen B** when the event has **no** bookable inventory — that is **not** implemented on Screen B in the reference screen today (§6).
7. When the admin finishes the flow (e.g. **Done** on Screen B, or equivalent commit step), the **COE** — both the **in-app card** and the **persisted COE object** — reflects the **final** set of events and their **assigned tables**, subject to all existing **API validation** and business rules.

### 1.4 Important distinction vs. draft / client flow

The reference path (attachment 2) often goes through **draft selection** (`coeSelectionStore`, bot, proposal/draft creation). For **admin manage on an existing COE**, the **source of truth** after **Done** must be the **COE on the server** (and the details UI), not only a local draft store. Implementation will need a clear strategy: either **parameterize** the existing screens for “existing COE + `coeId`” or introduce a dedicated admin surface that **reuses UI components** but **commits** via existing **COE add/remove (and seat)** endpoints. This doc does not mandate the technical approach — only the **product outcome** and **parity** with the reference UX.

---

## 2. COE request / create card: what admin vs client can do (reined in)

This section **scopes** the reference flow so implementation does **not** blur roles: **Manage Events** is **only** for **admin on COE details**; the **request / create card** keeps **today’s split** between client and admin.

### 2.1 Client (Request Experience card)

- **Where:** Bot / client journey — e.g. **`COEPreferencesForm`** (Request Experience: dates, city, budget, party size, preferences, **Open full calendar of events**, submit). See **`COE-FLOW-A-REQUEST-ONLY.md`** for request-only vs manual-event behavior.
- **May do:**
  - Submit a **request** (or trigger draft creation per **current** product rules).
  - Optionally open **full calendar** → **`coe-event-selection`** → **`event-seats`** to choose events / sections; selections feed **`coeSelectionStore`** and the **structured submit message** to the bot (`/bot/message`), not direct admin COE event CRUD from this card.
- **Must not gain (via this feature):**
  - **Manage Events** on an **existing** COE, **remove** events from a live experience, or access **admin-only** COE event APIs that belong on **details**.
  - **Build experience** on a request-only COE — remains **admin-only** on **COE details** / original request card (Flow A).

### 2.2 Admin (Create Experience / create-for-client card)

- **Where:** Bot — e.g. **`COECreateForm`** with admin context (Search Clients → **Create Experience**, or equivalent): same **layout concept** as the client card with **admin affordances** (client binding, **Create proposal** where applicable per `COECreateForm` rules, etc.).
- **May do:**
  - Create or advance a **draft / proposal** for a client using **Open full calendar** → **Screen B / C**, with selections flowing through **`coeSelectionStore`** + submit path **as today**.
  - On a **request-only** COE, use **Build experience** (on **COE details**) to enter the **existing** admin create flow — **unchanged** by this doc; **Manage Events** is a **separate** admin action on details for editing the **event lineup** of an **existing** experience.
- **Must not be restricted** by Manage Events work: admin request/create flows **stay** as documented in Flow A and related docs; we **reuse UI patterns** (Screens B/C), not replace admin create with COE-details manage.

### 2.3 This feature (**Manage Events**) vs the request card

| Topic | Request / create card (client or admin) | **Manage Events** (this spec) |
| ----- | ---------------------------------------- | ----------------------------- |
| **Entry** | From bot card (submit request / create for client) | From **COE details** only |
| **Role** | Client **or** admin (different buttons / outcomes) | **Admin only** |
| **Persistence** | Draft / bot / `create_coe_draft` semantics per existing rules | **Existing COE** via **COE add/remove (+ seat)** APIs |
| **Screens B / C** | Reference: `coe-event-selection`, `event-seats` | **UX parity** only; do **not** widen client powers or remove admin create flows |

**Rule of thumb:** Reuse **screens and interaction design** from the request path; do **not** change **who** can do **what** on the request card. **Manage Events** is an additional **admin-only** surface on **details**, not a merge of details into the client card.

---

## 3. Screen mapping (desired admin flow)

| Label | Role | Reference in codebase (today) |
| ----- | ---- | ----------------------------- |
| **Screen A** | COE **details**; **Manage Events** button; **no bin** on event cards | `mobile/app/coe-detail.js` (and carousel/card components) |
| **Screen B** | Date-grouped **event list**; attached vs available; **unselect/select**; **VIEW TABLES SECTIONS**; **Done** (or equivalent) to apply | `mobile/app/coe-event-selection.js` (pattern; may need `coeId` mode or sibling screen) |
| **Screen C** | **Tables sections** for one event; **section** selection; today reference stores **category** in store (`coeCategorySelect`) — admin parity may need **seat resolution** for COE APIs | `mobile/app/event-seats.js` (`mode: 'coeCategorySelect'` from Screen B) |

*Note:* In the written spec, “VIEW TABLES SECTIONS” on Screen B navigates to **Screen C** (not back to Screen B).

---

## 4. Functional requirements (summary)

| Requirement | Notes |
| ----------- | ----- |
| Admin only | Gating unchanged; only admins see **Manage Events** and this flow. |
| Remove via unselect | Must invoke the **same** remove semantics as today (seat release, pricing, merge metadata, validation). |
| Add via select + section | Target: **concrete seat/table** on the COE per existing APIs. **Reference UI** only commits **section** to `coeSelectionStore`; implementer must bridge **category → `seat_id`** (client auto-pick from `GET` seats, or server change). |
| Grey out + messaging | **Reference today:** section-level disabled copy on Screen C. **Product ask:** may also grey out **event rows** on Screen B when no availability — **new** vs current `coe-event-selection`. |
| Commit | **Done** (or explicit save) updates COE; details screen reflects new list. |
| Guards | All existing rules for **paid / deposit / revision / last event** / etc. remain; UI must remain consistent with what is allowed today (hide, disable, or server error handling as appropriate). |

---

## 5. Reference flow (attachment 2 — “reference flow”)

For **examination only** (this ticket is admin + existing COE, not identical to draft creation). **Admin vs client** capabilities on this path are **bounded in §2**.

- Entry from COE request / preferences: **“Open full calendar of events”** → **Screen B** (`/coe-event-selection`) → **Screen C** (`/event-seats` with appropriate params, e.g. `coeCategorySelect`).
- Relevant mobile routes: `mobile/app/coe-event-selection.js`, `mobile/app/event-seats.js`.
- Related entry points in code include `COEPreferencesForm`, `COECreateForm`, bot flows — useful for **reusing** list/section UX and **not** duplicating layout logic.

---

## 6. Current implementation trace — “Open full calendar of events” (code review)

This section reflects a read-through of the **mobile** code paths used when the user taps **Open full calendar of events** from the request/create card. Use it when implementing **Manage Events** so UX alignment is **intentional**, not guessed.

### 6.1 Entry (Screen A on reference attachment)

| Source | File | Navigation |
| ------ | ---- | ------------ |
| Client Request Experience | `mobile/src/components/COEPreferencesForm.js` | `router.push({ pathname: '/coe-event-selection', params: { city, startDate, endDate, budget } })` |
| Admin / client Create Experience card | `mobile/src/components/COECreateForm.js` | Same `pathname` and **same param shape** (`city`, `startDate`, `endDate`, `budget`) |
| Bot “new COE” manual event path | `mobile/app/(tabs)/bot.js` (`new_coe_manual_select_yes`) | Initializes `setCOESelection({ city, startDate, endDate, budget, events: [] }, { merge: false })` then pushes **`/coe-event-selection`** with the same params |

**No `coeId`** is passed today; the screen is **draft/request scoped**, not “edit existing COE.”

### 6.2 Screen B — `coe-event-selection.js` (`/coe-event-selection`)

- **Data load:** `GET /events/search?start_date=…&end_date=…&city=…` (dates normalized to ISO day bounds in code).
- **Grouping:** `SectionList` by **calendar date** (`getDateKey(start_datetime)`); header shows date and event count.
- **Selection model:** In-memory `selectedByDateAndType`: **at most one event per `(dateKey, venue_type)`** (`location.type`, e.g. `night_club`, `day_club`). Tapping a row toggles selection; choosing another event for the **same day + venue type** triggers a **confirm** alert (“One event per venue type per day”) before replacing.
- **Categories:** `selectedCategoryByEventId` + sync from **`getCOESelection()`** on load and **`useFocusEffect`** after returning from Screen C.
- **VIEW TABLES SECTIONS:** `router.push({ pathname: '/event-seats', params: { eventId, mode: 'coeCategorySelect' } })`.
- **Footer:** **Back** (`router.back()`), **Clear** (clears local selection + `setCOESelection(null)`), **Done**:
  - Builds payload from `selectedSummary` + categories (and merges category hints from store).
  - If any selected event lacks a category, shows **`Alert`**: let **The1** choose section vs stay to choose.
  - **`setCOESelection({ city, startDate, endDate, budget, events: [...] }, { merge: false })`** then **`router.back()`**.
- **No COE API calls** on this screen; persistence is **in-memory store** until the user submits the bot form / draft flow.

**Gap vs Manage Events spec:** today there is **no** list of “already on this COE” merged with search results — only **user toggled** selection plus store hydration. **No** row-level grey-out for “event has zero availability” on this screen.

### 6.3 Screen C — `event-seats.js` (`/event-seats`, `mode=coeCategorySelect`)

- **Data load:** `GET /events/:eventId/seats` — **all** seats (not `available_only`); UI derives availability from `seat.status === 'available'`.
- **UI:** “Tables Sections (N)” — groups by **`seat.category`**; shows price/capacity range and **“X available”** per section.
- **`coeCategorySelect` mode:**
  - If section has **available** seats → **“Select from section”** → `handleSelectCategory` writes **`{ eventId, seatCategory }`** into **`coeSelectionStore`** via **`setCOESelection(..., { merge: true })`** (merges with other events in store) and **`router.back()`**.
  - If **no** available seats in that section → disabled pill **“No tables available for this section”** (not selectable).
- **Does not** pick or store a specific **`seat_id`** / table id in this mode on the client.

### 6.4 Downstream (context only)

- **Admin `COECreateForm`:** **Create draft** / **Create proposal** can require **`hasAdminSelectedEvents`** (selection present) — tied to the **store / form** flow, not COE details APIs.
- **Client submit:** Message + optional selection IDs/categories go to **bot**; server creates/updates draft per existing bot rules.

---

## 7. Alignment checklist — admin COE details “Manage Events” vs reference

Use this when designing the admin flow so **UX matches** the reference where intended and **backend contracts** stay correct.

| # | Topic | Reference today | Needed for Manage Events (existing COE) |
| - | ----- | ----------------- | ---------------------------------------- |
| 1 | **Route params** | `city`, `startDate`, `endDate`, `budget` only | Add **`coeId`** (or dedicated route) and derive dates/city from **COE** when opening Screen B; keep budget/party hints from COE if useful for warnings. |
| 2 | **Event source** | Single `/events/search` list | **Union / distinguish** events **already on COE** (from `GET /coes/my/:id` or equivalent) vs **available-to-add** (e.g. existing **`/coes/:coeId/events/available-to-add`**); selection rules may differ from “one per venue type per day” if COE already breaks that — **product decision**. |
| 3 | **Remove** | N/A (only local deselect) | **Unselect** on Screen B must call **`POST /coes/:id/events/remove`** (or current remove endpoint) with same validations as today’s bin. |
| 4 | **Add / section** | Store **`seatCategory` only** | Likely need **`seat_id`** (and price fields) for **`add-with-seat`**; implement **auto-pick first available seat in category** on client or extend server — **explicit design**. |
| 5 | **Done** | Writes **`coeSelectionStore`**, `router.back()` | Must **apply delta** to server COE (batch or sequential add/remove), handle errors, then refresh **COE details** — **no** reliance on store as sole source of truth. |
| 6 | **Revision / paid guards** | N/A on selection screen | Reuse **`coe-detail`** rules (e.g. hide/disable Manage Events when structural edits blocked). |
| 7 | **Grey unavailable events** | Section-level only on Screen C | If product requires **row-level** grey on Screen B, add **pre-flight** availability (e.g. fetch seats per event or aggregate flags) — **new work**. |
| 8 | **Calendar / store** | Client draft flow uses store heavily | Admin manage should **not** overwrite client **`coeSelectionStore`** in a way that breaks open request forms; prefer **`coeId` mode** or isolated state. |

---

## 8. Out of scope for this document

- Concrete API payloads, new endpoints, or refactors.
- Exact duplicate vs. fork of `coe-event-selection` / `event-seats`.
- Copy deck beyond the names above.
- Automated tests or migration of existing COEs.

---

## 9. Related documentation

- `docs/MD_files/COE-FLOW-A-REQUEST-ONLY.md` — Flow A / request-only context.
- `docs/MD_files/coe-paid-revision_96b542b8.plan.md` (if present under `.cursor/plans/`) — revision and structural-edit constraints when changing events on paid-like COEs.
- `docs/MD_files/COE-EVENT-MANAGEMENT-ENHANCEMENT.md` — may overlap; reconcile when implementing.

---

## 10. Wireframe assets (workspace)

Screenshots provided for product reference:

1. `Screenshot_2026-03-23_at_15.38.34-2a7b1b59-090a-468b-ab74-cc59e9946b52.png` — FLOW A (desired) three-screen admin story.
2. `Screenshot_2026-03-23_at_15.49.30-7f40de47-8fe1-4070-917f-5cbb10130b9a.png` — Reference flow (calendar → selection → sections).

---

*End of planning doc.*
