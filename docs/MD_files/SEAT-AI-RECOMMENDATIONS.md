# AI-Generated Table Recommendations Based on Sentiments

## Overview
Generate short, compelling recommendations/descriptions for each table (selected seats and upgrade options) using OpenAI API, based on the table's sentiment data. These recommendations will help clients understand why a particular table is a good choice for their experience.

## Goals
- Generate personalized recommendations for each table based on its sentiments
- Display recommendations in the seat carousel (both selected seats and upgrade options)
- Cache recommendations to reduce API costs and improve performance
- Provide fallback text when API fails or sentiments are unavailable

## Current State

### Data Structure
- **Sentiment Storage**: Seats have `sentiment[]` array with structure:
  ```javascript
  {
    text: String,        // Sentiment description
    type: 'A' | 'B',     // A = positive, B = negative/consideration
    updatedBy: ObjectId, // User who added the sentiment
    updatedAt: Date      // Timestamp
  }
  ```
- **Location**: Stored in `Location.seats[].sentiment[]`
- **OpenAI Integration**: Already configured in `services/botService.js` using `gpt-4o-mini`

### Display Location
- Carousel slides in COE cards showing selected seats
- Upgrade option slides in the same carousel
- Currently displays: seat code, capacity, prices, media, status

## Implementation Plan

### 1. Data Flow & Storage

#### Storage Strategy
**Option A (Recommended)**: Store in COE's `selected_seats[]` subdocument
- **Field**: `ai_recommendation: String`
- **Additional Fields**:
  - `recommendation_generated_at: Date`
  - `recommendation_version: Number` (for cache invalidation)
- **Pros**:
  - COE-specific recommendations
  - Can be regenerated if sentiments change
  - No impact on shared location data
- **Cons**:
  - Requires schema update
  - Stored per COE (not reusable)

**Option B**: Store in `Location.seats[]` (shared cache)
- **Field**: `ai_recommendation: String` in `SeatSchema`
- **Pros**:
  - Reusable across COEs
  - No schema change needed for COE
- **Cons**:
  - Not COE-specific
  - May need regeneration if sentiments change

**Recommendation**: Use **Option A** with in-memory caching for performance

### 2. Generation Strategy

#### When to Generate
1. **On COE Creation/Update** (Primary):
   - Generate recommendations when COE is created via bot
   - Regenerate if sentiments are updated
   - Background generation to avoid blocking

2. **Lazy Loading** (Fallback):
   - Generate on-demand when COE is displayed
   - Use cached version if available
   - Fallback to generic text if generation fails

#### Caching Strategy
- **Cache Key**: `seat_recommendation_${locationId}_${seatCode}_${sentimentHash}`
- **Cache Duration**: 24 hours or until sentiments change
- **Cache Storage**: In-memory Map (Redis optional for production)
- **Regeneration Trigger**: When sentiments are added/updated

### 3. AI Service Implementation

#### New Service File
**File**: `services/seatRecommendationService.js`

#### Core Function
```javascript
/**
 * Generate AI recommendation for a seat based on its sentiments
 * @param {Object} seatData - Seat data including code, category, capacity
 * @param {Array} sentiments - Array of sentiment objects
 * @param {Object} options - Options for generation
 * @returns {Promise<string>} Generated recommendation text
 */
async function generateSeatRecommendation(seatData, sentiments, options = {})
```

#### OpenAI Prompt Template
```
Generate a short, compelling recommendation (2-3 sentences, max 150 characters) 
for this table/seat based on the following sentiments:

Sentiments:
[For each sentiment, list:
- Type A (Positive): [sentiment.text]
- Type B (Consideration): [sentiment.text]]

Table Details:
- Code: [seat.code]
- Category: [seat.category]
- Capacity: [seat.capacity]
- Section: [seat.section] (if available)

The recommendation should:
- Highlight positive aspects (Type A sentiments)
- Mention any considerations (Type B sentiments) if relevant, but frame them neutrally
- Be engaging and help the client understand why this table is a good choice
- Use natural, conversational language
- Be concise (max 150 characters)
- Focus on the experience and atmosphere

Example format:
"This premium table offers [positive aspect from Type A]. [Additional benefit]. Perfect for [use case based on capacity/category]."
```

