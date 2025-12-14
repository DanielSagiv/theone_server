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
  "preserve_seats": false,  // Optional: try to match seats from old event
  "seat_preferences": {      // Optional: if preserve_seats is false
    "capacity": 4,
    "budget": 5000,
    "preferences": {}
  }
}
```

**Functionality:**
- Validate COE exists and is in 'draft' status
- Validate old event exists in COE
- Validate new event exists and is available
- Remove old event and associated seats/upgrades
- If `preserve_seats: true`, attempt to find matching seats in new event
- If `preserve_seats: false` and `seat_preferences` provided, select new seats using existing seat selection logic
- If no preferences, remove seats (user can select manually later)
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
  - Event name and date
  - Location/venue
  - Available seats count
  - Price range
- "Select Event" button on each alternative
- Option to "Select seats automatically" or "Select manually later"
- Loading state during replacement
- Success/error feedback

#### 2.4 Alternative Events Display
**Components:**
- List/grid of alternative events
- Filter options (date range, city, venue type)
- Sort options (date, price, availability)
- "View Details" for each event
- "Select as Replacement" button

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
4. Remove old event and associated seats/upgrades
5. If `preserve_seats: true`:
   - Attempt to find matching seats in new event (by code, category, or similar)
   - If matches found, add them to `selected_seats`
6. If `preserve_seats: false` and `seat_preferences` provided:
   - Use existing seat selection logic (`selectSeatsByBudgetAndCapacity`)
   - Add selected seats to COE
7. Recalculate totals
8. Save and return updated COE

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
2. Build query based on filters:
   - City (from filter or current event)
   - Date range (from filter or current event date ±7 days)
   - Available seats > 0
   - Not already in COE
3. Return events with:
   - Basic info (name, date, location)
   - Available seats count
   - Price range
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

