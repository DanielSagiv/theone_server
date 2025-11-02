# GXN Inventory API - Data Structure Deep Dive

Based on analysis of `gxn_res.json` response from `/v4/gxn/inventory/json/` endpoint.

## Overview

The GXN Inventory API returns a complex nested structure with 5 main nodes:
- `data.header`: Request metadata and filters applied
- `data.inventory`: Date-scoped, browseable catalog of available items
- `data.items`: Detailed sellable inventory records with full pricing/availability
- `data.venues`: Permanent venue reference/profile data
- `data.schedules`: Event-focused "what's happening" calendar data

## Critical Distinction: Venue Data in Different Nodes

### `data.inventory.{dateKey}.venues` vs `data.venues`

**Why are venues represented in two different locations?**

#### `data.inventory.D251101.venues.VEN505115`
**Purpose**: Date-scoped catalog/discovery structure for browseable items  
**When**: Scoped to a specific date (D251101 = 2025-11-01)  
**Contains**:
- `ecozones`: Ecozone → mastercodes mapping for this date
- `ecolist`: Grouped by booktype (Admission, Table Reservations, etc.)
- `masterlist`: All master items with mastername, masterhighlight, ecoitems
- `tree`: Hierarchical navigation structure
- `tags`: Tag-grouped items

**Structure Example**:
```json
"inventory": {
  "D251101": {
    "venues": {
      "VEN505115": {
        "ecozones": {
          "ECZ000": {
            "items": ["MFSNGAAIB0AOXINQB", "MTZKLCAIB0AOXINQB", ...]
          }
        },
        "masterlist": {
          "MAS10503": {
            "mastername": "General Admission - Ladies",
            "ecoitems": {"ECZ000": "MFSNGAAIB0AOXINQB"}
          }
        }
      }
    }
  }
}
```

**Use Cases**:
- "What can I book on this date at this venue?"
- Browse items by category/type
- Filter by tags, pricing, availability
- Build catalog navigation (hierarchical tree)
- Item grouping and aggregation

---

#### `data.venues.VEN505115`
**Purpose**: Permanent venue reference/profile data  
**When**: Static venue information (not date-dependent)  
**Contains**:
- `info`: Name, description, address, coordinates, contact info, property, market area
- `images`: All venue media organized by image type
- `socials`: Social media links
- `seasons`: Operating seasons configuration
- `currentophours`: Current operating hours
- `ecozones`: Basic ecozone definitions

**Structure Example**:
```json
"venues": {
  "VEN505115": {
    "info": {
      "code": "VEN505115",
      "name": "Zouk Nightclub",
      "address": "Resorts World Las Vegas...",
      "city": "Las Vegas",
      "country": "US"
    },
    "images": {
      "IMT1026": [...],
      "IMT17211": [...]
    },
    "socials": [...],
    "seasons": {...},
    "currentophours": {...}
  }
}
```

**Use Cases**:
- Venue detail pages
- Location search and mapping
- Social sharing
- SEO/marketing content
- Building venue profiles

**Key Difference**: `inventory.{dateKey}.venues` is about **what you can buy**, `venues` is about **who/where you're buying from**.

---

### `data.inventory.{dateKey}.venues` vs `data.schedules.{dateKey}.venues`

**Why separate browsing catalog from scheduling/events?**

#### `data.inventory.D251101.venues.VEN505115`
**Purpose**: Browseable item catalog for the date  
**Focus**: Sellable inventory and how to discover it  
**Contains**:
- Master codes of available items
- Grouped by venue + ecozone + booktype
- Tree navigation structure
- Tags and filtering metadata
- Price ranges (min/max)

**Example**:
```json
"ecolist": [
  {
    "ecomasters": {
      "MAS10503": {"ecoitems": {"ECZ000": "MFSNGAAIB0AOXINQB"}}
    },
    "booktype": {"label": "Admission", "code": "BKT10252"}
  }
]
```

**User Journey**: "Show me all tables available on Nov 1st"

---

#### `data.schedules.D251101.venues.VEN505115`
**Purpose**: Calendar-focused "what's happening" data  
**Focus**: Events, performers, timing, venue status  
**Contains**:
- Venue operational status (Open/Closed)
- Event details (name, type, performers, flyers)
- Time windows (doors open/close, start/end times)
- Item counts by type (7 admission items, 6 seating items)
- Source type (Event vs Hours of Operations)

