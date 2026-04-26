# COE Event Management Enhancement

## Overview
Enhance the COE (Curated One Experience) build flow to allow users to remove events from a draft COE and replace existing events with alternative events.

## Goals
1. Enable removal of one or more events from a draft COE
2. Enable replacement of existing events with alternative events
3. Maintain COE data integrity and validation
4. Update seat selections when events are modified
5. Provide seamless UI/UX for event management
6. **Ensure feature is available in COE draft card for both:**
   - Users creating COEs for themselves (via bot)
   - Admins creating COEs for clients (via bot)
7. **Preserve all existing functionality** - do not harm other logic
8. **Reuse existing code** - avoid logic duplications
9. **Follow existing code structure** - maintain consistency

## Current State Analysis

### Existing COE Structure
- COE has `status: 'draft'` for editable COEs
- COE contains `selected_seats[]` array with event references
- Each seat has `event_id`, `seat_id`, `seat_code`, pricing, and status
- COE has `events[]` array (if populated) or references events via `selected_seats`
- COE has `seat_upgrade_offers[]` that reference specific events

### Current Limitations
- No API endpoint to remove events from a draft COE
- No API endpoint to replace events in a draft COE
- Frontend doesn't provide UI for event removal/replacement
- Seat selections are tied to events - need cleanup when events removed

## Implementation Plan

### Phase 1: Backend API Endpoints

#### 1.1 Remove Events from Draft COE
**Endpoint:** `DELETE /v1/coes/:coeId/events`

**Request Body:**
```json
{
  "event_ids": ["event_id_1", "event_id_2"]
}
```

**Functionality:**
- Validate COE exists and is in 'draft' status
- Validate user has permission (admin or COE owner)
- Remove specified events from COE
- Remove all `selected_seats` associated with removed events
- Remove all `seat_upgrade_offers` associated with removed events
- Recalculate COE totals (if applicable)
- Return updated COE

**Location:** `routes/coes.js`
**Service:** `services/coeService.js` - new function `removeEventsFromCOE(coeId, eventIds)`

**Code Structure Guidelines:**
- Follow existing route patterns in `routes/coes.js`
- Use same authentication middleware (`authenticateToken`)
- Use same error response format as other COE endpoints
- Place new function in `coeService.js` following existing function patterns
- Use same validation approach as existing COE update functions

#### 1.2 Replace Event in Draft COE
**Endpoint:** `PUT /v1/coes/:coeId/events/:oldEventId`

**Request Body:**
```json
{
  "new_event_id": "new_event_id",
  "preserve_seats": false,  // Optional: try to match seats from old event by seat code
  "seat_preferences": {      // Optional: if preserve_seats is false, use these preferences for seat selection
    "capacity": 4,
    "budget": 5000,
    "preferences": {}
  }
}
```

**Note**: If neither `preserve_seats` nor `seat_preferences` are provided (e.g., mobile app flow), the system will automatically use COE preferences (if available) to select seats using `selectSeatsByBudgetAndCapacity`. This ensures seamless seat selection when replacing events.

**Functionality:**
- Validate COE exists and is in 'draft' status
- Validate old event exists in COE
- Validate new event exists and is available
- Remove old event and associated seats/upgrades
- Seat selection logic (in order of priority):
  1. If `preserve_seats: true`, attempt to find matching seats in new event by seat code
  2. If `preserve_seats: false` and `seat_preferences` provided, select new seats using existing seat selection logic (`selectSeatsByBudgetAndCapacity`)
  3. **Fallback**: If neither `preserve_seats` nor `seat_preferences` provided (e.g., mobile app flow), automatically select seats using COE preferences:
     - Calculate budget being released from old event seats (sum of `event_price` from old seats)
     - If COE has stored preferences with original budget:
       - Calculate available budget: `Original budget - Current subtotal + Old event budget`
       - This ensures the new event can use the budget that was freed from the old event
     - If no original budget stored, use the old event budget as minimum available budget
     - Extract `party_size` from COE preferences (defaults to 2 if not available)
     - Use `selectSeatsByBudgetAndCapacity` with calculated available budget to auto-select seats
     - This ensures seamless experience when replacing events from mobile app and proper budget allocation
  4. **Critical Fallback**: If all seat selection methods above fail to find seats (e.g., budget constraints prevent selection, all seats filtered out, etc.), select any available seat(s) from the event:
     - This ensures events always get seats if any are available in inventory, regardless of budget constraints
     - Selects the first available seat(s) that meet capacity requirements (party_size)
     - Uses COE preferences for party_size, or defaults to 2 if not available
     - Only applies if there are actually available seats in the event (status === 'available')
     - Prevents events from being added to COE without seats due to budget calculation issues or filtering problems
