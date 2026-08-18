---
name: goat-payment-auth
description: Function-by-function GOAT payment integration reference for THEONE. Use when implementing GOAT auth, tokenization, charging, refunds, voids, reversals, and webhook parity with the current payment system.
---

# GOAT Payment Gateway Skill

## Goal
Provide a living, function-by-function integration reference for replacing Global Payments with GOAT while preserving THEONE behavior.

## Authentication Contract
GOAT uses HTTP Basic auth.

- Username: `SOURCE_KEY`
- Password: `PIN` (if configured)
- Header format: `Authorization: Basic base64("SOURCE_KEY:PIN")`
- If PIN is not configured: `Authorization: Basic base64("SOURCE_KEY:")`

## Sandbox Config
Use these env vars on **THEONE stage** (and local non-prod):
- `GOAT_SANDBOX_BASE_URL` (default `https://api.sandbox.goatpaymentsgateway.com`)
- `GOAT_SOURCE_KEY` — sandbox source key (must include **Void**, **Refund**, and for reversal also **Charge** + PIN)
- `GOAT_PIN`

## Production Config
Use these env vars on **THEONE prod**:
- `GOAT_PRODUCTION_BASE_URL` (or `GOAT_BASE_URL`) → `https://api.goatpaymentsgateway.com`
- `GOAT_SOURCE_KEY` — **production** source key (same permission set: Void, Refund, Charge as needed)
- `GOAT_PIN` — **required** for `POST /transactions/reversal`

`services/goatClient.js` `getGoatBaseUrl()` already routes: explicit `GOAT_BASE_URL` → else prod when `NODE_ENV=production` + `GOAT_PRODUCTION_BASE_URL` → else sandbox. All transaction paths (`charge`, `refund`, `void`, `reversal`) must go through that helper — never hardcode host.

## API Base URLs

- Production transactions base: `https://api.goatpaymentsgateway.com/api/v2/transactions`
- Sandbox transactions base: `https://api.sandbox.goatpaymentsgateway.com/api/v2/transactions`

| THEONE host | GOAT env | Charge / refund / void / reversal |
|-------------|----------|-----------------------------------|
| Stage / local | Sandbox | `{GOAT_SANDBOX_BASE_URL}/api/v2/transactions/...` |
| Prod | Production | `{GOAT_PRODUCTION_BASE_URL or GOAT_BASE_URL}/api/v2/transactions/...` |

## Integration Principles
- Keep GOAT credentials server-side only.
- Preserve THEONE payment states and side effects (`deposit`, `final_payment`, `full_payment`, `deposit_diff`, `full_diff`).
- Keep JSON response contracts stable for mobile and server callers.
- Implement idempotent handling for retries and webhook duplicates.

## Function Catalog
- Function 1: Tokenize card (`POST /saved-cards`) - documented below.
- Function 2: Charge card (`POST /transactions/charge`) - documented below.
- Function 3: Transactions list / lookup (`GET /transactions`) - documented below.
- Function 4: Source charge – saved token / PM / ref (`POST /transactions/charge`, `source`) - documented below.
- Function 5: Refund (full/partial) (`POST /transactions/refund`) - documented below.
- Function 25: Void unsettled charge (`POST /transactions/void`) - documented below.
- Function 26: Reversal — void or refund by state (`POST /transactions/reversal`) - documented below.
- Function 6: Webhooks and signature verification (`/webhooks`) - documented below.
- Function 7: Get single invoice (`GET /invoices/{id}`) - documented below.
- Function 8: Cancel existing invoice (`POST /invoices/{id}/cancel`) - documented below.
- Function 9: Reactivate canceled invoice (`POST /invoices/{id}/reactivate`) - documented below.
- Function 10: Request final payment (`POST /invoices/{id}/request-final`) - documented below.
- Function 11: Delete invoice (`DELETE /invoices/{id}`) - documented below.
- Function 12: Update invoice (`PATCH /invoices/{id}`) - documented below.
- Function 13: Send existing invoice (`POST /invoices/{id}/send`) - documented below.
- Function 14: Customers list (`GET /customers`) - documented below.
- Function 15: Create customer (`POST /customers`) - documented below.
- Function 16: Create customer from transaction (`POST /customers/create-from-transaction`) - documented below.
- Function 17: Get single customer (`GET /customers/{id}`) - documented below.
- Function 18: Update customer (`PATCH /customers/{id}`) - documented below.
- Function 19: Delete customer (`DELETE /customers/{id}`) - documented below.
- Function 20: List customer payment methods (`GET /customers/{id}/payment-methods`) - documented below.
- Function 21: Create customer payment method (`POST /customers/{id}/payment-methods`) - documented below.
- Function 22: List customer recurring schedules (`GET /customers/{id}/recurring-schedules`) - documented below.
- Function 23: Create customer recurring schedule (`POST /customers/{id}/recurring-schedules`) - documented below.
- Function 24: List customer transactions (`GET /customers/{id}/transactions`) - documented below.

---

## Function 1 - Credit Card Tokenization

### Endpoint
- Method: `POST`
- Path: `/saved-cards`
- Full sandbox URL: `{GOAT_SANDBOX_BASE_URL}/api/v2/saved-cards`
- Auth: `BasicAuthentication`

### Purpose
Save a card number for future use and return a token (`cardRef`) that can be used later instead of raw PAN.

### Request schema (Create Saved Card From Card Number)
Content type: `application/json`

Required fields:
- `card` (string, 14-16 chars, numeric)
- `expiry_month` (integer, 1-12)
- `expiry_year` (integer, 2020-9999)

Example:
```json
{
  "card": "4111111111111111",
  "expiry_month": 12,
  "expiry_year": 2030
}
```

### Response schema
Success (`200`):
```json
{
  "cardRef": "abcdefghijklmnop"
}
```

`cardRef` is the token representing the submitted card.

Error responses:
- `400` Invalid request or missing required fields
- `401` Credentials missing or invalid
- `415` Content-Type must be `application/json`

### Doc note captured from GOAT
Saving a card number does not verify card validity by itself. GOAT recommends a verification request with `save_card: true` when verification is required.

### cURL (tokenize)
```bash
curl -sS -w "\nHTTP_STATUS:%{http_code}\n" \
  -X POST "${GOAT_SANDBOX_BASE_URL}/api/v2/saved-cards" \
  -u "${GOAT_SOURCE_KEY}:${GOAT_PIN}" \
  -H "Content-Type: application/json" \
  -d '{
    "card": "4111111111111111",
    "expiry_month": 12,
    "expiry_year": 2030
  }'
```

### Mapping to THEONE
- GOAT `cardRef` -> THEONE `token_id` / `payment_token_id`
- Store card metadata separately in user profile (`brand`, `last4`, `expiry`)
- Never store raw card number or CVV in THEONE DB

### Validation checklist before implementation
- Confirm if GOAT also supports "Create Saved Card From Source" for token migration.
- **`cardRef` + charge:** use Source Charge on `POST /transactions/charge` with `source: "tkn-" + cardRef` (see Function 4).
- Confirm token deletion endpoint and behavior.

---

## Function 2 - Charge (Authorization/Capture)

### Endpoint
- Method: `POST`
- Path: `/transactions/charge`
- Full sandbox URL: `{GOAT_SANDBOX_BASE_URL}/api/v2/transactions/charge`
- Auth: `BasicAuthentication`

### Purpose
Create a new card/check authorization or charge. For credit cards, authorization is captured into the current batch by default.

### Source types supported by GOAT charge endpoint
- Credit Card
- DAF Card
- Credit Card Magstripe
- Check / ACH
- Source (previous transaction, stored payment method, token, or nonce)
- Digital Wallet

### Permissions / behavior notes from docs
- For credit card transactions, if `capture=false`, source key must include Auth-Only permission.
- Otherwise charge requires Charge permission.
- `capture` default: `true`.

### Request schema (Credit Card Charge variant)
Content type: `application/json`

Required fields:
- `amount` (number, range `0.01..20000000`)
- `card` (string, 14-16 numeric chars, regex `^\d+$`)
- `expiry_month` (integer, `1..12`)  
  - When using a card token, send any valid month.
- `expiry_year` (integer, `2020..9999`)  
  - When using a card token, send any valid year.

Optional high-value fields:
- `name` (cardholder name)
- `cvv2` (3-4 numeric chars, recommended for fraud prevention)
- `avs_address`, `avs_zip` (recommended for fraud prevention / e-commerce rates)
- `capture` (boolean, default `true`)
- `save_card` (boolean, default `false`; when `true` and approved, response can return `card_ref`)
- `ignore_duplicates` (boolean, default `false`)
- `amount_details`, `transaction_details`, `line_items`, `billing_info`, `shipping_info`, `custom_fields`, `customer`, `transaction_flags`, `3d_secure`

### Minimal request example (known-good pattern)
```json
{
  "amount": 0.01,
  "card": "4111111111111111",
  "expiry_month": 12,
  "expiry_year": 2030,
  "cvv2": "123",
  "capture": true,
  "transaction_details": {
    "description": "THEONE sandbox smoke test",
    "order_number": "theone-test-001"
  },
  "ignore_duplicates": true
}
```

### Full request example
Use GOAT official full schema example when Level 3 and rich metadata are required (amount_details, line_items, addresses, custom_fields, flags, 3DS).

### Response schema (200)
Core result fields:
- `version`
- `status` enum: `Approved | Partially Approved | Submitted | Declined | Error`
- `status_code` enum: `A | P | D | E`
- `error_message`, `error_code`, `error_details`
- `auth_amount`, `auth_code`
- `reference_number`
- `transaction` object
- `avs_result`, `avs_result_code`
- `cvv2_result`, `cvv2_result_code`
- `card_type`, `last_4`
- `card_ref` (token; returned when `save_card=true` and approved)

### Error responses
- `400` Invalid request or missing required fields
- `401` Credentials missing or invalid
- `415` `Content-Type` must be `application/json`

### cURL example
```bash
curl -sS -w "\nHTTP_STATUS:%{http_code}\n" \
  -X POST "${GOAT_SANDBOX_BASE_URL}/api/v2/transactions/charge" \
  -u "${GOAT_SOURCE_KEY}:${GOAT_PIN}" \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 0.01,
    "card": "4111111111111111",
    "expiry_month": 12,
    "expiry_year": 2030,
    "cvv2": "123",
    "capture": true,
    "transaction_details": {
      "description": "THEONE sandbox charge test",
      "order_number": "theone-charge-001"
    },
    "ignore_duplicates": true
  }'
```

### Mapping to THEONE
- GOAT `reference_number` and/or `transaction.id` -> internal `gp_transaction_id` replacement field
- GOAT top-level `status` + `status_code` -> internal payment status mapping (`completed`, `failed`, etc.)
- `transaction.status_details.status` should be persisted for reconciliation
- Optional `card_ref` can feed saved-card flow when `save_card=true`

### Validation and integration notes
- Placeholder sample data in docs may fail strict validation (e.g., non-numeric card/cvv).
- For production-grade fraud posture, include `cvv2`, `avs_address`, `avs_zip` when available.
- Use idempotency strategy (`ignore_duplicates` and internal idempotency keys) to avoid double charge.

---

## Function 4 – Source Charge (Token / Payment Method / Prior Transaction)

Same endpoint as Function 2: **`POST /transactions/charge`**. Use the **Source Charge** variant instead of sending raw `card`.

### Purpose
Charge using a **token**, **nonce**, **reference number** of a prior transaction, or **payment method ID** — no PAN in the request.

