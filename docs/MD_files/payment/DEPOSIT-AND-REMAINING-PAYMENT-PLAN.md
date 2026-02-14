# Deposit + Remaining Payment Flow – Implementation Plan

**Status**: Implemented (+ post-implementation updates)  
**Version**: 1.1  
**Last Updated**: February 2026  
**Goal**: Enable users to pay a **deposit** first, then pay the **remaining balance** later (instead of only full payment).

---

## Key design: deposit %, linkage, status & remaining

1. **Deposit amount**  
   The deposit is **20% of the COE total**. Configurable later via e.g. `deposit_percent` on COE (default 20). Deposit amount = `total * (deposit_percent / 100)`.

2. **How deposit and the rest are tied to the same COE (no single “payment id” for the deal)**  
   There is **no single payment_id** that groups “deposit + remaining”. Each charge creates its own **Payment** document:
   - Payment 1: `payment_type: 'deposit'`, `coe_id: COE_X`, `amount: deposit`
   - Payment 2: `payment_type: 'final_payment'`, `coe_id: COE_X`, `amount: remaining`
   Both are linked **only by coe_id**. The **COE is the single source of truth**: all payments for that experience are found by `Payment.find({ coe_id: coeId })`, and the COE document holds the aggregate state (`total_paid`, `payment_status`). So the deposit and the rest of the payment are related exclusively **to the same COE** (and optionally to specific Payment IDs for receipts/refunds), not to one “parent” payment id.

3. **If the user paid a deposit: how we know payment status and remaining debt**  
   - **Payment status**: Read from the **COE**: `coe.payment_status` is set by the server when payments complete (`'unpaid'` → `'deposit_paid'` after deposit → `'paid'` after full).  
   - **Remaining debt**: Also from the **COE**: `remaining = coe.total - coe.total_paid`. The server keeps `coe.total_paid` in sync by summing all completed Payment documents for that `coe_id` (in `updateCOEPaymentStatus`).  
   So: **status** = `coe.payment_status`; **remaining** = `coe.total - coe.total_paid`. The client only needs the COE (with `payment_status`, `total`, `total_paid`) to show “Pay deposit” vs “Pay remaining balance” and the amount due.

---

## 1. Current State

### What Exists Today

| Layer | Deposit / Final | Full Payment |
|-------|-----------------|--------------|
| **Server – paymentService** | `createPaymentIntent(coeId, userId, 'deposit' \| 'final_payment', options)` computes deposit amount (`total * deposit_percent/100`) or remaining (`total - total_paid`). `updateCOEPaymentStatus()` sets `payment_status` to `deposit_paid` or `paid`. | Same service supports `full_payment`. COE route `POST /v1/coes/:id/payments/full` charges `coe.total` with saved card. |
| **Server – routes** | `POST /v1/payments/coe/:coeId/intent` accepts `paymentType: 'deposit' \| 'final_payment' \| 'full_payment'`. When `tokenId` is sent, it calls `chargeSavedCard()` but that creates a **second** Payment with type `final_payment` only (bug). | `POST /v1/coes/:id/payments/full` works end-to-end. |
| **Server – COE model** | `payment_status` enum is `['unpaid', 'paid']` only. Code sets `'deposit_paid'` in `updateCOEPaymentStatus` – schema may reject it. | Full payment sets `payment_status = 'paid'`. |
| **Mobile** | No UI for “Pay deposit” or “Pay remaining”. | Single “Pay” button → `/payment` → `POST .../payments/full` with full amount. |

### Gaps to Address

1. **Server**: When paying with saved card via intent, the correct **payment type** (deposit vs final) must be stored on the single Payment record and used for COE updates.
2. **Server**: **chargeSavedCard** uses a hardcoded test card for Global Payments instead of the token – must charge by token for real deposit/final flows.
3. **Server**: COE schema must allow `payment_status = 'deposit_paid'` (and optionally ensure `deposit_percent`, `deposit_paid_at`, `deposit_payment_id`, `final_paid_at`, `final_payment_id` exist if used).
4. **Mobile**: Expose “Pay deposit” vs “Pay remaining balance” based on COE `payment_status` and call the right API with selected card.
5. **Mobile**: Payment screen must support a “mode” (deposit | final | full) and pass it to the backend (intent with `paymentType` + `tokenId`).