- Recalculate COE totals
- Return updated COE

**Location:** `routes/coes.js`
**Service:** `services/coeService.js` - new function `replaceEventInCOE(coeId, oldEventId, newEventId, options)`

**Code Structure Guidelines:**
- Follow existing route patterns in `routes/coes.js`
- Use same authentication middleware (`authenticateToken`)
- Use same error response format as other COE endpoints
- Place new function in `coeService.js` following existing function patterns
- **Reuse existing seat selection logic** - call `selectSeatsByBudgetAndCapacity` from `botAutoFillService.js` instead of duplicating
- Use same validation approach as existing COE update functions

#### 1.3 Get Alternative Events for Replacement
**Endpoint:** `GET /v1/coes/:coeId/events/:eventId/alternatives`

**Query Parameters:**
- `city` (optional): Filter by city
- `date_range_start` (optional): Start date for alternatives
- `date_range_end` (optional): End date for alternatives
- `limit` (optional): Max number of alternatives (default: 10)

**Functionality:**
- Get current event details
- Find alternative events based on:
  - Same city (if specified)
  - Similar date range (if specified)
  - Similar venue/location type
  - Available seats
- Return list of alternative events with basic info (name, date, location, available seats count)

**Location:** `routes/coes.js`
**Service:** `services/coeService.js` - new function `findAlternativeEvents(coeId, eventId, filters)`

**Code Structure Guidelines:**
- Follow existing route patterns in `routes/coes.js`
- Use same authentication middleware (`authenticateToken`)
- Use same error response format as other COE endpoints
- Place new function in `coeService.js` following existing function patterns
- **Reuse existing event query logic** - leverage event query patterns from `botToolHandlers.js` (e.g., `findEventsInDateRange`)
- Do not duplicate event filtering/querying logic

### Phase 2: Frontend UI Enhancements

#### 2.1 COE Draft Card Updates
**Location:** `views/test/dashboard.ejs`

**Changes:**
- Add "Remove Event" button/icon for each event in draft COE
- Add "Replace Event" button/icon for each event in draft COE
- Show confirmation modal before removing events
- Show event selection modal for replacement
- **CRITICAL: Feature must be available in COE draft card for:**
  - **Bot-created COEs** (when user creates COE for themselves via bot)
  - **Admin-created COEs** (when admin creates COE for client via bot)
- **Reuse existing UI patterns**:
  - Follow same button styling as existing COE card buttons
  - Use same modal patterns as existing modals in dashboard
  - Match existing event card display format
  - Use existing API call patterns (`makeApiRequest` function)
- **Preserve existing COE card functionality**:
  - Do not modify existing COE card rendering logic
  - Do not change existing event display
  - Do not alter existing seat display
  - Ensure all existing COE card features continue to work

#### 2.2 Event Removal UI
**Components:**
- Confirmation modal: "Are you sure you want to remove this event? All associated seats will be removed."
- Multi-select support if multiple events can be removed at once
- Loading state during removal
- Success/error feedback

#### 2.3 Event Replacement UI
**Components:**
- Modal with alternative events list
- Event cards showing:
  - **Event image** (from event media or venue/location media)
  - **Event name** (title)
  - **Description** (event description if available)
  - **Date and time** (formatted start_datetime)
  - **Venue/club name** (location name)
  - Available seats count
  - Price range (min - max)
- "Replace with This Event" button on each alternative
- Option to "Select seats automatically" or "Select manually later"
- Loading state during replacement
- Success/error feedback

#### 2.4 Alternative Events Display
**Mobile Implementation:**
- List of alternative events with enhanced cards (`EventCard` component)
- Each card displays:
  - **Image**: Event or venue image (16:9 aspect ratio, full width)
  - **Title**: Event name (bold, 20px font)
  - **Venue Name**: Location/venue name (14px, secondary color)
  - **Date**: Formatted date and time (13px, muted color)
  - **Description**: Event description if available (14px, up to 3 lines)
  - **Price Range**: Min-max price if available (16px, gold color)
  - **"Replace with This Event" button**: Rendered inside the card (as children prop of EventCard component)
