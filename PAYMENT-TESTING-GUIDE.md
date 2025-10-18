# Payment System Testing Guide
## How to Test All Payment Features

**Date**: October 14, 2025  
**Server**: Running on port 3006  
**Status**: Ready for testing

---

## 🎯 Testing Overview

You can test the payment system in 3 ways:
1. **EJS Test Dashboard** (Easiest) - Visual interface
2. **cURL Commands** (Quick) - Command line testing
3. **Postman/Insomnia** (Professional) - API client

---

## 💳 Global Payments Test Cards

### Successful Payment Cards

**Visa** (Most Common):
- Card: `4263970000005262`
- CVV: `123`
- Expiry: Any future date (e.g., `12/25`)

**Mastercard**:
- Card: `5425230000004415`
- CVV: `123`
- Expiry: Any future date

**American Express**:
- Card: `374101000000608`
- CVV: `1234` (4 digits for Amex)
- Expiry: Any future date

**Discover**:
- Card: `6011000000000087`
- CVV: `123`
- Expiry: Any future date

### Declined/Failed Cards

**Insufficient Funds**:
- Card: `4000000000009995`
- Result: Payment fails with "Insufficient funds"

**Card Declined**:
- Card: `4000000000000002`
- Result: Payment fails with "Card declined"

**Invalid Card**:
- Card: `4000000000000127`
- Result: Payment fails with "Invalid card"

**Expired Card**:
- Card: `4000000000000069`
- Result: Payment fails with "Expired card"

### 3D Secure Test Cards

**3D Secure - Success**:
- Card: `4263970000005262`
- Will prompt for 3D Secure authentication

**3D Secure - Failure**:
- Card: `4000000000001091`
- 3D Secure authentication fails

### Reference

