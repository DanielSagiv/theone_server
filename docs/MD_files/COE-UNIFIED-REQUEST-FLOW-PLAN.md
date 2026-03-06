## COE / Experience Unified Request Flow – Design Plan

### 1. Goals

- **Unified request card**: Make the COE/experience request card UX identical for **clients and admins** (when admin is creating for a specific client), including seat preferences, specific preferences, and shortcut chips (birthday, conference, etc.).
- **Event selection by venue type & date**: After request data is filled, show **available events** for the requested dates; allow selecting **max one event per venue type per day** (venue type from `Location.type`, e.g. `day_club`, `night_club`).
- **Progressive COE build**: Let users (client/admin) **accumulate events into a COE** while enforcing the per-day/per-venue-type constraint and keeping compatibility with existing COE/merge logic.
- **Rich event + seat data**: For each selectable event, show media and seat groups (by seat category), with prices, capacity, and seat media.
- **Budget awareness**: Track an estimated **total cost** while user selects events; notify once when they exceed their request budget and visually mark budget overrun.
- **Mobile-first**: Design works and looks consistent on **iOS and Android**, aligned with existing mobile design system, and does not break current flows (including seat upgrade / merge logic).

---

### 2. Current State (Short Summary)

- **Request collection**
  - Client flow: `COEPreferencesForm` + follow-up step collects city, date range, budget, party size, plus **seat preferences** and **specific preferences with shortcuts**.
  - Admin flow: `COECreateForm` collects city, dates, budget, party size, and notes; it does **not** currently expose the same preference shortcuts UI as the client flow.
- **Available events preview**
  - Documented in `COE-FORM-AVAILABLE-EVENTS-FEATURE.md`. When city + dates are set, both forms can load **compact event rows** using `GET /v1/events/search` and show them at the bottom of the request card; selection is currently just “preview” (checkbox reserved for future).
- **COE creation**
  - Bot tools (`coe_preferences_form`, `coe_create_form`, `create_coe_draft`) collect preferences and create a **COE draft / request**; downstream logic (including merge logic) works from the resulting COE + selected seats.
  - Existing AI auto‑selection / optimization paths (e.g. `botAutoFillService`, `seatRecommendationService`) remain in the codebase but are **not invoked by this unified request flow**. They are reserved for potential future use.
  - Seat / merge logic, runner assignment, and upgrade flows are already implemented and must remain untouched.
  - Client creation / editing capabilities continue to be controlled by feature flags:
    - `ENABLE_CLIENT_COE_CREATION` – controls whether clients can initiate full COE creation flows (vs. just sending a request).
    - `ENABLE_CLIENT_COE_EDITING` – controls client editing of existing COEs.

---

### 3. Unified Request Card (Admin + Client)

#### 3.1 UX Requirements

- **Entry points unchanged (for this phase)**:
  - Clients will access the request / preferences card via the **same bot and quick‑action flows** as today (for example: “Request Experience” → `coe_preferences_form`).
  - Admins will access the create‑for‑client card via the **same flows** as today (for example: bot client list → “Create Experience” → `coe_create_form`).
  - This implementation **only unifies the card content and the downstream selection/review flow**; it does **not** change how or where these cards are triggered in the UI. Any changes to entry points are explicitly out of scope for this step.

- **Same fields and layout** for:
  - Client `Request Experience` flow.
  - Admin `Create Experience` for a client (from client list / bot).
- Fields:
  - City (using existing `CityPicker`).
  - Date range (existing `DateRangePicker`).
  - Budget (existing `BudgetInput`).
  - Party size (existing `PartySizeStepper`).
  - **Seat preferences** (free text) – textarea-style.
  - **Specific preferences** (free text) – textarea-style.
  - **Preference shortcuts** – chips (birthday, bachelor party, conference, anniversary, etc.) that append templated text into specific preferences.
- For **admin**:
  - Client context (avatar, name, email) stays at the top in `COECreateForm`.
  - All preference controls from client flow appear **below** the client block.

#### 3.2 Technical Plan (High-Level)