#### Configuration
- **Model**: `gpt-4o-mini` (same as bot service)
- **Temperature**: `0.7` (balanced creativity)
- **Max Tokens**: `100` (keep it short)
- **Timeout**: `5 seconds`

#### Error Handling
- **API Failures**: Return fallback text: "Premium seating option with excellent amenities"
- **No Sentiments**: Return generic: "A great choice for your experience"
- **Rate Limiting**: Queue requests, return cached version if available
- **Timeout**: Return cached/generic text after 5 seconds

### 4. Schema Updates

#### COE Model (`models/COE.js`)
Add to `selected_seats[]` subdocument:
```javascript
selected_seats: [{
  // ... existing fields ...
  ai_recommendation: {
    type: String,
    trim: true,
    maxlength: 200
  },
  recommendation_generated_at: {
    type: Date
  },
  recommendation_version: {
    type: Number,
    default: 1
  }
}]
```

#### Location Model (Optional Cache)
Add to `SeatSchema` in `models/Location.js`:
```javascript
ai_recommendation: {
  type: String,
  trim: true,
  maxlength: 200
},
recommendation_cache_key: {
  type: String,
  trim: true
}
```

### 5. Backend Integration Points

#### COE Creation Flow
**File**: `services/botToolHandlers.js`
**Function**: `handleCreateCOEDraft`

**Integration Point**:
```javascript
// After seat selection in handleCreateCOEDraft
// Generate recommendations for all selected seats
if (selectedSeats && selectedSeats.length > 0) {
  const recommendations = await Promise.all(
    selectedSeats.map(async (seat) => {
      const locationSeat = location.seats.find(s => s.code === seat.seat_code);
      const sentiments = locationSeat?.sentiment || [];
      
      if (sentiments.length > 0) {
        try {
          const recommendation = await generateSeatRecommendation(
            { code: seat.seat_code, category: locationSeat.category, capacity: seat.capacity },
            sentiments
          );
          return {
            seat_code: seat.seat_code,
            recommendation: recommendation,
            generated_at: new Date(),
            version: 1
          };
        } catch (error) {
          console.error('[SEAT_RECOMMENDATION] Generation failed:', error);
          return {
            seat_code: seat.seat_code,
            recommendation: 'Premium seating option with excellent amenities',
            generated_at: new Date(),
            version: 1
          };
        }
      }
      return null;
    })
  );
  
  // Attach recommendations to selected seats
  selectedSeats.forEach((seat, index) => {
    const rec = recommendations[index];
    if (rec) {
      seat.ai_recommendation = rec.recommendation;
      seat.recommendation_generated_at = rec.generated_at;
      seat.recommendation_version = rec.version;
    }
  });
}
```

#### COE Update Flow
**File**: `services/coeService.js`
**Function**: `updateCOE`

**Integration Point**:
- Check if sentiments changed (compare sentiment hash)
- Regenerate recommendations if sentiments updated
- Update `recommendation_version` to invalidate cache

#### Response Formatting
**File**: `services/botResponseFormatter.js`
**Function**: `formatCOEResponse`

**Integration Point**:
- Include `ai_recommendation` in seat objects when formatting COE response
- Ensure recommendations are included for both selected seats and upgrade options

### 6. Frontend Display

#### Location in UI
- **Carousel Slides**: Display recommendation below seat details, above media
- **Styling**: 
  - Font size: `0.75rem`
  - Color: `#94a3b8` (muted gray)
  - Font style: `italic`
  - Line height: `1.4`
  - Max height: `3rem` with `overflow: hidden` and `text-overflow: ellipsis`
  - Padding: `8px 0`

