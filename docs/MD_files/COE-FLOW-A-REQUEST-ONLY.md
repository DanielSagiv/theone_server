# COE Flow A – “Request Only, Build Later” Design

## 1. Goal

**Goal:**  
Keep all existing COE flows working exactly as they do today **except one specific case**:

- **Case:** A **non‑admin user** submits the **Request Experience** card **without manually selecting any events** (never opened or finished the “Open full calendar of events” path; no events in `coeSelectionStore`).
- **New behaviour:**  
  - A **COE request** is created and sent to admin **without any events or tables auto‑assigned**.
  - Admin sees a **clean “Original Request Details” card** (like your 2nd screenshot), plus a **new “Build experience” button**.
  - When the admin clicks **“Build experience”**, we **start the existing admin “Create Experience for client” flow** (the “desiredFlowToadd”) using the request’s data.
  - Once the admin finishes building, there is a **COE in `draft` status** with events and seats.  
  - Until the COE is built, the **client sees only the request details**, not events, and **no “Build experience” button**.

Everything else (client flow with manual event selection, existing admin create‑for‑client flow, add‑event‑to‑COE admin flow, etc.) must remain **unchanged**.

---

## 2. Current Behaviour (Relevant Parts Only)

### 2.1 Client – Submit Request card

- UI: **Request Experience** card (`COECreateForm` rendered by `coe_preferences_form`).
  - Fields: dates, city, budget, party size, **Seat and general preferences**, **Occasion / Reason for your trip**, events in your dates → **Open full calendar of events**, **Submit Request**.
- On **Submit Request**:
  - `COECreateForm.performSubmit()` builds a **structured text message**, including:
    - `Start date: …`, `End date: …`, `City: …`, `Budget: $…`, `Number of people: …`
    - `Seat/Table preferences: <Seat and general preferences>`
    - `Specific preferences: <Occasion / Reason>`
    - Optional `Selected event IDs: …` and `Selected seat categories: …` (if the user used full calendar).
  - This message is sent to `/bot/message`.

### 2.2 Server – Current handling of that message

- `extractPreferencesFromFormSubmission()` (`botPreferenceService.js`) parses the message and returns `extractionResult` with:
  - `raw.start_date`, `raw.end_date`, `raw.city`, `raw.budget`, `raw.party_size`,
  - `raw.seat_preferences` (our merged “seat and general” text),
  - `raw.specific_preferences` (occasion / reason),
  - `raw.selected_events` and `raw.selected_seat_categories` (may be empty).
- `botService.js` Phase 2.4 currently:
  - Uses `extractionResult.raw` to build `toolParams`.
  - **Always** calls `create_coe_draft` (via `executeTool('create_coe_draft', toolParams, …)`), whether or not `selected_events` is empty.
  - `create_coe_draft` auto‑selects events if none are provided, so the client’s request **always becomes a COE draft with events/seats**, not a “pure request”.

### 2.3 Admin – Existing “Create Experience for client” flow (desiredFlowToadd)

- On Bot screen:
  - Admin taps **Search Clients** → bot sends `client_list`.
  - In `client_list` card, admin taps **Create Experience** for a client.
  - Bot returns `structured_data.type = 'coe_create_form'`.
  - `BotResponseRenderer` renders `COECreateForm` **in admin mode**, pre‑filled for that client.
  - Admin fills data, optionally opens full calendar, then taps **Submit**.
  - That message is parsed the same way and `create_coe_draft` is called, producing a **draft COE** for that client.

### 2.4 Admin – Viewing a COE request (what we like today)

- On `COEDetailScreen` (`coe-detail.js`), when a COE has `original_request_data`, the app renders `COEOriginalRequestCard`.
- That card shows:
  - Budget, requested dates, party size, city
  - **Seat and general preferences**
  - **Occasion / Reason for your trip**
- This is the **visual we want to keep** for the “request only” state, but with **no events attached**, and **plus a “Build experience” button** for admin only.