- **Mobile components**
  - Extract or reuse a **shared subcomponent** for the “preferences step” so both `COEPreferencesForm` and `COECreateForm` use the **same JSX + state structure** for:
    - Seat preferences input.
    - Specific preferences + shortcuts.
  - Keep validation rules in sync (min+max characters as currently used in client flow).
- **Bot payload**
  - Ensure both admin-initiated and client-initiated flows produce **the same shape** of `preferences` object sent to `create_coe_draft`:
    - `preferences.seat_preferences`
    - `preferences.specific_preferences`
    - Optional: `preferences.occasion` or `tags` derived from shortcuts (if not already present).
  - Preserve the distinction between:
    - **Client created** → COE status `request`.
    - **Admin created** → COE status `draft`.

---

### 4. Event Selection Rules (One per Venue Type per Day)

#### 4.1 Business Rules

- After the user completes the **request card** (city + date range + budget + preferences):
  - System loads **all events** in the requested date range and city (existing `/v1/events/search`).
  - For each **calendar day** and each **venue type** (from `Location.type`, e.g. `day_club`, `night_club`, or any other type):
    - User may select **at most one event** for that (date, venue_type) pair.
  - Example:
    - On 2026‑03‑06:
      - 2 `day_club` events → user can pick **max one** of those.
      - 3 `night_club` events → user can pick **max one** of those.
      - 1 `restaurant` event → user can pick **max one** of those.
      - So **max 3 events** for that day (1 per venue type).
- User can **change their mind**:
  - Selecting a different event for the same (date, venue_type) **replaces** the previous choice.
  - Rule is enforced for both client and admin flows.

#### 4.2 Data / API Considerations

- **Event search**
  - Reuse `/v1/events/search` with existing filters (city, start_date, end_date).
  - Ensure events are returned with:
    - `start_datetime` (or equivalent) in the **event’s local timezone** (e.g. Las Vegas time).
    - Populated `location_id` (or `location`) including:
      - `type` (e.g. `day_club`, `night_club`).
      - `media` (thumbnail / hero images).
- **Derived keys**
  - On the mobile client, derive:
    - `eventDateKey` = normalized date based on the event’s local date (consistent with how events are modeled on the server).
    - `venueTypeKey` = `location.type`.
  - Maintain a mapping:
    - `selectedEvents[dateKey][venueTypeKey] = eventId`.
  - Use this mapping to:
    - Toggle checkboxes / selection state in the event list.
    - Build the list of events that will go into the COE draft (`events` array for `create_coe_draft`).

---

### 5. Accumulating Events into the COE

#### 5.1 Interaction Model

- After the request card step:
  - Navigate to a **“Select Events for Your Experience”** screen (mobile).
  - Group events visually by **date**, and within each date group by **venue type**.
  - Each card/row:
    - Shows event info + media.
    - Shows seat groups (summary) and a CTA to inspect seats in detail.
  - User can scroll across dates and toggle selections.
- As user selects events:
  - The “selected events” panel shows a **summary list** with:
    - Date.
    - Venue type.
    - Event name.
    - Estimated cost contribution (see Budget section).
  - “Continue” button moves into the seats / finalization step once at least one event is selected.

#### 5.2 Compatibility With Existing COE & Merge Logic

- No changes to:
  - COE merge behavior.
  - Seat booking status updates.
  - Runner assignment.
- New flow is responsible only for:
  - Producing a **clean list of selected events and associated seat selections** that are valid under the **one-per-venue-type-per-day** rule.
  - Constructing an `events` array for `create_coe_draft` whose entries map cleanly onto the existing `COEItem` schema, e.g. each entry including:
    - `event_id`
    - normalized `event_date`
    - `venue_type` (from `Location.type`)
    - pricing fields required by `coeService` to compute `subtotal` / `total` (following existing pricing helpers).
  - Passing this structured payload into the existing `create_coe_draft` + `coeService` pipeline.
- All downstream processes (seat upgrades, merges, payments) continue to work on standard COE data structures (no schema changes expected).
  - The **one-per-venue-type-per-day** constraint is enforced only during this **request-building flow** on mobile; subsequent dashboard edits and merges are allowed to diverge from this rule if admins choose.

