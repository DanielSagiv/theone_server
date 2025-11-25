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

A seat is considered "better" than the currently selected seat if it meets these criteria:

1. **Sentiment Quality**:
   - Type A sentiment > Type B sentiment
   - Higher `priceTier` (1-5 scale)
   - Positive sentiment keywords: "upper", "premium", "VIP", "exclusive", "better view"

2. **Category Hierarchy**:
   - `owner_tables` > `upper_dance` > `stage_tables` > `lower_dance` > `third_tier_couch` > `backwall`

3. **Capacity Match**:
   - Same or higher capacity than current seat
   - Meets party size requirements

4. **Availability**:
   - Seat status is `'available'`
   - Seat is in the same event

5. **Price Consideration**:
   - May cost more (not a requirement, but expected for premium seats)
   - Price difference is reasonable (optional: max 50% increase)

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

### Phase 1: Seat Comparison Service (Backend Logic)

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

**Technical Details**:

```javascript
// services/seatUpgradeService.js

/**
 * Score a seat's quality based on sentiment, category, and price tier
 * @param {Object} seat - Seat object
 * @param {Object} location - Location with seat sentiments
 * @returns {number} Quality score (higher = better)
 */
function scoreSeatQuality(seat, location) {
  let score = 0;
  
  // Price tier (1-5, higher = better)
  score += (seat.priceTier || 1) * 10;
  
  // Get seat sentiment from location
  const locationSeat = location.seats.find(s => 
    s._id.toString() === seat.seat_id?.toString() || 
    s.code === seat.seat_code
  );
  
  if (locationSeat && locationSeat.sentiment) {
    locationSeat.sentiment.forEach(sent => {
      if (sent.type === 'A') score += 20;
      if (sent.type === 'B') score += 10;
    });
  }
  
  // Category hierarchy
  const categoryScores = {
    'owner_tables': 50,
    'upper_dance': 40,
    'stage_tables': 35,
    'lower_dance': 30,
    'third_tier_couch': 25,
    'backwall': 20,
    'four_tops': 15
  };
  score += categoryScores[seat.category] || 0;
  
  // Sentiment keywords
  if (locationSeat && locationSeat.sentiment) {
    const sentimentText = locationSeat.sentiment
      .map(s => s.text)
      .join(' ')
      .toLowerCase();
    
    if (sentimentText.includes('upper')) score += 15;
    if (sentimentText.includes('premium')) score += 15;
    if (sentimentText.includes('vip')) score += 20;
    if (sentimentText.includes('exclusive')) score += 20;
    if (sentimentText.includes('better view')) score += 10;
    if (sentimentText.includes('best')) score += 15;
  }
  
  return score;
}

/**
 * Find better alternative seats for a given selected seat
 * @param {Object} currentSeat - Currently selected seat from COE
 * @param {Object} event - Event with all available seats
 * @param {Object} location - Location with seat sentiments
 * @param {number} partySize - Party size requirement
 * @returns {Array} Array of better alternative seats (sorted by quality)
 */
async function findBetterSeats(currentSeat, event, location, partySize = 2) {
  if (!event.seats || event.seats.length === 0) {
    return [];
  }
  
  // Get current seat's quality score
  const currentSeatLocation = location.seats.find(s => 
    s._id.toString() === currentSeat.seat_id?.toString() ||
    s.code === currentSeat.seat_code
  );
  
  if (!currentSeatLocation) {
    return []; // Can't compare if current seat not found in location
  }
  
  const currentScore = scoreSeatQuality(
    { ...currentSeat, seat_id: currentSeat.seat_id },
    location
  );
  
  // Find all available seats in the same event
  const availableSeats = event.seats.filter(seat => 
    seat.status === 'available' &&
    seat.capacity >= partySize &&
    // Exclude the current seat
    seat._id.toString() !== currentSeat.seat_id?.toString() &&
    seat.code !== currentSeat.seat_code
  );
  
  // Score and filter better seats
  const betterSeats = availableSeats
    .map(seat => {
      const locationSeat = location.seats.find(s => 
        s._id.toString() === seat.seat_id?.toString() ||
        s.code === seat.code
      );
      
      if (!locationSeat) return null;
      
      const seatScore = scoreSeatQuality(
        { ...seat, seat_id: seat._id },
        location
      );
      
      return {
        seat,
        locationSeat,
        score: seatScore,
        isBetter: seatScore > currentScore
      };
    })
    .filter(item => item && item.isBetter)
    .sort((a, b) => b.score - a.score) // Sort by quality (best first)
    .slice(0, 3) // Top 3 alternatives
    .map(item => item.seat);
  
  return betterSeats;
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

### Phase 2: Offer Generation After COE Creation

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

### Phase 6: API Endpoints (Optional - For Manual Triggers)

**Goal**: Allow manual triggering and management of upgrade offers

**Tasks**:
1. Add GET endpoint to retrieve offers
2. Add POST endpoint to accept upgrade
3. Add POST endpoint to reject upgrade
4. Add validation and error handling

**Deliverables**:
- API endpoints for upgrade management
- Manual trigger capability (optional)

**Technical Details**:

```javascript
// routes/coes.js

