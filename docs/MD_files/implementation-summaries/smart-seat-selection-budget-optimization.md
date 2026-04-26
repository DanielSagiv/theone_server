# Smart Seat Selection & Budget Optimization

## Overview

This feature enhances COE creation by implementing intelligent seat selection that maximizes budget utilization while prioritizing quality, and always offers better upgrade options regardless of budget constraints.

---

## Objectives

| # | Objective | Description |
|---|-----------|-------------|
| 1 | **Quality First** | Select seats with best `qualityScore` + positive sentiment (Type A) |
| 2 | **Max Budget** | Fill budget as close to limit as possible |
| 3 | **Offer Better** | Always show upgrade offers for better seats, even if over budget |

---

## Implementation Phases

### Phase 1: Smart Initial Seat Selection (during COE creation)

**Current Behavior**: Picks first available seat that fits budget  
**New Behavior**: Score-based selection prioritizing quality + budget maximization

#### Selection Algorithm

```
For each event:
1. Get all available seats meeting capacity requirement
2. Score each seat using: qualityScore + sentimentBonus
3. Filter seats where price <= remaining budget
4. Pick highest-scoring seat that fits budget
5. If multiple seats have same score, prefer higher-priced to max out budget
```

#### Budget Maximization Example

```
User Budget: $10,000

Event 1 - Available seats:
  - Seat A: $2,000, score 8
  - Seat B: $3,500, score 7  
  - Seat C: $2,800, score 9

Selection: Seat C ($2,800, score 9) → Remaining: $7,200

Event 2 - Available seats:
  - Seat D: $3,000, score 8
  - Seat E: $4,500, score 8

Selection: Seat E ($4,500, score 8 - same score, higher price) → Remaining: $2,700

Event 3 - Available seats:
  - Seat F: $2,500, score 7
  - Seat G: $2,700, score 6

Selection: Seat F ($2,500, score 7) → Remaining: $200

Final COE Total: $9,800 (98% utilization)
```

### Phase 2: Generate Upgrade Offers (Always, Regardless of Budget)

**Current Behavior**: Only offers upgrades if they fit remaining budget  
**New Behavior**: Always offer better seats, clearly marking budget status

#### Offer Generation Logic

```
For each selected seat in COE:
1. Find ALL seats with:
   - Higher qualityScore, OR
   - Better sentiment (Type A), OR
   - Both
2. Include ALL better options regardless of price
3. Calculate price_delta for each alternative
4. Mark each offer with budget status:
   - fits_budget: true/false
   - tag: "Within Budget" | "Premium Upgrade"
5. Sort alternatives by: qualityScore DESC, then price ASC
```

#### Offer Tagging

| Condition | Tag | Color |
|-----------|-----|-------|
| `price_delta <= remaining_budget` | "Within Budget" | Green |
| `price_delta > remaining_budget` | "Premium Upgrade" | Gold |

### Phase 3: Response Structure Enhancement

#### COE Response with Budget Summary

```javascript
{
  type: "coe_created",
  coe: {
    _id: "...",
    name: "...",
    selected_seats: [...],
    subtotal: 9500,
    // ... other fields
  },
  budget_summary: {
    total_budget: 10000,
    coe_total: 9500,
    remaining: 500,
    utilization_percentage: 95
  },
  seat_upgrade_offers: [
    {
      current_seat_id: "...",
      current_seat_code: "T1",
      current_score: 7,
      current_price: 2000,
      event_id: "...",
      event_name: "Friday Night at XS",
      alternatives: [
        {
          seat_id: "...",
          seat_code: "T5",
          qualityScore: 9,
          event_price: 2800,
          price_delta: 800,
          price_delta_percentage: "+40%",
          fits_budget: false,
          tag: "Premium Upgrade",
          upgrade_reasons: [
            "Higher quality score (9 vs 7)",
            "Upper dance floor",
            "VIP sentiment"
          ],
          sentiment: [
            { text: "Upper dance floor", type: "A" }
          ]
        },
        {
          seat_id: "...",
          seat_code: "T3",
          qualityScore: 8,
          event_price: 2300,
          price_delta: 300,
          price_delta_percentage: "+15%",
          fits_budget: true,
          tag: "Within Budget",
          upgrade_reasons: [
            "Higher quality score (8 vs 7)"
          ]
        }
      ]
    }
  ]
}
```

