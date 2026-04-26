# Bot COE Creation: Pinpoint Seat Selection Diagnostics

## Overview

When creating a COE via the bot, if no seats are found, the system currently returns a generic error message: "We couldn't find any available seats/tables matching your preferences." This document outlines the implementation plan to provide **pinpoint diagnostic reasons** explaining exactly why seats weren't found.

## Problem Statement

### Current Behavior
- When `selectSeatsByBudgetAndCapacity` returns an empty array, no explanation is provided
- Users receive a generic error message without understanding the specific reason
- Multiple potential failure points exist, but only one generic message is shown

### User Impact
- Users cannot understand why their COE creation failed
- Users cannot adjust their preferences without knowing what to change
- Support requests increase due to lack of clarity

## Root Causes Analysis

The `selectSeatsByBudgetAndCapacity` function filters seats through multiple stages. At each stage, seats can be eliminated for specific reasons:

### 1. **No Seats in Event**
- **Reason**: Event has no seats defined
- **Location**: Line 163-165 in `botAutoFillService.js`
- **Diagnostic**: `{ reason: 'NO_SEATS_IN_EVENT', event_id, event_name }`

### 2. **No Available Seats (Status Filter)**
- **Reason**: All seats are booked, held, or blocked
- **Location**: Line 185-189 in `botAutoFillService.js`
- **Filter**: `seat.status === 'available'`
- **Diagnostic**: `{ reason: 'NO_AVAILABLE_SEATS', total_seats, available_count, booked_count, held_count, blocked_count }`

### 3. **Capacity Too Small**
- **Reason**: No seats can accommodate the party size
- **Location**: Line 187 in `botAutoFillService.js`
- **Filter**: `seat.capacity >= partySize`
- **Diagnostic**: `{ reason: 'CAPACITY_TOO_SMALL', party_size, max_capacity_found, seats_checked }`

### 4. **Budget Too Low**
- **Reason**: All seats exceed the budget
- **Location**: Line 188 in `botAutoFillService.js`
- **Filter**: `(seat.event_price || seat.min_spend || 0) <= budget`
- **Diagnostic**: `{ reason: 'BUDGET_TOO_LOW', budget, min_seat_price, max_seat_price, seats_checked }`

### 5. **Excluded by Sentiment Preferences**
- **Reason**: Seats match excluded sentiment keywords
- **Location**: Lines 192-226 in `botAutoFillService.js`
- **Filter**: Sentiment keyword matching
- **Diagnostic**: `{ reason: 'EXCLUDED_BY_PREFERENCES', exclusions, seats_excluded_count, matching_keywords }`

### 6. **Multiple Reasons (Combined)**
- **Reason**: Multiple filters eliminated all seats
- **Diagnostic**: `{ reason: 'MULTIPLE_FILTERS', details: [{ filter, count_eliminated }, ...] }`

## Implementation Plan

### Phase 1: Enhance `selectSeatsByBudgetAndCapacity` Function

**File**: `services/botAutoFillService.js`

**Changes**:
1. Add diagnostic tracking object to collect reasons
2. Track seat counts at each filtering stage
3. Return both selected seats AND diagnostics

**New Return Format**:
```javascript
{
  seats: [...], // Selected seats array (existing)
  diagnostics: {
    event_id: string,
    event_name: string,
    total_seats: number,
    party_size: number,
    budget: number,
    exclusions: string[],
    filtering_stages: {
      initial_count: number,
      after_status_filter: number,
      after_capacity_filter: number,
      after_budget_filter: number,
      after_exclusion_filter: number,
      final_count: number
    },
    primary_reason: string, // The main reason if no seats found
    secondary_reasons: string[], // Additional contributing factors
    details: {
      // Specific details based on primary reason
      no_available_seats?: {
        total: number,
        available: number,
        booked: number,
        held: number,
        blocked: number
      },
      capacity_too_small?: {
        party_size: number,
        max_capacity_found: number,
        seats_with_sufficient_capacity: number
      },
      budget_too_low?: {
        budget: number,
        min_seat_price: number,
        max_seat_price: number,
        seats_within_budget: number
      },
      excluded_by_preferences?: {
        exclusions: string[],
        seats_excluded: number,
        matching_keywords: string[]
      }
    }
  }
}
```