---

### 6. Event & Seat Presentation

#### 6.1 Event Cards

- **Data to display**
  - Event name.
  - Venue name.
  - Venue type label (e.g. “Day Club”, “Night Club”) derived from `location.type`.
  - Date/time (shown in the event’s local timezone as defined when creating the event).
  - Primary image:
    - Use event `media` image when available.
    - Fallback to location `media`.
- **Design**
  - Reuse / extend existing `EventCard` styles to fit the “select for COE” context.
  - Add visual affordances:
    - Selection state (highlight, checkmark, etc.).
    - Small pill for venue type.

#### 6.2 Seat Groups and Costs

- **Source**
  - Prefer existing event + seat structures (as in `event-seats`, seat upgrade features) to fetch:
    - Seat categories (e.g. “VIP Table”, “Standard Table”).
    - Price per seat / table.
    - Capacity.
    - Seat-level media (where available).
  - If existing APIs do not expose the required grouped seat/category/media data, introduce a **new read-only endpoint** that returns seat groups for an event in a shape compatible with current seat logic.
- **Grouping**
  - For each event, group seats by:
    - `category` (primary grouping key).
    - Optionally sub-group by `section` if already present in the schema.
- **Display**
  - For each category group:
    - Category name.
    - Min / max price in that category (across all seats in the group).
    - Capacity ranges.
    - One representative image (if seat media exists).
  - Provide entry points to existing detailed seat-selection UX (so we do not re‑implement low‑level seat selection logic).
- **Seat category selection (all users, via seat-options screen)**
  - On the **Select Events** screen, each event row focuses on **event information and media** plus a single **“View seat options”** button. No table/seat category chips are shown inline on this screen.
  - When the user taps **“View seat options”** for a selected event, they are taken to the **seat options screen** (current `event-seats` view) in a **category selection mode**:
    - Seats are aggregated by category/tier and presented as tappable category tiles/cards.
    - Each tile shows category name, price range, capacity range, and representative media.
    - The user selects **one category/tier per event** on this screen (they never choose an exact table).
  - After the user selects a category on the seat-options screen:
    - The choice is persisted for that event (used later when building the COE request).
    - The client navigates back to the **Select Events** screen, which now reflects the chosen category and updated estimated costs in the summary.
  - The selection is still sent in the request message as  
    **“Selected seat categories: eventId1:Category1, eventId2:Category2”**.  
    The server restricts seat selection to the chosen category and **auto-selects** one table within that category (budget, capacity, availability unchanged).

---

### 7. Budget Tracking & Notifications

#### 7.1 Budget Model

- Budget is set on the **initial request card** (existing `BudgetInput`).
- For estimation during event selection:
  - Use per-event **base price + representative seat costs** (How exactly is calculated will mirror current COE cost logic; implementation detail to be finalized with `coeService` / pricing rules).
  - Sum across all selected events to compute `estimatedTotal`.

#### 7.2 Behavior

- While user adds/removes events:
  - Continuously recompute `estimatedTotal`.
  - If `estimatedTotal` **first exceeds** the requested budget:
    - Show a **single notification** (toast / inline banner) such as:
      - “Your current selection exceeds your requested budget.”
    - Do **not** re‑notify on every subsequent change while still over budget.
  - Visual cue:
    - Total cost number turns **orange** when `estimatedTotal > budget`.
    - Returns to normal color if selection drops back under budget.
- All of this is **advisory only**:
  - System does **not** block selection.
  - Admin can continue building an over-budget COE if desired.

#### 7.3 Server-Side Re‑pricing & Review Step

- Before the request is finally submitted to the server:
  - Present a **“Review & Confirm Request”** step that shows:
    - Selected events and venue types per day.
    - The current estimated total vs. requested budget.
  - As part of entering this step, the client:
    - Triggers a **server-side re‑pricing** (using existing `coeService` pricing logic) for the selected events/seats.
    - Optionally re‑validates seat/event availability.