- Pull-to-refresh support
- Empty state: "No alternative events found"
- **Screen Refresh Behavior**: After event replacement, screens automatically refresh when they regain focus:
  - COE detail screen (`coe-detail.js`) uses `useFocusEffect` to reload COE data when screen comes into focus
  - Bot conversation screen (`bot.js`) uses `useFocusEffect` to reload conversation and fetch fresh COE data for all COE cards in the conversation
  - This ensures users see updated COE data immediately after event replacement without manual refresh

**Dashboard Implementation:**
- List/grid of alternative events
- Filter options (date range, city, venue type)
- Sort options (date, price, availability)
- "View Details" for each event
- "Select as Replacement" button

#### 2.5 API Response Enhancement
**Backend Changes:**
- `findAlternativeEvents` now includes in response:
  - `description`: Event description field
  - `media`: Array of event media (images/videos)
  - `location`: Full location object with `name`, `address`, and `media`
- Response structure:
  ```javascript
  {
    _id: string,
    name: string,
    description: string | null,
    start_datetime: Date,
    end_datetime: Date,
    location: {
      name: string,
      address: object,
      media: array
    },
    media: array,
    available_seats_count: number,
    total_available: number,
    price_range: { min: number, max: number }
  }
  ```

### Phase 3: Service Layer Implementation

#### 3.1 `coeService.js` Functions

**`removeEventsFromCOE(coeId, eventIds)`**
```javascript
/**
 * Remove events from a draft COE
 * @param {string} coeId - COE ID
 * @param {Array<string>} eventIds - Array of event IDs to remove
 * @returns {Promise<Object>} Updated COE
 */
```

**Logic:**
1. Fetch COE and validate it's a draft
2. Filter out specified events from COE events array (if exists)
3. Remove all `selected_seats` where `event_id` matches removed events
4. Remove all `seat_upgrade_offers` where `event_id` matches removed events
5. Recalculate `total_amount` if applicable
6. Save and return updated COE

**`replaceEventInCOE(coeId, oldEventId, newEventId, options)`**
```javascript
/**
 * Replace an event in a draft COE
 * @param {string} coeId - COE ID
 * @param {string} oldEventId - Event ID to replace
 * @param {string} newEventId - New event ID
 * @param {Object} options - Options for seat selection
 * @returns {Promise<Object>} Updated COE
 */
```

**Logic:**
1. Fetch COE and validate it's a draft
2. Validate old event exists in COE
3. Fetch new event and validate availability
4. Remove old event from `coe.events` array and associated seats/upgrades:
   - Release old event's seats back to inventory (update seat status from 'held' to 'available')
   - Remove old event's seats from `coe.selected_seats` using MongoDB `$pull`
   - Remove old event's upgrade offers from `coe.seat_upgrade_offers` using MongoDB `$pull`
   - Replace old event with new event in `coe.events` array using MongoDB `$set` with positional operator
   - **CRITICAL**: Verify old event is actually removed from `coe.events` array after replacement
   - If old event still present after `$set` operation, explicitly remove it using MongoDB `$pull` to ensure it's no longer in the array
   - This ensures replaced events will appear in alternative events lists (not excluded)
5. Seat selection (priority order):
   - **If `preserve_seats: true`**:
     - Attempt to find matching seats in new event by seat code
     - If matches found (same seat code and available), add them to `selected_seats`
   - **Else if `seat_preferences` provided**:
     - Use existing seat selection logic (`selectSeatsByBudgetAndCapacity`) with provided preferences
     - Add selected seats to COE
   - **Else (fallback for mobile/app flows)**:
     - Load COE preferences (for bot-created COEs that have preferences stored)
     - Extract `party_size` and `budget` from COE preferences
     - Use `selectSeatsByBudgetAndCapacity` with COE preferences to auto-select seats
     - This ensures seats are automatically selected when replacing events from mobile app without explicit preferences
   - **Critical Fallback**: If all seat selection methods fail (no seats found):
     - Select any available seat(s) from the event that meet capacity requirements
     - Uses COE preferences for party_size, or defaults to 2
     - Ensures events always get seats if any are available, preventing events from being added without seats
