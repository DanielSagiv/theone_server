# Payment History and Invoices Feature
## The1 Platform - User Payment History & Invoice Generation

**Status**: 📋 Planning  
**Version**: 1.1  
**Last Updated**: December 2025  
**Primary Focus**: Mobile App Implementation

---

## Overview

This document outlines the implementation plan for allowing users to view their payment history and download invoices/receipts for their payments. **The primary focus of this implementation is the mobile app**, with the dashboard implementation serving as a reference/validation tool.

---

## Current State Analysis

### Existing Implementation

#### Backend
- ✅ **Payment Model** (`models/Payment.js`) - Stores all payment transactions
- ✅ **Payment Service** (`services/paymentService.js`) - Payment processing logic
- ✅ **Payment Routes** (`routes/payments.js`) - API endpoints
- ✅ **Global Payments Integration** - Payment processing via Global Payments API
- ✅ **COE-Specific Payment History** - `GET /v1/payments/coe/:coeId` endpoint
- ✅ **Payment Details** - `GET /v1/payments/:paymentId` endpoint

#### Dashboard (EJS) - Reference/Validation Only
- ✅ **Payment History Tab** - Available in dashboard.ejs (Payments & Subscriptions section)
- ✅ **COE-Specific Payment History** - `loadPaymentHistory()` function implemented
  - Takes COE ID as input via text field (`paymentHistoryCOEId`)
  - Calls `GET /v1/payments/coe/:coeId` endpoint
  - Displays payments in a data table with columns: Payment ID (truncated), Type, Amount, Status, Card (brand + last 4), Date
  - Status badges: completed (success/green), refunded (warning/yellow), failed (danger/red), others (info/blue)
  - Handles empty state and error cases
  - **Note**: This is for validation/testing only, not the primary user interface

#### Mobile App
- ⚠️ **Limited Payment History** - Basic payment info shown in `coe-detail.js` screen
  - Shows single payment information (Payment ID, Amount, Status, Date) inline in COE detail view
  - Loaded via COE detail endpoint, displays basic payment fields
  - Limited functionality - no dedicated payment history view
- ❌ **No Payment History Screen** - Dedicated payment history list screen missing
- ❌ **No Payment Detail Screen** - Dedicated payment detail view missing
- ❌ **No Invoice/Receipt View** - Invoice generation and viewing missing

### Third-Party Payment Processor

**Global Payments (GP)** is the payment processor used for:
- Payment processing and transactions
- Card tokenization and storage
- Transaction tracking via `gp_transaction_id`
- Payment status updates via webhooks

**Note**: Global Payments does not provide built-in invoice/receipt generation. We will need to generate invoices ourselves using the payment data stored in our database.

---

## Feature Requirements

### 1. User Payment History

Users should be able to:
- View all their payments across all COEs
- Filter payments by:
  - Status (completed, refunded, failed, etc.)
  - Payment type (full_payment, subscription, etc.)
  - Date range
  - COE (filter to specific COE)
- Sort payments by date, amount
- See payment details including:
  - Payment ID
  - COE name and reference
  - Amount and currency
  - Payment type
  - Status
  - Payment method (card brand, last 4 digits)
  - Payment date
  - Transaction ID (Global Payments reference)

### 2. Invoice/Receipt Generation

For each completed payment, users should be able to:
- View invoice/receipt details
- Download invoice as PDF
- Email invoice to themselves (future enhancement)
- See invoice information including:
  - Invoice number (payment ID or generated invoice number)
  - Invoice date
  - Bill-to information (user details)
  - COE details (name, description, events)
  - Payment breakdown (subtotal, taxes, fees, total)
  - Payment method
  - Transaction ID
  - Invoice status (Paid, Refunded, etc.)

### 3. COE Payment History

Users should be able to:
- View payment history for a specific COE
- See all payments related to that COE
- Download invoice for the COE (aggregated if multiple payments)

---

## Implementation Plan

### Phase 1: Backend API Endpoints

#### 1.1 User Payment History Endpoint

**Endpoint**: `GET /v1/payments/my`

**Description**: Get all payments for the authenticated user

**Query Parameters**:
- `status` (optional): Filter by payment status
- `payment_type` (optional): Filter by payment type
- `coe_id` (optional): Filter by COE ID
- `start_date` (optional): Filter by start date (ISO format)
- `end_date` (optional): Filter by end date (ISO format)
- `page` (optional): Page number for pagination (default: 1)
- `limit` (optional): Results per page (default: 20, max: 100)