### Required fields (Source Charge)
- `amount` (number, `0.01..20000000`) – USD. Surcharge may adjust actual charged amount; response returns revised amounts.
- `source` (string, ≤ 26 chars) – must match:

  `(tkn|nonce|ref|pm)-[A-Za-z0-9]+`

  Prefix meanings:
  - **`tkn-`** – token (use with `cardRef` from `POST /saved-cards`, e.g. `tkn-` + `cardRef`).
  - **`ref-`** – reference number of a previous transaction.
  - **`pm-`** – payment method ID.
  - **`nonce-`** – nonce token.

### Expiration behavior
- Source charge **without** `expiry_month` / `expiry_year` uses the expiration **saved with the source**.
- If expiration is sent, it **overrides** the saved value.
- **Nonce** tokens are not stored with expiration — **must** send `expiry_month` and `expiry_year` in the request.

### Token-specific notes (from GOAT)
- For card token, docs allow sending **any valid** `expiry_month` / `expiry_year` (same pattern as PAN charge with token semantics).
- **CVV** and other extra payment-method fields sent with a **source** charge are **ignored** (do not rely on CVV for token charges).
- **AVS** fields are **auto-populated** when using a **payment method** source unless overridden in the request.

### Optional fields (same family as card charge)
- `amount_details`, `name`, `transaction_details`, `line_items`, `billing_info`, `shipping_info`, `custom_fields`, `ignore_duplicates`, `customer`, `transaction_flags`
- `avs_address`, `avs_zip` – recommended for e-commerce rates / fraud when not fully filled by PM source
- `expiry_month` (`1..12`), `expiry_year` (`2020..9999`) – optional for token/PM when saved expiry applies; required for nonce
- `cvv2` – documented as ignored for source flows
- `3d_secure` – v2 only for e-commerce
- `sec_code` – ACH override (`PPD`, `CCD`, `TEL`, `WEB`) when using ACH payment method
- `capture` (boolean, default `true`)
- `save_card` (boolean, default `false`) – **only** with **token** or **nonce**; if used with token + expiry supplied, token expiration is **updated** on approval

### Minimal example (charge saved token from `/saved-cards`)
Assume `cardRef` from tokenization is `abcdefghijklmnop`:

```json
{
  "amount": 12.34,
  "source": "tkn-abcdefghijklmnop",
  "capture": true,
  "transaction_details": {
    "description": "THEONE COE payment",
    "order_number": "coe-12345"
  },
  "ignore_duplicates": true
}
```

### Mapping to THEONE
- Stored `cardRef` → build `source` as **`tkn-` + `cardRef`** (confirm with GOAT that `cardRef` is exactly the suffix after `tkn-`).
- Reuse same response handling as Function 2 (`reference_number`, `transaction`, `status`, `card_ref` if `save_card=true`).
- Align with existing **charge saved card** server path: amount + token id → GOAT `amount` + `source`.

### Verify with GOAT
- Exact concatenation: `tkn-` + 16-char `cardRef` vs other formatting.
- Whether `pm-` id differs from `tkn-` for vaulted cards in their dashboard.

---

## Function 3 – Transactions List / Lookup

### Endpoint
- Method: `GET`
- Path: `/transactions`
- Full sandbox URL: `https://api.sandbox.goatpaymentsgateway.com/api/v2/transactions`
- Full production URL: `https://api.goatpaymentsgateway.com/api/v2/transactions`
- Auth: `BasicAuthentication`

### Purpose
Fetch multiple transactions (charges and refunds) with filters for status, payment type, dates, and pagination. Used for payment history views, reconciliation, and support lookups.

### Query parameters (most relevant to THEONE)
- `order` (string, default `"asc"`, enum: `"asc" | "desc"`) – sort order.
- `status` (array/comma-separated) – filter by one or more statuses:  
  `captured, pending, reserve, originated, returned, cancelled, queued, declined, error, settled, voided, approved, blocked, expired`.
- `payment_type` (array/comma-separated) – `credit_card`, `check`.
- `settled_date` (date, UTC) – settled date filter; also limits lookback to 30 days before this date.
- `date_field` (default `"created_at"`, enum `"created_at" | "settled_at"`) – which date to apply `date_from` / `date_to` to.
- `date_from` (integer or string) – earliest date to search (rounded down to start of day UTC).
- `date_to` (integer or string) – latest date to search (rounded up to end of day UTC).
- `limit` (integer `1..100`, default `10`) – max results.
- `offset` (integer ≥ 0) – 0-based offset for pagination.
- `key` (string) – transaction key; good candidate to store THEONE payment/COE ids.

### Response schema (200)
Returns an array of transactions. For each item:

- `id` (integer ≥ 1) – ID / reference number of the transaction.
- `created_at` (ISO datetime) – when the transaction was run.
- `settled_date` (UTC date) – when the transaction was settled.
- `amount_details`:
  - `amount`, `tax`, `tax_percent`, `surcharge`, `shipping`, `tip`, `discount`, `subtotal`,
  - `original_requested_amount`, `original_authorized_amount`.
- `transaction_details`:
  - `description`, `clerk`, `terminal`, `key`, `client_ip`, `signature`,
  - `invoice_number`, `po_number`, `order_number`,
  - `batch_id`, `source`, `terminal_name`, `terminal_id`, `username`,
  - `type` (e.g. `"charge"`), `reference_number`, `schedule_id`.
- `customer`:
  - `identifier`, `email`, `fax`, `customer_id`.
- `status_details`:
  - `status` (e.g. `"captured"`),
  - `error_code`, `error_message`.
- `billing_info` / `shipping_info` (Address):
  - `first_name`, `last_name`, `street`, `street2`, `city`, `state`, `zip`, `country`, `phone`.
- `custom_fields`:
  - `custom1` … `custom20`.
- `card_details`:
  - `name`, `last4`, `expiry_month`, `expiry_year`, `card_type`,
  - `avs_street`, `avs_zip`, `auth_code`,
  - `bin`, `bin_details.type`,
  - `avs_result`, `avs_result_code`,
  - `cvv_result`, `cvv_result_code`,
  - `cavv_result`, `cavv_result_code`.

### Error responses
- `400` – invalid request or missing required fields.
- `401` – credentials missing or invalid.

### Mapping to THEONE
- Store THEONE identifiers (e.g. `payment._id`, `coe_id`) in `transaction_details.key` or `custom_fields` to enable reverse lookup.
- Use `id` / `transaction_details.reference_number` as GOAT-side transaction identifiers when cross-referencing from your `Payment` model.
- `status_details.status` combined with `amount_details` allows reconciliation with your `Payment` and `COE` records.
- This endpoint is suitable for:
  - building admin payment history/analytics,
  - investigating missing or delayed webhooks,
  - sanity-checking that COE totals and refunds match gateway data.

---

## Function 5 – Refund (Full + Partial)

### Endpoint
- Method: `POST`
- Path: `/transactions/refund`
- Full sandbox URL: `https://api.sandbox.goatpaymentsgateway.com/api/v2/transactions/refund`
- Full production URL: `https://api.goatpaymentsgateway.com/api/v2/transactions/refund`
- Auth: `BasicAuthentication`

### Purpose
Refund a previously **settled** charge. Returns an error if the original transaction has not settled yet.

### Permissions / behavior notes
- Requires **Refund** permission on the source key for credit-card transactions.
- Requires **Check Refund** permission for checks.
- ACH transactions: can only be refunded **after 5 business days** have passed from processing.
- Terminals with connected refunds behave as matched refunds.

### Request schema
Content type: `application/json`

Required:
- `reference_number` (integer ≥ 1) – reference number of the transaction to refund.

Optional:
- `terminal_id` (string) – serial number of the terminal. Defaults to the terminal used on the original transaction; set this to run the refund on a different terminal.
- `amount` (number, `0.01..20000000`) – amount of the original transaction to refund.  
  - **Omit** to refund the full amount.
- `cvv2` (string, 3–4 digits, `^\d+$`) – CVC/CID; recommended for fraud prevention.
- `customer` (BaseTransactionCustomer) – customer contact details (email, identifier, send_receipt).
- `transaction_details` (BaseTransactionDetails) – description, clerk, terminal, client_ip, signature.
- `transaction_flags` (TransactionFlags) – additional flags (recurring, installment, customer_initiated, device info).
- `custom_fields` (CustomFields) – `custom1` … `custom20`.

Minimal full-refund example:
```json
{
  "reference_number": 123456
}
```

Partial refund example:
```json
{
  "reference_number": 123456,
  "amount": 50.00,
  "transaction_details": {
    "description": "Partial refund – price adjustment"
  }
}
```

### Response schema (200)
```json
{
  "version": "string",
  "status": "Approved | Partially Approved | Submitted | Declined | Error",
  "status_code": "A | P | D | E",
  "error_message": "string",
  "error_code": "string",
  "error_details": "string or object",
  "reference_number": 123457
}
```

Notes:
- `reference_number` in the response is the **new refund transaction’s** reference number (not the original charge).
- Use `status` / `status_code` and error fields to determine success.

### Error responses
- `400` – request invalid or missing required fields.
- `401` – credentials missing or invalid.
- `415` – `Content-Type` must be `application/json`.

### Mapping to THEONE
- Original GOAT `reference_number` or `id` → find corresponding `Payment` record.
- If `amount` is omitted:
  - Treat as **full refund**: mirror your existing logic (set Payment `status=refunded`, COE `payment_status` back to `unpaid`, adjust `total_paid` and `refund_amount` to full).
- If `amount` is present:
  - Treat as **partial refund**: subtract `amount` from `total_paid`, increment `refund_amount` by `amount`, but typically keep COE `payment_status` as `paid` (same as current `processRefund` logic).
- Persist:
  - refund amount,
  - refund timestamp,
  - GOAT refund `reference_number` as `refund_transaction_id` equivalent.
- Use this endpoint only after the charge has settled. For **unsettled** charges use Function 25 (**void**). To let GOAT pick void vs refund by settlement state, use Function 26 (**reversal**).

---

## Function 25 – Void (unsettled charge)

### Endpoint
- Method: `POST`
- Path: `/transactions/void`
- Full sandbox URL: `https://api.sandbox.goatpaymentsgateway.com/api/v2/transactions/void`
- Full production URL: `https://api.goatpaymentsgateway.com/api/v2/transactions/void`
- Auth: `BasicAuthentication`

THEONE: call `{getGoatApiRoot()}/transactions/void` so stage hits sandbox and prod hits production.

### Purpose
Void a previously **unsettled** charge. Returns an error if the original transaction has **already settled**.

### Permissions / behavior notes
- Requires **Void** permission on the source key for credit-card transactions.
- Requires **Check Void** permission for checks.
- ACH: can only be voided until **1am Eastern Time**.
- FirstData terminal: host capture; void only within **25 minutes** of the transaction.
- TSYS: voids only for **US or Canadian** cards. International cards must use **refund**.

### Request schema
Content type: `application/json`

Required:
- `reference_number` (integer ≥ 1) – reference number of the transaction to void.

Optional:
- `customer` (BaseTransactionCustomer) – `send_receipt`, `email`, `fax`, `identifier`.
- `transaction_details` (BaseTransactionDetails) – `description`, `clerk`, `terminal`, `client_ip`, `signature`.

Minimal example:
```json
{
  "reference_number": 123456
}
```

Full request sample:
```json
{
  "reference_number": 1,
  "customer": {
    "send_receipt": false,
    "email": "string",
    "fax": "string",
    "identifier": "string"
  },
  "transaction_details": {
    "description": "string",
    "clerk": "string",
    "terminal": "string",
    "client_ip": "string",
    "signature": "string"
  }
}
```

### Response schema (200)
```json
{
  "version": "string",
  "status": "Approved | Partially Approved | Submitted | Declined | Error",
  "status_code": "A | P | D | E",
  "error_message": "string",
  "error_code": "string",
  "error_details": "string or object"
}
```

Treat success like charge: `status_code` `A` or `status` `Approved`.