6. Recalculate totals (subtract old event seats, add new event seats)
7. Regenerate seat upgrade offers (if COE is in draft status)
8. Verify replacement was successful:
   - Verify new event is in `coe.events` array
   - Verify old event is NOT in `coe.events` array (critical for alternative events to work correctly)
   - If old event still present after replacement, explicitly remove it using MongoDB `$pull`
   - Log verification results for debugging
9. Save and return updated COE

**`findAlternativeEvents(coeId, eventId, filters)`**
```javascript
/**
 * Find alternative events for replacement
 * @param {string} coeId - COE ID
 * @param {string} eventId - Current event ID
 * @param {Object} filters - Filter criteria
 * @returns {Promise<Array>} List of alternative events
 */
```

**Logic:**
1. Fetch current event details
2. Build exclusion set:
   - Get all event IDs currently in COE (from `coe.events` array)
   - Get all event IDs currently in COE (from `coe.selected_seats`)
   - Add current event ID (the event we're finding alternatives for)
   - Use consistent ID normalization (convert ObjectIds to strings) for reliable comparison across different data structures
   - **Important**: Only events currently in the COE are excluded. Previously replaced events (which have been removed from the COE via `replaceEventInCOE`) will be available as alternatives.
   - **Implementation Note**: The `replaceEventInCOE` function explicitly verifies and removes old events from `coe.events` array using MongoDB `$pull` if they're still present after the `$set` replacement operation. This ensures replaced events are completely removed and will appear in alternative events lists.
3. Build query based on filters:
   - City (from filter or current event)
   - Date range (from filter or current event date ±7 days)
   - Available seats > 0
   - Exclude events in exclusion set (current event + events currently in COE)
   - Only active events
4. Return events with:
   - Basic info (name, date, location)
   - Available seats count
   - Price range
   - Description and media (for enhanced display)
   - Similarity score (optional)

#### 3.2 Integration with Existing Services
- **REUSE existing functions** - Do not duplicate logic:
  - Reuse `selectSeatsByBudgetAndCapacity` from `botAutoFillService.js` for automatic seat selection
  - Reuse event query logic from `botToolHandlers.js` (specifically `findEventsInDateRange` and related helpers)
  - Reuse seat upgrade generation from `seatUpgradeService.js` if upgrade offers need regeneration
  - Reuse validation logic from existing COE update functions
- **Follow existing patterns** - Match code structure in `coeService.js`:
  - Use same error handling patterns
  - Use same validation approach
  - Use same response format
  - Follow same async/await patterns
- **Preserve existing functionality**:
  - Do not modify existing COE update/creation logic
  - Do not change existing seat selection behavior
  - Do not alter existing upgrade offer generation
  - Ensure all existing COE operations continue to work unchanged

### Phase 4: Validation & Error Handling

#### 4.1 Validation Rules
- COE must be in 'draft' status
- User must be admin or COE owner
- At least one event must remain in COE (can't remove all events)
- New event must be available and not expired
- New event must have available seats (if auto-selecting seats)
- Budget constraints must be respected (if applicable)

#### 4.2 Error Scenarios
- COE not found or not a draft
- Event not found in COE
- New event not available
- No matching seats found (if preserve_seats: true)
- Budget exceeded (if auto-selecting seats)
- Permission denied

#### 4.3 Error Messages
- Clear, user-friendly error messages
- Suggestions when alternatives are available
- Guidance on next steps

### Phase 5: Testing

#### 5.1 Unit Tests
- Test `removeEventsFromCOE` function
- Test `replaceEventInCOE` function
- Test `findAlternativeEvents` function
- Test validation logic
- Test edge cases (empty COE, single event, etc.)

#### 5.2 Integration Tests
- Test API endpoints
- Test frontend-backend integration
- Test seat cleanup when events removed
- Test upgrade offers cleanup

#### 5.3 Manual Testing
- Remove single event from multi-event COE
- Remove multiple events
- Replace event with automatic seat selection
- Replace event with manual seat selection
- Replace event preserving existing seats
- Test with different user roles (admin, client)
- Test error scenarios

## Database Considerations

### COE Document Updates
- `selected_seats[]` - Remove entries for removed events
- `seat_upgrade_offers[]` - Remove offers for removed events
- `events[]` - Update if this array exists
- `total_amount` - Recalculate after changes
- `updated_at` - Update timestamp

### No Schema Changes Required
- Existing COE schema supports these operations
- No new fields needed

## API Endpoints Summary

1. **DELETE** `/v1/coes/:coeId/events` - Remove events
2. **PUT** `/v1/coes/:coeId/events/:oldEventId` - Replace event
3. **GET** `/v1/coes/:coeId/events/:eventId/alternatives` - Get alternative events

## Frontend Components Summary

1. Remove Event button/icon on each event card
2. Replace Event button/icon on each event card
3. Confirmation modal for event removal
4. Event selection modal for replacement
5. Alternative events list/grid
6. Loading states and feedback messages

## Security Considerations

- Authentication required for all endpoints
- Authorization: Only admin or COE owner can modify
- Validate COE status (only drafts can be modified)
- Sanitize input (event IDs, filters)
- Rate limiting on API endpoints

## Performance Considerations

- Efficient queries for alternative events
- Limit number of alternatives returned
- Cache event details when possible
- Optimize seat selection logic for replacements

## Future Enhancements (Out of Scope)

- Bulk event replacement
- Event suggestions based on AI/preferences
- Preview changes before applying
- Undo/redo functionality
- Event comparison view

## Implementation Order

1. Backend: `removeEventsFromCOE` function and endpoint
2. Backend: `findAlternativeEvents` function and endpoint
3. Backend: `replaceEventInCOE` function and endpoint
4. Frontend: Remove event UI
5. Frontend: Replace event UI and alternative events display
6. Testing and refinement

## Critical Implementation Requirements

### 1. Do Not Harm Other Logic
- **Preserve all existing COE operations:**
  - COE creation (bot and manual) must work unchanged
  - COE updates (status changes, seat selections) must work unchanged
  - COE viewing/display must work unchanged
  - All existing API endpoints must continue to function
- **Isolate new functionality:**
  - New functions should be self-contained
  - New endpoints should not interfere with existing endpoints
  - New UI elements should not break existing UI
- **Test existing functionality:**
  - Verify all existing COE operations still work after implementation
  - Test bot COE creation flow (both user and admin)
  - Test manual COE creation from dashboard
  - Test COE status transitions
  - Test seat selection and upgrade offers

### 2. Avoid Logic Duplications
- **Reuse existing functions:**
  - Use `selectSeatsByBudgetAndCapacity` from `botAutoFillService.js` for seat selection
  - Use event query helpers from `botToolHandlers.js` for finding events
  - Use existing validation helpers from `utils/validationSchemas.js`
  - Use existing error handling patterns
- **Extract shared logic:**
  - If common logic is needed, extract to shared utility functions
  - Do not copy-paste code between new functions
  - Reference existing implementations rather than recreating
- **Follow DRY principle:**
  - Single source of truth for event queries
  - Single source of truth for seat selection
  - Single source of truth for validation

### 3. Keep Code Structure
- **Follow existing patterns:**
  - Match function naming conventions in `coeService.js`
  - Match route structure in `routes/coes.js`
  - Match error handling in existing endpoints
  - Match response format in existing endpoints
- **Maintain file organization:**
  - Place new functions in appropriate service files
  - Place new routes in appropriate route files
  - Place new UI components in appropriate sections of `dashboard.ejs`
- **Follow existing code style:**
  - Use same indentation and formatting
  - Use same async/await patterns
  - Use same JSDoc comment style
  - Use same variable naming conventions

### 4. COE Draft Card Availability
- **Must work for bot-created COEs:**
  - When user creates COE for themselves via bot
  - COE draft card displayed in bot interface
  - Remove/Replace buttons visible on each event
  - Functionality accessible from bot UI
- **Must work for admin-created COEs:**
  - When admin creates COE for client via bot
  - COE draft card displayed in bot interface
  - Remove/Replace buttons visible on each event
  - Functionality accessible from bot UI (admin can modify)
- **UI Integration:**
  - Buttons should appear in the same event cards shown in COE draft
  - Use existing `renderCOECard` or similar rendering functions
  - Integrate with existing bot message rendering
  - Ensure buttons are visible for `status: 'draft'` COEs only

## Notes

- Maintain backward compatibility with existing COE structure
- Ensure seat upgrade offers are properly cleaned up
- Consider impact on COE pricing and totals
- Document API changes in API documentation
- **Bot-created COEs (both user and admin) must support these features**
- **All existing COE functionality must remain intact**