#### HTML Structure
```html
<div class="coe-seat-recommendation">
  <div class="coe-seat-recommendation-icon">💡</div>
  <div class="coe-seat-recommendation-text">
    ${seat.ai_recommendation || 'Premium seating option with excellent amenities'}
  </div>
</div>
```

#### CSS Styling
```css
.coe-seat-recommendation {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  margin-top: 8px;
  padding: 8px;
  background: rgba(59, 130, 246, 0.05);
  border-left: 2px solid rgba(59, 130, 246, 0.3);
  border-radius: 4px;
}

.coe-seat-recommendation-icon {
  font-size: 0.9rem;
  flex-shrink: 0;
  margin-top: 2px;
}

.coe-seat-recommendation-text {
  font-size: 0.75rem;
  color: #94a3b8;
  font-style: italic;
  line-height: 1.4;
  flex: 1;
  max-height: 3rem;
  overflow: hidden;
  text-overflow: ellipsis;
}
```

#### Integration Points
**File**: `views/test/dashboard.ejs`

1. **Selected Seat Display** (line ~7619):
   - Add recommendation after `coe-seat-costs`, before `seatMediaHtml`

2. **Upgrade Option Display** (line ~7667):
   - Add recommendation after `coe-seat-costs`, before upgrade reasons

### 7. Caching & Performance

#### Cache Implementation
**File**: `services/seatRecommendationService.js`

```javascript
// In-memory cache
const recommendationCache = new Map();

/**
 * Generate cache key
 */
function getCacheKey(locationId, seatCode, sentiments) {
  const sentimentHash = crypto
    .createHash('md5')
    .update(JSON.stringify(sentiments))
    .digest('hex')
    .substring(0, 8);
  return `seat_recommendation_${locationId}_${seatCode}_${sentimentHash}`;
}

/**
 * Get cached recommendation
 */
function getCachedRecommendation(cacheKey) {
  const cached = recommendationCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < 24 * 60 * 60 * 1000) {
    return cached.recommendation;
  }
  return null;
}

/**
 * Cache recommendation
 */
function cacheRecommendation(cacheKey, recommendation) {
  recommendationCache.set(cacheKey, {
    recommendation,
    timestamp: Date.now()
  });
}
```

#### Performance Optimizations
- **Batch Generation**: Generate multiple recommendations in parallel using `Promise.all()`
- **Cache First**: Check cache before calling OpenAI API
- **Timeout Protection**: 5-second timeout to prevent hanging requests
- **Rate Limiting**: Queue requests if OpenAI rate limit is hit

### 8. Error Handling

#### Error Scenarios
1. **OpenAI API Failure**:
   - Log error with context
   - Return fallback text
   - Continue with COE creation

2. **No Sentiments Available**:
   - Return generic recommendation
   - Don't block COE creation

3. **Rate Limiting**:
   - Queue request for later
   - Return cached version if available
   - Fallback to generic text

4. **Timeout**:
   - Return cached version
   - Fallback to generic text
   - Log timeout for monitoring

#### Fallback Text Options
- **With Sentiments**: "Premium seating option with excellent amenities"
- **No Sentiments**: "A great choice for your experience"
- **Error State**: "Premium table selection"

### 9. Cost Considerations

#### Estimated Costs
- **Model**: `gpt-4o-mini`
- **Cost per 1K tokens**: ~$0.15 input, $0.60 output
- **Average request**: ~200 tokens input, ~50 tokens output
- **Cost per recommendation**: ~$0.001 (0.1 cents)
- **Monthly estimate** (1000 COEs): ~$1.00

#### Cost Optimization
- **Caching**: Reduces API calls by ~80-90%
- **Batch Processing**: More efficient than individual calls
- **Model Selection**: Using `gpt-4o-mini` (cheapest option)

### 10. Implementation Steps