### Error responses
- `400` – request invalid, missing fields, or original txn already settled.
- `401` – credentials missing or invalid.
- `415` – `Content-Type` must be `application/json`.

### Mapping to THEONE
- Original GOAT `reference_number` → `Payment.gp_transaction_id` (legacy field; stores GOAT ref).
- On approved void: Payment `status=cancelled` (or a dedicated voided flag if added); do **not** create a refund row.
- Full void: reverse COE `total_paid` by the original amount; `payment_status` back to `unpaid` when that payment was the only captured amount (same accounting as full refund, without `refund_transaction_id`).
- Persist void timestamp + GOAT void response status. Do not call refund after a successful void on the same ref.
- Stage vs prod: sandbox source key must have Void; production source key must have Void independently.

---

## Function 26 – Reversal (void, refund, or adjust by state)

### Endpoint
- Method: `POST`
- Path: `/transactions/reversal`
- Full sandbox URL: `https://api.sandbox.goatpaymentsgateway.com/api/v2/transactions/reversal`
- Full production URL: `https://api.goatpaymentsgateway.com/api/v2/transactions/reversal`
- Auth: `BasicAuthentication` — source key **must have a PIN**.

THEONE: call `{getGoatApiRoot()}/transactions/reversal` so stage hits sandbox and prod hits production.

### Purpose
Convenience method to completely or partially reverse a previous transaction **regardless of settlement state**. Combines `/transactions/adjust`, `/transactions/void`, and `/transactions/refund`.

### Routing GOAT applies
If **no `amount`**:
- Unsettled → **void**
- Settled → **full refund**

If **`amount` is sent**:
- Unsettled → **adjust** (reduce by `amount`; not the new total). Full original amount → **void**
- Settled → **refund** for `amount`

### Permissions / behavior notes
- Source key **PIN required**.
- CC: **Charge**, **Void**, and **Refund**.
- Checks: **Check Void** and **Check Refund**.
- ACH: void only until 1am ET the night after processing; refund only after **5 business days**. ACH cannot be adjusted (error if amount sent while unsettled).
- First Data terminal: void only within **25 minutes**; after that GOAT runs refund/credit even if unsettled.
- Terminal: cannot adjust; a different `amount` always runs as refund, settled or not.
- TSYS: void/adjust only US/Canadian cards; international must refund.
- Full reversal on a **different** `terminal_id` runs as **refund**, not void.
- Terminals with connected refunds behave as matched refunds.

### Request schema
Content type: `application/json`

Required:
- `reference_number` (integer ≥ 1) – transaction to reverse.

Optional:
- `terminal_id` (string) – boarded terminal serial. Default = original terminal. Different terminal → void becomes refund.
- `amount` (number `0.01..20000000`) – amount of the original transaction to reverse (reduction, not new total).
- `customer` (BaseTransactionCustomer).
- `transaction_details` (BaseTransactionDetails).

Minimal full reverse:
```json
{
  "reference_number": 123456
}
```

Partial reverse sample:
```json
{
  "reference_number": 1,
  "terminal_id": "string",
  "amount": 0.01,
  "customer": {
    "send_receipt": false,
    "email": "string",
    "fax": "string",
    "identifier": "string"
  },
  "transaction_details": {
    "description": "string",
    "clerk": "string",
    "terminal": "string",
    "client_ip": "string",
    "signature": "string"
  }
}
```

### Response schema (200)
One of: Void response, Refund response, or Adjust response.

```json
{
  "version": "string",
  "status": "Approved | Partially Approved | Submitted | Declined | Error",
  "status_code": "A | P | D | E",
  "error_message": "string",
  "error_code": "string",
  "error_details": "string or object",
  "type": "Void"
}
```

`type` (when present) tells which path GOAT took (`Void` / refund / adjust). Branch THEONE accounting on `type` + `status_code`, not on whether you sent `amount`.

### Error responses
- `400` – request invalid or missing required fields.
- `401` – credentials missing or invalid (including missing PIN).
- `415` – `Content-Type` must be `application/json`.

### Mapping to THEONE
- Prefer Function 26 for a single admin “undo” when settlement is unknown; use Function 25 when product must **only** void and fail if already settled; use Function 5 when product must **only** refund settled charges.
- If `type` is `Void` → same Payment/COE mapping as Function 25.
- If GOAT refunded → same mapping as Function 5 (including refund ref if returned).
- If GOAT adjusted (partial unsettled) → reduce captured amount on Payment; do not mark fully refunded/cancelled unless remaining auth is zero.
- Stage sandbox key and prod key both need Charge + Void + Refund + PIN. Do not reuse the sandbox key on prod.

---

## Function 6 – Webhooks and Signature Management

> NOTE: These endpoints manage webhook registrations and expose the **signature secret**, but the docs still need to be checked for the **event payload shapes** and exact **signature verification algorithm**. This function focuses on lifecycle management.

### 6.1 List webhooks

#### Endpoint
- Method: `GET`
- Path: `/webhooks`
- Full sandbox URL: `https://api.sandbox.goatpaymentsgateway.com/api/v2/webhooks`
- Full production URL: `https://api.goatpaymentsgateway.com/api/v2/webhooks`
- Auth: `BasicAuthentication`

#### Purpose
Return a list of all webhooks configured for the merchant, including the per-webhook `signature` value used for validating incoming callbacks.

#### Response (200)
Array of:
- `id` (integer) – webhook ID
- `signature` (string) – webhook signature secret
- `webhook_url` (string, `https://...`, ≤ 255 chars)
- `description` (string, 1–255 chars)
- `active` (boolean, default `true`)

Errors:
- `400`, `401`

### 6.2 Create webhook

#### Endpoint
- Method: `POST`
- Path: `/webhooks`
- Auth: `BasicAuthentication`

#### Request body
Content type: `application/json`

Required:
- `webhook_url` (string, `https://...`, ≤ 255 chars)

Optional:
- `description` (string, 1–255 chars)
- `active` (boolean, default `true`)

Example:
```json
{
  "webhook_url": "https://stage.the1.vip/webhooks/goat",
  "description": "THEONE payment/refund events",
  "active": true
}
```

#### Response (201)
```json
{
  "id": 123,
  "signature": "string",
  "webhook_url": "https://stage.the1.vip/webhooks/goat",
  "description": "THEONE payment/refund events",
  "active": true
}
```

Errors:
- `400`, `401`, `409` (duplicate webhook)

### 6.3 Get single webhook

#### Endpoint
- Method: `GET`
- Path: `/webhooks/{id}`
- Path params:
  - `id` (integer ≥ 1) – webhook ID

#### Response (200)
Same fields as list/create:
- `id`, `signature`, `webhook_url`, `description`, `active`

Errors:
- `400`, `401`, `404`

### 6.4 Update webhook

#### Endpoint
- Method: `PATCH`
- Path: `/webhooks/{id}`
- Path params:
  - `id` (integer ≥ 1)

#### Request body
Content type: `application/json`

Any of:
- `webhook_url` (string, `https://...`)
- `description` (string)
- `active` (boolean)

Example:
```json
{
  "webhook_url": "https://stage.the1.vip/webhooks/goat",
  "description": "THEONE payments webhook",
  "active": true
}
```

#### Response (200)
Same as create:
- `id`, `signature`, `webhook_url`, `description`, `active`

Errors:
- `400`, `401`, `404`

### 6.5 Delete webhook

#### Endpoint
- Method: `DELETE`
- Path: `/webhooks/{id}`
- Path params:
  - `id` (integer ≥ 1)

#### Response
- `204` – webhook deleted

Errors:
- `400`, `401`, `404`

### Mapping to THEONE
- Maintain a single **primary webhook** registration for THEONE (per environment) and store:
  - `id`
  - `webhook_url`
  - `signature` (secret used for validating incoming requests)
- Keep `signature` in server config / env (`GOAT_WEBHOOK_SIGNATURE`) and never expose it to clients.
- When GOAT calls the webhook URL, you must:
  - extract the signature header they document (exact header name and HMAC/public-key algorithm still to be confirmed),
  - compute/verify against the stored `signature`,
  - then dispatch events into your existing `processPaymentWebhook` / COE-update logic.

### Still Required (not yet in docs)
- **Event payload schema**: what GOAT sends on payment authorized/captured/failed/refunded.
- **Signature verification details**:
  - header name containing signature,
  - algorithm (e.g. HMAC-SHA256 over raw body, timestamp, etc.),
  - any replay protection fields (timestamps, nonces).

---

## Function 7 - Get Single Invoice

### Endpoint
- Method: `GET`
- Path: `/invoices/{id}`
- Full sandbox URL: `https://api.sandbox.goatpaymentsgateway.com/api/v2/invoices/{id}`
- Full production URL: `https://api.goatpaymentsgateway.com/api/v2/invoices/{id}`
- Auth: `BasicAuthentication`

### Purpose
Fetch one invoice by invoice ID so THEONE can display invoice details, payment link, line items, and balances due to clients/admins.

### Path parameter
- `id` (required, integer >= 1) - The invoice ID.

### Response (200)
Invoice object fields:
- `id` (integer) - invoice ID
- `status` (enum) - `canceled | paid | partially paid | sent | viewed | authorized | saved`
- `to_email` (string) - comma-delimited recipient emails
- `sub_total_amount` (number) - subtotal before tax/surcharge
- `total_amount` (number) - total after tax (without surcharge)
- `due_amount` (number) - unpaid balance
- `paid_amount` (number) - amount already paid
- `tax` (number) - calculated tax amount
- `created_at` (date-time) - invoice create timestamp
- `products` (array of `InvoiceProduct`) - line items
- `payment_link` (string) - hosted pay URL
- `customer_id` (integer or null)
- `number` (string or null) - invoice number
- `customer_company` (string <= 255)
- `customer_email` (string <= 255)
- `billing_info` (object)
- `shipping_info` (object)
- `date` (date)
- `due_date` (date)
- `note` (string)
- `tax_percent` (number 0..100)
- `discount` (object)
- `requirement` (object)
- `surcharge` (object)
- `terms` (string)
- `action` (enum) - `charge | authorize`

### Error responses
- `400` - request invalid or missing required fields
- `401` - credentials missing or invalid
- `403` - no permission for this feature
- `404` - invoice not found

### Example response
```json
{
  "id": 0,
  "status": "canceled",
  "to_email": "string",
  "sub_total_amount": 0,
  "total_amount": 0,
  "due_amount": 0,
  "paid_amount": 0,
  "tax": 0,
  "created_at": "2019-08-24T14:15:22Z",
  "products": [
    {
      "id": 0,
      "product_id": null,
      "name": "string",
      "description": "string",
      "price": 20000000,
      "quantity": 0,
      "taxable": false,
      "tax": 100,
      "surcharge": 0,
      "subtotal": 0
    }
  ],
  "payment_link": "string",
  "customer_id": null,
  "number": null,
  "customer_company": "string",
  "customer_email": "string",
  "billing_info": {
    "first_name": "string",
    "last_name": "string",
    "street": "string",
    "street2": "string",
    "state": "string",
    "city": "string",
    "zip": "string",
    "country": "string",
    "phone": "string"
  },
  "shipping_info": {
    "first_name": "string",
    "last_name": "string",
    "street": "string",
    "street2": "string",
    "state": "string",
    "city": "string",
    "zip": "string",
    "country": "string",
    "phone": "string"
  },
  "date": "2019-08-24",
  "due_date": "2019-08-24",
  "note": "string",
  "tax_percent": 100,
  "discount": {
    "value": 0,
    "type": "percent"
  },
  "requirement": {
    "value": 100,
    "type": "percent"
  },
  "surcharge": {
    "card": {
      "value": 0,
      "type": "percent"
    },
    "ach": {
      "value": 0,
      "type": "percent"
    }
  },
  "terms": "string",
  "action": "charge"
}
```