- Behavior:
  - If server‑calculated totals **differ** from the client estimator (e.g. someone updated prices in the console), the UI:
    - Updates the totals to match the server.
    - Shows a **single clear notice** that prices have changed since selection.
  - If pricing/availability checks fail in a way that invalidates the current selection:
    - Block submission.
    - Show an actionable error and allow the user to go back and adjust selections.
  - If everything matches:
    - Simply show the review summary with a primary **“Submit Request”** action.

---

### 8. Mobile UX, iOS & Android Considerations

- **Shared design system**
  - Use existing theme colors, typography, and card patterns from `colors`, `commonStyles`, and current COE components to keep the feature visually aligned.
  - Ensure interactions and spacing follow conventions from `QuickActions`, `EventCard`, `COECard`, `COECreateForm`, and `COEPreferencesForm`.
- **Platform specifics**
  - Use existing cross‑platform primitives already used in current forms (e.g. `KeyboardAvoidingView`, `SafeAreaView`) so the new screens behave correctly on **both iOS and Android**.
  - Verify scroll behavior and keyboard overlap on small devices (iPhone SE, smaller Androids).
  - Ensure performance for event lists with pagination or lazy loading if needed (do not load unbounded lists).

#### 8.3 Performance & Pagination

- For wide date ranges or high‑volume cities:
  - Apply **pagination or hard caps** on the number of events loaded per query or per day group to keep lists responsive.
  - Consider lazy‑loading seat summaries (fetching seat groups only when an event row/card is expanded) instead of preloading all seat data.

---

---

### 9. Non‑Goals & Constraints

- **No schema breaking changes** to COE or Event models; new flow must work on top of existing structures.
- **Do not modify**:
  - Merge logic (COE merge/unmerge rules).
  - Seat booking / release logic (`updateSelectedSeatsStatus`, `releaseSelectedSeats`, etc.).
  - Payment and status transitions documented in `COE-STATUS-FLOW.md` and `COE-REQUEST-STATUS-AND-CLIENT-CANCELLATION-PLAN.md`.
- AI usage (preference understanding, seat recommendations) remains as currently implemented; this feature focuses on **UX and deterministic rules** (one event per venue type per day, budget indicators).

---

### 10. Implementation Phases (High-Level Checklist)

1. **Unify request card**
   - Make admin `COECreateForm` reuse the same preference inputs + shortcuts as client `COEPreferencesForm`.
   - Ensure both flows send identical `preferences` payloads into the bot tool chain.
2. **Event selection screen**
   - Implement a dedicated mobile screen to list available events (grouped by date and venue type) based on request city + dates.
   - Enforce **one event per (date, venue_type)** in the selection state.
3. **COE accumulation + payload**
   - Build a selected-events summary and construct the events array for `create_coe_draft`, preserving existing COE creation semantics.
4. **Seat group display**
   - Integrate seat group summaries (by category) into event cards, reusing data and patterns from `event-seats` / seat upgrade features.
5. **Budget estimator**
   - Implement estimated total calculation and single over‑budget notification with orange total styling.
6. **Review & submit step**
   - Implement the server-side re‑pricing + availability check and review screen before final request submission.
7. **Cross‑platform UX polish**
   - Validate behavior and layout on iOS and Android devices.
   - Confirm no regressions in existing COE flows, especially merge and upgrade behavior.
   - Implementation: Select Events screen uses `SafeAreaView`, `keyboardShouldPersistTaps="handled"`, and Android-specific list padding. Use the checklist in **mobile/docs/COE-UNIFIED-FLOW-IOS-ANDROID-TESTING.md** for verification on both platforms.

---

### 11. Testing & Error Handling Focus Areas (for Implementation)

- Verify **one-event-per-(date, venue_type)** behavior across multiple venue types and multi‑day ranges.
- Test budget transitions:
  - Under budget → over budget (single warning, color change).
  - Over budget → back under budget.
- Simulate pricing changes between selection and review:
  - Ensure re‑pricing detects differences and notifies the user once.
  - Ensure critical mismatches or availability failures block submission with clear guidance.
- Exercise failure modes:
  - Event search failure.
  - Seat API failure.
  - Re‑pricing/review API failure.
  - In all cases, confirm the UI shows actionable errors and does not silently submit stale or invalid data.

