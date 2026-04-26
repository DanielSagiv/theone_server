## Feature: THE1 Seat Category (`the1Category`) for Locations

### 1. Goal

Enhance seat categorization for **locations** by introducing a new, flexible field `the1Category` on each seat/table:

- Keep existing `category` field **unchanged** (GXN / legacy structural category).
- Add `the1Category` as a **THE1‑defined business category**:
  - Free-form, admin-controlled values (no hard‑coded enum to start).
  - Previously used values become **reusable options** when creating/editing seats.
  - Usable by pricing logic, UI grouping, recommendations, etc., independent of GXN changes.
- Ensure both **new** and **existing** locations can have `the1Category` added/edited via the admin UI.

---

### 2. Current State (for context)

- **Location seats model**
  - `models/Location.js` → `SeatSchema`:
    - Fields include `code`, `label`, `category`, `section`, `capacity`, `minSpendUSD`, `priceTier`, `qualityScore`, `sentiment`, etc.
    - `category` is an enum:

      ```js
      category: {
        type: String,
        enum: [
          'backwall', 'large_3rd_tier_couch', 'third_tier_couch',
          'upper_dance', 'lower_dance', 'four_tops', 'stage_tables', 'owner_tables'
        ],
        index: true
      },
      ```

- **Validation**
  - `utils/validationSchemas.js` → `seatSchema`:

    ```js
    category: Joi.string().valid(
      'backwall','large_3rd_tier_couch','third_tier_couch',
      'upper_dance','lower_dance','four_tops','stage_tables','owner_tables'
    ),
    ```

- **GXN import**
  - `services/gxnImportService.js` → `extractSeatsFromItems`:
    - Maps GXN item names into the fixed `category` enum via a `categoryMap`.
    - Does **not** currently set any separate “business” category.

- **Usage**
  - Throughout services/UI (`dashboard.ejs`, `seatUpgradeService`, COE flows), we primarily:
    - Read `seat.category` for grouping / display.
    - Do **not** have a second, more abstract grouping field.

---

### 3. High-Level Design

#### 3.1 New Field on Seats: `the1Category`

- **Schema** (Mongo / Mongoose, per seat on a location):

  ```js
  the1Category: {
    type: String,
    trim: true,
    index: true
    // No enum initially: free text to allow rapid iteration
  },
  ```

- **Semantics**:
  - Represents THE1’s **own categorization** logic for the seat:
    - Examples: `prime_stage`, `great_value`, `vip_bar`, `standard_back`, etc.
  - Independent from `category`:
    - `category` can stay aligned with GXN or structural map.
    - `the1Category` can be tuned for UX, pricing, and bot recommendations.

- **Backward compatibility**:
  - Existing seats:
    - `the1Category` is initially `undefined` / missing.
    - They continue to function as today using `category`.
  - New logic should be written to:
    - Prefer `the1Category` if present.
    - Fallback to `category` when `the1Category` is not set.

#### 3.2 Validation Layer

- Extend `seatSchema` in `utils/validationSchemas.js`:

  ```js
  the1Category: Joi.string().allow(''),
  ```

- Notes:
  - No enum at first → admin can introduce new values directly from UI.
  - We allow empty string so the field is optional/nullable.
  - Later, if we standardize, we can tighten this to a `valid(...)` list without breaking stored data (as long as we include all existing values).

#### 3.3 Reusable THE1 Categories (Admin UX)

- Concept:
  - Collect distinct `the1Category` values used across existing location seats.
  - When editing/creating seats for a location:
    - Provide a **select + free-text** control:
      - Dropdown: previously used `the1Category` values (sorted, unique).
      - Text input: allow typing a new category (which then becomes reusable going forward).

- Behavior:
  - **New location / seat**:
    - Admin can choose from 0..N existing THE1 categories or type a new one.
  - **Existing location / seat**:
    - Any existing `the1Category` value is shown as the current selection.
    - Admin can change it to another existing value or type a new one.

---

### 4. Data Model Changes

**File:** `models/Location.js`

1. **SeatSchema**

   Add `the1Category` after `category` to keep related fields grouped:

   ```js
   const SeatSchema = new mongoose.Schema({
     code: { type: String, required: true, trim: true, index: true },
     label: { type: String, trim: true },
     category: {
       type: String,
       enum: [
         'backwall', 'large_3rd_tier_couch', 'third_tier_couch',
         'upper_dance', 'lower_dance', 'four_tops', 'stage_tables', 'owner_tables'
       ],
       index: true
     },
     the1Category: {
       type: String,
       trim: true,
       index: true
     },
     section: { type: String, trim: true },
     capacity: { type: Number, min: 0 },
     ...
   }, { _id: true });
   ```