**Example**:
```json
"ECZ0": {
  "status": "Open",
  "source": "Event",
  "venuename": "Zouk Nightclub",
  "econame": "DJ Snake, HALLOWEEN WEEKEND",
  "event": {
    "name": "DJ Snake, HALLOWEEN WEEKEND",
    "eventid": "2048373",
    "performers": {"PER1242": {"perfcode": "PER1242"}},
    "flyers": {...},
    "ndoorsopen": "12200",
    "nstarttime": "12200"
  },
  "weekdays": [{"nopentime": "12200", "timestring": "From 10:00pm to 12:00am"}],
  "itemtypes": {"admission": 5, "table": 6}
}
```

**User Journey**: "What's happening at Zouk on Nov 1st? Who's performing?"

---

## Summary: The Three Venue Perspectives

| Node Path | Purpose | Focus | When |
|-----------|---------|-------|------|
| `inventory.{date}.venues` | Browseable catalog | **What can I buy?** | User shopping for items |
| `venues` | Venue reference data | **Who/where am I buying from?** | Venue details/profile |
| `schedules.{date}.venues` | Event calendar | **What's happening?** | User browsing what's on |

**Analogy**:
- `inventory` = Amazon product catalog
- `venues` = Seller storefront info
- `schedules` = Concert hall schedule of performances

---

## Inventory Item Fields Breakdown

Every item in `data.items` contains ~45 fields. Understanding them is critical for building booking flows.

### Core Identification
- `mastercode`: Unique item instance ID (e.g., `MFSNGAAIB0AOXINQB`)
- `masteritemcode`: Catalog master ID (e.g., `MAS10503`) - **return this when booking to decrement inventory**
- `masteritemid`: Numeric catalog ID
- `venuecode`: Which venue (e.g., `VEN505115`)
- `ecocode`: Ecozone assignment (e.g., `ECZ000`)
- `venueid`: Numeric venue ID

### Date & Time Context
- `caldate`: Available date in `YYYY-MM-DD`
- `cutofftstamp`: Unix timestamp when booking closes
- `arriveby`: Expected arrival time offset (often `0`)
- `starttime`, `endtime`: Activity time window (often `0` if not enforced)

### Pricing & Revenue
- `listprice`: Base price (before fees)
- `currency`: Currency code (e.g., `usd`)
- `currency_symbol`: Display symbol (`$`)
- `paynow`: Total amount charged at booking
- `paybase`: Base amount (usually equals paynow)
- `breakdowns`: Full fee calculation by payment type
  - `prepay.fullprepay`: Full prepay breakdown
  - `prepay.deposit`: Deposit-only breakdown
  - Fields: subtotal, procfee1, let1, ccfee1, total, balancedue

### Stock & Availability
- `capacity`: Total capacity (`1` for per-guest items, `15` for table capacity)
- `stock`: Available units at this location (`5` tickets, `1` table)
- `totalstock`: Total stock across all locations
- `locstock`: Location-specific stock
- `minqty`: Minimum purchaseable quantity
- `maxqty`: Maximum purchaseable quantity
- `qtys`: Array of allowed quantities (admission: `["1","2","3","4","5"]`)
- `inactive`: `0` active, `1` inactive
- `state`: `on`, `off`, `waitlist`, etc.

### Inventory Characteristics
- `globaltype`: High-level item type
  - `admission`: Per-guest tickets/entry
  - `seating`: Reserved tables/sections
- `itemtype`: Specific category
  - For admission: `admission`
  - For seating: `table`
- `pricing`: Pricing model
  - `admission`: Per-guest fixed pricing
  - `f&b`: Food & beverage minimum
  - `novalue`: No upfront pricing
- `paytype`: Payment flow
  - `prepay`: Full payment upfront
  - `deposit`: Partial payment, balance at venue
  - `reserve`: Reservation only

### Categorization & Discovery
- `booktypecode`: Booking category code (e.g., `BKT10252`)
- `booktypename`: Category name (e.g., `Admission`, `Food & Beverage`)
- `booktypeid`: Numeric category ID
- `pricingdisplay`: Display label for pricing (e.g., `Admission`, `Booking Fee`)
- `label`: CTA button text (e.g., `Book`)
- `qtylabel`: Quantity field label (e.g., `Guests`, `Seats`)
- `tagids`: Array of tag IDs for filtering
- `tags`: Comma-separated tag list (string form)
- `highlight`: Short marketing snippet
- `masterhighlight`: Master item's highlight
- `disclaimer`: Pricing disclaimer text
- `badge`: Urgency indicator (e.g., `Available`, `Low Stock`)

