# COE Single Event Per Day & Enhanced Sentiment Matching

## Overview
Enhance the COE creation process to ensure that no two events are scheduled on the same day, and prioritize event selection based on sentiment matching quality.

## Goals
1. Prevent multiple events from being selected on the same calendar day
2. Prioritize event selection based on sentiment match scores
3. Ensure the best sentiment-matched events are selected when multiple options exist
4. Maintain existing functionality (budget constraints, capacity matching, exclusions)
5. Provide clear feedback when date conflicts prevent event selection

## Current State Analysis

### Existing Event Selection Logic
- **Location**: `services/botSentimentService.js` - `autoSelectEventsBySentiment`
- **Current Behavior**:
  - Selects events based on sentiment scores
  - Filters by budget and capacity
  - Applies location and seat exclusions
  - Does NOT check for same-day conflicts
  - May select multiple events on the same date

### Existing Sentiment Matching
- Uses OpenAI embeddings for sentiment-based matching
- Calculates similarity scores between user preferences and event/location sentiments
- Ranks events by sentiment score
- Falls back to basic matching if OpenAI is unavailable

## Implementation Plan

### Phase 1: Date Conflict Detection

#### 1.1 Add Date Normalization Helper
**Location**: `services/botSentimentService.js` or `utils/dateParser.js`

**Function**: `normalizeEventDate(event)`
```javascript
/**
 * Normalize event date to calendar day (YYYY-MM-DD) for comparison
 * @param {Object} event - Event object with start_datetime
 * @returns {string} Normalized date string (YYYY-MM-DD)
 */
```

**Logic**:
- Extract `start_datetime` from event
- Convert to Date object
- Format as YYYY-MM-DD (ignoring time)
- Handle timezone considerations
- Return normalized date string

#### 1.2 Add Date Conflict Check
**Location**: `services/botSentimentService.js`

**Function**: `hasDateConflict(event, selectedEvents)`
```javascript
/**
 * Check if an event conflicts with already selected events (same day)
 * @param {Object} event - Event to check
 * @param {Array} selectedEvents - Already selected events
 * @returns {boolean} True if conflict exists
 */
```

**Logic**:
1. Normalize the event's date
2. Check against normalized dates of selected events
3. Return true if any match

### Phase 2: Enhanced Sentiment-Based Selection

#### 2.1 Modify Event Selection Algorithm
**Location**: `services/botSentimentService.js` - `autoSelectEventsBySentiment`

**Current Flow**:
1. Filter events by date range
2. Filter by budget
3. Filter by location exclusions
4. Calculate sentiment scores
5. Sort by sentiment score
6. Select top N events

**New Flow**:
1. Filter events by date range
2. Filter by budget
3. Filter by location exclusions
4. Calculate sentiment scores
5. **Sort by sentiment score (descending)**
6. **For each event in sorted order:**
   - Check if date conflicts with already selected events
   - If no conflict, add to selected events
   - If conflict, skip and continue to next event
7. Continue until target number of events or budget exhausted

#### 2.2 Prioritize Higher Sentiment Scores
**Enhancement**:
- When multiple events have the same date, always select the one with the highest sentiment score
- If an event is skipped due to date conflict, log the reason and the alternative event that was selected instead
- Ensure the selection algorithm always picks the best available option for each unique date

### Phase 3: Integration Points

#### 3.1 Bot Tool Handler Integration
**Location**: `services/botToolHandlers.js` - `handleCreateCOEDraft`

**Changes**:
- Ensure `autoSelectEventsBySentiment` is called with proper parameters
- Verify that the returned events have no date conflicts
- Add validation to reject COE creation if date conflicts are detected (safety check)

#### 3.2 Fallback Selection Logic
**Location**: `services/botAutoFillService.js` - `findAlternativeEventsWithSeats`

**Changes**:
- Apply same date conflict logic to alternative event searches
- Ensure alternatives don't conflict with already selected events

### Phase 4: Error Handling & User Feedback

