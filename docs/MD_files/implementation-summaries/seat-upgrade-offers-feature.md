# Seat Upgrade Offers Feature - Implementation Plan

## Overview

This document outlines the implementation plan for adding seat upgrade offers to the bot/AI COE creation system. After or while building a COE, the system will automatically identify and offer better seating options based on location seat sentiment data, even if they cost more. This allows clients to upgrade to premium tables (e.g., upper dance floor vs. lower dance floor) while the COE is in draft status.

## Feature Description

### User Story
As a client, I want to be offered premium seating upgrades when creating a COE through the bot, so I can choose better tables/seats that match my preferences, even if they cost more than my initial budget selection.

### Key Requirements
1. **Automatic Offer Generation**: System automatically identifies better seats after COE creation
2. **Sentiment-Based Selection**: Uses location seat sentiment data to determine "better" seats
3. **Price Transparency**: Clearly shows price difference for upgrades
4. **Draft Status Only**: Offers only available while COE is in draft status
5. **Easy Acceptance**: One-click upgrade acceptance that updates COE automatically
6. **Clear Value Proposition**: Explains why each upgrade is better (sentiment reasons)

## Business Logic

### What Makes a Seat "Better"?

A seat is considered a **candidate upgrade** relative to the currently selected seat using a combination of **hard filters** and **quality/price comparison**. The exact rules differ slightly for clients vs admins.

#### Universal hard filters (clients and admins)

For a seat to be considered at all:

1. **Same event**:  
   - Seat belongs to the same `Event` as the current seat.

2. **Availability**:
   - `seat.status === 'available'` (not held or booked).

3. **Capacity / party size**:
   - `seat.capacity >= partySize`  
   - `partySize` is taken from `coe.preferences.party_size` (default `2`).

4. **Location mapping required**:
   - The system must be able to resolve a **location seat** for the event seat using `seat_id` or `code` (via `findLocationSeat`).  
   - If we cannot map the event seat to a `location.seats[]` entry, it is **dropped** from consideration.

5. **COE status**:
   - COE status must be `draft` or `request`.  
   - No upgrade offers are generated for paid / finalized COEs.

#### Client-facing "better" definition

For **clients**, after the hard filters above, a candidate seat is only kept if it is **strictly an upgrade**:

1. **Current seat must be resolvable**:
   - We must successfully locate the current seat in the location via `findLocationSeat`.  
   - If we can’t, the function returns **no upgrades** for clients (we don’t guess).

2. **Quality score and price comparison**:
   - Each seat gets a **quality score** (see “Sentiment Quality Scoring Algorithm” below).
   - Let:
     - `currentScore` = quality of the current seat.
     - `currentPrice` = current seat price (`event_price` / `base_price` / `min_spend`).
     - `seatScore` / `seatPrice` = score and price for a candidate.
   - A seat is considered an upgrade if:
     - `seatScore > currentScore` **OR**
     - `seatPrice > currentPrice`.

3. **Exclude the current seat**:
   - By code and by `seat_id`, the current seat is removed from the candidates for clients.

4. **Sorting and limits (clients)**:
   - Sorts candidates **more expensive first**, then by **quality score (descending)**.
   - Keeps **top 5** upgrade options per seat.

#### Admin-facing definition

For **admins** (e.g. “Check available merges” / manual upgrade management):

1. **Same hard filters**:
   - Same availability, capacity, location mapping, and COE status rules as above.

2. **Current seat may be unresolved**:
   - If we can’t find the current seat in the location, **admins still get offers**.  
   - In that case, `currentScore`/`currentPrice` fall back to safe defaults and we don’t strictly enforce “must be better”.

3. **Include the current seat**:
   - The candidate list includes the seat that matches the current selection, marked as `"Currently Selected"` so the admin can see the baseline.

4. **No “must be better” filter**:
   - For admins, we effectively expose the **whole available inventory** (after hard filters), annotated with:
     - Quality score.
     - Price.
     - Sentiment‑based reasons.
     - Budget tags (`Within Budget` vs `Premium Upgrade`).

5. **Sorting and limits (admins)**:
   - Sorts seats by **price ascending**, then by **quality score (descending)**.  
   - Keeps up to **100** rows per seat/event (a practical cap, but effectively “all relevant”).

6. **Merged tables – group upgrades**:
   - When the current seat is a **merged table** (one event seat shared by multiple COEs via `booking_reference` + `merged_coe_ids`):
     - An admin upgrade is treated as a **group operation**.
     - The entire merge group (primary COE + all `merged_coe_ids`) is moved to the **new seat together**.
     - The old seat is reset to `status: 'available'` and has its `booking_reference` / `merged_coe_ids` cleared.
     - The new seat is marked as `status: 'held'`, with `booking_reference = primary COE id` and `merged_coe_ids = [other COE ids]`.
     - Each COE in the group gets its `selected_seats` entry updated to point at the new seat, and its totals are recalculated.
   - This ensures upgrading a merged table **does not silently break the merge**; all merged clients now sit at the upgraded table.

