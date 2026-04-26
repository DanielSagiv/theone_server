# Admin Full Access COE Editing Enhancement

## Overview

This enhancement provides administrators with full access to all available events and seats/tables when building or editing draft COEs, while maintaining the optimized, filtered experience for clients. The key difference is that admins see ALL options within constraints (city, date range), while clients see optimized selections.

## Current Behavior

### Event Replacement (All Users)
- **Alternative events** are filtered by:
  - Same city (optional, but defaults to current event's city)
  - Date range: ±7 days from current event date
  - Excludes events already in the COE
  - Only active events
  - Limited to 10 results (default)
  - **Optimized selection** (best matches for client preferences)

### Seat/Table Upgrades (All Users)
- **Upgrade options** are filtered by:
  - Must be available (`status === 'available'`)
  - Must meet capacity requirement (≥ party size)
  - Must be "better" than current seat:
    - Higher quality score (based on sentiment + qualityScore), OR
    - More expensive than current seat
  - Limited to top 5 alternatives

## Proposed Behavior

### Universal Restrictions (Both Admin and Client)
These restrictions apply to **ALL users** regardless of role:

1. **Held Seats/Tables**: 
   - Do NOT show seats/tables with `status === 'held'` or `status === 'booked'`
   - Only show seats with `status === 'available'`
   - This applies even for admins - held seats are not selectable

2. **Fully Booked Events**:
   - Do NOT show events where `total_available === 0`
   - Events must have at least 1 available seat to be selectable
   - This applies to both admin and client

3. **City Restriction**:
   - Only show events from the **selected city** (from COE preferences or current event's city)
   - This applies to both admin and client

4. **Date Range Restriction**:
   - Only show events within the **selected date range** (from COE preferences or ±7 days from current event)
   - This applies to both admin and client

### For Clients (Creating COE for Themselves)
- **System automatically selects best-fit events and seats** using:
  - Sentiment-based event scoring and matching (see `bot-coe-creation-stage2.md`)
  - Quality-based seat scoring
  - Budget optimization (see `smart-seat-selection-budget-optimization.md`)
  - Preference matching
- **Client does NOT manually select** - System auto-fills the COE with optimized selections
- **Alternative events** (when replacing):
  - Filtered alternative events (same city, within date range, optimized selection)
  - Limited to top results (typically 10)
- **Upgrade options** (when viewing seat upgrades):
  - Optimized upgrade options (only "better" seats, top 5)
  - Filtered by quality/price improvements

### For Admins (Creating COE for Clients)
- **Admin manually selects** events and seats from all available options
- **No auto-selection** - Admin has full control over what to include

#### Initial COE Build (Bot Flow)
**Event Selection**: Admin manually chooses from **ALL available events** that:
  - Are in the selected city (from user preferences)
  - Are within the selected date range (from user preferences)
  - Have `status === 'active'`
  - Have available seats (`total_available > 0`)
  - Are NOT fully booked
  - **No optimization/sentiment scoring** - Show all matching events, not just "best" ones
  - **No auto-selection** - Admin manually selects events
  - **No limit** - Show all matching events (limit: 100 for performance)

**Seat/Table Selection**: Admin manually chooses from **ALL available seats/tables** for selected events that:
  - Are available (`status === 'available'`) - **NOT held or booked**
  - Meet capacity requirement (≥ party size) - **OR** allow admin to override capacity check
  - **No quality/price filtering** - Show all seats, not just "better" ones
  - **No auto-selection** - Admin manually selects seats
  - **No optimization** - Show all matching seats (limit: 100 for performance)

#### Event Replacement (Editing Existing COE)
- **Alternative Events**: Show **ALL available events** that:
  - Are in the selected city (from COE preferences or current event's city)
  - Are within the date range (from COE preferences or ±7 days from current event)
  - Have `status === 'active'`
  - Have available seats (`total_available > 0`)
  - Are NOT fully booked
  - Are NOT already in the COE
  - **No optimization** - Show all matching events
  - **No limit** - Show all matching events

#### Seat/Table Upgrades (Editing Existing COE)
- **Upgrade Options**: Show **ALL available seats/tables** for the event that:
  - Are available (`status === 'available'`) - **NOT held or booked**
  - Meet capacity requirement (≥ party size) - **OR** allow admin to override
  - **No quality/price filtering** - Show all seats, not just "better" ones
  - Include current seat in the list (so admin can see what's currently selected)
  - Show all seats sorted by: price (ascending), then quality score (descending)

## Implementation Plan

### Phase 1: Backend Changes

#### 1.1 Update `findAlternativeEvents` Function
**File**: `services/coeService.js`

**Changes**:
- Add `isAdmin` parameter to function signature
- **Universal restrictions** (both admin and client):
  - Only events with `status === 'active'`
  - Only events with `total_available > 0` (not fully booked)
  - Only events in selected city (from COE preferences or current event's city)
  - Only events within date range (from COE preferences or ±7 days from current event)
  - Exclude events already in COE
- **When `isAdmin === true`**:
  - Remove optimization/filtering (show ALL matching events)
  - Increase limit to 100 (or remove limit entirely)
  - Don't apply sentiment/quality scoring for ranking
- **When `isAdmin === false`** (or not provided):
  - Keep current behavior (filtered, optimized, limited to 10)

**Route Update**: `routes/coes.js`
- Update `GET /:coeId/events/:eventId/alternatives` endpoint
- Pass `isAdmin: req.user.role === 'admin'` to `findAlternativeEvents()`

#### 1.2 Update `findBetterSeats` Function
**File**: `services/seatUpgradeService.js`

**Changes**:
- Add `isAdmin` parameter to function signature
- **Universal restrictions** (both admin and client):
  - Only seats with `status === 'available'` (NOT held or booked)
  - Must meet capacity requirement (≥ party size) - **OR** allow admin override
- **When `isAdmin === true`**:
  - Remove quality/price filtering (don't check if seat is "better")
  - Return ALL available seats that meet universal restrictions
  - Sort by: price (ascending), then quality score (descending)
  - Include current seat in results (marked with `is_current_seat: true` flag and "Currently Selected" tag)
  - Current seat inclusion mechanism: For admins, current seat is NOT excluded from initial filter, then marked with `isCurrentSeat` flag during processing
  - **Admin fallback behavior**: If current seat is not found in location data, use default values (score = 0, price from seat) and continue to show all seats (clients would return empty array in this case)
  - Limit: 100 seats (for performance)
- **When `isAdmin === false`** (or not provided):
  - Keep current behavior (only "better" seats, top 5)
  - If current seat not found in location data, return empty array (can't compare without baseline)

#### 1.3 Update `generateSeatUpgradeOffers` Function
**File**: `services/seatUpgradeService.js`

**Changes**:
- Add `isAdmin` parameter to function signature
- **Universal restrictions** (both admin and client):
  - Only seats with `status === 'available'` (NOT held or booked)
- **When `isAdmin === true`**:
  - Call `findBetterSeats()` with `isAdmin: true`
  - For each alternative seat, still generate:
    - Price delta (can be negative if cheaper seat)
    - Upgrade reasons (if applicable)
    - AI recommendation (if sentiment available)
  - Mark alternatives with `is_admin_view: true` flag
- **When `isAdmin === false`** (or not provided):
  - Keep current behavior

**Route Update**: `routes/coes.js`
- Update `GET /:id/seat-upgrades` endpoint (if exists)
- Pass `isAdmin: req.user.role === 'admin'` to `generateSeatUpgradeOffers()`

#### 1.4 Update Bot Event Selection Logic
**File**: `services/botToolHandlers.js` or `services/botSentimentService.js`

**Changes**:
- **For clients**: System uses auto-selection with sentiment-based matching (see `bot-coe-creation-stage2.md`)
  - `autoSelectEventsBySentiment` function is called
  - Events are ranked by sentiment score and automatically selected
  - No manual selection needed
- **For admins**: Admin manually selects events from all available options
  - Still respect city and date range from preferences
  - Still respect universal restrictions (not held, not fully booked)
  - **But**: Don't apply optimization/sentiment scoring (`autoSelectEventsBySentiment` is NOT used)
  - Show ALL events in city/date range (not just "best" ones)
  - Pass `isAdmin: true` flag to event selection functions
  - Admin chooses which events to include in COE

#### 1.5 Update Bot Seat Selection Logic
**File**: `services/botAutoFillService.js`

**Changes**:
- **For clients**: System uses auto-selection with budget optimization (see `smart-seat-selection-budget-optimization.md`)
  - `selectSeatsByBudgetAndCapacity` function is called
  - Seats are scored by quality + sentiment and automatically selected
  - Budget is maximized while prioritizing quality
  - No manual selection needed
- **For admins**: Admin manually selects seats from all available options
  - Still respect universal restrictions (only available seats, not held)
  - Still respect capacity requirement (or allow override)
  - **But**: Don't apply optimization/quality filtering (`selectSeatsByBudgetAndCapacity` is NOT used for auto-selection)
  - Show ALL available seats (not just "best" ones)
  - Pass `isAdmin: true` flag to seat selection functions
  - Admin chooses which seats to include in COE

#### 1.6 Update `replaceEventInCOE` Function
**File**: `services/coeService.js`

**Changes**:
- When regenerating upgrade offers after event replacement:
  - Check if user is admin (need to pass user context or check COE admin_id)
  - If admin, call `generateSeatUpgradeOffers()` with `isAdmin: true`
  - If client, call with `isAdmin: false` (or omit, default behavior)

**Route Update**: `routes/coes.js`
- Update `PUT /:coeId/events/:oldEventId` endpoint
- Pass admin status to `replaceEventInCOE()` or check within the function

### Phase 2: Frontend Changes

#### 2.1 Event Replacement Modal
**File**: `views/test/dashboard.ejs`

**Changes**:
- When admin clicks "Replace Event":
  - Show all events in city/date range (no optimization, backend handles it)
  - Display event details: name, date, location (city), price range, available seats
  - Add sorting options: by date, by city, by price
  - Add search/filter UI (optional, for convenience):
    - Filter by city (should match selected city)
    - Filter by date range (should match selected range)
    - Search by event name
- When client clicks "Replace Event":
  - Keep current behavior (filtered, optimized alternatives)

#### 2.2 Seat Upgrade Cards
**File**: `views/test/dashboard.ejs`

**Changes**:
- When admin views upgrade options:
  - Show ALL available seats (not just "better" ones)
  - Display price delta even if negative (cheaper options)
  - Show current seat in the list (marked as "Currently Selected")
  - Add sorting options: by price, by quality, by capacity
  - Show all seats in a scrollable list (not just carousel of top 5)
  - **Clearly indicate held/booked seats are NOT shown** (they're filtered out)
- When client views upgrade options:
  - Keep current behavior (only "better" seats, carousel)

#### 2.3 Admin Detection
**File**: `views/test/dashboard.ejs`

**Changes**:
- Detect if current user is admin (from `req.user` or frontend user object)
- Pass `isAdmin` flag to API calls:
  - `GET /coes/:coeId/events/:eventId/alternatives?isAdmin=true`
  - `GET /coes/:id/seat-upgrades?isAdmin=true` (if endpoint exists)
- Or backend can detect from `req.user.role === 'admin'` (preferred)

### Phase 3: API Endpoint Updates

#### 3.1 Alternative Events Endpoint
**Route**: `GET /v1/coes/:coeId/events/:eventId/alternatives`

**Changes**:
- Backend automatically detects admin from `req.user.role === 'admin'`
- Pass `isAdmin` flag to `findAlternativeEvents()`
- **Universal restrictions applied**:
  - Only active events
  - Only events with available seats (not fully booked)
  - Only events in selected city
  - Only events within date range
- **Response structure** (enhanced):
  - Each event includes:
    - Standard event fields (`_id`, `name`, `start_datetime`, `end_datetime`, `location`)
    - `available_seats_count`: Count of seats with `status === 'available'`
    - `total_available`: Total available capacity from event field
    - `price_range`: Object with `min` and `max` prices from available seats
  - Additional filtering: Events are filtered to ensure `available_seats_count > 0 && total_available > 0`
- Response format: Array of event objects with enhanced fields

#### 3.2 Seat Upgrades Endpoint (if exists)
**Route**: `GET /v1/coes/:id/seat-upgrades`

**Changes**:
- Backend automatically detects admin from `req.user.role === 'admin'`
- Pass `isAdmin` flag to `generateSeatUpgradeOffers()`
- **Universal restrictions applied**:
  - Only available seats (not held or booked)
- Response format remains the same, but includes all seats for admins

### Phase 4: Edge Cases & Considerations

#### 4.1 Held Seats Validation
- **Critical**: Ensure held seats are NEVER shown, even to admins
- Add validation in backend to reject seat selection if seat is held/booked
- Add UI indicator if seat becomes held while admin is viewing (real-time update)

#### 4.2 Fully Booked Events Validation
- **Critical**: Ensure fully booked events are NEVER shown
- Add validation in backend to reject event selection if event becomes fully booked
- Add UI indicator if event becomes fully booked while admin is viewing

#### 4.3 City and Date Range Enforcement
- **For Admin**: Still enforce city and date range restrictions
- Get city from:
  - COE preferences (if available)
  - Current event's location city (if replacing event)
  - User preferences (if building new COE)
- Get date range from:
  - COE preferences (if available)
  - Current event date ±7 days (if replacing event)
  - User preferences (if building new COE)

#### 4.4 Capacity Override for Admins
- Consider allowing admins to select seats below party size capacity
- Add UI toggle: "Allow seats below party size" (admin only)
- Backend validation: Allow if `isAdmin === true` AND override enabled

#### 4.5 Performance Considerations
- For admins, returning ALL events/seats could be large datasets
- Implement pagination for event list (limit 50 per page)
- Implement virtual scrolling for seat list (load on scroll)
- Add loading states for large datasets

#### 4.6 UI/UX Enhancements
- Add badges/tags to distinguish:
  - "Currently Selected" seat
  - "Cheaper Option" vs "Premium Upgrade"
  - "Below Capacity" (if capacity override enabled)
- Add filters/search for admin view (even though backend returns all):
  - Filter by price range
  - Filter by capacity
  - Search by seat code
  - Filter by section/category
- **Show restrictions clearly**:
  - "Showing events in [City] from [Date Range]"
  - "Held seats are not shown"
  - "Fully booked events are not shown"

#### 4.7 Backward Compatibility
- Ensure client experience remains unchanged
- Default behavior (when `isAdmin` not provided) should be current client behavior
- Test that existing client flows still work correctly

## Testing Plan

### Unit Tests
1. Test `findAlternativeEvents()` with `isAdmin: true` vs `false`
   - Verify universal restrictions apply to both
   - Verify admin sees all events (no optimization)
   - Verify client sees optimized events
2. Test `findBetterSeats()` with `isAdmin: true` vs `false`
   - Verify held seats are never shown (both admin and client)
   - Verify admin sees all available seats
   - Verify client sees only better seats
3. Test `generateSeatUpgradeOffers()` with `isAdmin: true` vs `false`
4. Test bot event selection with admin vs client
5. Test bot seat selection with admin vs client

### Integration Tests
1. Test admin building COE via bot sees all events in city/date range
2. Test admin building COE via bot sees all seats (not held)
3. Test admin viewing draft COE sees all events (city/date restricted)
4. Test admin viewing draft COE sees all seats (not held)
5. Test client building COE via bot sees optimized events
6. Test client building COE via bot sees optimized seats
7. Test client viewing draft COE sees filtered events
8. Test client viewing draft COE sees only better seats
9. Test held seats are never shown (admin or client)
10. Test fully booked events are never shown (admin or client)
11. Test city restriction applies to both admin and client
12. Test date range restriction applies to both admin and client

### Manual Testing
1. Create COE as admin via bot (verify all events in city/date shown, no optimization)
2. Create COE as client via bot (verify optimized selection)
3. Admin views draft COE, clicks "Replace Event" - verify all events in city/date shown
4. Admin views draft COE, checks upgrade options - verify all seats shown (not held)
5. Client views draft COE, clicks "Replace Event" - verify filtered, optimized events
6. Client views draft COE, checks upgrade options - verify only better seats
7. Try to select held seat (should fail for both admin and client)
8. Try to select from fully booked event (should fail for both admin and client)

## Success Criteria

- ✅ Admins see ALL available events in selected city/date range (no optimization)
- ✅ Admins see ALL available seats (not held, not just "better" ones)
- ✅ Clients continue to see filtered, optimized options (no regression)
- ✅ Initial COE build logic respects admin vs client (admin: all options, client: optimized)
- ✅ Universal restrictions apply to both admin and client:
  - Held seats are never shown
  - Fully booked events are never shown
  - City restriction is enforced
  - Date range restriction is enforced
- ✅ Performance is acceptable even with large datasets (pagination/virtual scrolling)
- ✅ UI clearly distinguishes admin vs client experience
- ✅ UI clearly shows restrictions (city, date range, held/booked filtering)

## Notes

- This enhancement only applies to **draft COEs** - confirmed/paid COEs should not allow event/seat changes
- Admin full access is automatic based on `req.user.role === 'admin'` - no additional permission checks needed
- **Universal restrictions are non-negotiable** - even admins cannot see/select held seats or fully booked events
- City and date range restrictions apply to both admin and client - admins just see ALL options within those constraints
- **Key distinction**: 
  - **Clients**: System automatically selects best-fit events/seats using optimization algorithms (see `bot-coe-creation-stage2.md` and `smart-seat-selection-budget-optimization.md`)
  - **Admins**: Admin manually selects from all available options (no auto-selection)
- Consider adding admin preference/setting to toggle between "full access" and "filtered view" (future enhancement)

## Implementation Details

### Current Seat Inclusion for Admins

When admins view seat upgrade options, the current seat is included in the results:

1. **Initial Filtering**: For admins, the current seat is NOT excluded from the initial available seats filter (unlike clients where it's excluded)
2. **Marking**: During processing, the current seat is identified via `isCurrentSeat` flag (matches by seat code or seat_id)
3. **Response**: In the final response, current seat is:
   - Tagged as "Currently Selected" (replaces default tag)
   - Flagged with `is_current_seat: true`
   - Included in the list so admin can see what's currently selected

### Admin Fallback Behavior

When the current seat cannot be found in location data:

- **For Clients**: Function returns empty array (can't compare without baseline quality/price data)
- **For Admins**: Function continues with default values:
  - `currentScore = 0` (default quality score)
  - `currentPrice` = price from seat object (`event_price`, `base_price`, or `min_spend`)
  - All available seats are still shown (since admins see all seats, no comparison needed)

This allows admins to still see upgrade options even if there's a data inconsistency where the seat exists in COE but not in location's seat list.

### Alternative Events Response Structure

The `findAlternativeEvents` function returns events with enhanced fields:

- `available_seats_count`: Count of seats with `status === 'available'` (calculated from event.seats array)
- `total_available`: Total available capacity from event field
- `price_range`: Object with:
  - `min`: Minimum price from available seats
  - `max`: Maximum price from available seats
- Additional filtering ensures both `available_seats_count > 0` AND `total_available > 0`

### Admin Limits

- **Event alternatives**: Limit of 100 events (for performance)
- **Seat upgrades**: Limit of 100 seats per event (for performance)
- Clients continue to use smaller limits (10 events, 5 seats) for optimized experience

## Related Documentation

- **Client COE Creation Flow**: See `architecture/bot-coe-creation-stage2.md` for client auto-selection implementation
- **Smart Seat Selection**: See `implementation-summaries/smart-seat-selection-budget-optimization.md` for client seat optimization logic
- **Admin COE Creation**: See `implementation-summaries/BOT-ADMIN-CREATE-COE-FROM-CLIENT-LIST.md` for admin COE creation flow
- **Seat Upgrade Offers**: See `implementation-summaries/seat-upgrade-offers-feature.md` for upgrade offer generation