### Mapping to THEONE
- Use GOAT invoice `id` as external invoice reference if you need a direct link.
- `payment_link` can be surfaced to clients for direct invoice payment (if this flow is enabled).
- Keep THEONE’s generated invoice endpoints (`/v1/payments/:paymentId/invoice` and `/invoice.pdf`) as the source of truth unless product explicitly moves to gateway-native invoices.

---

## Function 8 - Cancel an Existing Invoice

### Endpoint
- Method: `POST`
- Path: `/invoices/{id}/cancel`
- Full sandbox URL: `https://api.sandbox.goatpaymentsgateway.com/api/v2/invoices/{id}/cancel`
- Full production URL: `https://api.goatpaymentsgateway.com/api/v2/invoices/{id}/cancel`
- Auth: `BasicAuthentication`

### Purpose
Cancel an existing invoice after it has been sent but before any payment has been made.

### Business rule
- Invoice is cancelable only when sent and not yet paid.

### Path parameter
- `id` (required, integer >= 1) - The invoice ID.

### Responses
- `204` - Invoice canceled successfully.
- `400` - Request invalid or missing required fields.
- `401` - Credentials missing or invalid.
- `403` - No permission to access this feature.
- `404` - Invoice not found.
- `422` - Invoice cannot be canceled.

### Mapping to THEONE
- Use this operation for explicit client/admin cancellation flows where GOAT-native invoices are used.
- Keep local payment/invoice status transitions synchronized with GOAT cancel outcome (`204`) to avoid drift between systems.

---

## Function 9 - Reactivate a Canceled Invoice

### Endpoint
- Method: `POST`
- Path: `/invoices/{id}/reactivate`
- Full sandbox URL: `https://api.sandbox.goatpaymentsgateway.com/api/v2/invoices/{id}/reactivate`
- Full production URL: `https://api.goatpaymentsgateway.com/api/v2/invoices/{id}/reactivate`
- Auth: `BasicAuthentication`

### Purpose
Reactivate an invoice that was previously canceled and optionally send a reactivation email/SMS notification.

### Path parameter
- `id` (required, integer >= 1) - The invoice ID.

### Request body (application/json)
- `body` (string, optional)  
  Default: `"Dear {customer_name},\n\nPlease see the Invoice {invoice_number} attached."`  
  If omitted, GOAT uses default template with placeholders. If supplied, text is sent exactly as provided (supports escape chars like `\n`).
- `subject` (string, optional)  
  Default: `"Reactivated Invoice {invoice_number} from {merchant_company}"`  
  If supplied, text is sent exactly as provided without template parsing.
- `to` (array of email strings, optional)  
  Recipient list. If omitted, populated from invoice `customer_email`.
- `sms_number` (array of strings, optional)  
  Phone numbers for SMS send.
- `attach_invoice` (boolean, optional, default `true`)  
  Whether to attach the system invoice to email.

### Request example
```json
{
  "body": "Dear {customer_name},\n\nPlease see the Invoice {invoice_number} attached.",
  "subject": "Reactivated Invoice {invoice_number} from {merchant_company}",
  "to": [
    "string"
  ],
  "sms_number": [
    "string"
  ],
  "attach_invoice": true
}
```

### Responses
- `204` - Invoice reactivated successfully.
- `400` - Request invalid or missing required fields.
- `401` - Credentials missing or invalid.
- `403` - No permission to access this feature.
- `404` - Invoice not found.
- `422` - Invoice cannot be reactivated because it is not canceled.

### Mapping to THEONE
- Use this to restore a canceled GOAT-native invoice flow without creating a brand new invoice id.
- Keep THEONE local invoice/payment status synchronized with GOAT reactivation outcome (`204`) to avoid status drift.

---

## Function 10 - Request Final Payment for an Invoice

### Endpoint
- Method: `POST`
- Path: `/invoices/{id}/request-final`
- Full sandbox URL: `https://api.sandbox.goatpaymentsgateway.com/api/v2/invoices/{id}/request-final`
- Full production URL: `https://api.goatpaymentsgateway.com/api/v2/invoices/{id}/request-final`
- Auth: `BasicAuthentication`

### Purpose
Request final payment for an invoice that is active and partially paid.

### Business rule
- Final payment request is valid only when invoice is active and in partially paid state.

### Path parameter
- `id` (required, integer >= 1) - The invoice ID.

### Request body (application/json)
- `body` (string, optional)  
  Default: `"Dear {customer_name},\n\nPlease see the Invoice {invoice_number} attached."`  
  If omitted, GOAT uses default template with placeholders. If supplied, text is sent exactly as provided (supports escape chars like `\n`).
- `subject` (string, optional)  
  Default: `"Invoice {invoice_number} from {merchant_company}"`  
  If supplied, text is sent exactly as provided without template parsing.
- `to` (array of email strings, optional)  
  Recipient list. If omitted, populated from invoice `customer_email`.
- `sms_number` (array of strings, optional)  
  Phone numbers for SMS send.
- `attach_invoice` (boolean, optional, default `true`)  
  Whether to attach system invoice to email.

### Request example
```json
{
  "body": "Dear {customer_name},\n\nPlease see the Invoice {invoice_number} attached.",
  "subject": "Invoice {invoice_number} from {merchant_company}",
  "to": [
    "string"
  ],
  "sms_number": [
    "string"
  ],
  "attach_invoice": true
}
```

### Responses
- `204` - Payment request sent successfully.
- `400` - Request invalid or missing required fields.
- `401` - Credentials missing or invalid.
- `403` - No permission to access this feature.
- `404` - Invoice not found.
- `422` - Request cannot be sent.

### Mapping to THEONE
- Use this endpoint to collect outstanding balance on partially paid GOAT-native invoices.
- Keep THEONE-side invoice/payment status synchronized after request dispatch (`204`) and track follow-up via invoice status polling/webhooks.

---

## Function 11 - Delete an Invoice

### Endpoint
- Method: `DELETE`
- Path: `/invoices/{id}`
- Full sandbox URL: `https://api.sandbox.goatpaymentsgateway.com/api/v2/invoices/{id}`
- Full production URL: `https://api.goatpaymentsgateway.com/api/v2/invoices/{id}`
- Auth: `BasicAuthentication`

### Purpose
Delete an invoice before any payment is made.

### Business rule
- Invoice can be deleted only when no payment has been made.

### Path parameter
- `id` (required, integer >= 1) - The invoice ID.

### Responses
- `204` - Invoice deleted successfully.
- `400` - Request invalid or missing required fields.
- `401` - Credentials missing or invalid.
- `403` - No permission to access this feature.
- `404` - Invoice not found.
- `422` - Invoice cannot be deleted.

### Mapping to THEONE
- Use this for hard removal of unused/unpaid GOAT-native invoices.
- After successful delete (`204`), clean local references to the deleted GOAT invoice id and keep THEONE status aligned.

---

## Function 12 - Update an Invoice

### Endpoint
- Method: `PATCH`
- Path: `/invoices/{id}`
- Full sandbox URL: `https://api.sandbox.goatpaymentsgateway.com/api/v2/invoices/{id}`
- Full production URL: `https://api.goatpaymentsgateway.com/api/v2/invoices/{id}`
- Auth: `BasicAuthentication`

### Purpose
Update editable invoice fields before it is paid or canceled.

### Path parameter
- `id` (required, integer >= 1) - The invoice ID.

### Request body (application/json)
- `customer_id` (integer or null, default `null`)  
  Customer ID to associate with/send invoice to.
- `number` (string or null, default `null`)  
  Invoice number (alphanumeric allowed). If set to `null`, increments highest numeric number.
- `customer_company` (string <= 255)  
  Customer name. If linked to customer and omitted, populated from customer.
- `customer_email` (email string <= 255)  
  Customer email. If linked to customer and omitted, populated from customer.
- `billing_info` (object)  
  Billing info. If linked to customer and omitted, populated from customer.
- `shipping_info` (object)  
  Shipping info. If linked to customer and omitted, populated from customer.
- `date` (date string)  
  Invoice date. Defaults to today.
- `due_date` (date string)  
  Due date. Defaults to 30 days from invoice date.
- `note` (string)  
  Invoice note.
- `tax_percent` (number, range `0..100`)  
  Tax percent for taxable products.
- `discount` (object)  
  Optional pre-tax discount.
- `requirement` (object)  
  Initial required amount; default full due amount.
- `surcharge` (object)  
  Optional card/ACH surcharge; may be overridden by ISO/MSP mandatory surcharge rules.
- `terms` (string)  
  Additional invoice terms.
- `action` (enum, default `charge`)  
  `charge | authorize`

### Responses
- `200` - Invoice updated successfully.
- `400` - Request invalid or missing required fields.
- `401` - Credentials missing or invalid.
- `403` - No permission to access this feature.
- `404` - Invoice not found.
- `422` - Invoice cannot be updated once paid or canceled.

### Example response
```json
{
  "id": 0,
  "status": "canceled",
  "to_email": "string",
  "sub_total_amount": 0,
  "total_amount": 0,
  "due_amount": 0,
  "paid_amount": 0,
  "tax": 0,
  "created_at": "2019-08-24T14:15:22Z",
  "products": [
    {
      "id": 0,
      "product_id": null,
      "name": "string",
      "description": "string",
      "price": 20000000,
      "quantity": 0,
      "taxable": false,
      "tax": 100,
      "surcharge": 0,
      "subtotal": 0
    }
  ],
  "payment_link": "string",
  "customer_id": null,
  "number": null,
  "customer_company": "string",
  "customer_email": "string",
  "billing_info": {
    "first_name": "string",
    "last_name": "string",
    "street": "string",
    "street2": "string",
    "state": "string",
    "city": "string",
    "zip": "string",
    "country": "string",
    "phone": "string"
  },
  "shipping_info": {
    "first_name": "string",
    "last_name": "string",
    "street": "string",
    "street2": "string",
    "state": "string",
    "city": "string",
    "zip": "string",
    "country": "string",
    "phone": "string"
  },
  "date": "2019-08-24",
  "due_date": "2019-08-24",
  "note": "string",
  "tax_percent": 100,
  "discount": {
    "value": 0,
    "type": "percent"
  },
  "requirement": {
    "value": 100,
    "type": "percent"
  },
  "surcharge": {
    "card": {
      "value": 0,
      "type": "percent"
    },
    "ach": {
      "value": 0,
      "type": "percent"
    }
  },
  "terms": "string",
  "action": "charge"
}
```

### Mapping to THEONE
- Use PATCH to keep invoice metadata aligned with evolving COE details before payment.
- Gate updates in THEONE UI/workflow when invoice is paid/canceled to avoid predictable `422` responses.

---

## Function 13 - Send an Existing Invoice

### Endpoint
- Method: `POST`
- Path: `/invoices/{id}/send`
- Full sandbox URL: `https://api.sandbox.goatpaymentsgateway.com/api/v2/invoices/{id}/send`
- Full production URL: `https://api.goatpaymentsgateway.com/api/v2/invoices/{id}/send`
- Auth: `BasicAuthentication`

### Purpose
Send an existing invoice before any payment is made.

### Business rule
- Invoice can only be sent before payment is made.
- After payment has started/occurred, use `POST /invoices/{id}/request-final` for outstanding-balance collection.

### Path parameter
- `id` (required, integer >= 1) - The invoice ID.

### Request body (application/json)
- `body` (string, optional)  
  Default: `"Dear {customer_name},\n\nPlease see the Invoice {invoice_number} attached."`  
  If omitted, GOAT uses default template with placeholders. If supplied, text is sent exactly as provided (supports escape chars like `\n`).