### Example Scenario

**Current Seat**:
- Location: Club X
- Seat: Lower dance floor table (code: LDF-12)
- Price: $500
- Sentiment: Type B - "Good view of dance floor"
- Category: `lower_dance`
- Price Tier: 2

**Offered Upgrade**:
- Location: Club X (same)
- Seat: Upper dance floor table (code: UDF-05)
- Price: $750
- Sentiment: Type A - "Premium upper dance floor, better view, VIP experience"
- Category: `upper_dance`
- Price Tier: 4
- **Upgrade Reasons**: 
  - "Upgrade to upper dance floor"
  - "Premium tier 4 seating"
  - "Better view"
  - "VIP section"

**Price Delta**: +$250

## Implementation Phases

### Phase 1: Seat Comparison Service (Backend Logic – shared for client & admin)

**Goal**: Create service to identify better seats based on sentiment

**Tasks**:
1. Create `services/seatUpgradeService.js`
2. Implement `findBetterSeats()` function
3. Implement `scoreSeatQuality()` function
4. Implement `calculateUpgradeValue()` function
5. Implement `calculateUpgradeReasons()` function
6. Add sentiment comparison logic

**Deliverables**:
- Service can identify better seats for any given seat
- Quality scoring algorithm works correctly
- Upgrade reasons are generated from sentiment data

**Technical Details (current implementation)**:

