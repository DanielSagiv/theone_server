# Admin cash payments

**Status**: Implemented  
**Last updated**: July 2026  
**Gateway**: None — cash is recorded in THEONE only (no GOAT). Card flows unchanged.

## Purpose

Allow **admins** to record cash received for:

1. **COE lifecycle** (pay on behalf) — deposit, full, balance, revision diffs — same `payment_status` / `total_paid` accounting as card.
2. **On-spot (adhoc)** extras — arbitrary amount + description; does **not** change COE deposit/full status.

Cash payments are stored on the `Payment` document with `payment_channel: 'cash'` for future finance/ERP sync.

## API (admin only)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/v1/payments/admin/coe/:coeId/record-cash` | Record COE lifecycle cash (pay on behalf) |
| POST | `/v1/coes/:coeId/admin/adhoc-payment` | On-spot charge with `charge_method: 'cash'` |
| POST | `/v1/payments/admin/adhoc` | Same as above (alias) |

### COE record-cash body

```json
{
  "paymentType": "deposit",
  "cash_note": "Drawer A — receipt #42"
}
```

`paymentType`: `deposit` | `full_payment` | `final_payment` | `deposit_diff` | `full_diff`

### Adhoc cash body

```json
{
  "coe_id": "...",
  "amount": 150,
  "description": "Bottle service",
  "charge_method": "cash",
  "payer_user_id": "...",
  "adhoc_payer": { "type": "client", "display_name": "Jane Client" },
  "adhoc_note": "Optional note"
}
```

## Data model (`Payment`)

| Field | Cash value |
|-------|------------|
| `payment_channel` | `'cash'` (default for legacy rows: `'card'`) |
| `recorded_by_admin_id` | Admin who recorded payment |
| `created_by_admin_id` | Also set (adhoc backward compat) |
| `cash_note` | Optional admin note |
| `finance_sync_status` | `'pending'` (default) — for future ERP |
| `finance_external_id` | `null` until synced |
| `gp_transaction_id` | **Not set** |

## Invoices and receipts

Uses existing `getInvoiceData` + `generateInvoicePDF` + receipt email. Payment method line shows **Cash** or **Paid by {name} in cash** (adhoc).

## Refunds

`POST /v1/payments/:paymentId/refund` **rejects** cash payments. Reverse manually in ops/finance.

## Guards

- **First COE dual subscription** (`first_coe_deduction` + subscription charge): COE cash record returns 400 — subscription must be collected by card.
- **Client self-pay**: no cash UI; card only.

## Mobile

| Entry | Screen |
|-------|--------|
| Pay on behalf | COE admin detail → Pay on behalf drawer → **Cash** toggle |
| On-spot | COE menu → On-spot payment → **Cash** payment method |

## Non-goals (this release)

- Company-wide cash/card revenue dashboard
- Automated cash refunds
- Client-facing cash pay