#### 4.1 Date Conflict Scenarios
**Scenarios to Handle**:
1. **All events in date range are on same day**: 
   - Select only the best sentiment-matched event
   - Provide clear message: "Selected the best matching event for [date]. Other events on the same day were excluded to avoid conflicts."

2. **Multiple events with same sentiment score on different days**:
   - Select one event per day, prioritizing by date order (earliest first) or other criteria

3. **Insufficient events after date conflict filtering**:
   - Provide diagnostic message explaining why fewer events were selected
   - Suggest expanding date range if needed

#### 4.2 Diagnostic Messages
**Add to diagnostics**:
- `DATE_CONFLICT_SKIPPED`: Event was skipped because another event is already selected for that day
- `BEST_MATCH_SELECTED`: Selected the best sentiment-matched event for a given date
- `SINGLE_EVENT_PER_DAY_ENFORCED`: System enforced one event per day rule

### Phase 5: Testing & Validation

#### 5.1 Test Cases
1. **Same Day Events**:
   - Create COE with date range containing multiple events on same day
   - Verify only one event per day is selected
   - Verify highest sentiment score event is chosen

2. **Multiple Days**:
   - Create COE with date range spanning multiple days
   - Verify one event per day is selected
   - Verify events are selected in order of sentiment score

3. **Sentiment Score Ties**:
   - Test scenario where multiple events have same sentiment score
   - Verify consistent selection (e.g., earliest date, or first in list)

4. **Budget Constraints**:
   - Verify date conflict logic doesn't break budget filtering
   - Ensure budget is respected even with date conflicts

5. **Edge Cases**:
   - Single day date range with multiple events
   - Date range with no events
   - Date range with events but all on same day

## Code Changes Summary

### Files to Modify

1. **`services/botSentimentService.js`**:
   - Add `normalizeEventDate(event)` helper function
   - Add `hasDateConflict(event, selectedEvents)` helper function
   - Modify `autoSelectEventsBySentiment` to:
     - Sort events by sentiment score (descending)
     - Check for date conflicts before adding to selection
     - Skip events with date conflicts
     - Log skipped events with reasons

2. **`services/botToolHandlers.js`**:
   - Add validation after event selection to ensure no date conflicts
   - Add diagnostic messages for date conflicts

3. **`services/botResponseFormatter.js`** (if needed):
   - Add diagnostic formatting for date conflict messages

4. **`utils/dateParser.js`** (if exists, or create):
   - Add date normalization utilities

### New Helper Functions

```javascript
/**
 * Normalize event date to calendar day for comparison
 * @param {Object} event - Event with start_datetime
 * @returns {string} YYYY-MM-DD format
 */
function normalizeEventDate(event) {
  if (!event.start_datetime) return null;
  const date = new Date(event.start_datetime);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Check if event conflicts with selected events (same day)
 * @param {Object} event - Event to check
 * @param {Array} selectedEvents - Already selected events
 * @returns {boolean} True if conflict exists
 */
function hasDateConflict(event, selectedEvents) {
  const eventDate = normalizeEventDate(event);
  if (!eventDate) return false;
  
  return selectedEvents.some(selected => {
    const selectedDate = normalizeEventDate(selected);
    return selectedDate === eventDate;
  });
}
```

### Modified Selection Algorithm

```javascript
// In autoSelectEventsBySentiment function:

// After calculating sentiment scores and sorting:
const selectedEvents = [];
const selectedDates = new Set(); // Track selected dates

for (const event of sortedEvents) {
  // Check date conflict
  const eventDate = normalizeEventDate(event);
  
  if (selectedDates.has(eventDate)) {
    // Skip - date conflict
    console.log(`[SENTIMENT_SELECTION] Skipping event ${event.name} - date conflict with already selected event`);
    continue;
  }
  
  // Check budget and other constraints
  if (meetsBudgetConstraints(event, remainingBudget) && 
      meetsCapacityRequirements(event, preferences)) {
    selectedEvents.push(event);
    selectedDates.add(eventDate);
    // Update remaining budget, etc.
  }
}
```