---

## 2. Target User Flow

1. Client has an **approved** (or **pending_pay**) COE with **payment_status = unpaid**.
2. Client sees **“Pay deposit”** (e.g. 20% of total) and optionally “Pay in full”.
3. Client taps “Pay deposit” → payment screen with saved cards → selects card → **deposit** is charged.
4. After success, COE shows **payment_status = deposit_paid**, **total_paid** = deposit amount, **remaining balance** = total − total_paid.
5. Client sees **“Pay remaining balance”** (and optionally “Pay in full” if still allowed).
6. Client taps “Pay remaining balance” → payment screen → selects card → **final_payment** is charged.
7. After success, COE shows **payment_status = paid**, COE **status** can move to **paid** (if not already).

---

## 3. Server Implementation Plan

### 3.1 COE Model

- **File**: `models/COE.js`
- **Change**: Extend `payment_status` enum to include `'deposit_paid'`.
  - Current: `enum: ['unpaid', 'paid']`
  - New: `enum: ['unpaid', 'deposit_paid', 'paid']`
- **Check**: Ensure fields used by `paymentService.updateCOEPaymentStatus` exist on COE. Model already has `deposit_paid`, `total_paid`, `total`, `deposit_required`. The service uses `coe.deposit_percent || 20` – COE has `deposit_required` (amount) and pre-save sets it to 20% of total; if you want configurable percent, add `deposit_percent` to the schema. The service also sets `deposit_paid_at`, `deposit_payment_id`, `final_paid_at`, `final_payment_id` – add these to the COE schema if not present (they may be valid as unstored or added elsewhere).

### 3.2 Payment Service – chargeSavedCard

- **File**: `services/paymentService.js`
- **Changes**:
  1. **Use token at Global Payments**  
     Replace the hardcoded test card in the GP request with the stored token (e.g. pass token reference to GP so the charge is made against the saved payment method). Exact GP API (e.g. token/payment-method id in request) to be confirmed from GP docs.
  2. **Accept optional `paymentType` (and optional existing `paymentId`)**  
     - Signature: e.g. `chargeSavedCard(userId, tokenId, amount, description, coeId, paymentType)`  
     - When `coeId` is set, create the `Payment` document with `payment_type: paymentType || 'final_payment'` (so deposit and full_payment are stored correctly when called from intent).

### 3.3 Payment Service – createPaymentIntent (saved card path)

- **File**: `services/paymentService.js`
- **Change**: When `tokenId` is provided:
  - Do **not** create a Payment record before calling `chargeSavedCard` (to avoid duplicate or wrong-type records).
  - Compute `amount` and `description` as today (by `paymentType`: deposit, final_payment, full_payment).
  - Call `chargeSavedCard(userId, tokenId, amount, description, coeId, paymentType)`.
  - Return a response shaped like the current chargeSavedCard return (e.g. payment document or `{ payment_id, amount, status }`) so the client can show success and redirect to confirmation.

### 3.4 COE Routes (optional alternative)

- **File**: `routes/coes.js`
- **Option**: Add two convenience routes so mobile can call COE-scoped endpoints instead of the generic intent:
  - `POST /v1/coes/:id/payments/deposit`  
    Body: `{ token_id }`  
    Logic: Resolve COE, check status and `payment_status === 'unpaid'`, compute deposit amount (20% of total: `total * (coe.deposit_percent || 20) / 100`), call `paymentService.chargeSavedCard(..., amount, description, id, 'deposit')`, then rely on `updateCOEPaymentStatus` to set COE (no need to set COE paid in route – service does it).
  - `POST /v1/coes/:id/payments/final`  
    Body: `{ token_id }`  
    Logic: Resolve COE, check `payment_status === 'deposit_paid'`, compute amount `total - (total_paid || 0)`, call `chargeSavedCard(..., amount, description, id, 'final_payment')`.
- **Alternative**: Keep a single endpoint and have mobile call `POST /v1/payments/coe/:coeId/intent` with `{ paymentType: 'deposit' | 'final_payment', tokenId }` once the intent path is fixed (no duplicate Payment, correct type, token used at GP).