**Response**:
```javascript
{
  success: true,
  data: {
    payments: [
      {
        _id: "payment_id",
        coe_id: "coe_id",
        coe_name: "COE Name", // Populated from COE
        amount: 1000.00,
        currency: "USD",
        payment_type: "full_payment",
        status: "completed",
        card_brand: "VISA",
        card_last_four: "5262",
        description: "COE Name - full payment",
        created_at: "2025-12-28T10:00:00Z",
        completed_at: "2025-12-28T10:01:00Z",
        gp_transaction_id: "GP_TXN_123456",
        refund_amount: 0,
        refunded_at: null
      }
    ],
    pagination: {
      total: 50,
      page: 1,
      limit: 20,
      total_pages: 3
    },
    summary: {
      total_payments: 50,
      total_amount: 50000.00,
      total_refunded: 1000.00,
      net_amount: 49000.00
    }
  }
}
```

**Authentication**: Required (authenticated users can only see their own payments)

**Implementation Location**: `routes/payments.js`

**Service Function**: `services/paymentService.js` → `getUserPaymentHistory(userId, filters, pagination)`

#### 1.2 Invoice Data Endpoint

**Endpoint**: `GET /v1/payments/:paymentId/invoice`

**Description**: Get invoice data for a specific payment (for invoice generation)

**Response**:
```javascript
{
  success: true,
  data: {
    invoice: {
      invoice_number: "INV-2025-001", // Generated or payment ID
      invoice_date: "2025-12-28T10:00:00Z",
      payment_date: "2025-12-28T10:01:00Z",
      status: "paid",
      
      // Bill To
      bill_to: {
        name: "John Doe",
        email: "john@example.com",
        // Additional fields if available in User model
      },
      
      // COE Details
      coe: {
        _id: "coe_id",
        name: "Premium Experience Package",
        description: "Complete experience package...",
        events: [
          {
            event_name: "Event Name",
            event_date: "2025-12-30",
            seats: [
              {
                seat_code: "A1",
                event_price: 500.00
              }
            ]
          }
        ]
      },
      
      // Payment Details
      payment: {
        _id: "payment_id",
        amount: 1000.00,
        currency: "USD",
        payment_type: "full_payment",
        payment_method: {
          brand: "VISA",
          last_four: "5262"
        },
        transaction_id: "GP_TXN_123456",
        completed_at: "2025-12-28T10:01:00Z"
      },
      
      // Pricing Breakdown
      pricing: {
        subtotal: 900.00,
        taxes: 50.00,
        fees: 50.00,
        total: 1000.00
      },
      
      // Refund Information (if applicable)
      refund: {
        refund_amount: 0,
        refunded_at: null,
        refund_reason: null
      }
    }
  }
}
```

**Authentication**: Required (users can only access their own invoices)

**Implementation Location**: `routes/payments.js`

**Service Function**: `services/paymentService.js` → `getInvoiceData(paymentId, userId)`

#### 1.3 Invoice PDF Generation Endpoint

**Endpoint**: `GET /v1/payments/:paymentId/invoice.pdf`

**Description**: Generate and download invoice as PDF

**Query Parameters**:
- `download` (optional): If true, forces download (default: inline view)

**Response**: PDF file (Content-Type: application/pdf)

**Authentication**: Required (users can only download their own invoices)

**Implementation Location**: `routes/payments.js`

**Service Function**: `services/invoiceService.js` → `generateInvoicePDF(invoiceData)`

**Dependencies**:
- PDF generation library (e.g., `pdfkit`, `puppeteer`, `jsPDF`)
- Invoice template (HTML/CSS or PDF template)

---

### Phase 2: Invoice Service

#### 2.1 Invoice Service File

**File**: `services/invoiceService.js` (NEW)

**Functions**:

1. **`getInvoiceData(paymentId, userId)`**
   - Fetch payment and COE data
   - Populate user information
   - Format invoice data structure
   - Validate user owns the payment

2. **`generateInvoiceHTML(invoiceData)`**
   - Generate HTML invoice template
   - Include branding/styling
   - Format invoice number, dates, amounts
   - Include COE details, payment method, etc.

