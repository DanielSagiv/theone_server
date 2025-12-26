# Feature: Admin “Create COE” from Bot Client List

## 1. Goal

Enable an **admin** using the bot to quickly create a COE for a specific client directly from the **“show me clients”** structured response:

- When the admin prompts: `show me clients`
  - The bot returns the existing **client list card**.
  - Each client row will also have a new **“Create COE”** button.
- Clicking **“Create COE”** opens a **Create COE card** inside the bot panel:
  - Pre‑selects the chosen client.
  - Lets the admin fill out basic COE details (dates, budget, party size, notes).
  - On submit, calls the existing COE creation flow to create a **draft COE** for that client.
  - Shows the resulting **COE draft card** (with runner assignment handled as today via dashboard editor).

This is an **admin-only** shortcut; clients never see this button.

---

## 2. Existing Behavior (for context)

- Bot tool `get_clients` already returns a **structured response** of type `client_list`.
- Frontend (`dashboard.ejs` → `renderBotMessages` / `renderClientList`) currently:
  - Renders a table/list of clients.
  - Provides at least a **“View”** button per client (to open profile).
- COEs are created via:
  - Dashboard **Create COE** modal (manual).
  - Bot **preferences form + auto-selection** (`create_coe_draft`) primarily for **clients**.
- COE creation service:

```73:388:services/botToolHandlers.js
function formatCOEResponse(type, coe, message, actions = [], budget = null) {
  ...
  return {
    type: type,
    coe_id: coe._id?.toString() || coe.id,
    coe: {
      id: coe._id?.toString() || coe.id,
      name: coe.name,
      description: coe.description,
      status: coe.status,
      ...
    },
    message: message,
    actions: actions
  };
}
```

---

## 3. High‑Level Design

### 3.1 New UX Flow (Bot Tab)

1. **Admin types:** `show me clients`
2. Bot returns `client_list` structured response.
3. `renderClientList` renders each client row with:
   - Existing **View** button.
   - New **Create COE** button (admin only).
4. When admin clicks **Create COE**:
   - Frontend sends a new bot prompt, e.g.  
     `Create a COE draft for client <client_id>: open create-coe-from-client form`
   - Or (better) calls a **bot tool** directly via an internal helper (`sendBotPromptWithMetadata`) including selected client id.
5. Bot responds with a **new structured response type**, e.g.:
   - `type: 'coe_create_form'`
   - Includes:
     - `client` (id, name, email)
     - Default values (dates empty, currency, budget hints, etc.).
6. Frontend’s `renderBotMessages` detects `coe_create_form` and renders a **Create COE form card**:
   - Fields similar to dashboard create COE Step 1 + pricing inputs:
     - Client (read‑only, pre‑filled).
     - Start Date, End Date.
     - Currency (default USD).
     - Optional budget and notes.
7. On submit, the card:
   - Validates inputs on the client side.
   - Posts a new prompt (or dedicated endpoint) that maps to **`create_coe_draft`** bot tool with:
     - `client_id` = selected client.
     - `start_date`, `end_date`, and basic budget/party size if collected.
8. `handleCreateCOEDraft` creates a **draft COE** and returns a `coe_draft` structured response.
9. Frontend renders the `coe_draft` card as today (with runner section logic unchanged).

---

## 4. Backend Changes

### 4.1 New Bot Tool Handler: `open_create_coe_for_client`

**Note**: Tool name is `open_create_coe_for_client` (not `open_create_coe_from_client`)

- **Location:** `services/botToolHandlers.js`
- **Purpose:** Produce the **Create COE form** structured response for a specific client.
- **Inputs:**
  - `client_id` (required, 24‑char hex).
- **Behavior:**
  1. Validate `user.role === 'admin'`. If not, return permission error structured response (`type: 'error'`).
  2. Load client from `User` model; return 404 style error if not found.
  3. Build structured response:
     - `type: 'coe_create_form'`
     - `client`: `{ id, name, email, phone }`
     - Optional `defaults`: suggested currency, empty dates, empty notes.
  4. Return `{ success: true, data, message }`.

### 4.2 Bot Tools Wiring

- **File:** `services/botTools.js`
  - Register new tool key:
    - `'open_create_coe_for_client': { name: 'open_create_coe_for_client', ... }`
  - Wire to `handleOpenCreateCOEForClient` in `botToolHandlers`.

### 4.3 Response Formatter

- **File:** `services/botResponseFormatter.js`
- Add a formatter or direct structure for `coe_create_form`:
  - May not need a helper; we can return a simple JSON shape:

```js
{
  type: 'coe_create_form',
  client: { id, name, email, phone },
  defaults: {
    currency: 'USD',
    start_date: null,
    end_date: null,
    notes: ''
  },
  message: 'Create a new COE draft for this client.'
}
```

- Ensure `sendBotMessage` preserves `structured_data` when `open_create_coe_for_client` is used (it already does for other types via `structuredDataFromTools`).

### 4.4 Creating the COE from the Form

- Reuse existing `create_coe_draft` tool / handler:
  - When the admin submits the form card, the frontend will send a bot message formatted like:

    ```text
    Create a COE draft using this data:
    Client ID: <client_id>
    Start date: 2025-12-01
    End date: 2025-12-02
    Budget: $9000 USD
    Number of people: 8
    Notes: ...
    ```

  - The preferences extraction / `create_coe_draft` pipeline will:
    - Detect the structured format.
    - Use `client_id` from the message (we may add a small enhancement to prefer explicit `Client ID:` when admin).
    - Return a `coe_draft` structured response (already implemented).