---

## 3. Desired Behaviour (Precise)

### 3.1 Client “Request Only” Case (no manual events)

- User (not admin) fills the Request Experience card (dates, city, budget, party size, seat/general, occasion).
- User **does NOT** select events (either never opened full calendar, or leaves it with no selections).
- User taps **Submit Request**.
- Result:
  - **A COE is created with:**
    - `status: 'request'`
    - `events: []` and `selected_seats: []`
    - `original_request_data` populated from the message: budget, requested_dates, party_size, city, seat_preferences (Seat and general preferences), general_preferences (Occasion), original_request_text.
  - **No events or tables are auto‑assigned.**
  - Admin receives a **notification** and can open this COE like today.
  - On the client side, the user can see that they have **submitted a request**, but **does not see any events** yet.

### 3.2 Admin view of a “request only” COE

- When admin opens that COE in **Experience Details**:
  - They see the **Original Request Details** card exactly like the current design.
  - Under that card:
    - **No events list** yet (or an empty Events section, depending on final UX, but no auto‑assigned events).
  - The Original Request Details card now includes a **new button**:
    - **Label:** `Build experience`
- Clicking **Build experience**:
  - Starts the **existing admin “Create Experience for client” flow** (desiredFlowToadd) using this request’s data:
    - Same Create Experience card UI as “Search Clients → Create Experience”.
    - Pre‑filled with the request’s:
      - Dates, city, budget, party size,
      - Seat and general preferences,
      - Occasion / Reason.
  - Admin can:
    - Open full calendar,
    - Choose events and tables,
    - Submit to create/update a COE draft.
- After admin submits:
  - There is a **COE in `draft` status** with events/seats filled.
  - That draft is linked to the **same user** and request, and can then be proposed to the client like any other draft.

### 3.3 Other flows must remain unchanged

- **Client flow with manual event selection**:
  - If the client selects events via full calendar and then submits, we **keep today’s behaviour**:
    - Use `create_coe_draft` directly,
    - Create an immediate draft with events/seats.
- **Admin Search Clients → Create Experience**:
  - Remains exactly as is.
- **Admin “Add Event to COE” flow** (`add-event-to-coe.js`):
  - Remains as documented in `ADMIN-ADD-EVENT-TO-EXPERIENCE-PLAN.md`.
- **New COE (experimental) flow**:
  - Unchanged / stashed as already implemented.

---

## 4. Implementation Plan (Step‑by‑Step, Each Step Testable)

> **Important:** Steps are ordered so each can be implemented and tested independently, minimizing risk to existing flows.

### Step 1 – Server: Split form submissions into “client request‑only” vs “normal draft”

**Goal:**  
Teach `botService` to **detect the client request‑only case** and handle it differently, without touching admin or manual‑events submissions.

**Changes:**

1. In `botPreferenceService.extractPreferencesFromFormSubmission`:
   - **No change** needed; it already provides:
     - `raw.selected_events` (array),
     - preference and request data.
2. In `botService.js` Phase 2.4 (form submission path):
   - Detect **client request without manual events**:
     - `user.role === 'client'` AND
     - `raw.selected_events` is **missing or empty**.
   - For this case only:
     - **Do not call `create_coe_draft`.**
     - Create a `COE` directly via `coeService.createCOE` (or equivalent) with:
       - `status: 'request'`,
       - `events: []`,
       - `selected_seats: []`,
       - `original_request_data` filled from `raw` (plus `original_request_text`).
     - Set `conversation.active_coe_id` to this COE’s ID.
     - Append a confirmation assistant message like:
       - “Your experience request has been submitted. Our team will now build the best experience for you and send you a draft to review.”
   - For all **other cases**:
     - Keep the **existing** `create_coe_draft` behaviour (admin flows, client with manual events, etc.) untouched.

**Tests:**