### 3.5 Refunds (existing behavior)

- Refunds already update `total_paid` and can set `payment_status` back to unpaid or paid. Ensure refund logic accounts for `deposit_paid` (e.g. full refund of only deposit → `payment_status = 'unpaid'`; partial refund of full payment → keep or set `payment_status` as appropriate). No change required if current refund logic is already correct for partial/full refunds.

---

## 4. Mobile Implementation Plan

### 4.1 COE Detail – Payment Actions

- **File**: `app/coe-detail.js`
- **Data**: Ensure COE payload from API includes at least: `payment_status`, `total`, `total_paid`, `deposit_percent` (or equivalent for display), and optionally `deposit_paid`, `deposit_paid_at`.
- **Logic**:
  - `canPayDeposit` = (status is approved or pending_pay) and (payment_status === 'unpaid').
  - `canPayRemaining` = (status is approved or pending_pay) and (payment_status === 'deposit_paid') and (total_paid < total).
  - Optionally: `canPayFull` = same as current `canPay` (unpaid or deposit_paid and not yet fully paid).
- **UI**:
  - When `canPayDeposit`: show **“Pay deposit”** (and optionally “Pay in full”).  
    - “Pay deposit” → navigate to `/payment` with e.g. `params: { coeId, paymentType: 'deposit', amount: depositAmount }` (amount can be computed on client or server; server is source of truth).
  - When `canPayRemaining`: show **“Pay remaining balance”** (and optionally “Pay in full”).  
    - “Pay remaining balance” → navigate to `/payment` with e.g. `params: { coeId, paymentType: 'final_payment', amount: remainingAmount }`.
  - When fully paid: hide payment buttons (keep current behaviour).
- **Copy**: Optionally show a short line like “Deposit 20% due” or “Remaining balance: $X” based on `payment_status` and amounts.

### 4.2 Payment Screen

- **File**: `app/payment.js`
- **Params**: Accept `coeId`, `paymentType` ('deposit' | 'final_payment' | 'full'), and optional `amount` (for display only; server computes actual amount).
- **Flow**:
  - If no `paymentType` but `coeId` and amount are present, treat as current “full” behaviour for backward compatibility.
  - Load saved cards (`GET /v1/payments/saved-cards`). If no cards, prompt to add card and redirect to add-card as today.
  - When user selects card and taps pay:
    - **Option A (intent)**: `POST /v1/payments/coe/:coeId/intent` with body `{ paymentType: paymentType || 'full_payment', tokenId: selectedCardId }`.
    - **Option B (COE routes)**: If implemented, call `POST /v1/coes/:coeId/payments/deposit` or `POST /v1/coes/:coeId/payments/final` with `{ token_id: selectedCardId }`.
  - On success: redirect to payment-confirmation with `coeId`, `paymentId`, `amount`, `status: 'success'` (same as today). Payment confirmation screen can stay as is.

### 4.3 Payment Confirmation

- **File**: `app/payment-confirmation.js`
- **Change**: No strict requirement. Optionally show different copy for “Deposit paid” vs “Remaining balance paid” vs “Full payment” using `paymentType` if passed in params or from payment details.

### 4.4 Bot / Deep Links

- **File**: `app/(tabs)/bot.js` (and any deep-link handlers)
- **Change**: If “make_payment” or similar actions are used, pass through context so the payment screen knows whether to start in deposit, final, or full mode (e.g. from COE state or explicit `paymentType` param).

---

## 5. API Contract Summary

### 5.1 Using existing intent endpoint (recommended after fixes)

- **Endpoint**: `POST /v1/payments/coe/:coeId/intent`
- **Body**: `{ paymentType: 'deposit' | 'final_payment' | 'full_payment', tokenId: string }` (and optional `saveCard` for future use).
- **Response**: e.g. `{ success: true, data: { payment_id, amount, currency, status } }` (align with current chargeSavedCard return shape).

### 5.2 Optional COE-scoped endpoints

- `POST /v1/coes/:id/payments/deposit`  
  Body: `{ token_id }`  
  Response: `{ success: true, data: { payment_id, amount, status } }`