```javascript
// services/seatUpgradeService.js

/**
 * Resolve an event seat to its location seat (primary by seat_id, fallback by code)
 */
function findLocationSeat(seat, location) {
  if (!location?.seats || location.seats.length === 0) return null;

  const seatId = seat.seat_id?.toString();
  if (seatId) {
    const matchById = location.seats.find(s => s._id?.toString() === seatId);
    if (matchById) return matchById;
  }

  const seatCode = seat.seat_code || seat.code;
  if (seatCode) {
    const matchByCode = location.seats.find(s => s.code === seatCode);
    if (matchByCode) return matchByCode;
  }

  return null;
}

/**
 * Score a seat's quality based on qualityScore and sentiment
 * @param {Object} seat - Seat object (event or COE seat)
 * @param {Object} location - Location with seats + sentiment
 * @returns {number} Quality score (higher = better)
 */
function scoreSeatQuality(seat, location) {
  const locationSeat = findLocationSeat(seat, location);
  const plain = locationSeat?.toObject ? locationSeat.toObject() : locationSeat;

  // Base quality: qualityScore 1–10 scaled to 10–100
  const qualityScore = plain?.qualityScore || seat.qualityScore || 5;
  let score = qualityScore * 10;

  // Sentiment bonus: Type A = +5, Type B = +2
  if (plain?.sentiment) {
    plain.sentiment.forEach(sent => {
      if (sent.type === 'A') score += 5;
      if (sent.type === 'B') score += 2;
    });
  }

  return score;
}

/**
 * Find alternative seats for a selected seat
 * @param {Object} currentSeat - Selected seat from COE
 * @param {Object} event - Event with seats[]
 * @param {Object} location - Location with seats + sentiment
 * @param {number} partySize - Party size requirement
 * @param {number} remainingBudget - Remaining budget (for fits_budget tag)
 * @param {boolean} isAdmin - If true, admin mode (show inventory)
 * @returns {Array} Candidate seats with quality/price/budget info
 */
async function findBetterSeats(currentSeat, event, location, partySize = 2, remainingBudget = 0, isAdmin = false) {
  if (!event.seats || event.seats.length === 0) return [];

  const currentLocation = findLocationSeat(currentSeat, location);
  let currentScore = 0;
  let currentPrice = currentSeat.event_price || currentSeat.base_price || currentSeat.min_spend || 0;

  // For clients: require a resolvable current seat
  if (!currentLocation && !isAdmin) {
    return [];
  }

  if (currentLocation) {
    const currentObj = currentSeat.toObject ? currentSeat.toObject() : currentSeat;
    currentScore = scoreSeatQuality(
      { ...currentObj, seat_id: currentObj.seat_id, code: currentObj.seat_code || currentObj.code },
      location
    );
  }

  // Hard filters: availability + capacity, and exclude current seat for clients
  const availableSeats = event.seats.filter(seat => {
    if (seat.status !== 'available') return false;
    if (seat.capacity < partySize) return false;

    if (!isAdmin) {
      const sameCode = seat.code === (currentSeat.seat_code || currentSeat.code);
      const sameId =
        seat._id?.toString() && currentSeat.seat_id?.toString() &&
        seat._id.toString() === currentSeat.seat_id.toString();
      if (sameCode || sameId) return false;
    }

    return true;
  });

  const processed = availableSeats
    .map(seat => {
      const locSeat = findLocationSeat(seat, location);
      if (!locSeat) return null;

      const seatObj = seat.toObject ? seat.toObject() : seat;
      const seatScore = scoreSeatQuality(
        { ...seatObj, seat_id: seatObj._id, code: seatObj.code },
        location
      );

      const seatPrice = seat.event_price || seat.min_spend || 0;
      const isBetterQuality = seatScore > currentScore;
      const isMoreExpensive = seatPrice > currentPrice;
      const isUpgrade = isBetterQuality || isMoreExpensive;

      const shouldInclude = isAdmin ? true : isUpgrade;

      return shouldInclude
        ? {
            seat,
            score: seatScore,
            price: seatPrice,
            isBetterQuality,
            isMoreExpensive,
          }
        : null;
    })
    .filter(Boolean)
    .sort((a, b) => {
      if (isAdmin) {
        if (a.price !== b.price) return a.price - b.price;       // cheaper first
        return b.score - a.score;                                // then higher quality
      } else {
        if (a.isMoreExpensive !== b.isMoreExpensive) {
          return (b.isMoreExpensive ? 1 : 0) - (a.isMoreExpensive ? 1 : 0);
        }
        return b.score - a.score;
      }
    });

  const limited = isAdmin ? processed.slice(0, 100) : processed.slice(0, 5);

  // Attach budget tags
  return limited.map(item => {
    const seatObj = item.seat.toObject ? item.seat.toObject() : item.seat;
    const seatPrice = item.price;
    const priceDelta = seatPrice - currentPrice;
    const fitsBudget = priceDelta <= remainingBudget;

    return {
      ...seatObj,
      event_price: seatPrice,
      fits_budget: fitsBudget,
      tag: fitsBudget ? 'Within Budget' : 'Premium Upgrade',
    };
  });
}

/**
 * Calculate upgrade value proposition
 * @param {Object} currentSeat - Current seat
 * @param {Object} upgradeSeat - Proposed upgrade seat
 * @param {Object} location - Location with sentiments
 * @returns {Object} Upgrade details
 */
function calculateUpgradeValue(currentSeat, upgradeSeat, location) {
  const currentPrice = currentSeat.event_price || currentSeat.base_price || 0;
  const upgradePrice = upgradeSeat.event_price || upgradeSeat.min_spend || 0;
  const priceDelta = upgradePrice - currentPrice;
  
  // Get sentiments
  const currentLocationSeat = location.seats.find(s => 
    s._id.toString() === currentSeat.seat_id?.toString() ||
    s.code === currentSeat.seat_code
  );
  
  const upgradeLocationSeat = location.seats.find(s => 
    s._id.toString() === upgradeSeat._id?.toString() ||
    s.code === upgradeSeat.code
  );
  
  const upgradeReasons = calculateUpgradeReasons(
    currentLocationSeat,
    upgradeLocationSeat,
    currentSeat,
    upgradeSeat
  );
  
  return {
    price_delta: priceDelta,
    price_delta_percentage: currentPrice > 0 ? ((priceDelta / currentPrice) * 100).toFixed(1) : 0,
    upgrade_reasons: upgradeReasons,
    sentiment_improvement: {
      current: currentLocationSeat?.sentiment || [],
      upgrade: upgradeLocationSeat?.sentiment || []
    }
  };
}

/**
 * Generate human-readable upgrade reasons
 * @param {Object} currentLocationSeat - Current seat from location
 * @param {Object} upgradeLocationSeat - Upgrade seat from location
 * @param {Object} currentSeat - Current seat from COE
 * @param {Object} upgradeSeat - Upgrade seat from event
 * @returns {Array<string>} Array of upgrade reason strings
 */
function calculateUpgradeReasons(currentLocationSeat, upgradeLocationSeat, currentSeat, upgradeSeat) {
  const reasons = [];
  
  if (!currentLocationSeat || !upgradeLocationSeat) {
    return reasons;
  }
  
  // Category upgrades
  const categoryUpgrades = {
    'lower_dance': { 'upper_dance': 'Upgrade to upper dance floor' },
    'third_tier_couch': { 'upper_dance': 'Upgrade to upper dance floor', 'lower_dance': 'Upgrade to dance floor' },
    'backwall': { 'lower_dance': 'Upgrade to dance floor', 'upper_dance': 'Upgrade to upper dance floor' },
    'stage_tables': { 'owner_tables': 'Upgrade to owner tables' }
  };
  
  const currentCategory = currentSeat.category || currentLocationSeat.category;
  const upgradeCategory = upgradeSeat.category || upgradeLocationSeat.category;
  
  if (categoryUpgrades[currentCategory] && categoryUpgrades[currentCategory][upgradeCategory]) {
    reasons.push(categoryUpgrades[currentCategory][upgradeCategory]);
  }
  
  // Price tier upgrade
  const currentTier = currentLocationSeat.priceTier || 1;
  const upgradeTier = upgradeLocationSeat.priceTier || 1;
  
  if (upgradeTier > currentTier) {
    reasons.push(`Premium tier ${upgradeTier} seating`);
  }
  
  // Sentiment-based reasons
  const upgradeSentiment = upgradeLocationSeat.sentiment || [];
  const upgradeSentimentText = upgradeSentiment.map(s => s.text).join(' ').toLowerCase();
  
  if (upgradeSentimentText.includes('upper') && !currentLocationSeat.sentiment?.some(s => s.text.toLowerCase().includes('upper'))) {
    reasons.push('Upper level seating');
  }
  
  if (upgradeSentimentText.includes('vip')) {
    reasons.push('VIP section');
  }
  
  if (upgradeSentimentText.includes('premium')) {
    reasons.push('Premium experience');
  }
  
  if (upgradeSentimentText.includes('better view') || upgradeSentimentText.includes('best view')) {
    reasons.push('Better view');
  }
  
  if (upgradeSentimentText.includes('exclusive')) {
    reasons.push('Exclusive area');
  }
  
  // Type A sentiment upgrade
  const hasTypeA = upgradeSentiment.some(s => s.type === 'A');
  const currentHasTypeA = currentLocationSeat.sentiment?.some(s => s.type === 'A');
  
  if (hasTypeA && !currentHasTypeA) {
    reasons.push('Premium sentiment rating');
  }
  
  // Remove duplicates
  return [...new Set(reasons)];
}
```