/**
 * GET /v1/coes/:id/seat-upgrades
 * Get available seat upgrade offers for a COE
 * Only available for draft COEs
 */
router.get('/:id/seat-upgrades', authenticateToken, async (req, res) => {
  try {
    const coe = await coeService.getCOEById(req.params.id);
    
    if (!coe) {
      return res.status(404).json({
        success: false,
        error: { code: 'COE_NOT_FOUND', message: 'COE not found' }
      });
    }
    
    // Only draft COEs can have upgrade offers
    if (coe.status !== 'draft') {
      return res.status(400).json({
        success: false,
        error: { 
          code: 'INVALID_STATUS', 
          message: 'Upgrade offers only available for draft COEs' 
        }
      });
    }
    
    // Permission check
    if (req.user.role === 'client' && coe.client_id.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        error: { code: 'PERMISSION_DENIED', message: 'Access denied' }
      });
    }
    
    // Generate offers if they don't exist
    let offers = coe.seat_upgrade_offers || [];
    if (offers.length === 0) {
      const { generateSeatUpgradeOffers } = require('../services/seatUpgradeService');
      offers = await generateSeatUpgradeOffers(coe);
      
      // Store in COE
      coe.seat_upgrade_offers = offers;
      await coe.save();
    }
    
    res.json({
      success: true,
      data: {
        coe_id: coe._id.toString(),
        offers: offers
      }
    });
  } catch (error) {
    console.error('Error getting seat upgrades:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to get upgrade offers' }
    });
  }
});

/**
 * POST /v1/coes/:id/seat-upgrades/accept
 * Accept a seat upgrade offer
 * Body: { current_seat_id, alternative_seat_id, event_id }
 */
router.post('/:id/seat-upgrades/accept', authenticateToken, async (req, res) => {
  try {
    const { current_seat_id, alternative_seat_id, event_id } = req.body;
    
    if (!current_seat_id || !alternative_seat_id || !event_id) {
      return res.status(400).json({
        success: false,
        error: { 
          code: 'VALIDATION_ERROR', 
          message: 'Missing required fields: current_seat_id, alternative_seat_id, event_id' 
        }
      });
    }
    
    const coe = await coeService.getCOEById(req.params.id);
    
    if (!coe) {
      return res.status(404).json({
        success: false,
        error: { code: 'COE_NOT_FOUND', message: 'COE not found' }
      });
    }
    
    if (coe.status !== 'draft') {
      return res.status(400).json({
        success: false,
        error: { 
          code: 'INVALID_STATUS', 
          message: 'Can only accept upgrades for draft COEs' 
        }
      });
    }
    
    // Permission check
    if (req.user.role === 'client' && coe.client_id.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        error: { code: 'PERMISSION_DENIED', message: 'Access denied' }
      });
    }
    
    // Find the offer
    const offer = coe.seat_upgrade_offers?.find(o => 
      o.current_seat_id.toString() === current_seat_id &&
      o.event_id.toString() === event_id
    );
    
    if (!offer) {
      return res.status(404).json({
        success: false,
        error: { code: 'OFFER_NOT_FOUND', message: 'Upgrade offer not found' }
      });
    }
    
    const alternative = offer.alternatives.find(alt =>
      alt.seat_id.toString() === alternative_seat_id
    );
    
    if (!alternative) {
      return res.status(404).json({
        success: false,
        error: { code: 'ALTERNATIVE_NOT_FOUND', message: 'Alternative seat not found in offer' }
      });
    }
    
    // Replace seat in COE
    const seatIndex = coe.selected_seats.findIndex(seat =>
      seat.seat_id.toString() === current_seat_id &&
      seat.event_id.toString() === event_id
    );
    
    if (seatIndex === -1) {
      return res.status(404).json({
        success: false,
        error: { code: 'SEAT_NOT_FOUND', message: 'Current seat not found in COE' }
      });
    }
    
    // Get event to get full seat details
    const Event = require('../models/Event');
    const event = await Event.findById(event_id)
      .populate('location_id', 'seats');
    
    if (!event) {
      return res.status(404).json({
        success: false,
        error: { code: 'EVENT_NOT_FOUND', message: 'Event not found' }
      });
    }
    
    const upgradeSeat = event.seats.find(s =>
      s._id.toString() === alternative_seat_id
    );
    
    if (!upgradeSeat || upgradeSeat.status !== 'available') {
      return res.status(400).json({
        success: false,
        error: { code: 'SEAT_UNAVAILABLE', message: 'Upgrade seat is no longer available' }
      });
    }
    
    // Update seat in COE
    const oldSeat = coe.selected_seats[seatIndex];
    coe.selected_seats[seatIndex] = {
      event_id: event_id,
      seat_id: upgradeSeat._id,
      seat_code: upgradeSeat.code,
      capacity: upgradeSeat.capacity,
      base_price: upgradeSeat.min_spend || 0,
      event_price: upgradeSeat.event_price || upgradeSeat.min_spend || 0,
      available_from: event.start_datetime,
      available_until: event.end_datetime || event.start_datetime,
      status: 'selected'
    };
    
    // Recalculate pricing
    const { autoFillCOEData } = require('../services/botAutoFillService');
    const updatedCoeData = await autoFillCOEData(
      {
        ...coe.toObject(),
        selected_seats: coe.selected_seats
      },
      {},
      []
    );
    
    coe.subtotal = updatedCoeData.subtotal;
    coe.taxes = updatedCoeData.taxes;
    coe.fees = updatedCoeData.fees;
    coe.total = updatedCoeData.total;
    coe.deposit_required = updatedCoeData.deposit_required;
    
    // Update offer status
    alternative.status = 'accepted';
    alternative.accepted_at = new Date();
    alternative.accepted_by = req.user._id;
    
    // Release old seat
    await releaseSeat(oldSeat.seat_id, oldSeat.event_id);
    
    // Hold new seat
    await holdSeat(upgradeSeat._id, event_id);
    
    await coe.save();
    
    // Get updated COE
    const updatedCOE = await coeService.getCOEById(coe._id);
    
    res.json({
      success: true,
      data: {
        coe: updatedCOE,
        upgrade: {
          old_seat: oldSeat,
          new_seat: coe.selected_seats[seatIndex],
          price_delta: alternative.price_delta
        }
      },
      message: 'Seat upgrade accepted successfully'
    });
  } catch (error) {
    console.error('Error accepting seat upgrade:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to accept upgrade' }
    });
  }
});