### Display & Presentation
- `itemname`: Display name (e.g., `VIP Expedited Entry - Ladies`)
- `mastername`: Canonical name
- `skuname`: SKU display name
- `sku`: Stock keeping unit code
- `itempic`: Primary image URL
- `descr`: Long description

### Terms & Legal
- `terms`: Full terms & conditions text
- `termid`: Terms version ID

### Configuration
- `layoutcode`: Layout/map identifier
- `timemode`: Time constraints mode (e.g., `None`, `AM`, `PM`)
- `timelabel`: Human-readable time span
- `mintime`, `maxtime`: Time slot constraints
- `locids`: Comma-separated location IDs
- `marketplace`: `1` if exposed in marketplace

### Operational
- `modtstamp`: Unix timestamp of last modification
- `vendor`: 3rd party vendor name (if applicable)
- `listzero`: How zero-priced items are displayed (`Included`, `Reservation`)
- `basedisplay`: Action button label (`Pay Now`, `Reserve`)
- `breakdown_labels`: Map of pay modes to labels
- `econame`: Ecozone display name
- `has_seating`: Boolean for seating-related items

---

## Admission vs Seating: Key Differences

Based on `globaltype`:

### `globaltype: "admission"`
- **Purpose**: Per-guest tickets/entry passes
- **Pricing**: Fixed price per person with full breakdown calculated upfront
  - Example: `listprice: 50`, `paynow: 64.71` (includes all fees)
- **Payment**: Full prepay at booking
  - `paytype: "prepay"`
  - `breakdown_labels: {"prepay": "Full PrePay"}`
- **Quantity**: User selects guest count (e.g., 1-5 guests)
  - `capacity: "1"` (meaning: 1 person per unit)
  - `minqty: "1"`, `maxqty: "5"`
  - `qtys: ["1","2","3","4","5"]`
- **Stock**: Number of tickets available
  - `stock: "5"` = 5 tickets left
- **Terms**: Explicit about ticket sales being final, processing fees non-refundable
- **Unit semantics**: `qtytype: "guests"`, `unitname: "Guest"`

### `globaltype: "seating"`
- **Purpose**: Reserved tables/sections with minimum spend
- **Pricing**: F&B minimum spend requirement
  - Example: `listprice: 8500` (min spend), `pricing: "f&b"`
- **Payment**: Deposit upfront, balance due at venue
  - `paytype: "deposit"`
  - Terms specify: 20% deposit + fees, rest on arrival