---

### Phase 2: Offer Generation After COE Creation (client-focused)

**Goal**: Automatically generate upgrade offers when COE is created

**Tasks**:
1. Create `generateSeatUpgradeOffers()` function
2. Integrate into `handleCreateCOEDraft` in `botToolHandlers.js`
3. Store offers in COE model
4. Include offers in bot response

**Deliverables**:
- Offers generated automatically after COE creation
- Offers stored in COE document
- Offers included in structured bot response

**Technical Details**:

```javascript
// services/seatUpgradeService.js

/**
 * Generate upgrade offers for all seats in a COE
 * @param {Object} coe - COE object with selected_seats
 * @returns {Promise<Array>} Array of upgrade offers per seat
 */
async function generateSeatUpgradeOffers(coe) {
  const Event = require('../models/Event');
  const offers = [];
  
  // Group seats by event
  const seatsByEvent = {};
  for (const selectedSeat of coe.selected_seats || []) {
    const eventId = selectedSeat.event_id?.toString();
    if (!eventId) continue;
    
    if (!seatsByEvent[eventId]) {
      seatsByEvent[eventId] = [];
    }
    seatsByEvent[eventId].push(selectedSeat);
  }
  
  // Process each event
  for (const [eventId, seats] of Object.entries(seatsByEvent)) {
    // Get event with location populated
    const event = await Event.findById(eventId)
      .populate('location_id', 'seats');
    
    if (!event || !event.location_id) continue;
    
    // Get party size from COE or preferences
    const partySize = coe.preferences?.party_size || 2;
    
    // Find better seats for each selected seat
    for (const selectedSeat of seats) {
      const betterSeats = await findBetterSeats(
        selectedSeat,
        event,
        event.location_id,
        partySize
      );
      
      if (betterSeats.length > 0) {
        // Calculate upgrade value for each alternative
        const alternatives = betterSeats.map(seat => {
          const upgradeValue = calculateUpgradeValue(
            selectedSeat,
            seat,
            event.location_id
          );
          
          // Get location seat for sentiment
          const locationSeat = event.location_id.seats.find(s =>
            s._id.toString() === seat._id?.toString() ||
            s.code === seat.code
          );
          
          return {
            seat_id: seat._id,
            seat_code: seat.code,
            capacity: seat.capacity,
            event_price: seat.event_price || seat.min_spend || 0,
            base_price: seat.min_spend || 0,
            price_delta: upgradeValue.price_delta,
            price_delta_percentage: upgradeValue.price_delta_percentage,
            upgrade_reasons: upgradeValue.upgrade_reasons,
            sentiment: locationSeat?.sentiment || [],
            category: seat.category,
            section: seat.section,
            media: seat.media || []
          };
        });
        
        offers.push({
          current_seat_id: selectedSeat.seat_id,
          current_seat_code: selectedSeat.seat_code,
          event_id: eventId,
          event_name: event.name,
          current_price: selectedSeat.event_price || selectedSeat.base_price || 0,
          alternatives: alternatives,
          generated_at: new Date()
        });
      }
    }
  }
  
  return offers;
}
```

**Integration Point**:

```javascript
// services/botToolHandlers.js - handleCreateCOEDraft

// After COE is created successfully
if (populatedCOE.status === 'draft') {
  try {
    // Generate seat upgrade offers
    const upgradeOffers = await generateSeatUpgradeOffers(populatedCOE);
    
    if (upgradeOffers.length > 0) {
      // Store offers in COE
      populatedCOE.seat_upgrade_offers = upgradeOffers;
      await populatedCOE.save();
      
      // Include offers in response
      structuredResponse.seat_upgrade_offers = upgradeOffers;
    }
  } catch (error) {
    console.error('[BOT] Error generating upgrade offers:', error);
    // Don't fail COE creation if offers fail
  }
}
```

---

### Phase 3: COE Model Enhancement

**Goal**: Add seat upgrade offers storage to COE model

**Tasks**:
1. Add `seat_upgrade_offers` field to COE schema
2. Add validation
3. Add indexes if needed

**Deliverables**:
- COE model supports storing upgrade offers
- Offers persist in database

**Technical Details**:

```javascript
// models/COE.js

// Add to COE schema (after selected_seats field):

// Seat upgrade offers (only for draft COEs)
seat_upgrade_offers: [{
  current_seat_id: { 
    type: mongoose.Schema.Types.ObjectId,
    required: true
  },
  current_seat_code: { 
    type: String,
    required: true
  },
  event_id: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Event',
    required: true
  },
  event_name: {
    type: String
  },
  current_price: {
    type: Number,
    min: 0
  },
  alternatives: [{
    seat_id: { 
      type: mongoose.Schema.Types.ObjectId,
      required: true
    },
    seat_code: { 
      type: String,
      required: true
    },
    capacity: {
      type: Number,
      min: 1
    },
    event_price: {
      type: Number,
      min: 0,
      required: true
    },
    base_price: {
      type: Number,
      min: 0
    },
    price_delta: {
      type: Number,
      required: true
    },
    price_delta_percentage: {
      type: String
    },
    upgrade_reasons: [{
      type: String
    }],
    sentiment: [{
      text: { type: String },
      type: { 
        type: String, 
        enum: ['A', 'B'] 
      }
    }],
    category: {
      type: String
    },
    section: {
      type: String
    },
    media: [{
      type: { 
        type: String, 
        enum: ['image', 'video'] 
      },
      url: { type: String },
      caption: { type: String }
    }],
    offered_at: { 
      type: Date, 
      default: Date.now 
    },
    status: { 
      type: String, 
      enum: ['pending', 'accepted', 'rejected', 'expired'],
      default: 'pending'
    }
  }],
  generated_at: { 
    type: Date, 
    default: Date.now 
  },
  expires_at: { 
    type: Date 
  } // Optional: offers expire when COE moves out of draft
}]
```

---

### Phase 4: Bot Response Formatting

**Goal**: Format upgrade offers for frontend display

**Tasks**:
1. Add `formatSeatUpgradeOffersResponse()` to `botResponseFormatter.js`
2. Update `isStructuredResponse()` to include new type
3. Export function

**Deliverables**:
- Upgrade offers formatted as structured response
- Frontend can detect and render offers

**Technical Details**:

```javascript
// services/botResponseFormatter.js

/**
 * Format seat upgrade offers response
 * @param {Object} coe - COE object
 * @param {Array} offers - Upgrade offers array
 * @param {string} message - Optional message
 * @returns {Object} Structured response
 */
function formatSeatUpgradeOffersResponse(coe, offers, message) {
  return {
    type: 'seat_upgrade_offers',
    coe_id: coe._id?.toString() || coe.id,
    message: message || 'We found some premium seating options that might interest you!',
    offers: offers.map(offer => ({
      current_seat: {
        seat_id: offer.current_seat_id,
        seat_code: offer.current_seat_code,
        event_id: offer.event_id,
        event_name: offer.event_name,
        current_price: offer.current_price
      },
      alternatives: offer.alternatives.map(alt => ({
        seat_id: alt.seat_id?.toString() || alt.seat_id,
        seat_code: alt.seat_code,
        capacity: alt.capacity,
        price: alt.event_price,
        base_price: alt.base_price,
        price_delta: alt.price_delta,
        price_delta_percentage: alt.price_delta_percentage,
        upgrade_reasons: alt.upgrade_reasons,
        sentiment: alt.sentiment,
        category: alt.category,
        section: alt.section,
        media: alt.media
      }))
    }))
  };
}

// Update isStructuredResponse
function isStructuredResponse(response) {
  if (!response || typeof response !== 'object') return false;
  return response.type && [
    'coe_created', 'coe_updated', 'coe_details', 'coe_draft', 'coe_list', 
    'event_list', 'location_list', 'coe_preferences_form', 'error', 
    'user_profile', 'client_list', 'seat_upgrade_offers' // Add new type
  ].includes(response.type);
}
```

---

### Phase 5: Frontend Rendering

**Goal**: Display upgrade offers in bot interface

**Tasks**:
1. Add `renderSeatUpgradeOffers()` function in `dashboard.ejs`
2. Add CSS styling for upgrade cards
3. Add accept/reject button handlers
4. Update `renderBotMessages()` to handle new type