For more test cards, visit: [Global Payments Test Cards](https://developer.globalpay.com/resources/test-card-numbers)

---

## 📋 Testing Prerequisites

### 1. Server Running
```bash
npm start
# Server should be on http://localhost:3006
```

### 2. Authentication Token
You need a valid JWT token. Get it by logging in:

```bash
curl -X POST http://localhost:3006/v1/auth/signin \
  -H "Content-Type: application/json" \
  -d '{"email":"sagiv.daniel.p@gmail.com","password":"123456"}'
```

Save the token from response:
```json
{
  "success": true,
  "data": {
    "token": "eyJhbGci..." <-- Copy this
  }
}
```

**Set as variable**:
```bash
export TOKEN="eyJhbGci..."
```

### 3. Create a Test COE
You need a COE to test payments against. Use the EJS dashboard or API to create one.

**Save the COE ID**:
```bash
export COE_ID="67..."
```

---

## 🧪 Phase 1: Basic Payments Testing

### Test 1.1: Create Payment Intent (Deposit)

**What it tests**: Payment creation, Global Payments integration

**Command**:
```bash
curl -X POST http://localhost:3006/v1/payments/coe/$COE_ID/intent \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "paymentType": "deposit"
  }'
```

**Expected Response**:
```json
{
  "success": true,
  "data": {
    "payment_id": "67...",
    "gp_transaction_id": "TRN_...",
    "payment_url": "https://pay.globalpay.com/...",
    "amount": 2000,
    "currency": "USD",
    "status": "processing"
  },
  "message": "Payment intent created successfully"
}
```

**What to check**:
- ✅ Payment record created in database
- ✅ `payment_url` returned (this is where user enters card)
- ✅ Amount calculated correctly (20% of COE total)
- ✅ Status is 'processing'

**Save payment_id**:
```bash
export PAYMENT_ID="67..."
```

---

### Test 1.2: Get Payment Details

**Command**:
```bash
curl -X GET http://localhost:3006/v1/payments/$PAYMENT_ID \
  -H "Authorization: Bearer $TOKEN"
```

**Expected Response**:
```json
{
  "success": true,
  "data": {
    "_id": "67...",
    "amount": 2000,
    "status": "processing",
    "payment_type": "deposit",
    "user_id": {...},
    "coe_id": {...}
  }
}
```

---

### Test 1.3: Get Payment History for COE

**Command**:
```bash
curl -X GET http://localhost:3006/v1/payments/coe/$COE_ID \
  -H "Authorization: Bearer $TOKEN"
```

**Expected Response**:
```json
{
  "success": true,
  "data": [
    {
      "_id": "67...",
      "amount": 2000,
      "status": "processing",
      "payment_type": "deposit",
      "created_at": "2025-10-14T..."
    }
  ]
}
```

---

### Test 1.4: Simulate Payment Webhook

**What it tests**: Webhook handling, payment completion

**Command**:
```bash
curl -X POST http://localhost:3006/webhooks/global-payments \
  -H "Content-Type: application/json" \
  -H "x-gp-signature: test-signature" \
  -d '{
    "type": "PAYMENT_COMPLETED",
    "id": "TRN_test_123",
    "reference": "'$PAYMENT_ID'",
    "amount": 200000,
    "currency": "USD",
    "status": "COMPLETED",
    "payment_method": {
      "card": {
        "brand": "VISA",
        "last_four": "5262"
      }
    },
    "authorization_code": "AUTH123",
    "response_code": "00",
    "response_message": "Success"
  }'
```

**Expected Response**:
```json
{
  "received": true,
  "processed": true
}
```

**What to check**:
- ✅ Payment status updated to 'completed'
- ✅ COE payment_status updated to 'deposit_paid'
- ✅ Card info saved (brand, last 4)

---

### Test 1.5: Verify Payment Completion

**Command**:
```bash
curl -X GET http://localhost:3006/v1/payments/$PAYMENT_ID \
  -H "Authorization: Bearer $TOKEN"
```

**Expected**:
```json
{
  "success": true,
  "data": {
    "status": "completed",
    "card_brand": "VISA",
    "card_last_four": "5262",
    "completed_at": "2025-10-14T..."
  }
}
```

---

### Test 1.6: Process Refund (Admin)

**What it tests**: Refund processing

**Command**:
```bash
curl -X POST http://localhost:3006/v1/payments/$PAYMENT_ID/refund \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 100,
    "reason": "Testing partial refund"
  }'
```

**Expected Response**:
```json
{
  "success": true,
  "data": {
    "refund_id": "RFD_...",
    "amount": 100,
    "status": "completed"
  },
  "message": "Refund processed successfully"
}
```

**What to check**:
- ✅ Payment status → 'refunded'
- ✅ COE total_paid decreased
- ✅ COE refund_amount increased

---

## 🔐 Phase 2: Card Tokenization Testing

### Test 2.1: Save a Credit Card

**What it tests**: Card tokenization, secure storage

**Command**:
```bash
curl -X POST http://localhost:3006/v1/payments/tokenize \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "cardDetails": {
      "number": "4263970000005262",
      "expiry_month": "12",
      "expiry_year": "25",
      "cvv": "123",
      "nickname": "My Test Card"
    },
    "setAsDefault": true
  }'
```

**Expected Response**:
```json
{
  "success": true,
  "data": {
    "token_id": "PMT_...",
    "card_brand": "VISA",
    "card_last_four": "5262",
    "is_default": true
  },
  "message": "Payment method saved successfully"
}
```

**What to check**:
- ✅ Token saved to user.saved_payment_methods
- ✅ Only display data stored (no card number)
- ✅ Set as default
- ✅ Global Payments API called successfully

**Save token ID**:
```bash
export TOKEN_ID="PMT_..."
```

---

### Test 2.2: Get Saved Cards

**Command**:
```bash
curl -X GET http://localhost:3006/v1/payments/saved-cards \
  -H "Authorization: Bearer $TOKEN"
```

**Expected Response**:
```json
{
  "success": true,
  "data": {
    "saved_cards": [
      {
        "token_id": "PMT_...",
        "card_brand": "VISA",
        "card_last_four": "5262",
        "expiry_month": "12",
        "expiry_year": "25",
        "is_default": true,
        "nickname": "My Test Card",
        "created_at": "2025-10-14T...",
        "last_used_at": null
      }
    ],
    "default_payment_method": "PMT_..."
  }
}
```

---

### Test 2.3: Charge Saved Card (One-Click Payment!)

**What it tests**: Charging saved payment method

**Command**:
```bash
curl -X POST http://localhost:3006/v1/payments/saved-card/$TOKEN_ID/charge \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 100,
    "description": "Test one-click payment",
    "coeId": "'$COE_ID'"
  }'
```

**Expected Response**:
```json
{
  "success": true,
  "data": {
    "_id": "67...",
    "amount": 100,
    "status": "completed",
    "payment_token_id": "PMT_...",
    "is_token_payment": true,
    "card_brand": "VISA",
    "card_last_four": "5262",
    "completed_at": "2025-10-14T..."
  },
  "message": "Payment processed successfully"
}
```

**What to check**:
- ✅ Payment processed instantly (no redirect needed!)
- ✅ Saved card's last_used_at updated
- ✅ COE payment status updated
- ✅ is_token_payment = true

---

### Test 2.4: Save Second Card

**Command**:
```bash
curl -X POST http://localhost:3006/v1/payments/tokenize \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "cardDetails": {
      "number": "5425230000004415",
      "expiry_month": "06",
      "expiry_year": "26",
      "cvv": "456",
      "nickname": "My Second Card"
    },
    "setAsDefault": false
  }'
```

**Save second token**:
```bash
export TOKEN_ID_2="PMT_..."
```

---

### Test 2.5: Set Different Default Card

**Command**:
```bash
curl -X PUT http://localhost:3006/v1/payments/saved-cards/$TOKEN_ID_2/default \
  -H "Authorization: Bearer $TOKEN"
```

**Expected**:
```json
{
  "success": true,
  "message": "Default payment method updated"
}
```

**Verify**:
```bash
curl -X GET http://localhost:3006/v1/payments/saved-cards \
  -H "Authorization: Bearer $TOKEN"
# Should show TOKEN_ID_2 as default
```

---

### Test 2.6: Remove Saved Card

**Command**:
```bash
curl -X DELETE http://localhost:3006/v1/payments/saved-cards/$TOKEN_ID_2 \
  -H "Authorization: Bearer $TOKEN"
```

**Expected**:
```json
{
  "success": true,
  "message": "Payment method removed successfully"
}
```

---

## 🔄 Phase 3: Recurring Billing Testing

### Test 3.1: Get Membership Pricing (Public)

**No auth required**:
```bash
curl -X GET http://localhost:3006/v1/subscriptions/pricing
```

**Expected Response**:
```json
{
  "success": true,
  "data": {
    "pricing": {
      "basic": { "monthly": 49, "yearly": 490 },
      "premium": { "monthly": 99, "yearly": 990 },
      "vip": { "monthly": 199, "yearly": 1990 },
      "elite": { "monthly": 499, "yearly": 4999 }
    },
    "tiers": {
      "basic": {
        "name": "Basic",
        "benefits": [...]
      },
      ...
    }
  }
}
```

---

### Test 3.2: Create Subscription

**Prerequisites**: Must have a saved payment method first!

**Command**:
```bash
curl -X POST http://localhost:3006/v1/subscriptions \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "tier": "premium",
    "frequency": "monthly",
    "payment_token_id": "'$TOKEN_ID'"
  }'
```

**Expected Response**:
```json
{
  "success": true,
  "data": {
    "subscription": {
      "_id": "sub_123",
      "user_id": "68cf...",
      "tier": "premium",
      "frequency": "monthly",
      "amount": 99,
      "status": "active",
      "next_billing_date": "2025-11-14T...",
      "payment_token_id": "PMT_...",
      "total_payments": 1,
      "total_amount_paid": 99
    },
    "first_payment": {
      "_id": "pay_456",
      "amount": 99,
      "status": "completed",
      "payment_type": "subscription"
    }
  },
  "message": "Subscription created successfully"
}
```

**What to check**:
- ✅ Subscription created
- ✅ First payment processed immediately ($99)
- ✅ next_billing_date set to 1 month from now
- ✅ User membership_status → 'active'
- ✅ User membership_tier → 'premium'

**Save subscription ID**:
```bash
export SUB_ID="sub_123"
```

---

### Test 3.3: Get My Subscriptions

**Command**:
```bash
curl -X GET http://localhost:3006/v1/subscriptions/my \
  -H "Authorization: Bearer $TOKEN"
```

**Expected Response**:
```json
{
  "success": true,
  "data": [
    {
      "_id": "sub_123",
      "tier": "premium",
      "status": "active",
      "amount": 99,
      "frequency": "monthly",
      "next_billing_date": "2025-11-14T...",
      "total_payments": 1,
      "total_amount_paid": 99
    }
  ]
}
```

---

### Test 3.4: Get Subscription Details

**Command**:
```bash
curl -X GET http://localhost:3006/v1/subscriptions/$SUB_ID \
  -H "Authorization: Bearer $TOKEN"
```

**Expected**: Full subscription object with user populated

---

### Test 3.5: Test Automated Billing (Cron Job)

**Option A: Wait for Cron** (Not practical)
- Wait until midnight UTC
- Cron will process subscriptions due

**Option B: Manually Trigger** (Recommended)

1. **Update subscription next_billing_date to today**:
```bash
node -e "
require('dotenv').config();
const mongoose = require('mongoose');
const Subscription = require('./models/Subscription');

mongoose.connect(process.env.DB_URI).then(async () => {
  const sub = await Subscription.findById('$SUB_ID');
  sub.next_billing_date = new Date(); // Set to today
  await sub.save();
  console.log('Updated next_billing_date to today');
  process.exit(0);
});
"
```

2. **Manually trigger cron function**:
```bash
node -e "
require('dotenv').config();
const mongoose = require('mongoose');
const subscriptionService = require('./services/subscriptionService');

mongoose.connect(process.env.DB_URI).then(async () => {
  const payment = await subscriptionService.processSubscriptionPayment('$SUB_ID');
  console.log('Payment processed:', payment._id);
  console.log('Amount:', payment.amount);
  console.log('Status:', payment.status);
  process.exit(0);
});
"
```

**What to check**:
- ✅ Payment created and completed
- ✅ total_payments incremented
- ✅ total_amount_paid increased
- ✅ next_billing_date updated to next month
- ✅ User membership_expires_at updated

---

### Test 3.6: Update Subscription Payment Method

**Save another card first**:
```bash
curl -X POST http://localhost:3006/v1/payments/tokenize \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "cardDetails": {
      "number": "5425230000004415",
      "expiry_month": "12",
      "expiry_year": "26",
      "cvv": "123"
    }
  }'
# Save new TOKEN_ID_3
```

**Update subscription**:
```bash
curl -X PUT http://localhost:3006/v1/subscriptions/$SUB_ID/payment-method \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "payment_token_id": "'$TOKEN_ID_3'"
  }'
```

**Expected**:
```json
{
  "success": true,
  "data": {
    "_id": "sub_123",
    "payment_token_id": "PMT_new",
    "card_brand": "MASTERCARD",
    "card_last_four": "4415"
  },
  "message": "Payment method updated successfully"
}
```

---

### Test 3.7: Cancel Subscription

**Command**:
```bash
curl -X POST http://localhost:3006/v1/subscriptions/$SUB_ID/cancel \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "reason": "Testing cancellation"
  }'
```

**Expected Response**:
```json
{
  "success": true,
  "data": {
    "subscription": {
      "status": "cancelled",
      "cancelled_at": "2025-10-14T...",
      "end_date": "2025-11-14T..."
    },
    "access_until": "2025-11-14T...",
    "message": "Subscription cancelled. Access continues until end of current billing period."
  }
}
```

**What to check**:
- ✅ Subscription status → 'cancelled'
- ✅ end_date set to current_period_end
- ✅ User membership_status → 'cancelled'
- ✅ User keeps access until end_date

---

### Test 3.8: Test Failed Payment Handling

1. **Create subscription with invalid token** (or let real payment fail)

2. **Check subscription failure tracking**:
```bash
curl -X GET http://localhost:3006/v1/subscriptions/$SUB_ID \
  -H "Authorization: Bearer $TOKEN"
```

**Expected**:
```json
{
  "failed_payments": 1,
  "last_failure_date": "2025-10-14T...",
  "last_failure_reason": "Card declined"
}
```

3. **After 3 failures**:
- ✅ Subscription status → 'failed'
- ✅ User membership_status → 'suspended'

---

### Test 3.9: Get All Subscriptions (Admin)

**Command**:
```bash
curl -X GET "http://localhost:3006/v1/subscriptions?status=active&tier=premium" \
  -H "Authorization: Bearer $TOKEN"
```

**Expected**: Array of all subscriptions matching filters

---

## 🎨 Testing via EJS Dashboard

### Access Dashboard
1. Go to: `http://localhost:3006/test`
2. Enter password: `The0ne1976`
3. Login with your credentials

### Test Payment Flow
1. **Create COE** (if not exists)
   - Go to COE section
   - Create a test COE with events

2. **Pay Deposit**:
   - View COE
   - Click "Pay Deposit" (if available)
   - Or use API endpoints above

3. **Manage Saved Cards**:
   - Add a "Saved Cards" section to dashboard (future)
   - Or use API endpoints above

4. **Subscribe to Membership**:
   - Add a "Subscriptions" section to dashboard (future)
   - Or use API endpoints above

---

## 🧪 Complete Test Scenarios

### Scenario 1: Full COE Payment Flow

**Steps**:
1. Create COE ($10,000 total)
2. Pay deposit ($2,000) → COE status: 'deposit_paid'
3. Pay final balance ($8,000) → COE status: 'fully_paid' → 'accepted'
4. Verify payment history shows 2 payments
5. Process partial refund ($1,000)
6. Verify COE total_paid = $9,000

---

### Scenario 2: Save Card and Pay

**Steps**:
1. Tokenize credit card
2. Verify card appears in saved cards
3. Pay COE deposit with saved card (one-click!)
4. Verify payment processed without entering card again
5. Verify card's last_used_at updated

---

### Scenario 3: Subscription Lifecycle

**Steps**:
1. Save payment method
2. Create monthly subscription ($99)
3. Verify first payment processed
4. Simulate next billing (update next_billing_date)
5. Trigger cron job manually
6. Verify second payment processed
7. Verify next_billing_date updated again
8. Cancel subscription
9. Verify access continues until period ends
10. Wait for expiration (or trigger cron)
11. Verify subscription expired

---

### Scenario 4: Failed Payment Recovery

**Steps**:
1. Create subscription
2. Simulate payment failure (use declined card)
3. Verify failed_payments = 1
4. Wait 3 days (or manually trigger retry)
5. Retry fails again → failed_payments = 2
6. Update payment method to valid card
7. Retry succeeds
8. Verify failed_payments reset to 0
9. Verify subscription active

---

## 📊 Database Queries for Verification

### Check Payment Records
```bash
node -e "
require('dotenv').config();
const mongoose = require('mongoose');
const Payment = require('./models/Payment');

mongoose.connect(process.env.DB_URI).then(async () => {
  const payments = await Payment.find().sort({ created_at: -1 }).limit(5);
  payments.forEach(p => {
    console.log('Payment:', p._id);
    console.log('  Amount:', p.amount);
    console.log('  Status:', p.status);
    console.log('  Type:', p.payment_type);
    console.log('  Created:', p.created_at);
    console.log('---');
  });
  process.exit(0);
});
"
```

---

### Check User Payment Methods
```bash
node -e "
require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./models/User');

mongoose.connect(process.env.DB_URI).then(async () => {
  const user = await User.findOne({ email: 'sagiv.daniel.p@gmail.com' });
  console.log('Saved cards:', user.saved_payment_methods.length);
  user.saved_payment_methods.forEach(card => {
    console.log('Card:', card.card_brand, '****', card.card_last_four);
    console.log('  Default:', card.is_default);
    console.log('  Token:', card.token_id);
  });
  process.exit(0);
});
"
```

---

### Check Subscriptions
```bash
node -e "
require('dotenv').config();
const mongoose = require('mongoose');
const Subscription = require('./models/Subscription');

mongoose.connect(process.env.DB_URI).then(async () => {
  const subs = await Subscription.find().populate('user_id', 'email firstName lastName');
  console.log('Total subscriptions:', subs.length);
  subs.forEach(s => {
    console.log('Subscription:', s._id);
    console.log('  User:', s.user_id.email);
    console.log('  Tier:', s.tier);
    console.log('  Status:', s.status);
    console.log('  Amount:', s.amount);
    console.log('  Next billing:', s.next_billing_date);
    console.log('---');
  });
  process.exit(0);
});
"
```

---

## ⚠️ Important Testing Notes

### Global Payments API
Since we're using **conceptual API endpoints**, actual Global Payments calls may fail until you:

1. **Verify API endpoints** with GP documentation
2. **Update endpoint paths** if different
3. **Adjust request formats** as needed

### Workaround for Testing Without GP
You can test the flow by:
1. **Comment out GP API calls** temporarily
2. **Mock responses** in the code
3. **Test database logic** and business rules
4. **Add GP integration** once sandbox access confirmed

**Example Mock** (temporary):
```javascript
// In paymentService.js - createPaymentIntent()
// Comment out:
// const gpResponse = await gpClient.post('/transactions', gpRequest);

// Replace with mock:
const gpResponse = {
  data: {
    id: 'TRN_mock_' + Date.now(),
    payment_url: 'https://mock-payment-page.com',
    reference: payment._id.toString()
  }
};
```

---

## ✅ Test Results Checklist

### Phase 1: Basic Payments
- [ ] Payment intent created
- [ ] Payment record in database
- [ ] Webhook processed
- [ ] Payment status updated
- [ ] COE status updated
- [ ] Payment history retrieved
- [ ] Refund processed

### Phase 2: Card Tokenization
- [ ] Card tokenized and saved
- [ ] Saved cards retrieved
- [ ] Saved card charged (one-click)
- [ ] Card removed
- [ ] Default card changed
- [ ] Multiple cards managed

### Phase 3: Recurring Billing
- [ ] Pricing retrieved
- [ ] Subscription created
- [ ] First payment processed
- [ ] Subscription retrieved
- [ ] Automated billing tested
- [ ] Payment method updated
- [ ] Subscription cancelled
- [ ] Failed payment handled

---

## 🔍 Debugging Tips

### Payment Not Created?
- Check COE exists and status is 'sent' or 'approved'
- Verify user is the COE client
- Check amount calculation logic
- Review server logs

### Webhook Not Processing?
- Verify webhook signature (may need to disable in dev)
- Check payment_id in webhook reference matches database
- Review webhook logs

### Saved Card Not Working?
- Verify token saved to user.saved_payment_methods
- Check token_id is correct
- Verify user owns the token

### Subscription Not Created?
- Must have saved payment method first
- Check for existing active subscription
- Verify pricing configuration

### Cron Job Not Running?
- Check server logs for cron startup messages
- Verify next_billing_date is in the future
- Check subscription status is 'active'

---

## 🎯 Quick Test Script

Create a test script to run all tests:

**File**: `test-payments.sh`

```bash
#!/bin/bash

# Configuration
export BASE_URL="http://localhost:3006"
export EMAIL="sagiv.daniel.p@gmail.com"
export PASSWORD="123456"

echo "🧪 Starting Payment System Tests..."
echo ""

# 1. Login
echo "1️⃣ Logging in..."
LOGIN_RESPONSE=$(curl -s -X POST $BASE_URL/v1/auth/signin \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}")

export TOKEN=$(echo $LOGIN_RESPONSE | grep -o '"token":"[^"]*' | cut -d'"' -f4)

if [ -z "$TOKEN" ]; then
  echo "❌ Login failed"
  exit 1
fi
echo "✅ Login successful"
echo ""

# 2. Get Pricing
echo "2️⃣ Getting membership pricing..."
PRICING=$(curl -s -X GET $BASE_URL/v1/subscriptions/pricing)
echo "✅ Pricing retrieved"
echo ""

# 3. Tokenize Card
echo "3️⃣ Saving credit card..."
TOKENIZE=$(curl -s -X POST $BASE_URL/v1/payments/tokenize \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "cardDetails": {
      "number": "4263970000005262",
      "expiry_month": "12",
      "expiry_year": "25",
      "cvv": "123",
      "nickname": "Test Card"
    },
    "setAsDefault": true
  }')

export TOKEN_ID=$(echo $TOKENIZE | grep -o '"token_id":"[^"]*' | cut -d'"' -f4)

if [ -z "$TOKEN_ID" ]; then
  echo "❌ Card tokenization failed"
  echo $TOKENIZE
else
  echo "✅ Card saved: $TOKEN_ID"
fi
echo ""

# 4. Get Saved Cards
echo "4️⃣ Getting saved cards..."
CARDS=$(curl -s -X GET $BASE_URL/v1/payments/saved-cards \
  -H "Authorization: Bearer $TOKEN")
echo "✅ Saved cards retrieved"
echo ""

# 5. Create Subscription
echo "5️⃣ Creating subscription..."
SUB=$(curl -s -X POST $BASE_URL/v1/subscriptions \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"tier\": \"basic\",
    \"frequency\": \"monthly\",
    \"payment_token_id\": \"$TOKEN_ID\"
  }")

export SUB_ID=$(echo $SUB | grep -o '"_id":"[^"]*' | head -1 | cut -d'"' -f4)

if [ -z "$SUB_ID" ]; then
  echo "❌ Subscription creation failed"
  echo $SUB
else
  echo "✅ Subscription created: $SUB_ID"
fi
echo ""

# 6. Get My Subscriptions
echo "6️⃣ Getting my subscriptions..."
MY_SUBS=$(curl -s -X GET $BASE_URL/v1/subscriptions/my \
  -H "Authorization: Bearer $TOKEN")
echo "✅ Subscriptions retrieved"
echo ""

echo "🎉 All tests completed!"
echo ""
echo "Results:"
echo "  Token: ${TOKEN:0:20}..."
echo "  Card Token: $TOKEN_ID"
echo "  Subscription: $SUB_ID"
```

**Run it**:
```bash
chmod +x test-payments.sh
./test-payments.sh
```

---

## 📈 What to Monitor

### During Testing
- Server logs: `tail -f /tmp/server.log`
- Payment records in MongoDB
- User saved_payment_methods array
- Subscription records
- COE payment_status changes

### Success Indicators
- ✅ No errors in server logs
- ✅ HTTP 200/201 responses
- ✅ Database records created
- ✅ Status transitions correct
- ✅ Amounts calculated correctly

### Red Flags
- ❌ 500 errors (server errors)
- ❌ 400 errors (validation errors)
- ❌ Missing database records
- ❌ Incorrect amounts
- ❌ Status not updating

---

## 🎯 Next Steps After Testing

1. **If all tests pass**:
   - ✅ System is working!
   - Configure Global Payments webhook
   - Test with real GP sandbox
   - Deploy to staging

2. **If tests fail**:
   - Check error messages
   - Review server logs
   - Verify database records
   - Check Global Payments API docs

3. **When ready for production**:
   - Switch to GP production API
   - Update credentials
   - Test thoroughly
   - Monitor closely

---

## 🚀 Start Testing Now!

**Quickest way to start**:

1. Get your auth token:
```bash
export TOKEN=$(curl -s -X POST http://localhost:3006/v1/auth/signin \
  -H "Content-Type: application/json" \
  -d '{"email":"sagiv.daniel.p@gmail.com","password":"123456"}' \
  | grep -o '"token":"[^"]*' | cut -d'"' -f4)

echo "Token: $TOKEN"
```

2. Test pricing (no auth needed):
```bash
curl -s http://localhost:3006/v1/subscriptions/pricing | jq
```

3. Save a card:
```bash
curl -X POST http://localhost:3006/v1/payments/tokenize \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "cardDetails": {
      "number": "4263970000005262",
      "expiry_month": "12",
      "expiry_year": "25",
      "cvv": "123"
    }
  }' | jq
```

4. Get saved cards:
```bash
curl -s -X GET http://localhost:3006/v1/payments/saved-cards \
  -H "Authorization: Bearer $TOKEN" | jq
```

That's it! Start testing! 🎉

---

**Questions?** Check the phase summary docs for detailed implementation details!