### Phase 2: Collect Diagnostics Across Multiple Events

**File**: `services/botToolHandlers.js`

**Changes**:
1. Collect diagnostics from each event's seat selection attempt
2. Aggregate reasons across all events
3. Identify the most common failure reason

**In `handleCreateCOEDraft`** (around line 586-644):
- For each event, capture diagnostics from `selectSeatsByBudgetAndCapacity`
- Store event-level diagnostics
- When no seats found, aggregate all event diagnostics

### Phase 3: Build Specific Error Messages

**File**: `services/botResponseFormatter.js`

**Changes**:
1. Enhance `formatNoSeatsAvailableError` function
2. Use diagnostics to build specific error messages
3. Include actionable suggestions based on the reason

**Error Message Examples**:

**Capacity Too Small**:
```
"We couldn't find any available seats/tables matching your preferences. 
The events in [City] don't have seats that accommodate [X] people. 
The largest available seat capacity is [Y] people."
```

**Budget Too Low**:
```
"We couldn't find any available seats/tables matching your preferences. 
All available seats exceed your budget of $[X]. 
The minimum seat price is $[Y]."
```

**No Available Seats**:
```
"We couldn't find any available seats/tables matching your preferences. 
All seats for the selected events are currently booked or reserved."
```

**Excluded by Preferences**:
```
"We couldn't find any available seats/tables matching your preferences. 
The available seats were excluded based on your preferences: [exclusion keywords]."
```

**Multiple Reasons**:
```
"We couldn't find any available seats/tables matching your preferences. 
The events in [City] don't have seats that accommodate [X] people within your budget of $[Y]."
```

### Phase 4: Update Error Response Structure

**File**: `services/botResponseFormatter.js`

**Enhanced Error Response**:
```javascript
{
  type: 'error',
  error_type: 'NO_SEATS_AVAILABLE',
  message: 'Specific reason message...',
  specific_reason: 'CAPACITY_TOO_SMALL', // Primary reason
  details: {
    searched_dates: { start, end },
    searched_city: string,
    budget_range: { min, max },
    party_size: number,
    primary_reason: string,
    secondary_reasons: string[],
    event_diagnostics: [
      {
        event_id: string,
        event_name: string,
        reason: string,
        details: {...}
      }
    ],
    suggestions: [
      'Consider reducing party size to [X]',
      'Increase budget to $[Y]',
      'Try different dates',
      'Remove exclusion: [keyword]'
    ]
  }
}
```

## Implementation Details

### Step 1: Modify `selectSeatsByBudgetAndCapacity`

**Location**: `services/botAutoFillService.js` (lines 162-287)

**Key Changes**:
1. Initialize diagnostics object at function start
2. Track seat counts before/after each filter
3. Identify primary reason when no seats found
4. Return both seats and diagnostics