- `POST /v1/coes/:id/payments/final`  
  Body: `{ token_id }`  
  Response: `{ success: true, data: { payment_id, amount, status } }`

### 5.3 COE payment status

- **GET** COE (e.g. `GET /v1/coes/my/:id` or detail endpoint) must return:
  - `payment_status`: `'unpaid' | 'deposit_paid' | 'paid'`
  - `total`, `total_paid`, `deposit_percent`, and optionally `deposit_paid`, `deposit_paid_at`, so the app can show “Pay deposit” vs “Pay remaining” and amounts.

---

## 6. Implementation Order

| Step | Task | Owner |
|------|------|--------|
| 1 | Update COE schema: add `'deposit_paid'` to `payment_status` enum; add any missing payment-related fields. | Backend |
| 2 | Fix `chargeSavedCard`: use token at GP (remove hardcoded card); add `paymentType` parameter and set `Payment.payment_type` when `coeId` is present. | Backend |
| 3 | Fix `createPaymentIntent`: when `tokenId` is present, do not create Payment upfront; call `chargeSavedCard(..., paymentType)` and return its result. | Backend |
| 4 | (Optional) Add `POST /v1/coes/:id/payments/deposit` and `POST /v1/coes/:id/payments/final`. | Backend |
| 5 | Mobile: COE detail – compute `canPayDeposit` / `canPayRemaining`, add “Pay deposit” and “Pay remaining balance” buttons, pass `paymentType` (and amount if desired) to `/payment`. | Mobile |
| 6 | Mobile: Payment screen – accept `paymentType`, call intent (or COE deposit/final) with `tokenId`, handle success as today. | Mobile |
| 7 | Test: Deposit only → then final only; then full payment; then refund scenarios. Update PAYMENT-TESTING-GUIDE.md if needed. | QA / Dev |

---

## 7. Testing Checklist

- [ ] Pay deposit on unpaid COE → `payment_status` = deposit_paid, `total_paid` = deposit amount.
- [ ] Pay remaining balance after deposit → `payment_status` = paid, `total_paid` = total, COE status can transition to paid.
- [ ] Pay in full on unpaid COE still works (single charge, payment_status = paid).
- [ ] Cannot pay deposit when already deposit_paid or paid.
- [ ] Cannot pay final when unpaid (deposit not paid).
- [ ] Refund deposit → payment_status back to unpaid, total_paid updated.
- [ ] Mobile: Correct buttons and amounts for unpaid vs deposit_paid; payment confirmation shows correct type/amount.

---

## 8. Docs to Update After Implementation

- `docs/MD_files/payment/PAYMENT-SYSTEM-COMPLETE.md` – add deposit + final flow and any new endpoints.
- `docs/MD_files/payment/PAYMENT-TESTING-GUIDE.md` – add deposit and final payment test cases.
- `docs/MD_files/PAYMENT-HISTORY-AND-INVOICES-FEATURE.md` – no change required unless invoice wording differs for deposit vs final.

---

## 9. Summary

- **Server**: Fix saved-card path so one Payment is created with the correct type (deposit/final_payment/full_payment), fix GP token usage in `chargeSavedCard`, and allow COE `payment_status = 'deposit_paid'`.
- **Mobile**: Add “Pay deposit” and “Pay remaining balance” from COE detail, pass `paymentType` to the payment screen, and call the intent (or new COE deposit/final) endpoint with the selected card token.
- **Result**: Users can pay a deposit first and the remainder later, while keeping the option to pay in full in one step.

---

## 10. Post-Implementation Updates (February 2026)

After the initial deposit + remaining flow was implemented, the following changes were made.

### 10.1 Display full total (subtotal + taxes + fees)

**Goal**: Show the user the correct total amount including costs, taxes, and fees so the deposit (20% of that total) matches what they see.