- `subject` (string, optional)  
  Default: `"Invoice {invoice_number} from {merchant_company}"`  
  If supplied, text is sent exactly as provided without template parsing.
- `to` (array of email strings, optional)  
  Recipient list. If omitted, populated from invoice `customer_email`.
- `sms_number` (array of strings, optional)  
  Phone numbers for SMS send.
- `attach_invoice` (boolean, optional, default `true`)  
  Whether to attach system invoice to email.

### Request example
```json
{
  "body": "Dear {customer_name},\n\nPlease see the Invoice {invoice_number} attached.",
  "subject": "Invoice {invoice_number} from {merchant_company}",
  "to": [
    "string"
  ],
  "sms_number": [
    "string"
  ],
  "attach_invoice": true
}
```

### Responses
- `204` - Invoice sent successfully.
- `400` - Request invalid or missing required fields.
- `401` - Credentials missing or invalid.
- `403` - No permission to access this feature.
- `404` - Invoice not found.
- `422` - Invoice cannot be sent.

### Mapping to THEONE
- Use this for first-time send/resend of unpaid GOAT-native invoices.
- If invoice has already been partially paid, route flow to `request-final` rather than `send` to match GOAT business rules.

---

## Function 14 - Get Multiple Customers

### Endpoint
- Method: `GET`
- Path: `/customers`
- Full sandbox URL: `https://api.sandbox.goatpaymentsgateway.com/api/v2/customers`
- Full production URL: `https://api.goatpaymentsgateway.com/api/v2/customers`
- Auth: `BasicAuthentication`

### Purpose
Return a paginated array of GOAT customers. Use for admin/support lookups and to find an existing customer (e.g. filter by `customer_number`) before associating charges with `customer_id`.

### Query parameters
- `order` (string, default `"asc"`, enum: `"asc"` | `"desc"`) – sort order.
- `limit` (integer, `1..100`, default `10`) – maximum number of results.
- `offset` (integer, `>= 0`, default `0`) – 0-based offset for pagination.
- `active` (boolean, optional) – filter by customer active status.
- `customer_number` (string, optional) – filter by the customer’s `customer_number` (custom identifier).

### Response schema (200)
Content type: `application/json`

Returns an **array** of customer objects. Each item may include:

- `id` (integer, `>= 1`) – GOAT customer ID (use as `customer.customer_id` on charges when linking).
- `identifier` (string, `<= 255`) – identifies the customer (e.g. name or company).
- `customer_number` (string, `<= 255`) – custom identifier (good fit for stable external keys such as THEONE `User._id` as string).
- `first_name` (string, `<= 255`)
- `last_name` (string, `<= 255`)
- `email` (string, email, `<= 255`)
- `website` (string, `<= 255`)
- `phone` (string, `<= 50`)
- `alternate_phone` (string, `<= 50`)
- `billing_info` (object, `Address`) – `first_name`, `last_name`, `street`, `street2`, `state`, `city`, `zip`, `country`, `phone`
- `shipping_info` (object, `Address`) – same shape as `billing_info`
- `active` (boolean, default `true`)
- `note` (string, `<= 750`)

### Error responses
- `400` – request invalid or missing required fields.
- `401` – credentials missing or invalid.

### Example response (200)
```json
[
  {
    "identifier": "string",
    "customer_number": "string",
    "first_name": "string",
    "last_name": "string",
    "email": "string",
    "website": "string",
    "phone": "string",
    "alternate_phone": "string",
    "billing_info": {
      "first_name": "string",
      "last_name": "string",
      "street": "string",
      "street2": "string",
      "state": "string",
      "city": "string",
      "zip": "string",
      "country": "string",
      "phone": "string"
    },
    "shipping_info": {
      "first_name": "string",
      "last_name": "string",
      "street": "string",
      "street2": "string",
      "state": "string",
      "city": "string",
      "zip": "string",
      "country": "string",
      "phone": "string"
    },
    "active": true,
    "note": "string",
    "id": 1
  }
]
```

### cURL (list customers, sandbox)
```bash
curl -sS -w "\nHTTP_STATUS:%{http_code}\n" \
  -X GET "${GOAT_SANDBOX_BASE_URL}/api/v2/customers?limit=10&offset=0&order=asc" \
  -u "${GOAT_SOURCE_KEY}:${GOAT_PIN}" \
  -H "Accept: application/json"
```

### Mapping to THEONE
- Prefer `customer_number` (or `identifier`, per product choice) to store THEONE’s stable user key so `GET /customers?customer_number=...` can resolve the GOAT `id` before `POST /transactions/charge`.
- After resolving `id`, send `customer: { customer_id: <id>, identifier: ..., email: ... }` on source charges (see Function 4) so transactions stay linked to the vault customer.

---

## Function 15 - Create a Customer

### Endpoint
- Method: `POST`
- Path: `/customers`
- Full sandbox URL: `https://api.sandbox.goatpaymentsgateway.com/api/v2/customers`
- Full production URL: `https://api.goatpaymentsgateway.com/api/v2/customers`
- Auth: `BasicAuthentication`

### Purpose
Create a GOAT customer record. Use when no customer exists for a THEONE user (e.g. after `GET /customers?customer_number=...` returns empty), then persist the returned `id` and pass it as `customer.customer_id` on subsequent charges (Function 4).

### Request body (application/json)
Content type: `application/json` (required; `415` if missing or wrong).

**Required**
- `identifier` (string, `<= 255`) – something that identifies the customer (e.g. name or company).

**Optional**
- `customer_number` (string, `<= 255`) – custom identifier (recommended for THEONE `User._id` as string for stable lookup).
- `first_name`, `last_name` (string, `<= 255` each)
- `email` (string, valid email, `<= 255`)
- `website` (string, `<= 255`)
- `phone`, `alternate_phone` (string, `<= 50` each)
- `billing_info`, `shipping_info` (object, `Address`) – `first_name`, `last_name`, `street`, `street2`, `state`, `city`, `zip`, `country`, `phone`
- `active` (boolean, default `true`)
- `note` (string, `<= 750`)

### Response schema (201)
Content type: `application/json`

Same fields as the request, plus:
- `id` (integer, `>= 1`) – GOAT customer ID to use as `customer_id` on charges and invoices.

### Error responses
- `400` – request invalid or missing required fields (e.g. missing `identifier`).
- `401` – credentials missing or invalid.
- `415` – `Content-Type` must be `application/json`.

### Request example
```json
{
  "identifier": "string",
  "customer_number": "string",
  "first_name": "string",
  "last_name": "string",
  "email": "string",
  "website": "string",
  "phone": "string",
  "alternate_phone": "string",
  "billing_info": {
    "first_name": "string",
    "last_name": "string",
    "street": "string",
    "street2": "string",
    "state": "string",
    "city": "string",
    "zip": "string",
    "country": "string",
    "phone": "string"
  },
  "shipping_info": {
    "first_name": "string",
    "last_name": "string",
    "street": "string",
    "street2": "string",
    "state": "string",
    "city": "string",
    "zip": "string",
    "country": "string",
    "phone": "string"
  },
  "active": true,
  "note": "string"
}
```

### Response example (201)
```json
{
  "identifier": "string",
  "customer_number": "string",
  "first_name": "string",
  "last_name": "string",
  "email": "string",
  "website": "string",
  "phone": "string",
  "alternate_phone": "string",
  "billing_info": {
    "first_name": "string",
    "last_name": "string",
    "street": "string",
    "street2": "string",
    "state": "string",
    "city": "string",
    "zip": "string",
    "country": "string",
    "phone": "string"
  },
  "shipping_info": {
    "first_name": "string",
    "last_name": "string",
    "street": "string",
    "street2": "string",
    "state": "string",
    "city": "string",
    "zip": "string",
    "country": "string",
    "phone": "string"
  },
  "active": true,
  "note": "string",
  "id": 1
}
```

### cURL (create customer, sandbox)
```bash
curl -sS -w "\nHTTP_STATUS:%{http_code}\n" \
  -X POST "${GOAT_SANDBOX_BASE_URL}/api/v2/customers" \
  -u "${GOAT_SOURCE_KEY}:${GOAT_PIN}" \
  -H "Content-Type: application/json" \
  -d '{
    "identifier": "Acme Corp",
    "customer_number": "theone-user-objectid",
    "first_name": "Jane",
    "last_name": "Doe",
    "email": "jane@example.com"
  }'
```

### Mapping to THEONE
- Minimum viable body: `identifier` (required) plus `customer_number` set to THEONE user id string, `email`, and `first_name` / `last_name` from profile when available.
- On `201`, read `id` and cache on the user (or derive via Function 14 before each charge if you skip caching).
- Handle duplicate or conflict responses per GOAT behavior in production (not listed above); consider listing by `customer_number` again before creating if races occur.

---

## Function 16 - Create a Customer From a Transaction

### Endpoint
- Method: `POST`
- Path: `/customers/create-from-transaction`
- Full sandbox URL: `https://api.sandbox.goatpaymentsgateway.com/api/v2/customers/create-from-transaction`
- Full production URL: `https://api.goatpaymentsgateway.com/api/v2/customers/create-from-transaction`
- Auth: `BasicAuthentication`

### Purpose
Create a new GOAT **customer** using data copied from an existing **transaction** (by `reference_number`). GOAT documentation states:

- A **payment method** can later be created using the **same transaction** as the source.
- Any field sent in the request body **overrides** the corresponding value from the transaction.
- A **new customer is always created**, even when the transaction is already linked to an existing customer (does not merge into that customer).
- If the transaction was **not** linked to a customer, it will be **linked to this newly created** customer.

### Request body (application/json)
Content type: `application/json` (required; `415` if missing or wrong).

**Required**
- `reference_number` (integer, `>= 1`) – GOAT transaction reference number (same concept as charge response `reference_number`; see Functions 2 and 4).

**Optional** (each overrides transaction-sourced data when provided)
- `identifier` (string, `<= 255`)
- `customer_number` (string, `<= 255`)
- `first_name`, `last_name` (string, `<= 255` each)
- `email` (string, valid email, `<= 255`)
- `website` (string, `<= 255`)
- `phone`, `alternate_phone` (string, `<= 50` each)
- `billing_info`, `shipping_info` (object, `Address`)
- `active` (boolean, default `true`)
- `note` (string, `<= 750`)

### Response schema (201)
Content type: `application/json`

Customer object: same optional profile fields as Function 15, plus:
- `id` (integer, `>= 1`) – new GOAT customer ID.

### Error responses
- `400` – body invalid (e.g. missing or bad `reference_number`).
- `401` – credentials missing or invalid.
- `404` – transaction not found for the given `reference_number`.
- `415` – `Content-Type` must be `application/json`.

### Request example
`reference_number` is required. Omit optional fields to rely entirely on transaction data (still send a JSON object with at least `reference_number`).

```json
{
  "reference_number": 123456,
  "identifier": "string",
  "customer_number": "string",
  "first_name": "string",
  "last_name": "string",
  "email": "string",
  "website": "string",
  "phone": "string",
  "alternate_phone": "string",
  "billing_info": {
    "first_name": "string",
    "last_name": "string",
    "street": "string",
    "street2": "string",
    "state": "string",
    "city": "string",
    "zip": "string",
    "country": "string",
    "phone": "string"
  },
  "shipping_info": {
    "first_name": "string",
    "last_name": "string",
    "street": "string",
    "street2": "string",
    "state": "string",
    "city": "string",
    "zip": "string",
    "country": "string",
    "phone": "string"
  },
  "active": true,
  "note": "string"
}
```