---

## Scoring Formula

### Total Score Calculation

```javascript
totalScore = (qualityScore * 10) + sentimentBonus

// qualityScore: 1-10 (from Location.seats.qualityScore)
// sentimentBonus: calculated from sentiment data
```

### Sentiment Bonus Calculation

| Condition | Bonus Points |
|-----------|--------------|
| Has Type A sentiment | +5 |
| Keyword: "VIP" | +2 |
| Keyword: "premium" | +2 |
| Keyword: "upper" | +2 |
| Keyword: "front" | +1 |
| Keyword: "center" | +1 |
| No sentiment | 0 |

### Example Score Calculations

```
Seat with qualityScore=8, Type A sentiment "Upper VIP section":
  Base: 8 * 10 = 80
  Type A: +5
  "upper": +2
  "VIP": +2
  Total: 89

Seat with qualityScore=6, no sentiment:
  Base: 6 * 10 = 60
  Total: 60

Seat with qualityScore=7, Type B sentiment "Standard seating":
  Base: 7 * 10 = 70
  Total: 70
```

---

## Files to Modify

| File | Changes |
|------|---------|
| `services/botAutoFillService.js` | Update `selectSeatsByBudgetAndCapacity` with score-based selection + budget maximization |
| `services/seatUpgradeService.js` | Remove budget filter, add `fits_budget` flag and `tag` to alternatives |
| `services/botResponseFormatter.js` | Add `budget_summary` object to COE response |
| `services/botToolHandlers.js` | Pass budget info to formatter |
| `views/test/dashboard.ejs` | Display budget utilization bar, style "Within Budget" vs "Premium Upgrade" tags |

---

## Detailed Implementation

### 1. botAutoFillService.js - selectSeatsByBudgetAndCapacity

```javascript
// New function to calculate seat score
function calculateSeatScore(seat, locationSeat) {
  const qualityScore = locationSeat?.qualityScore || seat.qualityScore || 5;
  let score = qualityScore * 10;
  
  // Add sentiment bonus
  const sentiment = locationSeat?.sentiment || [];
  const hasTypeA = sentiment.some(s => s.type === 'A');
  if (hasTypeA) score += 5;
  
  // Keyword bonuses
  const sentimentText = sentiment.map(s => s.text?.toLowerCase() || '').join(' ');
  if (sentimentText.includes('vip')) score += 2;
  if (sentimentText.includes('premium')) score += 2;
  if (sentimentText.includes('upper')) score += 2;
  if (sentimentText.includes('front')) score += 1;
  if (sentimentText.includes('center')) score += 1;
  
  return score;
}

// Updated selection logic
async function selectSeatsByBudgetAndCapacity(event, partySize, remainingBudget, location) {
  const availableSeats = event.seats.filter(s => 
    s.status === 'available' && 
    s.capacity >= partySize &&
    (s.event_price || s.min_spend || 0) <= remainingBudget
  );
  
  if (availableSeats.length === 0) return null;
  
  // Score all seats
  const scoredSeats = availableSeats.map(seat => {
    const locationSeat = location?.seats?.find(ls => ls.code === seat.code);
    return {
      seat,
      score: calculateSeatScore(seat, locationSeat),
      price: seat.event_price || seat.min_spend || 0
    };
  });
  
  // Sort by score DESC, then price DESC (to max budget)
  scoredSeats.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return b.price - a.price; // Higher price preferred to max budget
  });
  
  return scoredSeats[0].seat;
}
```

### 2. seatUpgradeService.js - findBetterSeats