**Deliverables**:
- Upgrade offers displayed as interactive cards
- Users can accept or reject offers
- Visual comparison between current and upgrade seats

**UI/UX Design**:

```
┌─────────────────────────────────────────────────────┐
│  Premium Seating Upgrade Available                  │
├─────────────────────────────────────────────────────┤
│  Event: Club X - Friday Night                      │
│                                                      │
│  Current Seat:                                      │
│  • Lower Dance Floor (LDF-12)                       │
│  • $500                                             │
│                                                      │
│  ────────────────────────────────────────────────  │
│                                                      │
│  Upgrade Option:                                    │
│  • Upper Dance Floor (UDF-05)                       │
│  • $750 (+$250 / +50%)                              │
│  • Premium tier 4 seating                           │
│  • Better view                                      │
│  • VIP section                                      │
│                                                      │
│  [Upgrade]  [Keep Current]                          │
└─────────────────────────────────────────────────────┘
```

**Technical Details**:

```javascript
// views/test/dashboard.ejs

function renderSeatUpgradeOffers(offersData) {
  const container = document.createElement('div');
  container.className = 'bot-structured-card bot-upgrade-offers';
  
  let html = `
    <div class="upgrade-offers-header">
      <h3>Premium Seating Upgrades Available</h3>
      <p>${offersData.message || 'We found some premium seating options!'}</p>
    </div>
  `;
  
  offersData.offers.forEach((offer, offerIndex) => {
    html += `
      <div class="upgrade-offer-card">
        <div class="upgrade-offer-event">
          <strong>${offer.current_seat.event_name}</strong>
        </div>
        
        <div class="upgrade-offer-comparison">
          <div class="current-seat">
            <div class="seat-label">Current Seat</div>
            <div class="seat-code">${offer.current_seat.seat_code}</div>
            <div class="seat-price">$${offer.current_seat.current_price.toLocaleString()}</div>
          </div>
          
          <div class="upgrade-arrow">→</div>
          
          ${offer.alternatives.map((alt, altIndex) => `
            <div class="upgrade-seat">
              <div class="seat-label">Upgrade Option</div>
              <div class="seat-code">${alt.seat_code}</div>
              <div class="seat-price">$${alt.price.toLocaleString()}</div>
              <div class="price-delta ${alt.price_delta > 0 ? 'positive' : ''}">
                ${alt.price_delta > 0 ? '+' : ''}$${alt.price_delta.toLocaleString()}
                ${alt.price_delta_percentage ? `(${alt.price_delta_percentage}%)` : ''}
              </div>
              
              ${alt.upgrade_reasons.length > 0 ? `
                <div class="upgrade-reasons">
                  ${alt.upgrade_reasons.map(reason => `
                    <span class="upgrade-reason-badge">${reason}</span>
                  `).join('')}
                </div>
              ` : ''}
              
              ${alt.sentiment.length > 0 ? `
                <div class="upgrade-sentiment">
                  ${alt.sentiment.map(sent => `
                    <span class="sentiment-badge type-${sent.type.toLowerCase()}">
                      ${sent.text || `Type ${sent.type}`}
                    </span>
                  `).join('')}
                </div>
              ` : ''}
              
              <button 
                class="btn-upgrade" 
                onclick="handleAcceptUpgrade('${offersData.coe_id}', '${offer.current_seat.seat_id}', '${alt.seat_id}', '${offer.current_seat.event_id}')"
              >
                Upgrade
              </button>
            </div>
          `).join('')}
        </div>
        
        <button 
          class="btn-keep-current" 
          onclick="handleRejectUpgrade('${offersData.coe_id}', '${offer.current_seat.seat_id}')"
        >
          Keep Current Seat
        </button>
      </div>
    `;
  });
  
  container.innerHTML = html;
  return container;
}

function handleAcceptUpgrade(coeId, currentSeatId, upgradeSeatId, eventId) {
  // Call API to accept upgrade
  // Update COE with new seat
  // Recalculate pricing
  // Refresh COE display
}

function handleRejectUpgrade(coeId, seatId) {
  // Mark offer as rejected
  // Hide upgrade card
}
```

---

### Phase 6: API Endpoints (Client + Admin Flows)

We currently have two main API surfaces for upgrades:

1. **Client acceptance of pre-generated offers**  
   - `POST /v1/coes/:id/seat-upgrades/accept`  
   - Body: `{ current_seat_id, alternative_seat_id, event_id }`  
   - Delegates to `coeService.acceptSeatUpgrade(...)`, which:
     - Validates COE status (`draft` / `request`).
     - Validates that the requested alternative exists in `seat_upgrade_offers`.
     - Swaps the seat in `selected_seats`, marks the alternative as `accepted`, and recalculates COE totals.

