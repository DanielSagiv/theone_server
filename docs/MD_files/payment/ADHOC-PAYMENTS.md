# Admin on-spot (adhoc) payments

**Status**: Implemented  
**Last updated**: June 2026  
**Gateway**: GOAT (see [GoatSkill.md](../../../GoatSkill.md))

## Purpose

Allow **admins** to charge a card immediately for COE-related extras without affecting the client deposit / full-payment lifecycle:

- Listed client card fails → try another COE-linked card or one-time PAN
- Unlisted card → tokenize + charge (optional save to payer wallet)
- Mid-event extras → optional `event_id` on the payment
- Guest payer → `adhoc_payer` snapshot (name, **email required**, phone) while `user_id` remains COE `client_id`
- **GOAT (guest):** transaction `name` = guest display name; `customer.email` = guest email when provided; `customer.customer_id` stays COE client; `customer.identifier` = `coe:<coeId>`; description includes COE name/id
- When `SEND_PAYMENT_RECEIPT_EMAIL=true`, after a successful adhoc charge THEONE emails the **on-spot payer** (`adhoc_payer.email` or participant/client email) with the **invoice PDF attached**; invoice **Bill To** uses the payer snapshot

## API (admin only)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/v1/coes/:coeId/admin/adhoc-payment-options?eventId=` | Payers, saved cards, events (mobile primary) |
| POST | `/v1/coes/:coeId/admin/adhoc-payment` | Execute charge (`Idempotency-Key` header optional) |
| GET | `/v1/payments/admin/coe/:coeId/payment-options?eventId=` | Same as above (alias) |
| POST | `/v1/payments/admin/adhoc` | Same as above (alias) |
| GET | `/v1/payments/coe/:coeId?payment_type=adhoc` | History (includes adhoc fields; guest phone masked for non-admin) |

### POST body

```json
{
  "coe_id": "...",
  "event_id": "...",
  "amount": 150,
  "description": "Bottle service",
  "charge_method": "saved_card",
  "payer_user_id": "...",
  "token_id": "..."
}
```

One-time card:

```json
{
  "charge_method": "one_time_card",
  "card": { "card": "4111111111111111", "expiry_month": 12, "expiry_year": 2030 },
  "save_to_payer": false,
  "adhoc_payer": { "type": "guest", "display_name": "Jane Guest", "email": "j@example.com" }
}
```

## Data model

- **Payment** `payment_type: 'adhoc'`, optional `event_id`, `created_by_admin_id`, `adhoc_payer`, `adhoc_note`
- API and invoices expose **`adhoc_payment_summary`**: `Paid by <name> with card ending with <last4>` (from `adhoc_payer.display_name` + `card_last_four`)
- **COE** `adhoc_collected_total` — sum of completed adhoc payments (reporting only)
- **`total_paid` / `payment_status`** — adhoc payments are **excluded** from `updateCOEPaymentStatus` aggregation

## Mobile

- Route: `/admin-adhoc-payment` (`coeId`, optional `eventId`, `eventTitle`)
- Entry: COE admin menu **On-spot payment**; event detail hero (admin only)
- Card entry: **Manual** or **Scan card** (`expo-camera` + `expo-text-extractor`; requires `pod install` + native rebuild or latest EAS build)

## Test dashboard

Payments & Subscriptions → **Admin On-spot** tab mirrors the API for sandbox validation.

## Refunds

Use existing `POST /v1/payments/:paymentId/refund` (admin) on completed adhoc payments.