- **Optional (cleaner)**: add a dedicated admin tool that accepts JSON directly:
  - `create_coe_for_client` → wraps `handleCreateCOEDraft` with explicit `client_id` and basic fields.
  - The Create COE card would call this tool explicitly instead of re‑using the text‑parsing step.

---

## 5. Frontend Changes (Dashboard EJS)

### 5.1 Extend Client List Card

- **File:** `views/test/dashboard.ejs`
- In `renderClientList(structuredData)` (already used for `type === 'client_list'`):
  - Add another action button per client:
    - Label: **Create COE**
    - Only render if `currentUser.role === 'admin'`.
  - On click:
    - Either:
      - Call `sendBotPrompt()` with a system‑formatted prompt, including client id, e.g.  
        `"Open the create COE form for client with id <client_id>. Use the open_create_coe_for_client tool with this client_id."`.
      - Or better: call a helper `callBotToolFromUI('open_create_coe_for_client', { client_id })` which posts to `/v1/bot/message` with the right tool call format.

### 5.2 Render Create COE Form Card

- **In** `renderBotMessages`:
  - Extend `isStructuredResponse` type list to include `'coe_create_form'`.
  - Add a branch:

```12:15:views/test/dashboard.ejs
} else if (structuredData.type === 'coe_create_form') {
  const coeFormCard = renderCOECreateForm(structuredData);
  contentEl.appendChild(coeFormCard);
}
```

- Implement `renderCOECreateForm(formData)`:
  - Inputs:
    - `formData.client` and `formData.defaults`.
  - Layout:
    - Shows client name/email at top (read‑only).
    - Inputs:
      - Start Date (required).
      - End Date (required).
      - Currency (default USD, select).
      - Optional budget and party size (if we decide to collect).
      - Notes.
    - Submit button: **Create COE**.
  - On submit:
    - Validate fields.
    - Disable button while sending.
    - Call `sendBotPrompt()` with a machine‑readable message (or a small JSON payload encoded in the prompt) that triggers the admin COE creation tool / `create_coe_draft`.
    - Clear or keep form depending on success.

### 5.3 COE Draft Display (Already Implemented)

- When bot responds with `type: 'coe_draft'`, existing code:

```8530:8535:views/test/dashboard.ejs
if (structuredData.type === 'coe_created' || structuredData.type === 'coe_updated' || structuredData.type === 'coe_details' || structuredData.type === 'coe_draft') {
  const coeCard = renderCOECard(structuredData.coe, structuredData.actions || []);
  contentEl.appendChild(coeCard);
}
```

- `renderCOECard` now:
  - Shows **runner details** if assigned.
  - For **draft COEs with no runner** and **admin user**, shows a **Runner Assignment** CTA that opens the standard dashboard COE editor via `handleCOEAction('edit_coe', coeId)`.

---

## 6. Validation, Permissions, and Error Handling

- **Permissions**
  - `open_create_coe_for_client`:
    - Only for `user.role === 'admin'`.
    - If non‑admin calls it, return `type: 'error'` with a clear message ("Only admins can create COEs for clients.").
  - COE creation itself remains governed by existing `createCOEDraft` checks.

- **Validation**
  - On the **form card**:
    - Require `start_date`, `end_date`.
    - Validate `end_date >= start_date`.
    - Optional budget, party size as positive numbers if provided.
  - Backend:
    - Re‑validate dates and client id in the tool handler / `handleCreateCOEDraft`.

- **Errors**
  - If `open_create_coe_for_client` fails (client not found, permission error), return `type: 'error'` structured response and render via existing `renderErrorResponse`.
  - If COE creation fails (`create_coe_draft` error), the bot already returns an error structured response which is rendered in the bot panel.

---

## 7. Testing Plan

### 7.1 Happy Path (Admin)

1. Log in as **admin**.
2. Open bot tab, send: `show me clients`.
3. Verify each row shows **View** and **Create COE** buttons.
4. Click **Create COE** for a client.
5. Verify:
   - A **Create COE form card** appears with that client’s name/email.
6. Fill dates and submit.
7. Verify:
   - Bot responds with a **COE draft card** (`type: 'coe_draft'`).
   - The draft’s client is the selected client.

### 7.2 Runner Assignment

1. From the COE draft card, expand **View My Seats & Details**.
2. As admin, verify:
   - Runner section shows **“Runner Assignment”** with **Assign Runner** button when no runner is set.
3. Click **Assign Runner**, verify:
   - Dashboard COE editor opens with the correct client and events.

### 7.3 Non‑Admin Behavior

1. Log in as **client**.
2. Ask the bot: `show me clients`.
3. Verify:
   - No **Create COE** buttons are rendered.
4. Attempt to trigger `open_create_coe_for_client` (if possible).
5. Verify:
   - Bot returns `type: 'error'` structured response with permission message.

### 7.4 Error Cases

- Invalid `client_id`:
  - Manually tamper with the prompt / tool call.
  - Expect a clean error card.
- Invalid dates in the form:
  - End date before start date → front‑end validation message, no bot call.

---

## 8. Notes / Non-Goals

- We **do not** change the existing **multi‑step preferences collection** flow for clients.
- We **reuse existing COE creation logic** (`create_coe_draft` + `formatCOEResponse`) to avoid duplication.
- Runner assignment remains a **dashboard responsibility** (COE edit modal), not part of the bot form itself.

## Related Documentation

- **Admin Full Access**: See `ADMIN-FULL-ACCESS-COE-EDITING.md` for details on admin vs client selection behavior
- **Client Auto-Selection**: See `architecture/bot-coe-creation-stage2.md` for client auto-selection implementation