#### Phase 1: Service Creation
1. Create `services/seatRecommendationService.js`
2. Implement `generateSeatRecommendation()` function
3. Add caching mechanism
4. Add error handling and fallbacks
5. Write unit tests

#### Phase 2: Schema Updates
1. Update `models/COE.js` to add `ai_recommendation` fields
2. Run database migration (if needed)
3. Update validation schemas

#### Phase 3: Backend Integration
1. Integrate recommendation generation in `handleCreateCOEDraft`
2. Update `formatCOEResponse` to include recommendations
3. Add regeneration logic in COE update flow
4. Test with various sentiment combinations

#### Phase 4: Frontend Integration
1. Update `renderCOECard` to display recommendations
2. Add CSS styling for recommendation display
3. Test in carousel (selected seats and upgrade options)
4. Ensure responsive design

#### Phase 5: Testing & Optimization
1. Test with various sentiment combinations
2. Test error scenarios (API failure, no sentiments, timeout)
3. Verify caching works correctly
4. Monitor API costs and performance
5. Optimize prompt if needed

### 11. Files to Modify/Create

#### New Files
- `services/seatRecommendationService.js` - Core recommendation generation service

#### Modified Files
- `models/COE.js` - Add `ai_recommendation` fields to `selected_seats[]`
- `services/botToolHandlers.js` - Generate recommendations on COE creation
- `services/botResponseFormatter.js` - Include recommendations in COE response
- `views/test/dashboard.ejs` - Display recommendations in carousel slides

#### Optional Files
- `models/Location.js` - Add cache fields to `SeatSchema` (if using Option B)

### 12. Success Criteria

#### Functional Requirements
- ✅ Recommendations appear on all seat carousel slides (selected + upgrades)
- ✅ Recommendations are relevant to the seat's sentiments
- ✅ Fallback text displays when API fails or no sentiments available
- ✅ Caching reduces redundant API calls

#### Performance Requirements
- ✅ Generation completes in < 5 seconds
- ✅ Cache hit rate > 80%
- ✅ No blocking of COE creation flow

#### Quality Requirements
- ✅ Recommendations are concise (max 150 characters)
- ✅ Recommendations are engaging and helpful
- ✅ Recommendations highlight positive aspects appropriately
- ✅ Error handling doesn't break COE creation

### 13. Testing Scenarios

#### Test Cases
1. **COE with Sentiments**:
   - Create COE with seats that have Type A and Type B sentiments
   - Verify recommendations are generated and displayed
   - Verify recommendations mention positive aspects

2. **COE without Sentiments**:
   - Create COE with seats that have no sentiments
   - Verify generic fallback text is displayed

3. **API Failure**:
   - Simulate OpenAI API failure
   - Verify fallback text is used
   - Verify COE creation still succeeds

4. **Caching**:
   - Create COE with same seat twice
   - Verify second request uses cache
   - Verify cache expires after 24 hours

5. **Upgrade Options**:
   - Create COE with upgrade offers
   - Verify recommendations appear on upgrade option slides

6. **Multiple Seats**:
   - Create COE with multiple seats
   - Verify all seats get recommendations
   - Verify batch generation works correctly

### 14. Future Enhancements

#### Potential Improvements
1. **User Preferences Integration**:
   - Consider user preferences when generating recommendations
   - Personalize recommendations based on past COEs

2. **Multi-language Support**:
   - Generate recommendations in user's preferred language
   - Cache by language

3. **A/B Testing**:
   - Test different prompt variations
   - Measure user engagement with recommendations

4. **Analytics**:
   - Track which recommendations lead to upgrades
   - Optimize prompts based on conversion data

5. **Real-time Updates**:
   - Regenerate recommendations when sentiments are updated
   - Push updates to active COE views

## Notes
- Recommendations should be concise and engaging
- Always provide fallback text to ensure UI consistency
- Cache aggressively to reduce costs
- Monitor API usage and costs regularly
- Consider user experience - recommendations should add value, not clutter

