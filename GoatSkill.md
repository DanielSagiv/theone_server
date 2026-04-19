---
name: goat-payment-auth
description: Function-by-function GOAT payment integration reference for THEONE. Use when implementing GOAT auth, tokenization, charging, refunds, and webhook parity with the current payment system.
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
Use these env vars:
- `GOAT_SANDBOX_BASE_URL`
- `GOAT_SOURCE_KEY`
- `GOAT_PIN`

## API Base URLs

- Production transactions base: `https://api.goatpaymentsgateway.com/api/v2/transactions`
- Sandbox transactions base: `https://api.sandbox.goatpaymentsgateway.com/api/v2/transactions`

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
- Function 6: Webhooks and signature verification (`/webhooks`) - documented below.

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
- Use this endpoint only after the charge has settled; for immediate reversals pre-settlement, look for a separate **void** capability if GOAT provides it.

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

## Implementation readiness (summary)

| Area | Status |
|------|--------|
| Auth (Basic) | Documented |
| Tokenize card (`/saved-cards`) | Documented |
| Card charge (`/transactions/charge`) | Documented |
| **Source charge (`source` + `tkn-` / `ref-` / `pm-` / `nonce-`)** | Documented (Function 4) |
| List transactions (`GET /transactions`) | Documented |
| Refund (`POST /transactions/refund`) | Documented |
| Webhook CRUD (`/webhooks`) | Documented |
| **Inbound webhook HTTP payload + signature verification** | Still need GOAT docs or captured sample requests |

You can implement charges, token charges, refunds, reconciliation, and webhook registration. **Async payment status** parity with Global Payments still needs the inbound webhook contract above, or polling `GET /transactions` until webhooks are wired.