2. **Admin free-choice seat change for a specific event**  
   - `POST /v1/coes/:id/admin/seat-upgrade`  
   - Protected by `authenticateToken` + `requireAdmin`.  
   - Body:  
     ```json
     {
       "current_seat_id": "<event seat _id currently in selected_seats>",
       "new_seat_id": "<target event seat _id>",
       "event_id": "<event id>"
     }
     ```
   - Delegates to `coeService.adminReplaceSeat(coeId, currentSeatId, newSeatId, eventId)`, which:
     - Ensures the triggering COE exists and is in `draft` or `request`.
     - Loads the Event and validates that the **new seat exists and is `available`**.
     - Detects whether the old seat is:
       - A **single‑COE seat** (no `merged_coe_ids`) – or  
       - A **merged seat** with `booking_reference` + `merged_coe_ids` (multiple COEs sharing one table).
     - **Single‑COE path** (no merge):
       - Releases only this COE’s previous seat back to `available`.
       - Updates this COE’s `selected_seats` entry to the new seat.
       - Clears stale `seat_upgrade_offers` for that event on this COE.
       - Recalculates this COE’s totals and holds the new seat using `updateSelectedSeatsStatus`.
     - **Merged‑group path**:
       - Builds the **merge group** from the event seat’s `booking_reference` (primary COE) and `merged_coe_ids` (other COEs), plus the triggering COE id.
       - Uses `Event.bulkWrite` to:
         - Set the old seat to `status: 'available'` and clear all booking/merge metadata.
         - Set the new seat to `status: 'held'`, `booking_reference = primary COE id`, and `merged_coe_ids = [other COE ids]`, preserving `booked_by`.
       - For **each COE in the group**:
         - Finds the `selected_seats` entry for this `event_id` + old `seat_id` and rewrites it to the new seat (code, capacity, price).
         - Marks `is_merged_booking = true` and `primary_coe_id = primary COE id`.
         - Clears stale `seat_upgrade_offers` for that event.
         - Recalculates `subtotal` and `total`, then saves the COE.
       - Returns the fully populated COE for the one that triggered the upgrade.

This split keeps the **client** experience based on curated upgrade offers, while giving **admins** a direct “pick any available table for this event” workflow that properly releases the old table back into inventory.

---

## Data Flow

```
┌─────────────────────────────────────────────────────────────┐
│ User Creates COE via Bot                                    │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ COE Created in Draft Status                                  │
│ - Selected seats stored                                     │
│ - Pricing calculated                                        │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ Phase 2: Generate Upgrade Offers                            │
│ - For each selected seat:                                   │
│   1. Get event and location                                 │
│   2. Find better seats using sentiment                     │
│   3. Calculate upgrade value                                │
│   4. Generate upgrade reasons                               │
│ - Store offers in COE.seat_upgrade_offers                   │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ Phase 4: Format as Structured Response                     │
│ - Include offers in bot response                            │
│ - Type: 'seat_upgrade_offers'                               │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ Phase 5: Frontend Rendering                                 │
│ - Display upgrade cards                                     │
│ - Show current vs. upgrade comparison                       │
│ - Accept/Reject buttons                                     │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ User Accepts Upgrade                                        │
│ - Replace seat in COE                                       │
│ - Recalculate pricing                                       │
│ - Update offer status                                       │
│ - Release old seat, hold new seat                          │
└─────────────────────────────────────────────────────────────┘
```

---

## Sentiment Quality Scoring Algorithm

### Scoring Components

The **current implementation** intentionally keeps scoring simple and driven by the `qualityScore` field plus explicit sentiment tags on `location.seats`.

1. **Base quality (10–100 points)**
   - `qualityScore` is stored on each `location.seats[]` entry (typically `1–10`).
   - We compute:  
     \[
     \text{baseScore} = (\text{qualityScore} \text{ or } 5) \times 10
     \]
   - If no `qualityScore` is present, we default to `5` → base score `50`.

2. **Sentiment Type bonuses**
   - For each sentiment attached to the location seat:
     - Type **A** → `+5` points.
     - Type **B** → `+2` points.
   - There is no hard cap; all sentiments are counted.

3. **Final score**
   - Final quality score is simply:
     \[
     \text{finalScore} = \text{baseScore} + \text{sentimentBonus}
     \]

4. **Upgrade threshold (clients)**
   - For clients, a candidate counts as an upgrade if:
     - `seatScore > currentScore` **OR**
     - `seatPrice > currentPrice`.
   - For admins, we **do not** require `seatScore > currentScore`; all filtered seats are shown and scored, and the UX uses price/score/budget tags to help the admin decide.

---

## Edge Cases and Error Handling

### Edge Cases

1. **No Better Seats Available**
   - If no seats meet criteria, return empty offers array
   - Don't show upgrade section in UI

2. **Seat Becomes Unavailable**
   - When accepting upgrade, check seat is still available
   - If unavailable, return error and suggest alternatives