3. **`generateInvoicePDF(invoiceData, options)`**
   - Convert HTML invoice to PDF
   - Handle page breaks, formatting
   - Return PDF buffer/stream
   - Options: download filename, orientation, etc.

4. **`generateInvoiceNumber(paymentId)`**
   - Generate human-readable invoice number
   - Format: `INV-YYYY-XXXXX` or use payment ID
   - Ensure uniqueness

---

### Phase 3: Mobile App Implementation (PRIMARY FOCUS)

**Note**: This is the primary implementation focus. Mobile app screens should be fully functional and provide the main user experience for payment history and invoices.

#### 3.1 Payment History Screen

**File**: `mobile/app/payment-history.js` (NEW)

**Features**:
- List of all user payments (fetched from `GET /v1/payments/my`)
- Pull-to-refresh functionality
- Filter options (status, payment type, date range)
- Search/filter by COE name
- Tap payment row to navigate to payment detail screen
- Summary statistics at top (total payments, total amount, net amount)
- Empty state when no payments found
- Loading state while fetching data
- Error state with retry option

**Navigation**: 
- Accessible from Profile screen (add menu item/button)
- Accessible from COE detail screen (link to payment history)
- Deep link: `/payment-history`
- Add to `mobile/app/_layout.js` Stack navigation

#### 3.2 Payment Detail Screen

**File**: `mobile/app/payment-detail.js` (NEW)

**Features**:
- Payment details view (fetched from `GET /v1/payments/:paymentId`)
- Payment information display:
  - Payment ID
  - Amount and currency
  - Payment type
  - Status (with color-coded badge)
  - Payment method (card brand + last 4)
  - Transaction ID (GP transaction ID)
  - Payment date (created_at, completed_at)
  - Refund information (if applicable)
- COE information section (with link to COE detail screen)
- Actions:
  - "View Invoice" button (navigates to invoice view)
  - "Download Invoice" button (future)
  - Share invoice option (future)

**Navigation**:
- From payment history list (tap on payment row)
- From COE detail screen (if payment exists)
- Deep link: `/payment-detail?paymentId=xxx`
- Add to `mobile/app/_layout.js` Stack navigation

#### 3.3 Invoice View Screen

**File**: `mobile/app/invoice-view.js` (NEW)

**Features**:
- Display invoice (fetched from `GET /v1/payments/:paymentId/invoice`)
- Invoice information display:
  - Invoice number
  - Invoice date and payment date
  - Bill-to information (user details)
  - COE details (name, description, events)
  - Payment breakdown (subtotal, taxes, fees, total)
  - Payment method
  - Transaction ID
- Actions:
  - Download invoice as PDF (opens PDF from `GET /v1/payments/:paymentId/invoice.pdf`)
  - Share invoice (native share dialog - future)
  - Print invoice (if supported - future)
- PDF viewing using WebView or react-native-pdf library

**Navigation**:
- From payment detail screen ("View Invoice" button)
- Deep link: `/invoice-view?paymentId=xxx`
- Add to `mobile/app/_layout.js` Stack navigation

#### 3.4 Current Mobile Payment History (Existing - Limited)

**File**: `mobile/app/coe-detail.js` (Existing - Limited Implementation)

**Current Implementation**:
- Shows basic payment history information inline in COE detail view
- Displays: Payment ID (truncated), Amount, Status, Date
- Loaded via COE detail endpoint response (`paymentHistory` state variable)
- Limited to single payment display (shows one payment if it exists)
- No navigation to dedicated payment screens
- No invoice viewing/downloading

**Code Location**: Lines ~43 (state), ~861-900 (display section)

**Note**: This basic implementation should be replaced/enhanced with proper payment history screens and navigation. Users should be able to navigate to dedicated payment history and detail screens.

---

### Phase 4: Dashboard Enhancement (Optional - Low Priority)

**Note**: Dashboard implementation is primarily for validation/testing purposes. Mobile app implementation is the priority. Dashboard enhancements can be done later if needed.

#### 4.1 Enhanced Payment History Tab

**File**: `server/views/test/dashboard.ejs` (UPDATE - Optional)