- **T1 – Client request‑only path:**
  - Log in as non‑admin.
  - Fill the Request Experience card.
  - **Do not** open or complete full calendar selection.
  - Submit.
  - Expected:
    - A new COE in DB:
      - `status: 'request'`,
      - `events.length === 0`,
      - `original_request_data` populated (budget, dates, party size, city, seat/general, occasion).
    - Bot replies with a simple “request received” message, **not** a full draft card.
- **T2 – Client with manual events still works:**
  - Client fills card, opens full calendar, selects events/tables, submits.
  - Expected:
    - `create_coe_draft` is called,
    - A draft COE with events exists (today’s behaviour).
- **T3 – Admin create‑for‑client unchanged:**
  - Admin Search Clients → Create Experience, then submit.
  - Expected:
    - Same draft flow as today (uses `create_coe_draft`).

---

### Step 2 – API + model: Ensure “request” COE is visible in detail screens

**Goal:**  
Ensure a `status: 'request'` COE created in Step 1 appears correctly for admin and client in `/coes/my/:id` and in mobile `coe-detail`.

**Changes:**

1. **Server:**
   - Confirm `/coes/my/:id` already includes `original_request_data` (it does).
   - Confirm no filters exclude `status: 'request'` COEs for clients or admins.
2. **Mobile:**
   - Verify that `COEDetailScreen` already:
     - Renders `COEOriginalRequestCard` when `coe.original_request_data` is present.
     - Shows **no events** or an empty events state when `coe.events` is empty.

**Tests:**

- **T4 – Admin sees request‑only COE:**
  - As admin, open the COE created in T1 by `coeId`.
  - Expected:
    - Status chip shows `REQUESTED` (or similar).
    - **Original Request Details** card is visible with:
      - Budget, dates, party size, city,
      - Seat and general preferences, Occasion.
    - Events area shows **no auto‑assigned events**.
- **T5 – Client sees their pending request:**
  - As the same client, open that COE or go via your existing entry point.
  - Expected:
    - They see that their request is **awaiting review** (whatever copy you already use),
    - No events are shown.

---

### Step 3 – Add “Build experience” button to Original Request card (admin only)

**Goal:**  
Let admin start building an experience from a request‑only COE via a clearly named button.

**Changes (mobile only):**

1. **`COEOriginalRequestCard` component:**
   - Extend props to accept:
     - `onBuildExperience?: () => void`
   - Render a **primary button** at the bottom:
     - **Title:** `Build experience`.
     - Only render if `onBuildExperience` is provided (admin only).
2. **`coe-detail.js`:**
   - When user is admin and `coe.status === 'request'` and `coe.original_request_data` exists:
     - Render `COEOriginalRequestCard` with `onBuildExperience={handleBuildExperienceFromRequest}`.
   - Implement `handleBuildExperienceFromRequest` to **delegate to Step 4** (initially it can just log/alert during development).

**Tests:**

- **T6 – Admin sees Build button:**
  - Open a request‑only COE (T1).
  - Expected:
    - Original Request Details card includes **“Build experience”** button at the bottom.
- **T7 – Client does NOT see Build button:**
  - Open the same COE as the client.
  - Expected:
    - No “Build experience” button anywhere.

---

### Step 4 – Wire “Build experience” to admin Create Experience flow

**Goal:**  
When admin clicks **Build experience** on a request‑only COE, they land in the **exact same Create Experience card** they would get from **Search Clients → Create Experience**, pre‑filled from `original_request_data`.

#### 4.1 Server: helper/endpoint to trigger `coe_create_form` from a request COE

- Add a new internal route, e.g.:
  - `POST /v1/coes/:coeId/build-experience-form`