3. **Multiple Upgrades for Same Seat**
   - Show all alternatives (up to 3)
   - User can choose which upgrade to accept

4. **COE Status Changes**
   - Offers expire when COE moves out of draft
   - Clear offers when COE is approved/sent

5. **Budget Constraints**
   - Optional: Filter upgrades that exceed budget by more than X%
   - Or: Show all upgrades but warn if over budget

6. **No Sentiment Data**
   - Fallback to price tier and category only
   - Still generate offers if seats have higher price tier

### Error Handling

- **Seat Not Found**: Log error, skip that seat
- **Event Not Found**: Log error, skip that event
- **Location Not Populated**: Fetch location before processing
- **Offer Generation Fails**: Don't fail COE creation, log error
- **Upgrade Acceptance Fails**: Return error, don't update COE

---

## Testing Scenarios

### Test Case 1: Basic Upgrade Offer
- **Setup**: COE with lower dance floor seat
- **Expected**: System offers upper dance floor seat
- **Verify**: Offer includes price delta and upgrade reasons

### Test Case 2: Multiple Alternatives
- **Setup**: COE with backwall seat
- **Expected**: System offers 2-3 better alternatives
- **Verify**: All alternatives shown, sorted by quality

### Test Case 3: No Upgrades Available
- **Setup**: COE with owner_tables seat (highest tier)
- **Expected**: No upgrade offers generated
- **Verify**: COE created without offers

### Test Case 4: Accept Upgrade
- **Setup**: COE with upgrade offers
- **Action**: User accepts upgrade
- **Expected**: 
  - Seat replaced in COE
  - Pricing recalculated
  - Old seat released, new seat held
  - Offer status updated

### Test Case 5: Reject Upgrade
- **Setup**: COE with upgrade offers
- **Action**: User rejects upgrade
- **Expected**: Offer marked as rejected, COE unchanged

### Test Case 6: Seat Unavailable on Accept
- **Setup**: Upgrade offer exists
- **Action**: Another user books the upgrade seat
- **Action**: User tries to accept
- **Expected**: Error message, suggest other alternatives

---

## Success Criteria

1. ✅ System identifies better seats using sentiment data
2. ✅ Offers generated automatically after COE creation
3. ✅ Offers displayed in bot response as structured cards
4. ✅ Users can accept upgrades with one click
5. ✅ COE pricing updates correctly when upgrade accepted
6. ✅ Offers only available for draft COEs
7. ✅ Upgrade reasons clearly explain value proposition
8. ✅ Price differences clearly displayed
9. ✅ Old seats released, new seats held correctly
10. ✅ Error handling works for edge cases

---

## Dependencies

- Existing COE model and service
- Location seat sentiment data
- Event seat availability
- Bot response formatter
- Frontend bot interface

---

## Timeline Estimate

- **Phase 1**: 2-3 days (Seat comparison service)
- **Phase 2**: 1-2 days (Offer generation integration)
- **Phase 3**: 1 day (COE model enhancement)
- **Phase 4**: 1 day (Response formatting)
- **Phase 5**: 2-3 days (Frontend rendering)
- **Phase 6**: 1-2 days (API endpoints - optional)
- **Testing**: 1-2 days
- **Total**: 9-14 days

---

## Related Documentation

- [Bot Architecture Plan](../architecture/bot-architecture-plan.md) - Overall bot system
- [COE Specification](../architecture/coe-specification.md) - COE data model
- [Bot COE Creation Stage 2](../architecture/bot-coe-creation-stage2.md) - COE creation flow

---

## TODO / Future Enhancements

- [ ] **Admin seat selection UX**: In the mobile `seat-upgrades` screen, add explicit sorting controls (e.g. sort by price ascending/descending, by quality score, or by capacity) so admins can quickly find the right table when many are available.
- [ ] **Visual grouping for admin view**: Group available seats by `section` / `category` (e.g. “Dance Floor”, “Upper Level”, “Owner Tables”) with sticky headers to make scanning large inventories easier.
- [ ] **Highlight current vs target seat**: In the admin list, visually indicate which seat is currently held for the COE (e.g. “Current table” badge) and highlight potential conflicts such as seats already used in merges.
- [ ] **Budget awareness in client UI**: Surface the `Within Budget` vs `Premium Upgrade` tags in the client-facing upgrade cards, and optionally add a filter toggle to hide/show “Premium Upgrade” options.
- [ ] **Audit / logging view**: Add an internal report or log view showing when upgrades were accepted/changed (client vs admin), including old/new seat codes and price deltas, to help debug and review decisions.

---

## Notes

- Offers are automatically generated but can be manually triggered via API
- Offers expire when COE moves out of draft status
- Optional: Add time-based expiration (e.g., 7 days)
- Future: Could add "suggested upgrades" even if not strictly "better" (e.g., different style)
- Future: Could allow admins to manually add upgrade offers