```javascript
// Updated to always include better seats and add budget flags
function findBetterSeats(currentSeat, event, location, partySize, remainingBudget = 0) {
  const currentScore = scoreSeatQuality(currentSeat, location);
  const currentPrice = currentSeat.event_price || currentSeat.min_spend || 0;
  
  const betterSeats = event.seats
    .filter(seat => 
      seat.status === 'available' &&
      seat.capacity >= partySize &&
      seat._id.toString() !== currentSeat._id.toString()
    )
    .map(seat => {
      const score = scoreSeatQuality(seat, location);
      const price = seat.event_price || seat.min_spend || 0;
      const priceDelta = price - currentPrice;
      
      return {
        ...seat.toObject(),
        score,
        price_delta: priceDelta,
        fits_budget: priceDelta <= remainingBudget,
        tag: priceDelta <= remainingBudget ? 'Within Budget' : 'Premium Upgrade'
      };
    })
    .filter(seat => seat.score > currentScore) // Only better seats
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.price_delta - b.price_delta; // Cheaper first among same score
    })
    .slice(0, 5); // Top 5 alternatives
  
  return betterSeats;
}
```

### 3. botResponseFormatter.js - formatCOEResponse

```javascript
// Add budget_summary to response
function formatCOEResponse(coe, message, budgetInfo = null) {
  const response = {
    type: 'coe_created',
    coe: { ... },
    message
  };
  
  if (budgetInfo && budgetInfo.total_budget) {
    response.budget_summary = {
      total_budget: budgetInfo.total_budget,
      coe_total: coe.subtotal || 0,
      remaining: budgetInfo.total_budget - (coe.subtotal || 0),
      utilization_percentage: Math.round(((coe.subtotal || 0) / budgetInfo.total_budget) * 100)
    };
  }
  
  return response;
}
```

### 4. dashboard.ejs - UI Updates

```html
<!-- Budget Utilization Bar -->
<div class="budget-utilization">
  <div class="budget-bar">
    <div class="budget-fill" style="width: ${utilization}%"></div>
  </div>
  <span class="budget-text">
    $${coeTotal.toLocaleString()} / $${totalBudget.toLocaleString()} (${utilization}% utilized)
  </span>
</div>

<!-- Upgrade Offer Tags -->
<span class="upgrade-tag ${fits_budget ? 'within-budget' : 'premium-upgrade'}">
  ${tag}
</span>
```

```css
.upgrade-tag.within-budget {
  background: #10b981;
  color: white;
}

.upgrade-tag.premium-upgrade {
  background: linear-gradient(135deg, #f59e0b, #d97706);
  color: white;
}
```

---

## Testing Scenarios

### Scenario 1: Budget Maximization
- Budget: $10,000
- 3 events with multiple seat options
- Expected: System selects highest-scoring seats that maximize budget usage

### Scenario 2: Upgrade Offers Include Over-Budget Options
- COE total: $9,500, Remaining: $500
- Better seat costs +$800
- Expected: Offer shown with "Premium Upgrade" tag

### Scenario 3: Within Budget Upgrade Available
- COE total: $8,000, Remaining: $2,000
- Better seat costs +$500
- Expected: Offer shown with "Within Budget" tag

### Scenario 4: No Better Seats Available
- Current seat has highest qualityScore
- Expected: No upgrade offers shown for that seat

---

## Success Criteria

1. ✅ COE budget utilization ≥ 90% when possible
2. ✅ Selected seats have highest available qualityScore within budget
3. ✅ All better seats shown as upgrade offers (regardless of price)
4. ✅ Clear visual distinction between "Within Budget" and "Premium Upgrade" offers
5. ✅ Budget summary displayed with utilization percentage

---

## Timeline

| Phase | Task | Estimate |
|-------|------|----------|
| 1 | Update seat selection logic | 1 hour |
| 2 | Update upgrade offer generation | 30 min |
| 3 | Add budget summary to response | 30 min |
| 4 | Frontend UI updates | 1 hour |
| 5 | Testing | 30 min |
| **Total** | | **3.5 hours** |