/**
 * POST /v1/coes/:id/seat-upgrades/reject
 * Reject a seat upgrade offer
 * Body: { current_seat_id, alternative_seat_id, event_id }
 */
router.post('/:id/seat-upgrades/reject', authenticateToken, async (req, res) => {
  try {
    const { current_seat_id, alternative_seat_id, event_id } = req.body;
    
    const coe = await coeService.getCOEById(req.params.id);
    
    if (!coe || coe.status !== 'draft') {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_STATUS', message: 'Can only reject upgrades for draft COEs' }
      });
    }
    
    // Find and mark offer as rejected
    const offer = coe.seat_upgrade_offers?.find(o => 
      o.current_seat_id.toString() === current_seat_id &&
      o.event_id.toString() === event_id
    );
    
    if (offer) {
      const alternative = offer.alternatives.find(alt =>
        alt.seat_id.toString() === alternative_seat_id
      );
      
      if (alternative) {
        alternative.status = 'rejected';
        alternative.rejected_at = new Date();
        await coe.save();
      }
    }
    
    res.json({
      success: true,
      message: 'Upgrade offer rejected'
    });
  } catch (error) {
    console.error('Error rejecting seat upgrade:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to reject upgrade' }
    });
  }
});
```

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

1. **Price Tier** (0-50 points)
   - Tier 1: 10 points
   - Tier 2: 20 points
   - Tier 3: 30 points
   - Tier 4: 40 points
   - Tier 5: 50 points

2. **Sentiment Type** (0-40 points)
   - Type A sentiment: +20 points each
   - Type B sentiment: +10 points each
   - Max 2 sentiments counted

3. **Category Hierarchy** (0-50 points)
   - `owner_tables`: 50 points
   - `upper_dance`: 40 points
   - `stage_tables`: 35 points
   - `lower_dance`: 30 points
   - `third_tier_couch`: 25 points
   - `backwall`: 20 points
   - `four_tops`: 15 points

4. **Sentiment Keywords** (0-60 points)
   - "upper": +15 points
   - "premium": +15 points
   - "VIP": +20 points
   - "exclusive": +20 points
   - "better view": +10 points
   - "best": +15 points

**Total Possible Score**: 200 points

**Upgrade Threshold**: A seat is considered "better" if its score is higher than the current seat's score.

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

## Notes

- Offers are automatically generated but can be manually triggered via API
- Offers expire when COE moves out of draft status
- Optional: Add time-based expiration (e.g., 7 days)
- Future: Could add "suggested upgrades" even if not strictly "better" (e.g., different style)
- Future: Could allow admins to manually add upgrade offers