### Response example (201)
```json
{
  "identifier": "string",
  "customer_number": "string",
  "first_name": "string",
  "last_name": "string",
  "email": "string",
  "website": "string",
  "phone": "string",
  "alternate_phone": "string",
  "billing_info": {
    "first_name": "string",
    "last_name": "string",
    "street": "string",
    "street2": "string",
    "state": "string",
    "city": "string",
    "zip": "string",
    "country": "string",
    "phone": "string"
  },
  "shipping_info": {
    "first_name": "string",
    "last_name": "string",
    "street": "string",
    "street2": "string",
    "state": "string",
    "city": "string",
    "zip": "string",
    "country": "string",
    "phone": "string"
  },
  "active": true,
  "note": "string",
  "id": 1
}
```

### cURL (sandbox)
```bash
curl -sS -w "\nHTTP_STATUS:%{http_code}\n" \
  -X POST "${GOAT_SANDBOX_BASE_URL}/api/v2/customers/create-from-transaction" \
  -u "${GOAT_SOURCE_KEY}:${GOAT_PIN}" \
  -H "Content-Type: application/json" \
  -d '{
    "reference_number": 123456,
    "customer_number": "theone-user-objectid",
    "email": "client@example.com"
  }'
```

### Mapping to THEONE
- Use after a successful charge when you have `gp_transaction_id` / GOAT `reference_number` and want a customer row plus future **payment-method-from-transaction** flows.
- Because GOAT **always creates a new customer**, avoid calling this repeatedly for the same transaction unless product intends multiple customer records; prefer Function 15 or **list + create** (Functions 14–15) for idempotent “ensure customer” patterns.
- Set `customer_number` to THEONE `User._id` string when overriding so Function 14 can find the record later.

---

## Function 17 - Get a Single Customer

### Endpoint
- Method: `GET`
- Path: `/customers/{id}`
- Full sandbox URL: `https://api.sandbox.goatpaymentsgateway.com/api/v2/customers/{id}`
- Full production URL: `https://api.goatpaymentsgateway.com/api/v2/customers/{id}`
- Auth: `BasicAuthentication`

### Purpose
Return one GOAT customer by numeric ID (e.g. after create or when reading cached `goat_customer_id` / invoice `customer_id`).

### Path parameter
- `id` (required, integer `>= 1`) – the GOAT customer ID.

### Response schema (200)
Content type: `application/json`

Single customer object:

- `id` (integer, `>= 1`) – customer ID.
- `identifier` (string, `<= 255`)
- `customer_number` (string, `<= 255`)
- `first_name`, `last_name` (string, `<= 255` each)
- `email` (string, email, `<= 255`)
- `website` (string, `<= 255`)
- `phone`, `alternate_phone` (string, `<= 50` each)
- `billing_info`, `shipping_info` (object, `Address`)
- `active` (boolean, default `true`)
- `note` (string, `<= 750`)

### Error responses
- `400` – request invalid or missing required fields.
- `401` – credentials missing or invalid.
- `404` – customer not found.

### Example response (200)
`GET` has no request body; the payload below is the response body.

```json
{
  "identifier": "string",
  "customer_number": "string",
  "first_name": "string",
  "last_name": "string",
  "email": "string",
  "website": "string",
  "phone": "string",
  "alternate_phone": "string",
  "billing_info": {
    "first_name": "string",
    "last_name": "string",
    "street": "string",
    "street2": "string",
    "state": "string",
    "city": "string",
    "zip": "string",
    "country": "string",
    "phone": "string"
  },
  "shipping_info": {
    "first_name": "string",
    "last_name": "string",
    "street": "string",
    "street2": "string",
    "state": "string",
    "city": "string",
    "zip": "string",
    "country": "string",
    "phone": "string"
  },
  "active": true,
  "note": "string",
  "id": 1
}
```

### cURL (sandbox)
```bash
curl -sS -w "\nHTTP_STATUS:%{http_code}\n" \
  -X GET "${GOAT_SANDBOX_BASE_URL}/api/v2/customers/1" \
  -u "${GOAT_SOURCE_KEY}:${GOAT_PIN}" \
  -H "Accept: application/json"
```

### Mapping to THEONE
- Use to verify or refresh customer metadata after storing GOAT `id` on a user or payment record.
- For lookup by THEONE user id without a known GOAT `id`, prefer Function 14 (`GET /customers?customer_number=...`).

---

## Function 18 - Update a Customer

### Endpoint
- Method: `PATCH`
- Path: `/customers/{id}`
- Full sandbox URL: `https://api.sandbox.goatpaymentsgateway.com/api/v2/customers/{id}`
- Full production URL: `https://api.goatpaymentsgateway.com/api/v2/customers/{id}`
- Auth: `BasicAuthentication`

### Purpose
Update fields on an existing GOAT customer (e.g. sync `email`, name, or `customer_number` after THEONE profile changes).

### Path parameter
- `id` (required, integer `>= 1`) – the GOAT customer ID.

### Request body (application/json)
All fields optional for PATCH semantics (send only fields to change):

- `identifier` (string, `<= 255`)
- `customer_number` (string, `<= 255`)
- `first_name`, `last_name` (string, `<= 255` each)
- `email` (string, valid email, `<= 255`)
- `website` (string, `<= 255`)
- `phone`, `alternate_phone` (string, `<= 50` each)
- `billing_info`, `shipping_info` (object, `Address`)
- `active` (boolean, default `true`)
- `note` (string, `<= 750`)

### Response schema (200)
Content type: `application/json`

Full customer object after update (same shape as Function 17), including `id`.

### Error responses
- `400` – request invalid or missing required fields.
- `401` – credentials missing or invalid.
- `404` – customer not found.

### Request example
```json
{
  "identifier": "string",
  "customer_number": "string",
  "first_name": "string",
  "last_name": "string",
  "email": "string",
  "website": "string",
  "phone": "string",
  "alternate_phone": "string",
  "billing_info": {
    "first_name": "string",
    "last_name": "string",
    "street": "string",
    "street2": "string",
    "state": "string",
    "city": "string",
    "zip": "string",
    "country": "string",
    "phone": "string"
  },
  "shipping_info": {
    "first_name": "string",
    "last_name": "string",
    "street": "string",
    "street2": "string",
    "state": "string",
    "city": "string",
    "zip": "string",
    "country": "string",
    "phone": "string"
  },
  "active": true,
  "note": "string"
}
```

### Response example (200)
```json
{
  "identifier": "string",
  "customer_number": "string",
  "first_name": "string",
  "last_name": "string",
  "email": "string",
  "website": "string",
  "phone": "string",
  "alternate_phone": "string",
  "billing_info": {
    "first_name": "string",
    "last_name": "string",
    "street": "string",
    "street2": "string",
    "state": "string",
    "city": "string",
    "zip": "string",
    "country": "string",
    "phone": "string"
  },
  "shipping_info": {
    "first_name": "string",
    "last_name": "string",
    "street": "string",
    "street2": "string",
    "state": "string",
    "city": "string",
    "zip": "string",
    "country": "string",
    "phone": "string"
  },
  "active": true,
  "note": "string",
  "id": 1
}
```

### cURL (sandbox)
```bash
curl -sS -w "\nHTTP_STATUS:%{http_code}\n" \
  -X PATCH "${GOAT_SANDBOX_BASE_URL}/api/v2/customers/1" \
  -u "${GOAT_SOURCE_KEY}:${GOAT_PIN}" \
  -H "Content-Type: application/json" \
  -d '{"email": "updated@example.com", "first_name": "Jane"}'
```

### Mapping to THEONE
- Call when THEONE user profile fields change and GOAT should reflect the same `email`, display name, or `customer_number` (THEONE `User._id` string).
- Prefer partial bodies (only changed keys) to avoid unintentionally clearing fields if the API treats omitted nested objects in a destructive way—confirm merge behavior with GOAT if you use `billing_info` / `shipping_info` patches.

---

## Function 19 - Delete a Customer

### Endpoint
- Method: `DELETE`
- Path: `/customers/{id}`
- Full sandbox URL: `https://api.sandbox.goatpaymentsgateway.com/api/v2/customers/{id}`
- Full production URL: `https://api.goatpaymentsgateway.com/api/v2/customers/{id}`
- Auth: `BasicAuthentication`

### Purpose
Remove a GOAT customer record by ID. Use sparingly in THEONE (e.g. account erasure flows); most integrations keep customers and set `active: false` via Function 18 instead.

### Path parameter
- `id` (required, integer `>= 1`) – the GOAT customer ID.

### Responses
- `204` – customer deleted successfully (typically no response body).
- `400` – request invalid or missing required fields.
- `401` – credentials missing or invalid.
- `404` – customer not found.
- `409` – customer is linked to **active recurring schedules**; resolve or cancel those before retrying delete.

### cURL (sandbox)
```bash
curl -sS -w "\nHTTP_STATUS:%{http_code}\n" \
  -X DELETE "${GOAT_SANDBOX_BASE_URL}/api/v2/customers/1" \
  -u "${GOAT_SOURCE_KEY}:${GOAT_PIN}"
```

### Mapping to THEONE
- If THEONE caches `goat_customer_id` on `User`, clear it after a successful `204` so the next charge path can recreate or relink per product rules.
- Handle `409` by surfacing a clear error (user must cancel or complete recurring obligations in GOAT first).

---

## Function 20 - Get Payment Methods for a Customer

### Endpoint
- Method: `GET`
- Path: `/customers/{id}/payment-methods`
- Full sandbox URL: `https://api.sandbox.goatpaymentsgateway.com/api/v2/customers/{id}/payment-methods`
- Full production URL: `https://api.goatpaymentsgateway.com/api/v2/customers/{id}/payment-methods`
- Auth: `BasicAuthentication`

### Purpose
Return all **payment methods** vaulted for a GOAT customer. GOAT models this as an array whose items may be one of several shapes (e.g. **credit card**, **check**, **DAF card**). Below documents the **card** variant; extend parsing when you encounter other `payment_method_type` values.

### Path parameter
- `id` (required, integer `>= 1`) – the GOAT customer ID (`customer_id`).

### Response schema (200)
Content type: `application/json`

**Array** of payment method objects.

**Credit card payment method** (representative fields):
- `id` (integer, `>= 1`) – payment method ID (usable as `pm-…` **source** on `POST /transactions/charge` per Function 4; confirm prefix with GOAT).
- `customer_id` (integer, `>= 1`)
- `created_at` (string, date-time)
- `avs_address` (string, `<= 255`) – billing street/address on file.
- `avs_zip` (string, `<= 50`) – billing ZIP; recommended for fraud prevention and e-commerce rates.
- `name` (string, `<= 255`) – name on the account.
- `expiry_month` (integer, `1..12`)
- `expiry_year` (integer, `2020..9999`)
- `payment_method_type` (string) – e.g. `"card"`.
- `card_type` (string, enum) – e.g. `Visa`, `MasterCard`, `Amex`, `Discover`, `JCB`, `Diners`.
- `bin` (string, 6 characters) – first six digits of the PAN.
- `bin_details` (object) – issuer/metadata; shape depends on GOAT (may include fields such as `type`).
- `last4` (string, 4 characters) – last four digits of the card number.

### Error responses
- `400` – request invalid or missing required fields.
- `401` – credentials missing or invalid.
- `404` – customer not found.

### Example response (200)
`GET` has no request body. Sample shows one **card** entry; `bin_details` varies by BIN.

```json
[
  {
    "id": 1,
    "customer_id": 1,
    "created_at": "2019-08-24T14:15:22Z",
    "avs_address": "string",
    "avs_zip": "string",
    "name": "string",
    "expiry_month": 1,
    "expiry_year": 2020,
    "payment_method_type": "card",
    "card_type": "Visa",
    "bin": "411111",
    "bin_details": {
      "type": "C"
    },
    "last4": "1111"
  }
]
```