- **Quantity**: One table at a time
  - `capacity: "15"` (table holds 15 people)
  - `minqty: "1"`, `maxqty: "1"` (can't book multiple tables)
  - No `qtys` array
- **Stock**: Number of tables/seats available
  - `stock: "1"` = 1 table left
- **Terms**: Explicit about min spend, venue fee %, gratuity %, sales tax
- **Unit semantics**: `itemtype: "table"`

**Example Disclaimer**: *"Pricing based on 15 guests"*  
**Locations**: Specific table assignments via `locids` (e.g., `"10415,10416,10417,10418,10419,10420,10421"`)

---

## Relationships & Cross-References

### Items ↔ Schedules
- Items are the **inventory you can book**
- Schedules show **events happening** that may drive demand for those items
- Same venue on same date, but different purposes

### Items ↔ Venues
- Items have `venuecode` pointing to `data.venues`
- Venues provide context (location, contact, images) for items
- One-to-many: one venue has many items

### Items ↔ Inventory
- `data.items` has full detail on every item
- `data.inventory.{date}.venues` provides discovery structure (grouped by booktype, ecozone, tags)
- Both reference same `masteritemcodes` and `mastercodes`

### Schedules ↔ Featured
- `schedules.{date}.venues.{venue}.ECZ0.event.eventcode` = `EVE50511500020251101`
- `featured.EVE50511500020251101` contains full event details, performers, flyers
- Cross-reference via `eventcode`

### Schedules ↔ Performers
- Event has `performers: {"PER1242": {...}}`
- Performer has `shows: ["EVE50511500020251101"]`
- Bidirectional lookup for "what events is this artist at?" and "who's performing at this event?"

---

## Practical Integration Guide

### For Building a Venue Browse Page
1. Use `data.venues.VEN505115.info` for venue name, address, images
2. Use `data.schedules.D251101.venues.VEN505115.ECZ0` for "what's happening"
3. Use `data.inventory.D251101.venues.VEN505115.masterlist` for available items
4. For each master, fetch full detail from `data.items.{mastercode}`

### For Building a Product Detail Page
1. User clicks on `MAS10503` → fetch `data.items.MFSNGAAIB0AOXINQB`
2. Show pricing from `breakdowns.prepay.fullprepay` for each `qty`
3. Display `terms`, `disclaimer`, `highlight`
4. Cross-reference to `schedules` for event context if this date has one

### For Building a Calendar/Events Page
1. Iterate `data.schedules.{date}` for each date
2. For each venue, show `status`, `venuename`, `event.name`
3. Display `weekdays` timing
4. Show `performers` from `event.performers` (resolve to full profile via `data.performers`)
5. Show `flyers` for event imagery

### For Building a Booking Flow
1. Resolve selected item → `mastercode`
2. Fetch `data.items.{mastercode}` for full pricing
3. User selects quantity from `qtys` array
4. Calculate total using `breakdowns.prepay.{qtyKey}` (e.g., `breakdowns.prepay.q3`)
5. Show `terms`, `disclaimer`, `basedisplay`
6. On booking, return `masteritemcode` to GXN API to decrement inventory

---

## Visual Data Flow

```
User requests: /v4/gxn/inventory/json/?caldate=2025-11-01&venuecode=VEN505115

Response:
├── header (request context, tokens, venuecodes)
├── inventory.D251101
│   └── venues.VEN505115           ← "What can I browse?"
│       ├── ecozones               ← Items by ecozone
│       ├── ecolist                ← Grouped by booktype
│       ├── masterlist             ← Summary of masters
│       ├── tree                   ← Navigation hierarchy
│       └── tags                   ← Tag-based organization
│
├── items                          ← "Full detail on every item"
│   ├── MFSNGAAIB0AOXINQB          ← Admission item
│   ├── MZSUOPAIB0AOXINQB          ← Seating item
│   └── ...
│
├── venues.VEN505115               ← "Who/where am I buying from?"
│   ├── info                       ← Name, address, contact
│   ├── images                     ← Media gallery
│   ├── socials                    ← Social links
│   ├── seasons                    ← Operating seasons
│   ├── currentophours            ← Current hours
│   └── ecozones                  ← Basic zone definitions
│
└── schedules.D251101
    └── venues.VEN505115          ← "What's happening?"
        └── ECZ0
            ├── status            ← Open/Closed
            ├── source            ← Event vs Hours
            ├── event             ← Event details, performers
            ├── weekdays          ← Timing windows
            └── itemtypes         ← Counts by type
```

---

## Field Quick Reference

### Price Fields
- `listprice`: Base price before fees
- `paynow`: Total charged at booking
- `paybase`: Base amount (often equals paynow)
- `breakdowns.{paytype}.{qty}.subtotal`: Ticket/base amount
- `breakdowns.{paytype}.{qty}.procfee1`: Processing fee
- `breakdowns.{paytype}.{qty}.let1`: Live Entertainment Tax
- `breakdowns.{paytype}.{qty}.ccfee1`: Credit card fee
- `breakdowns.{paytype}.{qty}.total`: Grand total

### Availability Fields
- `stock`: Currently available units
- `totalstock`: Total across all locations
- `locstock`: Location-specific stock
- `capacity`: Per-unit capacity
- `minqty`, `maxqty`: Purchase constraints
- `inactive`: Active status
- `state`: Operational state

### Identification Fields
- `mastercode`: Item instance ID (for booking)
- `masteritemcode`: Catalog master ID (return to API on booking)
- `venuecode`: Venue identifier
- `ecocode`: Ecozone identifier
- `booktypecode`: Category identifier
- `sku`: Stock keeping unit

### Timing Fields
- `caldate`: Availability date
- `cutofftstamp`: Booking cutoff time
- `starttime`, `endtime`: Activity window
- `arriveby`: Arrival expectation
- `timelabel`: Human-readable time
- `weekdays`: Day-specific hours (schedules)

### Metadata Fields
- `globaltype`: admission or seating
- `itemtype`: Specific category
- `pricing`: Pricing model
- `paytype`: Payment flow
- `pricingdisplay`: Display label
- `qtylabel`: Quantity label
- `basedisplay`: Action label

---

*Document generated from analysis of real GXN API response structure.*