2. **Indexes**
   - The extra index on `the1Category` supports:
     - Querying all seats by THE1 category.
     - Fast lookups for analytics / upgrade logic / UI filters.

---

### 5. Validation & API Contract

**File:** `utils/validationSchemas.js`

- Update `seatSchema`:

```js
const seatSchema = Joi.object({
  code: Joi.string().required(),
  label: Joi.string().allow(''),
  category: Joi.string().valid(
    'backwall','large_3rd_tier_couch','third_tier_couch',
    'upper_dance','lower_dance','four_tops','stage_tables','owner_tables'
  ),
  the1Category: Joi.string().allow(''),
  section: Joi.string().allow(''),
  capacity: Joi.number().min(0),
  ...
});
```

- All location create/update APIs that accept `seats`:
  - Automatically allow `the1Category` in the payload.
  - No extra fields are required; existing requests without `the1Category` remain valid.

---

### 6. Admin UI / UX (Location Seats)

> Note: actual implementation details depend on existing EJS or frontend structure, but behavior should follow these rules.

#### 6.1 New Seat Editor Controls

- For each seat row in the location editor:
  - Show both:
    - **System Category** (existing `category`):
      - Same behavior as today.
    - **THE1 Category** (new `the1Category`):
      - Control type: **combo** (select + free text).
      - Initially empty for legacy seats unless we backfill (backfill is optional and can be separate task).

- Data source for dropdown options:
  - Distinct `the1Category` values across:
    - All seats in the current location.
    - Optionally all locations (if we want global reuse).
  - Sorted and deduplicated.
  - Exclude empty/null values.

#### 6.2 Editing Existing Locations

- When loading an existing location:
  - For seats that already have `the1Category`:
    - Pre-fill the THE1 category field with that value.
  - For seats without `the1Category`:
    - Leave field empty; admin can:
      - Assign an existing option from the dropdown.
      - Type a new one.

- Save behavior:
  - On save/update:
    - Persist `the1Category` per seat along with other seat fields.
    - Validation ensures field is a string (or empty).

---

### 7. GXN Import Integration (Optional / Phase 2)

Initial implementation can leave `the1Category` **unset** for GXN imports. Later, we can enhance:

- **File:** `services/gxnImportService.js`

In `extractSeatsFromItems`:

```js
const seat = {
  code: item.itemname || itemCode.slice(0, 20),
  label: item.itemname || '',
  category: mapToCategory(item.itemname),
  the1Category: null, // or a mapping if we decide one
  section: item.econame || '',
  ...
};
```

Future enhancement:
- Add a separate mapping from GXN itemnames → THE1-high-level buckets (e.g. `prime_zone`, `good_zone`, `value_zone`).

---

### 8. Usage Guidelines for New Logic

When writing **new** features that care about seat categories:

- Prefer **`the1Category`** when present:

```js
const effectiveCategory = seat.the1Category || seat.category || 'uncategorized';
```

- Use that for:
  - Grouping seats in UI.
  - Determining pricing bands.
  - Seat upgrade recommendation tiers.

Existing features that currently read `seat.category` can be left as-is and incrementally updated to use `effectiveCategory` when we’re ready.

---

### 9. Testing Plan

1. **Schema & Validation**
   - Create a location with seats including `the1Category`:
     - Expect `Location` documents to store the field per seat.
   - Update an existing location, adding `the1Category` to one or more seats:
     - Confirm updates succeed and are persisted.
   - Send invalid types (e.g., non-string) for `the1Category`:
     - Expect Joi validation to reject.

2. **Admin UI – New Location**
   - Create a new location and add multiple seats:
     - For seat A, set `the1Category = "prime_stage"`.
     - For seat B, choose `"prime_stage"` from the reusable list.
   - Save and reload:
     - THE1 categories should be persisted and visible.

3. **Admin UI – Existing Location**
   - Open an existing location with no `the1Category`:
     - Fields should appear empty.
   - Assign values to a subset of seats, save, reload, and confirm they’re preserved.

4. **Non-Regression**
   - Existing GXN-imported locations (without `the1Category`) still:
     - Import without errors.
     - Display seats as before.
   - Existing event and COE flows that depend on `category` continue to work (we are not changing `category`).

---

### 10. Notes / Non-Goals

- We **do not** remove or change the behavior of the existing `category` field.
- This feature does **not** yet:
  - Migrate all existing logic to use `the1Category`.
  - Define a global, fixed enum for THE1 categories (free text for now).
- Any bulk backfill/migration of `the1Category` based on current `category` or seat location is considered a **separate task**.