**Pseudocode**:
```javascript
async function selectSeatsByBudgetAndCapacity(event, preferences = {}, remainingBudget = null) {
  const diagnostics = {
    event_id: event._id?.toString(),
    event_name: event.name,
    total_seats: event.seats?.length || 0,
    party_size: preferences.party_size || 2,
    budget: remainingBudget || preferences.budget?.max || Infinity,
    exclusions: preferences.structuredPreferences?.exclusions || [],
    filtering_stages: {},
    primary_reason: null,
    secondary_reasons: [],
    details: {}
  };

  // Track initial count
  diagnostics.filtering_stages.initial_count = event.seats?.length || 0;

  // Filter by status
  let availableSeats = event.seats.filter(seat => seat.status === 'available');
  diagnostics.filtering_stages.after_status_filter = availableSeats.length;
  
  if (availableSeats.length === 0) {
    diagnostics.primary_reason = 'NO_AVAILABLE_SEATS';
    diagnostics.details.no_available_seats = {
      total: event.seats.length,
      available: 0,
      booked: event.seats.filter(s => s.status === 'booked').length,
      held: event.seats.filter(s => s.status === 'held').length,
      blocked: event.seats.filter(s => s.status === 'blocked').length
    };
    return { seats: [], diagnostics };
  }

  // Filter by capacity
  const partySize = preferences.party_size || 2;
  availableSeats = availableSeats.filter(seat => seat.capacity >= partySize);
  diagnostics.filtering_stages.after_capacity_filter = availableSeats.length;
  
  if (availableSeats.length === 0) {
    const maxCapacity = Math.max(...event.seats.map(s => s.capacity || 0));
    diagnostics.primary_reason = 'CAPACITY_TOO_SMALL';
    diagnostics.details.capacity_too_small = {
      party_size: partySize,
      max_capacity_found: maxCapacity,
      seats_with_sufficient_capacity: 0
    };
    return { seats: [], diagnostics };
  }

  // Filter by budget
  const budget = remainingBudget || preferences.budget?.max || Infinity;
  availableSeats = availableSeats.filter(seat => 
    (seat.event_price || seat.min_spend || 0) <= budget
  );
  diagnostics.filtering_stages.after_budget_filter = availableSeats.length;
  
  if (availableSeats.length === 0) {
    const prices = event.seats.map(s => s.event_price || s.min_spend || 0).filter(p => p > 0);
    const minPrice = prices.length > 0 ? Math.min(...prices) : 0;
    diagnostics.primary_reason = 'BUDGET_TOO_LOW';
    diagnostics.details.budget_too_low = {
      budget,
      min_seat_price: minPrice,
      max_seat_price: prices.length > 0 ? Math.max(...prices) : 0,
      seats_within_budget: 0
    };
    return { seats: [], diagnostics };
  }

  // Filter by exclusions (if any)
  // ... existing exclusion logic ...
  
  // If seats found, return them with diagnostics
  // If no seats after exclusions, set reason and return
  
  return { seats: [...], diagnostics };
}
```

### Step 2: Update Callers to Handle New Return Format

**Location**: `services/botToolHandlers.js` (lines 586-644)

**Changes**:
1. Destructure return value: `const { seats, diagnostics } = await selectSeatsByBudgetAndCapacity(...)`
2. Store diagnostics for each event
3. Aggregate diagnostics when no seats found

### Step 3: Enhance Error Formatting

**Location**: `services/botResponseFormatter.js`

**Changes**:
1. Accept diagnostics in `formatNoSeatsAvailableError`
2. Build specific message based on primary reason
3. Generate actionable suggestions

### Step 4: Update Frontend Display

**Location**: `views/test/dashboard.ejs`

**Changes**:
1. Display specific reason prominently
2. Show diagnostic details in expandable section
3. Display suggestions for user action

## Testing Scenarios

### Test Case 1: Capacity Too Small
- **Input**: Party size = 10, Event has seats with max capacity = 6
- **Expected**: Error message explains capacity issue with specific numbers

### Test Case 2: Budget Too Low
- **Input**: Budget = $5,000, All seats cost > $5,000
- **Expected**: Error message shows minimum seat price and suggests budget increase

### Test Case 3: No Available Seats
- **Input**: All seats are booked/held
- **Expected**: Error message explains all seats are unavailable

### Test Case 4: Excluded by Preferences
- **Input**: User excludes "loud" venues, all seats have "loud" sentiment
- **Expected**: Error message lists excluded keywords

### Test Case 5: Multiple Events, Different Reasons
- **Input**: 3 events, Event 1: capacity issue, Event 2: budget issue, Event 3: no seats
- **Expected**: Error message identifies most common reason across all events

## Benefits

1. **User Clarity**: Users understand exactly why COE creation failed
2. **Actionable Feedback**: Users know what to change (budget, party size, dates, preferences)
3. **Reduced Support**: Fewer support requests due to unclear errors
4. **Better UX**: More professional and helpful error messages
5. **Debugging**: Easier to debug seat selection issues with detailed diagnostics

## Implementation Checklist

- [ ] Modify `selectSeatsByBudgetAndCapacity` to return diagnostics
- [ ] Update all callers to handle new return format
- [ ] Enhance `formatNoSeatsAvailableError` with specific messages
- [ ] Update frontend to display specific reasons
- [ ] Add unit tests for diagnostic collection
- [ ] Test all failure scenarios
- [ ] Update error logging to include diagnostics

## Notes

- Diagnostics should not expose sensitive information
- Performance impact should be minimal (only collect when needed)
- Diagnostic data should be logged for debugging
- Consider caching diagnostics for similar queries