- Behaviour:
  - Validate:
    - COE exists and `status === 'request'`.
    - User is admin and allowed to manage this COE.
  - Construct a `coe_create_form` structured payload using:
    - **Client id:** `coe.client_id`
    - **Defaults** from `original_request_data`:
      - `city`, `requested_dates.start_date` / `end_date`,
      - `budget.max` & currency,
      - `party_size`,
      - `seat_preferences` (Seat and general preferences),
      - `general_preferences` (Occasion).
  - Append this as an **assistant message** to the admin’s bot conversation (same format as the existing `coe_create_form` tool output).
  - Return the new message (or message list) to mobile.

#### 4.2 Mobile: `handleBuildExperienceFromRequest`

- In `coe-detail.js`:
  - Implement `handleBuildExperienceFromRequest` to:
    - Call `POST /coes/:coeId/build-experience-form`.
    - On success, navigate the admin to the **Bot tab**.
    - The bot conversation will contain a new **Create Experience** card (`coe_create_form`) pre‑filled from the request.
- Admin then:
  - Adjusts fields if needed.
  - Optionally uses **Open full calendar of events**.
  - Submits, which calls `create_coe_draft` as today.

#### 4.3 COE linking / status strategy

- Decide how the new draft relates to the original request COE:

**Option A – New COE linked to request (simpler):**

- `create_coe_draft` behaves as today (always creates a new COE).
- New draft COE includes a back‑reference `request_source_coe_id` (optional).
- The original request COE remains:
  - `status: 'request'`,
  - `events: []`.
- Pros: minimal changes to `create_coe_draft`.  
- Cons: two COEs per journey (request + draft).

**Option B – Upgrade request COE into draft (cleaner):**

- Extend `create_coe_draft` (or a wrapper) to accept `request_coe_id`.
- When `request_coe_id` is provided:
  - Use that record instead of creating a new one:
    - Set `status: 'draft'`,
    - Fill `events`, `selected_seats`, price fields, etc.
    - Keep `original_request_data` unchanged.
- Pros: single COE per journey.  
- Cons: more invasive; must be very careful not to break other `create_coe_draft` callers.

**Tests:**

- **T8 – Build Experience card appears in Bot:**
  - As admin, on a request‑only COE, tap **Build experience**.
  - Expected:
    - You’re taken to the Bot tab.
    - At the bottom of the conversation there is a **Create Experience** card (`coe_create_form`) for that client.
    - Fields are pre‑filled from the request (dates, city, budget, party size, seat & general preferences, occasion).
- **T9 – Admin completes Build flow:**
  - On that Create Experience card:
    - Optionally open full calendar, pick events and tables, submit.
  - Expected:
    - A draft COE exists with:
      - The same client,
      - Events and seats as chosen,
      - Status = `draft`.
    - Original request data is preserved.
- **T10 – Client sees draft after admin build:**
  - As the client, refresh your experiences.
  - Expected:
    - You see a **draft/proposal** experience (depending on your status naming).
    - If you chose Option B (same COE updated), the original request COE is now the draft; if Option A (new COE), you can still see that the new draft is clearly related.

---

## 5. Safeguards / Non‑Goals

- **Do NOT change:**
  - Parsing regexes in `extractPreferencesFromFormSubmission` (unless strictly necessary).
  - The behaviour of `create_coe_draft` for:
    - Admin “Create Experience” flow,
    - Client flows with manual events.
  - Admin **add‑event‑to‑COE** and **merge** flows.
  - New COE experimental flow (stashed).

- **Error handling:**
  - For the new “request‑only” branch:
    - If creating the COE fails, log clearly and send a human‑readable error to the user.
  - For `build-experience-form` endpoint:
    - Validate `status === 'request'` and admin permissions; return clear errors if misused.

---

## 6. Summary

- **Only one path changes:**  
  Client submits the Request Experience card **without manually selecting events**.
- **New result:**  
  A **pure request COE** (no events) is created, admin sees **Original Request Details** plus **Build experience** button.
- **Admin builds later:**  
  Clicking **Build experience** starts the **existing create‑for‑client flow**, leading to a **draft COE** while keeping all other flows intact.