## Implementation Considerations

### 1. Do Not Harm Other Logic
- **Preserve existing functionality**:
  - Budget filtering must still work
  - Capacity matching must still work
  - Exclusion logic must still work
  - Sentiment scoring must still work
- **Isolate new functionality**:
  - Date conflict checking is additive
  - Does not change existing selection criteria
  - Only adds an additional filter step

### 2. Avoid Logic Duplications
- **Reuse existing date utilities**:
  - Use `parseAndNormalizeDate` from `utils/dateParser.js` if available
  - Reuse date comparison logic from existing code
- **Reuse sentiment scoring**:
  - No changes to sentiment calculation
  - Only change the selection order/priority

### 3. Keep Code Structure
- **Follow existing patterns**:
  - Match function naming conventions
  - Match error handling patterns
  - Match logging patterns
- **Maintain file organization**:
  - Add helpers to appropriate service files
  - Keep related functions together

### 4. Performance Considerations
- **Efficient date comparison**:
  - Use Set for O(1) date lookups
  - Normalize dates once, reuse normalized values
- **Minimal overhead**:
  - Date conflict check is O(n) where n = selected events (typically small)
  - Sentiment scoring already done, just reordering

## Edge Cases & Error Handling

### Edge Case 1: All Events on Same Day
**Scenario**: Date range contains 5 events, all on 2025-12-10
**Behavior**: Select only the event with highest sentiment score
**Message**: "Selected the best matching event for December 10, 2025. 4 other events on the same day were excluded."

### Edge Case 2: No Events After Date Conflict Filtering
**Scenario**: Date range has 2 events, both on same day, but budget only allows 1
**Behavior**: Select the best sentiment-matched event
**Message**: "Selected 1 event. 1 event was excluded due to same-day conflict."

### Edge Case 3: Sentiment Score Ties
**Scenario**: Two events on different days have identical sentiment scores
**Behavior**: Select both (different days, no conflict)
**Tie-breaker**: If same day, select earliest event or first in list

### Edge Case 4: Timezone Considerations
**Scenario**: Event in different timezone might appear on different calendar day
**Behavior**: Use event's local date (from start_datetime) for comparison
**Note**: Ensure consistent timezone handling

## Testing Plan

### Unit Tests
1. Test `normalizeEventDate` with various date formats
2. Test `hasDateConflict` with same/different dates
3. Test selection algorithm with date conflicts
4. Test sentiment score prioritization

### Integration Tests
1. Test full COE creation flow with same-day events
2. Test with multiple days and sentiment scores
3. Test budget constraints with date conflicts
4. Test exclusion logic with date conflicts

### Manual Testing
1. Create COE with date range containing same-day events
2. Verify only one event per day is selected
3. Verify highest sentiment score events are chosen
4. Verify diagnostic messages are clear
5. Test with various date ranges and event distributions

## Success Criteria

1. ✅ No two events are ever selected on the same calendar day
2. ✅ Events are selected in order of sentiment match quality
3. ✅ Best sentiment-matched event is chosen when conflicts exist
4. ✅ Existing functionality (budget, capacity, exclusions) still works
5. ✅ Clear diagnostic messages explain date conflict exclusions
6. ✅ Performance impact is minimal
7. ✅ Code follows existing patterns and structure

## Future Enhancements (Out of Scope)

- Allow user to override "one event per day" rule
- Support for multi-day events (spanning multiple calendar days)
- Time-based conflict detection (e.g., events too close in time)
- User preference for event spacing (e.g., "at least 2 days apart")

## Notes

- This enhancement applies to **bot-created COEs** (both user and admin)
- Manual COE creation from dashboard is not affected (admin can still manually add same-day events if needed)
- The enhancement is transparent to the user - they just get better event selection
- Diagnostic messages help explain why certain events weren't selected