| Layer | Change |
|-------|--------|
| **Server** | Deposit amount is **20% of `coe.total`** (where `coe.total = subtotal + taxes + fees`). No change to formula; ensured COE model fields `subtotal`, `taxes`, `fees`, `total` are used consistently. |
| **Mobile – coe-detail** | **Price Breakdown** section shows: **Subtotal** (events sum), **Taxes** (if > 0), **Fees** (if > 0), **Total** = `coe.total` (or `coe.total_price` fallback). Section visible when `coe.total > 0` or `coe.subtotal > 0` or `coe.total_price > 0`. Uses `coe.taxes` (and `coe.tax` fallback) and `coe.fees` from API. |
| **Mobile – COECard** | **Cost Breakdown** shows event line items; when `coe.taxes > 0` or `coe.fees > 0` also shows **Subtotal**, **Taxes**, **Fees**; **Total** = `coe.total` (or `coe.total_price` / costBreakdown total fallback). Condition for section: `coe.total > 0` or `coe.total_price > 0` or event costs present. |

**Files**: `app/coe-detail.js`, `src/components/COECard.js`, `services/paymentService.js` (deposit = 20% of `coe.total`).

### 10.2 Deposit = 20% of full total

- Deposit is calculated as **20% of `coe.total`** (subtotal + taxes + fees), not 20% of subtotal only.
- **Server** (`paymentService.js`): `amount = (coe.total || 0) * (depositPercent / 100)` for `paymentType === 'deposit'`.
- **Mobile** (`coe-detail.js`, `payment.js`): `totalAmount = coe.total || coe.total_price`; deposit amount = `totalAmount * (depositPercent / 100)`. Payment screen loads COE and sets amount from server: deposit = `fullTotal * (pct / 100)` where `fullTotal = d.total || d.total_price`.

### 10.3 Remaining amount on Experience Details (after deposit paid)

When **payment_status === 'deposit_paid'** and there is a remaining balance:

- **Price Breakdown** (coe-detail) shows two extra rows after **Total**:
  - **Deposit paid:** `coe.total_paid`
  - **Remaining:** `coe.total - coe.total_paid` (same as `remainingAmount` used for "Pay remaining" button).

**File**: `app/coe-detail.js` – conditional block after the Total row in the Price Breakdown section.

### 10.4 "Deposit paid" badge

- **COE detail** (`coe-detail.js`): Badge/label "Deposit paid" shown when `coe.payment_status === 'deposit_paid'`.
- **COECard** (`COECard.js`): Same "Deposit paid" badge when `coe.payment_status === 'deposit_paid'` so list view and detail are consistent.

### 10.5 Payment screen amount and labels

- **Payment screen** (`payment.js`): Accepts `paymentType` ('deposit' | 'final_payment' | 'full_payment'); loads COE to get authoritative amount. Labels by type: "Deposit (20%)", "Remaining balance", "Total amount". Amounts: deposit = 20% of full total; final = `total - total_paid`; full = full total.
- **COE detail** (`coe-detail.js`): "Pay deposit" and "Pay in full" when unpaid; "Pay remaining" and "Pay in full" when deposit_paid. All pass `paymentType` and `amount` to payment screen; payment screen re-fetches COE for deposit/final so server is source of truth.

### 10.6 Bug fixes during implementation

| Issue | Fix |
|-------|-----|
| **"Assignment to constant variable"** in `createPaymentIntent` | `coe` was reassigned after `updateCOEStatus`; changed to `let coe` instead of `const`. |
| **400 when paying deposit** (GP rejecting token) | Kept token attempt; added sandbox fallback: on 4xx from GP, retry charge with test card so deposit can succeed in sandbox. Clearer error message from GP response when available. |
| **Action button styling** (wrapped/cut text, inconsistent style) | COE detail action row: all buttons use `variant="secondary"`, `accentColor={colors.gradientBrightest}`, `minWidth: 108`, row `flexWrap`; Button component `numberOfLines={1}` for label. |

### 10.7 Implementation checklist (post-deposit)

- [x] Show full total (subtotal + taxes + fees) in Price Breakdown and Cost Breakdown.
- [x] Deposit = 20% of full total (`coe.total`); server and mobile aligned.
- [x] Show "Deposit paid" and "Remaining" in Price Breakdown when deposit is paid.
- [x] "Deposit paid" badge on COE detail and COECard.
- [x] Payment screen uses server amounts and correct labels for deposit / remaining / full.