**Current Implementation** (Already Exists):
- Payment History tab in Payments & Subscriptions section
- COE ID input field (`paymentHistoryCOEId`)
- `loadPaymentHistory()` JavaScript function (lines ~18038-18087)
- Payment table display with columns:
  - Payment ID (truncated to 8 chars)
  - Payment Type (deposit, final_payment, full_payment, subscription, refund)
  - Amount (formatted as currency)
  - Status (with color-coded badges)
  - Card (brand + last 4 digits, or "N/A")
  - Date (formatted using `toLocaleDateString()`)
- Status badge styling (success/warning/danger/info classes)
- Empty state handling
- Error handling with `showAlert()` function

**Optional Enhancements** (Future - Not Priority):
- **All Payments View**: Change default view to show all user payments (instead of requiring COE ID)
- **COE Filter**: Convert COE ID input to optional filter dropdown (populate from user's COEs)
- **Filters UI**: Add filter controls for status, payment type, date range
- **Pagination**: Add pagination controls
- **Summary Statistics**: Add summary section (total payments, total amount, net amount)
- **COE Name Column**: Add COE name column (populated from COE data)
- **Invoice Download**: Add "Download Invoice" button for each payment row
- **Better Table Layout**: Improve table styling and responsiveness

**Implementation Notes**:
- Dashboard enhancement is not required for this feature
- Focus should be on mobile app implementation
- Dashboard can be enhanced later if needed for admin validation/testing

---

## Data Model

### Payment Model (Existing)

The existing Payment model already contains all necessary fields:
- Payment identification (ID, GP transaction ID)
- References (COE, User)
- Amount and currency
- Payment type and status
- Payment method (card brand, last 4)
- Dates (created, completed, refunded)
- Refund information

### Invoice Data Structure

```javascript
{
  invoice_number: String,        // Generated invoice number
  invoice_date: Date,            // Invoice issue date
  payment_date: Date,            // Payment completion date
  status: String,                // paid, refunded, etc.
  
  bill_to: {
    name: String,
    email: String,
    // Additional fields if available
  },
  
  coe: {
    _id: ObjectId,
    name: String,
    description: String,
    events: Array,
    // COE details for invoice
  },
  
  payment: {
    _id: ObjectId,
    amount: Number,
    currency: String,
    payment_type: String,
    payment_method: Object,
    transaction_id: String,
    completed_at: Date
  },
  
  pricing: {
    subtotal: Number,
    taxes: Number,
    fees: Number,
    total: Number
  },
  
  refund: {
    refund_amount: Number,
    refunded_at: Date,
    refund_reason: String
  }
}
```

---

## API Endpoints Summary

### New Endpoints

| Method | Endpoint | Description | Auth | Access |
|--------|----------|-------------|------|--------|
| GET | `/v1/payments/my` | Get user's payment history | ✅ | User's own payments |
| GET | `/v1/payments/:paymentId/invoice` | Get invoice data (JSON) | ✅ | User's own invoices |
| GET | `/v1/payments/:paymentId/invoice.pdf` | Download invoice PDF | ✅ | User's own invoices |

### Existing Endpoints (Reference)

| Method | Endpoint | Description | Auth | Access |
|--------|----------|-------------|------|--------|
| GET | `/v1/payments/coe/:coeId` | Get payments for COE | ✅ | User's own COEs |
| GET | `/v1/payments/:paymentId` | Get payment details | ✅ | User's own payments |

---

## Invoice Template Design

### Invoice Layout

```
┌─────────────────────────────────────────────────────┐
│                    THE1 PLATFORM                    │
│                   INVOICE                           │
│                                                     │
│ Invoice #: INV-2025-001                            │
│ Invoice Date: December 28, 2025                    │
│ Payment Date: December 28, 2025                    │
│ Status: PAID                                        │
├─────────────────────────────────────────────────────┤
│ BILL TO:                                            │
│ John Doe                                            │
│ john@example.com                                    │
├─────────────────────────────────────────────────────┤
│ COE DETAILS:                                        │
│ Premium Experience Package                          │
│                                                     │
│ Description:                                        │
│ Complete curated experience...                     │
├─────────────────────────────────────────────────────┤
│ ITEMS:                                              │
│ Event: Event Name                                   │
│   Date: December 30, 2025                          │
│   Seat A1 - $500.00                                │
│                                                     │
│ [Additional events/seats]                          │
├─────────────────────────────────────────────────────┤
│                                                     │
│ Subtotal:                    $900.00               │
│ Taxes:                       $50.00                │
│ Fees:                        $50.00                │
│ ─────────────────────────────────                  │
│ TOTAL:                       $1,000.00             │
├─────────────────────────────────────────────────────┤
│ PAYMENT INFORMATION:                                │
│ Payment Method: VISA •••• 5262                     │
│ Transaction ID: GP_TXN_123456                      │
│ Payment Date: December 28, 2025                    │
└─────────────────────────────────────────────────────┘
```

### Invoice Number Format

**Format**: `INV-YYYY-XXXXX`

- `INV` - Invoice prefix
- `YYYY` - Year
- `XXXXX` - Sequential number (padded with zeros)

**Example**: `INV-2025-00001`, `INV-2025-00002`

**Alternative**: Use payment ID as invoice number (simpler, but less user-friendly)

---

## Global Payments Integration

### Current GP Data Available

From Global Payments API, we have:
- `gp_transaction_id` - Transaction reference
- `gp_authorization_code` - Authorization code
- `gp_response_code` - Response code
- `gp_response_message` - Response message

### Invoice Requirements

**What we have**:
- ✅ Payment amount and currency
- ✅ Transaction ID (GP reference)
- ✅ Payment date
- ✅ Card brand and last 4 digits
- ✅ Payment status

**What we store**:
- ✅ COE details (name, description, events, pricing)
- ✅ User information (name, email)
- ✅ Payment breakdown (subtotal, taxes, fees)

**What we generate**:
- Invoice number
- Invoice date
- Formatted invoice document

**Note**: Global Payments does not provide invoice generation. We generate invoices using our stored payment and COE data.

---

## Implementation Steps

### Step 1: Backend API - User Payment History

1. Create `getUserPaymentHistory()` function in `paymentService.js`
   - Query payments by `user_id`
   - Support filtering (status, type, date range, COE)
   - Support pagination
   - Populate COE data for COE name
   - Calculate summary statistics
   - Return formatted response

2. Create `GET /v1/payments/my` route in `routes/payments.js`
   - Authenticate user
   - Parse query parameters
   - Call service function
   - Return JSON response

3. Add validation schema for query parameters
   - Date format validation
   - Status enum validation
   - Payment type enum validation
   - Pagination limits

### Step 2: Backend API - Invoice Data

1. Create `getInvoiceData()` function in `paymentService.js`
   - Fetch payment by ID
   - Verify user owns the payment
   - Populate COE data
   - Populate user data (bill-to)
   - Format invoice data structure
   - Generate invoice number
   - Return invoice data

2. Create `GET /v1/payments/:paymentId/invoice` route
   - Authenticate user
   - Validate payment ID
   - Call service function
   - Return JSON response

### Step 3: Invoice Service

1. Create `services/invoiceService.js`
   - Implement `generateInvoiceNumber()`
   - Implement `generateInvoiceHTML()`
   - Implement `generateInvoicePDF()`
   - Create invoice HTML template
   - Handle PDF generation (choose library)

2. Choose PDF Generation Library:
   - **Option A**: `pdfkit` - Direct PDF generation (lightweight)
   - **Option B**: `puppeteer` - HTML to PDF (better styling, but heavier)
   - **Option C**: `jsPDF` - Client-side PDF generation (for mobile)
   - **Recommendation**: `pdfkit` for server-side, `react-native-html-to-pdf` for mobile

### Step 4: Backend API - Invoice PDF Download

1. Create `GET /v1/payments/:paymentId/invoice.pdf` route
   - Authenticate user
   - Get invoice data
   - Generate PDF
   - Set appropriate headers (Content-Type, Content-Disposition)
   - Return PDF stream

### Step 5: Mobile App - Payment History Screen

1. Create `mobile/app/payment-history.js`
   - Fetch payments from `/v1/payments/my`
   - Display payment list
   - Implement pull-to-refresh
   - Add filter UI (status, date range)
   - Navigate to payment detail on tap

2. Update navigation
   - Add route to app navigation
   - Add menu item/link to access payment history

### Step 6: Mobile App - Payment Detail Screen

1. Create `mobile/app/payment-detail.js`
   - Fetch payment details from `/v1/payments/:paymentId`
   - Display payment information
   - Show COE details (with link)
   - Display payment method
   - Show transaction ID
   - Add "View Invoice" button

### Step 7: Mobile App - Invoice View Screen

1. Create `mobile/app/invoice-view.js`
   - Fetch invoice data from `/v1/payments/:paymentId/invoice`
   - Display invoice (HTML or PDF)
   - Add download button (download PDF)
   - Add share button (native share)
   - Handle PDF viewing (using `react-native-pdf` or web view)

2. Alternative: Use web view to display PDF from `/v1/payments/:paymentId/invoice.pdf`

### Step 8: Dashboard Enhancement (Optional - Skip for Now)

**Note**: Dashboard enhancement is optional and not required for this feature. The current dashboard implementation is sufficient for validation/testing purposes. Focus should be on mobile app implementation.

**If needed in the future:**
1. Update `dashboard.ejs` payment history tab
   - Change default view to show all user payments
   - Add filters UI (status, type, date range, COE)
   - Add pagination
   - Add summary statistics section
   - Add "Download Invoice" buttons
   - Improve table layout
   - Add COE name column with links

---

## Technical Considerations

### PDF Generation Options

#### Option 1: pdfkit (Recommended for Server)

**Pros**:
- Lightweight and fast
- Direct PDF generation (no browser needed)
- Good for structured documents
- Well-maintained library

**Cons**:
- Less flexible for complex layouts
- Requires manual layout coding

**Implementation**:
```javascript
const PDFDocument = require('pdfkit');
const fs = require('fs');

function generateInvoicePDF(invoiceData) {
  const doc = new PDFDocument();
  // Add content: header, bill-to, items, totals, footer
  // Return stream or buffer
}
```

#### Option 2: Puppeteer (HTML to PDF)

**Pros**:
- Better for complex layouts (uses HTML/CSS)
- Easy to style with CSS
- Can use existing HTML templates

**Cons**:
- Heavier (requires Chrome/Chromium)
- Slower generation
- Higher memory usage

**Implementation**:
```javascript
const puppeteer = require('puppeteer');

async function generateInvoicePDF(invoiceData) {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  const html = generateInvoiceHTML(invoiceData);
  await page.setContent(html);
  const pdf = await page.pdf({ format: 'A4' });
  await browser.close();
  return pdf;
}
```

#### Option 3: Client-Side PDF (Mobile)

**For Mobile App**:
- Use `react-native-html-to-pdf` for iOS/Android
- Or use WebView to display server-generated PDF
- Or fetch PDF from server and display using `react-native-pdf`

**Recommendation**: 
- **Server**: Use `pdfkit` for simplicity and performance
- **Mobile**: Fetch PDF from server endpoint and display using WebView or `react-native-pdf`

### Invoice Number Generation

**Option 1**: Sequential Number
- Store last invoice number in database
- Increment for each new invoice
- Format: `INV-YYYY-XXXXX`

**Option 2**: Use Payment ID
- Simple: Use payment `_id` as invoice number
- Format: `INV-{payment_id.substring(0, 8).toUpperCase()}`
- No database tracking needed

**Recommendation**: Start with Option 2 (simpler), can migrate to Option 1 later if needed.

### Data Population

For invoice generation, we need to populate:
- **Payment** → COE (for COE name, description, events, pricing)
- **Payment** → User (for bill-to information)
- **COE** → Events → Event details (for itemized invoice)

Ensure proper `.populate()` calls in service functions.

### Permissions & Security

- Users can only view their own payment history
- Users can only download invoices for their own payments
- Validate `user_id` matches `req.user._id` in all endpoints
- Admin users might need special permissions (future consideration)

### Performance Considerations

- **Pagination**: Implement pagination for payment history (default 20 items per page)
- **Indexes**: Ensure proper indexes on `user_id`, `created_at`, `status` in Payment model (already exists)
- **Caching**: Consider caching invoice PDFs (future optimization)
- **Lazy Loading**: For mobile app, load payment details on-demand

---

## Testing Plan

### Backend API Tests

1. **User Payment History Endpoint**
   - ✅ Returns all payments for authenticated user
   - ✅ Filters by status correctly
   - ✅ Filters by payment type correctly
   - ✅ Filters by date range correctly
   - ✅ Filters by COE ID correctly
   - ✅ Pagination works correctly
   - ✅ Returns summary statistics
   - ✅ Does not return payments from other users
   - ✅ Handles empty results gracefully

2. **Invoice Data Endpoint**
   - ✅ Returns invoice data for user's payment
   - ✅ Includes all required invoice fields
   - ✅ Populates COE data correctly
   - ✅ Populates user data correctly
   - ✅ Generates invoice number
   - ✅ Rejects access to other users' invoices

3. **Invoice PDF Endpoint**
   - ✅ Generates PDF correctly
   - ✅ PDF contains all invoice information
   - ✅ PDF is properly formatted
   - ✅ Sets correct Content-Type header
   - ✅ Handles download vs inline view
   - ✅ Rejects access to other users' invoices

### Mobile App Tests

1. **Payment History Screen**
   - ✅ Loads user payments correctly
   - ✅ Pull-to-refresh works
   - ✅ Filters work correctly
   - ✅ Navigation to payment detail works
   - ✅ Handles empty state
   - ✅ Handles error states

2. **Payment Detail Screen**
   - ✅ Displays payment information correctly
   - ✅ Shows COE details
   - ✅ Navigation to invoice view works
   - ✅ Handles missing data gracefully

3. **Invoice View Screen**
   - ✅ Displays invoice correctly
   - ✅ PDF download works
   - ✅ Share functionality works
   - ✅ Handles PDF generation errors

### Dashboard Tests (Optional - Validation Only)

**Note**: Dashboard tests are optional since dashboard implementation is for validation only.

1. **Payment History Tab** (Current Implementation)
   - ✅ Shows COE-specific payments when COE ID is entered
   - ✅ Payment table displays correctly
   - ✅ Status badges work correctly
   - ✅ Error handling works

**Future Dashboard Tests** (If enhanced):
   - Shows all user payments (default)
   - COE filter works
   - Status filter works
   - Date range filter works
   - Invoice download works
   - Pagination works
   - Summary statistics display correctly

---

## File Structure

### New Files

```
server/
├── services/
│   └── invoiceService.js          # NEW - Invoice generation service
├── routes/
│   └── payments.js                # UPDATE - Add new endpoints
├── views/
│   └── invoices/
│       └── invoice-template.html  # NEW - HTML invoice template (optional)

mobile/
├── app/
│   ├── payment-history.js         # NEW - Payment history screen
│   ├── payment-detail.js          # NEW - Payment detail screen
│   └── invoice-view.js            # NEW - Invoice view screen
├── src/
│   └── components/
│       └── PaymentCard.js         # NEW - Payment card component (optional)
```

### Updated Files

```
server/
├── services/
│   └── paymentService.js          # UPDATE - Add getUserPaymentHistory, getInvoiceData
├── routes/
│   └── payments.js                # UPDATE - Add new routes
├── views/
│   └── test/
│       └── dashboard.ejs          # NO UPDATE NEEDED - Current implementation sufficient for validation

mobile/
├── app/
│   └── _layout.js                 # UPDATE - Add payment-history, payment-detail, invoice-view routes
├── app/(tabs)/
│   └── profile.js                 # UPDATE - Add link/button to payment history (optional)
└── app/
    └── coe-detail.js              # UPDATE - Add link to payment history (optional)
```

---

## Dependencies

### Backend

**New Dependencies**:
```json
{
  "pdfkit": "^0.13.0"  // For PDF generation (recommended)
  // OR
  "puppeteer": "^21.0.0"  // For HTML to PDF (alternative)
}
```

**Installation**:
```bash
npm install pdfkit
# OR
npm install puppeteer
```

### Mobile App

**New Dependencies** (if needed):
```json
{
  "react-native-pdf": "^6.0.0",  // For PDF viewing
  "react-native-html-to-pdf": "^0.12.0"  // For client-side PDF (optional)
}
```

**Installation**:
```bash
cd mobile
npx expo install react-native-pdf
# OR
npm install react-native-html-to-pdf
```

---

## Environment Variables

No new environment variables required. Existing payment-related variables are sufficient.

---

## Future Enhancements

### Phase 2 Features (Future)

1. **Email Invoices**
   - Send invoice PDF via email after payment
   - Allow users to request invoice email
   - Email template with invoice attachment

2. **Invoice Numbering System**
   - Sequential invoice numbers with database tracking
   - Invoice number format customization
   - Invoice series per year/month

3. **Invoice Templates**
   - Multiple invoice templates
   - Customizable branding
   - Template selection per COE type

4. **Receipt Generation**
   - Separate receipt format (simpler than invoice)
   - Automatic receipt generation on payment
   - Receipt download option

5. **Invoice Export**
   - Export payment history to CSV
   - Export invoices to ZIP
   - Bulk invoice download

6. **Admin Invoice Management**
   - Admin can view all invoices
   - Admin can regenerate invoices
   - Admin can download invoices for any user

7. **Tax Information**
   - Add tax ID to invoices
   - Tax calculation breakdown
   - VAT/GST information

8. **Multi-Currency Support**
   - Currency conversion display
   - Multi-currency invoice support
   - Exchange rate information

---

## Reference: Dashboard Implementation Details

### Current Dashboard Implementation (For Validation/Testing)

**Location**: `server/views/test/dashboard.ejs`

**Existing Function**: `loadPaymentHistory()` (lines ~18038-18087)

**Current Implementation**:
```javascript
async function loadPaymentHistory() {
    try {
        const coeId = document.getElementById('paymentHistoryCOEId').value.trim();
        if (!coeId) {
            showAlert('Please enter a COE ID', 'error');
            return;
        }
        
        const result = await makeApiRequest(`/payments/coe/${coeId}`, 'GET');
        
        if (result.success && result.data) {
            const container = document.getElementById('paymentHistoryContainer');
            const payments = result.data;
            
            if (payments.length === 0) {
                container.innerHTML = '<p class="text-muted">No payments found for this COE</p>';
                return;
            }
            
            let html = '<div class="table-container"><table class="data-table"><thead><tr>';
            html += '<th>ID</th><th>Type</th><th>Amount</th><th>Status</th><th>Card</th><th>Date</th>';
            html += '</tr></thead><tbody>';
            
            payments.forEach(payment => {
                const statusClass = payment.status === 'completed' ? 'badge-success' : 
                                  payment.status === 'refunded' ? 'badge-warning' : 
                                  payment.status === 'failed' ? 'badge-danger' : 'badge-info';
                html += '<tr>';
                html += `<td><code>${payment._id.substring(0, 8)}...</code></td>`;
                html += `<td>${payment.payment_type}</td>`;
                html += `<td>$${payment.amount.toFixed(2)}</td>`;
                html += `<td><span class="${statusClass}">${payment.status.toUpperCase()}</span></td>`;
                html += `<td>${payment.card_brand ? payment.card_brand + ' •••• ' + payment.card_last_four : 'N/A'}</td>`;
                html += `<td>${new Date(payment.created_at).toLocaleDateString()}</td>`;
                html += '</tr>';
            });
            
            html += '</tbody></table></div>';
            container.innerHTML = html;
        } else {
            document.getElementById('paymentHistoryContainer').innerHTML = '<p class="text-muted">Failed to load payment history</p>';
        }
    } catch (error) {
        console.error('Error loading payment history:', error);
        showAlert('Failed to load payment history', 'error');
    }
}
```

**Features**:
- COE ID input field (`paymentHistoryCOEId`)
- Calls `GET /v1/payments/coe/:coeId` endpoint
- Displays payments in table format
- Shows: Payment ID (truncated to 8 chars), Type, Amount, Status, Card (brand + last 4), Date
- Status badges with color coding (success/warning/danger/info classes)
- Error and empty state handling
- Uses `showAlert()` function for error messages

**Purpose**: This implementation exists for validation/testing purposes. It demonstrates the backend API works correctly. The mobile app implementation is the primary focus.

---

## Related Documentation

- [Payment System Complete](./payment/PAYMENT-SYSTEM-COMPLETE.md) - Complete payment system documentation
- [Payment Implementation Guide](./payment/PAYMENT-IMPLEMENTATION-GUIDE.md) - Payment system implementation details
- [COE Specification](./architecture/coe-specification.md) - COE data model and structure

---

## Changelog

### Version 1.1 (December 2025)
- **Updated**: Focus clarified - Mobile app is primary implementation target
- **Added**: Reference section documenting existing dashboard implementation (`loadPaymentHistory()` function)
- **Updated**: Dashboard enhancement marked as optional/low priority
- **Updated**: Documented limited payment history in mobile app's `coe-detail.js` (existing implementation)
- **Updated**: Mobile app implementation section expanded with detailed feature lists
- **Updated**: File structure updated to reflect mobile app focus

### Version 1.0 (December 2025)
- Initial feature specification
- Complete implementation plan
- API endpoint specifications
- Mobile app screen designs
- Dashboard enhancement plan