### cURL (sandbox)
```bash
curl -sS -w "\nHTTP_STATUS:%{http_code}\n" \
  -X GET "${GOAT_SANDBOX_BASE_URL}/api/v2/customers/1/payment-methods" \
  -u "${GOAT_SOURCE_KEY}:${GOAT_PIN}" \
  -H "Accept: application/json"
```

### Mapping to THEONE
- After resolving `goat_customer_id`, this endpoint can **reconcile** gateway-saved methods with `user.saved_payment_methods` (last4, brand, expiry)—note THEONE may still store **token** charges as `tkn-` + `cardRef` while GOAT also exposes **`pm-`** IDs for the same customer.
- Do not persist full PAN; `bin` + `last4` are sufficient for display and support.

---

## Function 21 - Create a Payment Method (`POST /customers/{id}/payment-methods`)

Vaulted payment method on an existing GOAT customer. Full path under API root: `/api/v2/customers/{id}/payment-methods`.

### Endpoint
- Method: `POST`
- Path: `/customers/{id}/payment-methods` (i.e. `POST /api/v2/customers/{id}/payment-methods` when combined with `{GOAT_*_BASE_URL}/api/v2`)
- Full sandbox URL: `https://api.sandbox.goatpaymentsgateway.com/api/v2/customers/{id}/payment-methods`
- Full production URL: `https://api.goatpaymentsgateway.com/api/v2/customers/{id}/payment-methods`
- Auth: `BasicAuthentication`

### Purpose
Create a **vaulted payment method** on a GOAT customer. GOAT accepts multiple **request body variants** (e.g. credit card, check, DAF card, **create from source**). This section documents the **credit card** variant; see official schema for ACH/check/DAF/from-source payloads.

### Path parameter
- `id` (required, integer `>= 1`) – the GOAT customer ID.

### Request body (application/json) – Create credit card payment method
Content type: `application/json` (required; `415` if wrong).

**Required**
- `card` (string, `14..16` characters, `^\d+$`) – card number (PAN).
- `expiry_month` (integer, `1..12`)
- `expiry_year` (integer, `2020..9999`)

**Optional**
- `avs_address` (string, `<= 255`) – billing address for the card.
- `avs_zip` (string, `<= 50`) – billing ZIP; recommended for fraud prevention and e-commerce rates.
- `name` (string, `<= 255`) – name on the account.

### Response schema (201)
Content type: `application/json`

**Credit card payment method** (same family as Function 20 list items):
- `id` (integer, `>= 1`) – payment method ID (candidate for `source: "pm-" + id` on Function 4; confirm formatting with GOAT).
- `customer_id` (integer, `>= 1`)
- `created_at` (string, date-time)
- `avs_address`, `avs_zip`, `name`
- `expiry_month` (`1..12`), `expiry_year` (`2020..9999`)
- `payment_method_type` (string) – e.g. `"card"`.
- `card_type` (string, enum) – `Visa`, `MasterCard`, `Amex`, `Discover`, `JCB`, `Diners`.
- `bin` (string, 6 characters)
- `bin_details` (object)
- `last4` (string, 4 characters)

### Error responses
- `400` – request invalid or missing required fields.
- `401` – credentials missing or invalid.
- `404` – customer not found.
- `409` – a payment method with these details **already exists** for this customer.
- `415` – `Content-Type` must be `application/json`.

### Request example (credit card)
Do **not** send `id`, `customer_id`, `bin`, or `last4` in the request; GOAT derives those on create.

```json
{
  "card": "4111111111111111",
  "expiry_month": 12,
  "expiry_year": 2030,
  "avs_address": "123 Main St",
  "avs_zip": "90210",
  "name": "Jane Doe"
}
```

### Response example (201)
```json
{
  "id": 1,
  "customer_id": 1,
  "created_at": "2019-08-24T14:15:22Z",
  "avs_address": "123 Main St",
  "avs_zip": "90210",
  "name": "Jane Doe",
  "expiry_month": 12,
  "expiry_year": 2030,
  "payment_method_type": "card",
  "card_type": "Visa",
  "bin": "411111",
  "bin_details": {
    "type": "C"
  },
  "last4": "1111"
}
```

### cURL (sandbox)
```bash
curl -sS -w "\nHTTP_STATUS:%{http_code}\n" \
  -X POST "${GOAT_SANDBOX_BASE_URL}/api/v2/customers/1/payment-methods" \
  -u "${GOAT_SOURCE_KEY}:${GOAT_PIN}" \
  -H "Content-Type: application/json" \
  -d '{
    "card": "4111111111111111",
    "expiry_month": 12,
    "expiry_year": 2030,
    "name": "Sandbox Test"
  }'
```

### Mapping to THEONE
- **PCI**: only call from trusted server code; never from mobile with raw PAN unless using a GOAT-hosted flow that keeps PAN off your servers.
- THEONE’s primary card-on-file path today uses **`POST /saved-cards`** + `tkn-` charges (Functions 1 and 4). Use this endpoint when you need a **customer-scoped payment method** (`pm-`) for the same GOAT `customer_id` you send on charges.
- On `409`, treat as idempotent “already vaulted” and optionally **list** payment methods (Function 20) to find the existing `id`.

---

## Function 22 - Get Recurring Schedules for a Customer (`GET /customers/{id}/recurring-schedules`)

Full path under API root: `/api/v2/customers/{id}/recurring-schedules`.

### Endpoint
- Method: `GET`
- Path: `/customers/{id}/recurring-schedules`
- Full sandbox URL: `https://api.sandbox.goatpaymentsgateway.com/api/v2/customers/{id}/recurring-schedules`
- Full production URL: `https://api.goatpaymentsgateway.com/api/v2/customers/{id}/recurring-schedules`
- Auth: `BasicAuthentication`

### Purpose
Return all **recurring billing schedules** attached to a GOAT customer (amount, frequency, next run, status, linked payment method). Use for admin/support, and to understand why **DELETE customer** may return `409` (Function 19: active recurring schedules).

### Path parameter
- `id` (required, integer `>= 1`) – the GOAT customer ID.

### Response schema (200)
Content type: `application/json`

**Array** of schedule objects:

- `title` (string, `<= 255`)
- `frequency` (string, default `"monthly"`) – enum: `daily`, `weekly`, `biweekly`, `monthly`, `bimonthly`, `quarterly`, `biannually`, `annually`
- `amount` (number, `0.01..20000000`) – amount to bill; actual capture may differ if ISO/MSP **surcharge** rules apply.
- `next_run_date` (string, date) – next date in **EST** the schedule runs; must be after today; default described by GOAT as **tomorrow in EST** when creating schedules.
- `num_left` (integer, `>= 0`, default `0`) – billings remaining; **`0` = ongoing** (no fixed count).
- `payment_method_id` (integer, `>= 1`) – GOAT payment method id (see Functions 20–21).
- `active` (boolean, default `true`)
- `receipt_email` (string, email, `<= 255`) – receipt destination each run.
- `status` (string) – enum:
  - `active` – schedule will run on `next_run_date`.
  - `declined` – last run was **declined**; may retry next day if retries remain.
  - `error` – last run **errored**; may retry next day if retries remain.
  - `finished` – completed the configured number of runs.
  - `failed` – exhausted retries; will not retry until the next **frequency** boundary (e.g. next month).
- `prev_run_date` (string, date) – previous run date (**UTC**).
- `transaction_count` (integer, `>= 0`) – number of transactions processed by this schedule.
- `id` (integer, `>= 1`) – schedule ID.
- `customer_id` (integer, `>= 1`)
- `created_at` (string, date-time)

### Error responses
- `400` – request invalid or missing required fields.
- `401` – credentials missing or invalid.
- `404` – customer not found.

### Example response (200)
`GET` has no request body.

```json
[
  {
    "title": "string",
    "frequency": "daily",
    "amount": 0.01,
    "next_run_date": "2019-08-24",
    "num_left": 0,
    "payment_method_id": 1,
    "active": true,
    "receipt_email": "string",
    "status": "active",
    "prev_run_date": "2019-08-24",
    "transaction_count": 0,
    "id": 1,
    "customer_id": 1,
    "created_at": "2019-08-24T14:15:22Z"
  }
]
```

### cURL (sandbox)
```bash
curl -sS -w "\nHTTP_STATUS:%{http_code}\n" \
  -X GET "${GOAT_SANDBOX_BASE_URL}/api/v2/customers/1/recurring-schedules" \
  -u "${GOAT_SOURCE_KEY}:${GOAT_PIN}" \
  -H "Accept: application/json"
```

### Mapping to THEONE
- Correlate `customer_id` with cached THEONE `goat_customer_id` when debugging subscription/membership flows.
- Before deleting a customer (Function 19), list schedules here and cancel or finish them to avoid `409`.

---

## Function 23 - Create a Recurring Schedule (`POST /customers/{id}/recurring-schedules`)

Full path under API root: `/api/v2/customers/{id}/recurring-schedules`.

### Endpoint
- Method: `POST`
- Path: `/customers/{id}/recurring-schedules`
- Full sandbox URL: `https://api.sandbox.goatpaymentsgateway.com/api/v2/customers/{id}/recurring-schedules`
- Full production URL: `https://api.goatpaymentsgateway.com/api/v2/customers/{id}/recurring-schedules`
- Auth: `BasicAuthentication`

### Purpose
Create a **recurring billing schedule** for a GOAT customer, using an existing **payment method** (`payment_method_id` from Functions 20–21).

### Path parameter
- `id` (required, integer `>= 1`) – the GOAT customer ID.

### Request body (application/json)
Content type: `application/json` (required; `415` if wrong).

**Required**
- `title` (string, `<= 255`)
- `amount` (number, `0.01..20000000`) – amount to bill; actual capture may differ under mandatory ISO/MSP **surcharge** rules.
- `payment_method_id` (integer, `>= 1`)

**Optional**
- `frequency` (string, default `"monthly"`) – enum: `daily`, `weekly`, `biweekly`, `monthly`, `bimonthly`, `quarterly`, `biannually`, `annually`
- `next_run_date` (string, date) – next run in **EST**; must be **after today**; GOAT default described as **tomorrow in EST** when omitted.
- `num_left` (integer, `>= 0`, default `0`) – billings remaining; **`0` = ongoing**.
- `active` (boolean, default `true`)
- `receipt_email` (string, email, `<= 255`) – receipt each run.
- `use_this_source_key` (boolean, default `false`) – by default recurring runs use the **Recurring** source key; set `true` to use the **same source key** as this request’s Basic auth credentials.

### Response schema (201)
Content type: `application/json`

Returns the created schedule, including server-assigned fields:

- All submitted fields above (except `use_this_source_key` is typically not echoed—confirm in your environment).
- `status` (string) – enum `active` | `declined` | `error` | `finished` | `failed` (meanings same as Function 22).
- `prev_run_date` (string, date, optional until first run) – previous run (**UTC**).
- `transaction_count` (integer, `>= 0`)
- `id` (integer, `>= 1`) – schedule ID.
- `customer_id` (integer, `>= 1`)
- `created_at` (string, date-time)

### Error responses
- `400` – request invalid or missing required fields.
- `401` – credentials missing or invalid.
- `404` – customer not found.
- `415` – `Content-Type` must be `application/json`.

### Request example
```json
{
  "title": "string",
  "frequency": "daily",
  "amount": 0.01,
  "next_run_date": "2019-08-24",
  "num_left": 0,
  "payment_method_id": 1,
  "active": true,
  "receipt_email": "string",
  "use_this_source_key": false
}
```

### Response example (201)
```json
{
  "title": "string",
  "frequency": "daily",
  "amount": 0.01,
  "next_run_date": "2019-08-24",
  "num_left": 0,
  "payment_method_id": 1,
  "active": true,
  "receipt_email": "string",
  "status": "active",
  "prev_run_date": "2019-08-24",
  "transaction_count": 0,
  "id": 1,
  "customer_id": 1,
  "created_at": "2019-08-24T14:15:22Z"
}
```

### cURL (sandbox)
```bash
curl -sS -w "\nHTTP_STATUS:%{http_code}\n" \
  -X POST "${GOAT_SANDBOX_BASE_URL}/api/v2/customers/1/recurring-schedules" \
  -u "${GOAT_SOURCE_KEY}:${GOAT_PIN}" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "THEONE membership",
    "amount": 99.00,
    "payment_method_id": 1,
    "frequency": "annually",
    "num_left": 0,
    "receipt_email": "member@example.com"
  }'
```

### Mapping to THEONE
- Requires a GOAT **customer** (Functions 14–17) and a vaulted **payment method** (Functions 20–21). Membership logic in THEONE should store the returned **`id`** if you need cancel/update flows (document those endpoints when added to this skill).
- Choose `use_this_source_key` deliberately: recurring vs standard key permissions differ in the GOAT dashboard.

---

## Function 24 - Get Transactions for a Customer (`GET /customers/{id}/transactions`)

Full path under API root: `/api/v2/customers/{id}/transactions`.

### Endpoint
- Method: `GET`
- Path: `/customers/{id}/transactions`
- Full sandbox URL: `https://api.sandbox.goatpaymentsgateway.com/api/v2/customers/{id}/transactions`
- Full production URL: `https://api.goatpaymentsgateway.com/api/v2/customers/{id}/transactions`
- Auth: `BasicAuthentication`

### Purpose
Return **transactions** scoped to one GOAT **customer** (`id`), with the same filtering and pagination style as global **`GET /transactions`** (Function 3). Each array element is a **credit card** or **check** transaction object; the shape aligns with Function 3’s transaction items.

### Path parameter
- `id` (required, integer `>= 1`) – the GOAT customer ID.

### Query parameters
- `order` (string, default `"asc"`, enum: `"asc"` | `"desc"`) – sort order.
- `status` (array of strings, or comma-separated) – filter by status(es):  
  `captured`, `pending`, `reserve`, `originated`, `returned`, `cancelled`, `queued`, `declined`, `error`, `settled`, `voided`, `approved`, `blocked`, `expired`.
- `payment_type` (array of strings, or comma-separated) – `credit_card`, `check`.
- `settled_date` (string, date) – settled date in **UTC**; **excludes** transactions settled **more than 30 days before** this date, regardless of `date_from`.
- `date_field` (string, default `"created_at"`, enum: `settled_at` | `created_at`) – which date field `date_from` / `date_to` apply to.
- `date_from` (integer or string) – earliest search instant, rounded **down** to start of day **UTC**.
- `date_to` (integer or string) – latest search instant, rounded **up** to end of day **UTC**.
- `limit` (integer, `1..100`, default `10`) – max results.
- `offset` (integer, `>= 0`, default `0`) – pagination offset.

### Response schema (200)
Content type: `application/json`

**Array** of transactions. Top-level fields per item (credit card variant shown in example; check transactions differ per GOAT schema):

- `id` (integer, `>= 1`) – transaction ID / reference number.
- `created_at` (string, date-time) – when the transaction was run.
- `settled_date` (string, date) – settlement date **UTC**.
- `amount_details` (object) – amounts, tax, surcharge, subtotal, etc. (see Function 3).
- `transaction_details` (object) – `description`, `order_number`, `key`, `source`, `type`, `reference_number`, `schedule_id`, etc.
- `customer` (object) – `identifier`, `email`, `fax`, `customer_id`.
- `status_details` (object) – `status`, `error_code`, `error_message`.
- `billing_info`, `shipping_info` (object, `Address`)
- `custom_fields` (object) – `custom1` … `custom20`.
- `card_details` (object) – card-present metadata when applicable (`last4`, `expiry_month`/`expiry_year`, `card_type`, AVS/CVV/CAVV results, `bin`, `bin_details`, etc.).

### Error responses
- `400` – request invalid or missing required fields.
- `401` – credentials missing or invalid.
- `404` – customer not found.

### Example response (200)
`GET` has no request body. Expanded sample (one credit card transaction); `last4` is four characters in live data.

```json
[
  {
    "id": 1,
    "created_at": "2019-08-24T14:15:22Z",
    "settled_date": "2019-08-24",
    "amount_details": {
      "amount": 0.01,
      "tax": 0,
      "tax_percent": 0,
      "surcharge": 0,
      "shipping": 0,
      "tip": 0,
      "discount": 0,
      "subtotal": 0,
      "original_requested_amount": 0.01,
      "original_authorized_amount": 0.01
    },
    "transaction_details": {
      "description": "string",
      "clerk": "string",
      "terminal": "string",
      "key": "string",
      "client_ip": "string",
      "signature": "string",
      "invoice_number": "string",
      "po_number": "string",
      "order_number": "string",
      "batch_id": 1,
      "source": "string",
      "terminal_name": "string",
      "terminal_id": "string",
      "username": "string",
      "type": "charge",
      "reference_number": 1,
      "schedule_id": 0
    },
    "customer": {
      "identifier": "string",
      "email": "string",
      "fax": "string",
      "customer_id": 1
    },
    "status_details": {
      "error_code": "string",
      "error_message": "string",
      "status": "captured"
    },
    "billing_info": {
      "first_name": "string",
      "last_name": "string",
      "street": "string",
      "street2": "string",
      "state": "string",
      "city": "string",
      "zip": "string",
      "country": "string",
      "phone": "string"
    },
    "shipping_info": {
      "first_name": "string",
      "last_name": "string",
      "street": "string",
      "street2": "string",
      "state": "string",
      "city": "string",
      "zip": "string",
      "country": "string",
      "phone": "string"
    },
    "custom_fields": {
      "custom1": "string",
      "custom2": "string",
      "custom3": "string",
      "custom4": "string",
      "custom5": "string",
      "custom6": "string",
      "custom7": "string",
      "custom8": "string",
      "custom9": "string",
      "custom10": "string",
      "custom11": "string",
      "custom12": "string",
      "custom13": "string",
      "custom14": "string",
      "custom15": "string",
      "custom16": "string",
      "custom17": "string",
      "custom18": "string",
      "custom19": "string",
      "custom20": "string"
    },
    "card_details": {
      "name": "string",
      "last4": "1111",
      "expiry_month": 1,
      "expiry_year": 2020,
      "card_type": "Visa",
      "avs_street": "string",
      "avs_zip": "string",
      "auth_code": "string",
      "bin": "411111",
      "bin_details": {
        "type": "C"
      },
      "avs_result": "string",
      "avs_result_code": "YYY",
      "cvv_result": "string",
      "cvv_result_code": "M",
      "cavv_result": "string",
      "cavv_result_code": "string"
    }
  }
]
```

### cURL (sandbox)
```bash
curl -sS -w "\nHTTP_STATUS:%{http_code}\n" \
  -G "${GOAT_SANDBOX_BASE_URL}/api/v2/customers/1/transactions" \
  -u "${GOAT_SOURCE_KEY}:${GOAT_PIN}" \
  -H "Accept: application/json" \
  --data-urlencode "order=desc" \
  --data-urlencode "limit=25" \
  --data-urlencode "offset=0" \
  --data-urlencode "status=captured,settled"
```

### Mapping to THEONE
- Use for **per-customer** history in admin/support UIs when you already know `goat_customer_id`; use Function 3 for **account-wide** reconciliation across customers.
- Match `transaction_details.key` / `order_number` / `custom_fields` to THEONE `Payment` / COE ids if you store them on charge (Function 4).

---

## Post-charge receipt (THEONE) vs GOAT invoices

After a **successful immediate charge** (`POST /transactions/charge` with `source`), money is captured. The customer needs a **receipt** (proof of payment), not a “please pay” invoice email.

| Channel | When to use |
|--------|-------------|
| **THEONE receipt + SES email** | Default: after charge completes, THEONE stores `Payment` and can email a receipt with links to `GET /v1/payments/:id/invoice` and `GET /v1/payments/:id/invoice.pdf` (authenticated). Implemented in `services/paymentReceiptEmail.js` + `SEND_PAYMENT_RECEIPT_EMAIL`. |
| **GOAT `POST /invoices/{id}/send`** | Documented for sending an existing **unpaid** invoice before payment. Do **not** rely on this alone as the primary post-charge receipt; GOAT rules emphasize pre-pay / `request-final` flows. |

**GOAT-native invoice creation (`POST /invoices` or equivalent)** is **not** documented in this skill. Confirm request/response and post-paid semantics with official GOAT API docs before storing `goat_invoice_id` / `payment_link` on `Payment` and extending `goatClient`. Until then, THEONE-generated invoices/receipts remain the source of truth for customer-facing documents after a charge.

---

## Optional: GOAT `payment_link` on Payment (phase 2)

If the product requires a GOAT-hosted invoice URL:

1. Obtain official GOAT documentation for **invoice creation** (e.g. `POST /api/v2/invoices`).
2. Extend `services/goatClient.js` with validated helpers; add optional fields on `models/Payment.js` such as `goat_invoice_id`, `goat_payment_link`.
3. Keep **SES receipt email** as the primary post-charge notification unless GOAT confirms `send` applies to your paid-invoice scenario.

---

## Implementation readiness (summary)

| Area | Status |
|------|--------|
| Auth (Basic) | Documented |
| Tokenize card (`/saved-cards`) | Documented |
| Card charge (`/transactions/charge`) | Documented |
| **Source charge (`source` + `tkn-` / `ref-` / `pm-` / `nonce-`)** | Documented (Function 4) |
| List transactions (`GET /transactions`) | Documented |
| Refund (`POST /transactions/refund`) | Documented |
| Void (`POST /transactions/void`) | Documented (Function 25) |
| Reversal (`POST /transactions/reversal`) | Documented (Function 26) |
| Webhook CRUD (`/webhooks`) | Documented |
| Get single invoice (`GET /invoices/{id}`) | Documented |
| Cancel existing invoice (`POST /invoices/{id}/cancel`) | Documented |
| Reactivate canceled invoice (`POST /invoices/{id}/reactivate`) | Documented |
| Request final payment (`POST /invoices/{id}/request-final`) | Documented |
| Delete invoice (`DELETE /invoices/{id}`) | Documented |
| Update invoice (`PATCH /invoices/{id}`) | Documented |
| Send existing invoice (`POST /invoices/{id}/send`) | Documented |
| List customers (`GET /customers`) | Documented |
| Create customer (`POST /customers`) | Documented |
| Create customer from transaction (`POST /customers/create-from-transaction`) | Documented |
| Get single customer (`GET /customers/{id}`) | Documented |
| Update customer (`PATCH /customers/{id}`) | Documented |
| Delete customer (`DELETE /customers/{id}`) | Documented |
| List customer payment methods (`GET /customers/{id}/payment-methods`) | Documented |
| Create customer payment method (`POST /customers/{id}/payment-methods`) | Documented |
| List customer recurring schedules (`GET /customers/{id}/recurring-schedules`) | Documented |
| Create customer recurring schedule (`POST /customers/{id}/recurring-schedules`) | Documented |
| List customer transactions (`GET /customers/{id}/transactions`) | Documented |
| **Inbound webhook HTTP payload + signature verification** | Still need GOAT docs or captured sample requests |

You can implement charges, token charges, refunds, voids, reversals, reconciliation, and webhook registration. **Async payment status** parity with Global Payments still needs the inbound webhook contract above, or polling `GET /transactions` until webhooks are wired.

Void/reversal are **documented only** until `goatClient` + payment service + mobile admin UI are wired. When implementing, reuse `getGoatApiRoot()` so THEONE stage → GOAT sandbox and THEONE prod → GOAT production.
