# THE1 Bot Architecture Plan

## Overview
The THE1 Bot enables users to interact with the platform via natural language to query events, create and edit COEs (Curated One Experiences), and manage their bookings. The bot uses OpenAI's function calling capabilities to execute tools that interact with the backend services.

**Note**: This document focuses on bot-specific architecture and production concerns. For general system-wide production concerns (seat holds, payment snapshots, approval workflows, etc.), see `../TBD/general_concerns.md` in the `MD_files` directory.

## Core Principles

1. **Memory**: Conversation history is stored per user in MongoDB (`BotConversation` model) with timezone, locale, and event logging support
2. **Tooling**: Bot uses OpenAI function calling to execute backend operations
3. **Permissions**: All tools enforce role-based access control (Admin, Client, Runner)
4. **Structured Responses**: When relevant, bot returns structured JSON that renders as interactive UI components in the chat
5. **Approval Required**: COEs created via bot require approval (status: `draft`, pending admin or client approval)
6. **In-Place Updates**: COE edits update the existing COE (no versioning)
7. **Spelling Handling**: All user prompts are processed through OpenAI LLM to handle spelling mistakes, typos, and variations in natural language input automatically
8. **Extensible Prompts**: The prompt system is designed to be expandable. New interaction patterns can be added without requiring architectural changes. The supported prompts list represents the initial set and will be continuously updated and expanded.

---

## Tool System Architecture

### Tool Registry

All tools are registered in `services/botTools.js` with metadata for OpenAI function calling:

#### 1. `get_events_by_date`
**Purpose**: Query events within a date range with optional filters

**Parameters**:
- `start_date` (string, required): ISO date string
- `end_date` (string, required): ISO date string
- `location` (string, optional): Location name or city
- `type` (string, optional): Event type filter
- `status` (string, optional): Event status filter (default: 'active')
- `search` (string, optional): Text search in name/description

**Returns**: Array of event objects with:
- Basic info (name, description, type, dates)
- Location details
- Pricing and availability
- **Sentiment data** (from location and event level)
- Media URLs

**Permissions**: All authenticated users

**Implementation**: Calls `eventService.getEvents()` with filters

---

#### 2. `create_coe_draft`
**Purpose**: Create a new COE with selected events and seats

**Parameters**:
- `name` (string, required): COE name
- `description` (string, required): COE description
- `start_date` (string, required): ISO date string
- `end_date` (string, required): ISO date string
- `idempotency_key` (string, optional): Unique key to prevent duplicate COE creation on retries
- `events` (array, required): Array of event selections
  - `event_id` (string, required): Event MongoDB ID
  - `selected_seats` (array, optional): Array of seat selections
    - `seat_id` (string, required)
    - `seat_code` (string, required)
    - `capacity` (number, required)
- `client_id` (string, optional): Client ID (admin only, defaults to current user)
- `preferences` (object, optional): User preferences for AI selection
  - `budget_range` (object): `{ min: number, max: number }`
  - `location_preferences` (array): City/location names
  - `party_size` (number)
  - `notes` (string)

**Returns**: COE object with:
- Full COE details
- Events and selected seats
- Pricing breakdown
- Status: `draft` (pending approval by admin or client)
- `created_method`: `'automated'`

**Permissions**:
- **Client**: Can create COEs for themselves only - *Requires `ENABLE_CLIENT_COE_CREATION=true` feature flag*
- **Admin**: Can create COEs for any client (always enabled)

**Implementation**: 
- Calls `coeService.createCOE()` with auto-filled data
- Sets `status: 'draft'` and `created_method: 'automated'`
- COE requires approval: Admin approves if created by client, Client approves if created by admin

**Auto-Fill Logic** (System automatically fills all required fields):

1. **Client Selection**:
   - If current user is **Client**: `client_id = currentUser._id`
   - If current user is **Admin**: `client_id` must be provided in parameters (admin can create for any client)
   - `admin_id`: Auto-assigned to first available admin if created by client, or current user if created by admin

2. **COE Name**:
   - Auto-generated format: `"<client_first_name> experience for <dates>"`
   - Example: `"John experience for Nov 15-20, 2025"`
   - Dates formatted as: "MMM DD-DD, YYYY" or "MMM DD - MMM DD, YYYY" if different months

3. **Description**:
   - **Leave empty for now** (can be added in future iterations)

4. **Dates**:
   - `start_date` and `end_date`: Extracted from user prompt
   - **Conversation Flow**: If dates are missing, bot asks:
     - "What dates are you looking for? (e.g., Nov 15-20, 2025)"
     - Bot parses natural language dates and converts to ISO format
     - Validates dates are in the future and end_date >= start_date

5. **Currency**:
   - **Default**: `'USD'` (hardcoded, not configurable)

6. **Events Selection**:
   - System queries events using `get_events_by_date(start_date, end_date)`
   - Filters: `status: 'active'`, `end_datetime >= current_date`
   - **Selection Criteria**:
     - Events must fall within `start_date` to `end_date` range
     - Events must have available seats/tables
     - If budget provided: Events selected to fit within budget range
     - If multiple events needed to support budget: System plans multiple events across the date range
     - **Sentiment Matching**: 
       - Correlates user preferences with location/seat sentiments (type A/B)
       - Matches past user events/history if available
       - Ranks events by sentiment alignment score
     - **Auto-Selection**: If sufficient data (dates + budget + preferences) → Bot auto-selects best matching events
     - **Manual Selection**: If insufficient data → Bot presents top 3-5 options for user to choose

7. **Tables/Seats Selection**:
   - For each selected event, system selects seats/tables:
     - **Budget-Aware**: If budget provided, selects seats that fit within budget constraints
     - **Sentiment Matching**: Uses location/seat sentiments to match user preferences
     - **Capacity Matching**: Matches seat capacity to party size (if provided)
     - **Availability**: Only selects seats with `status: 'available'`
     - **Multiple Events**: If budget requires multiple events, distributes seat selections across events
   - Each seat includes:
     - `event_id`, `seat_id`, `seat_code`, `capacity`
     - `base_price` (from location), `event_price` (from event)
     - `available_from`, `available_until` (from event dates)
     - `status: 'selected'` (default)

8. **Runner Assignment**:
   - **Assignment Type**: Default `'coe'` - **"Assign to entire COE"** (not per-event assignment)
   - **Runner Selection**:
     - Query runners (users with role `'runner'`)
     - Find runner **not busy** during COE date range:
       - Check existing COE assignments where runner is assigned
       - Check if runner has conflicting COEs/events during `start_date` to `end_date`
       - Select first available runner
     - If no available runner: Leave `runner_id` empty (can be assigned manually later)
   - **Runner Notes**: **Leave empty** (default: `null` or empty string)
   - **Assignment Details**:
     - `assigned_by`: Current user ID
     - `assigned_at`: Current timestamp
     - `status`: `'assigned'` (default)

9. **Pricing Calculation**:
   - **Subtotal**: Sum of all event `total_price` values + sum of all `selected_seats[].event_price` values
   - **Taxes**: **Default 30%** of subtotal (`taxes = subtotal * 0.30`)
   - **Fees**: Default `0` (can be configured later)
   - **Total**: `subtotal + taxes + fees`
   - **Deposit Required**: Default 20% of total (`deposit_required = total * 0.20`)
   - **Pricing Breakdown**: Detailed breakdown per event with seat pricing (see COE schema)

10. **Policies**:
    - **Source**: Taken from GXN data saved on location/event objects
    - Query location's `policies` field (if exists)
    - Query event's `policies` field (if exists)
    - Combine location and event policies
    - If no policies found: Leave empty (can be added manually later)

11. **Notes**:
    - **Admin Notes**: Leave empty (default)
    - **Client Notes**: Leave empty (default)

12. **Additional Fields**:
    - `request_date`: Current timestamp
    - `created_at`: Current timestamp
    - `updated_at`: Current timestamp
    - `participants`: Empty array (default)
    - `tags`: Empty array (default)
    - `sharable`: `false` (default)

**AI Selection Logic Summary**:
- **Sufficient Data** (dates + budget + preferences): Bot auto-selects events and seats using sentiment analysis
- **Insufficient Data**: Bot presents options for user to choose from
- **Sentiment Correlation**: System matches user preferences with location/seat sentiments (type A/B) and past event history
- **Budget Planning**: If budget requires multiple events, system distributes selections across date range

---

#### 3. `update_coe`
**Purpose**: Edit an existing COE (events, seats, dates, notes, etc.)

**Parameters**:
- `coe_id` (string, required): COE MongoDB ID
- `updates` (object, required): Fields to update
- `idempotency_key` (string, optional): Unique key to prevent duplicate updates on retries
  - `name` (string, optional)
  - `description` (string, optional)
  - `start_date` (string, optional): ISO date string
  - `end_date` (string, optional): ISO date string
  - `events` (array, optional): Updated event list
  - `selected_seats` (array, optional): Updated seat selections
  - `notes` (string, optional)
  - `client_notes` (string, optional)

**Returns**: Updated COE object

**Permissions**:
- **Client**: Can edit own COEs only (status must be `draft` or `approved`) - *Requires `ENABLE_CLIENT_COE_EDITING=true` feature flag*
- **Admin**: Can edit any COE (always enabled)

**Implementation**: 
- Calls `coeService.updateCOE()`
- Updates existing COE in place (no versioning)
- Releases old seats and holds new ones if seat selections change

---

#### 4. `get_my_coes`
**Purpose**: List all COEs for the current user

**Parameters**:
- `status` (string, optional): Filter by status
- `limit` (number, optional): Max results (default: 50)
- `offset` (number, optional): Pagination offset

**Returns**: Array of COE summaries:
- Basic info (name, status, dates)
- Event count
- Total price
- Status badge

**Permissions**: All authenticated users

**Implementation**: Calls `coeService.getCOEsByUser()`

---

#### 5. `get_coe_details`
**Purpose**: Get full details of a specific COE

**Parameters**:
- `coe_id` (string, required): COE MongoDB ID

**Returns**: Full COE object with:
- All events and selected seats
- Pricing breakdown
- Runner assignments
- Payment status
- Timeline dates

**Permissions**:
- **Client**: Can view own COEs and assigned COEs
- **Admin**: Can view any COE
- **Runner**: Can view assigned COEs

**Implementation**: Calls `coeService.getCOEById()` with permission checks

---

#### 6. `delete_coe`
**Purpose**: Delete a COE (soft delete or hard delete based on status)

**Parameters**:
- `coe_id` (string, required): COE MongoDB ID

**Returns**: Success confirmation

**Permissions**:
- **Client**: Can delete own COEs (only if status is `draft` or `approved`)
- **Admin**: Can delete any COE

**Implementation**: 
- Calls `coeService.deleteCOE()`
- Releases all held seats
- Updates event `coe_count`

---

## Supported Prompts and Interaction Patterns

**Note**: This section documents the initial set of supported bot interaction patterns. The system is designed to be extensible, and this list will be continuously updated and expanded as new use cases are identified. All prompts support automatic spelling correction and natural language variations through OpenAI LLM processing.

### Prompt Categories

#### 1. COE Creation and Management

##### Prompt #1: Create COE for Client (Admin)
**User Type**: Admin  
**Trigger**: "create a coe for <client>"

**Conversation Flow**:
1. Bot asks: "What is the start date and end date?"
2. User provides start and end date
3. Bot asks: "What is your budget?"
4. User provides budget
5. Bot asks (if date range > 1 day): "How many events do you want?"
6. User provides number of events
7. Bot asks: "What do you prefer? Day events, night events, or both?"
8. Bot builds the COE and displays it

**Display**: Designed structure (unless user asks for text only)  
**Notes**: System handles spelling mistakes using OpenAI LLM

---

##### Prompt #4: Show Client's COEs (Admin)
**User Type**: Admin  
**Trigger**: "show me <client>'s coe's"

**Conversation Flow**:
- If system recognizes the client: Presents admin with the COEs
- If system does not recognize the client: Asks for additional data (last name, email, etc.)
- Example: If multiple clients named "Mike" exist, system asks for last name, email, or other identifying information
- If multiple matches: User can ask for all COEs related to name "Mike" and system presents them with title format: `<client's full name>, <client's email>`

**Display**: Designed structure (unless user asks for text only)

---

#### 2. Event Queries

##### Prompt #2: Upcoming Events Query
**User Type**: Admin / Client  
**Trigger**: "what are the upcoming events for the next (<number> weeks) / (<number> days) / (month)"

**System Response**: Displays the events

**Display**: 
- Designed structure (unless user asks for text only)
- **Admin**: Shows relevant events and all clients associated with each event in a list under the event
- **Client**: Under each event, notifies user if they reserved this event and shows the table

---

##### Prompt #12: Future Events Query
**User Type**: Admin / Client  
**Trigger**: "show me all future events"

**Conversation Flow**:
1. If user didn't supply date range: System asks for date range or specific date
2. User provides date ranges or a specific date
3. System shows all events and seats

**Display**: Designed structure (unless user asks for text only)

---

##### Prompt #17: Table Availability Check
**User Type**: Admin / Client  
**Trigger**: "do we have an available table at event <event name>, club <club name> at date?"

**Conversation Flow**:
1. If missing data: System asks user for missing data (date, event name, location name)
2. User completes required data (date, names, etc.)
3. System displays:
   - **If available seats/table**: Text title + designed structure of event with available seats under it
   - **If no available seats/table**: Text only response

**Display**: Designed structure for event with available seats, text only if none available  
**Notes**: This is a general question about event, so we show event structure with available seats

---

#### 3. Client Personal Queries

##### Prompt #3: My Future Events (Client)
**User Type**: Client  
**Trigger**: "show me my future events"

**System Response**: Shows the user's events aggregated by COEs

**Display**: Designed structure (unless user asks for text only)

---

##### Prompt #5: My Past Events (Client)
**User Type**: Client  
**Trigger**: "show me all my past events"

**Conversation Flow**:
1. System asks for from date to date (if not stated)
2. User provides missing data
3. System displays the past COEs

**Display**: Designed structure (unless user asks for text only)

---

##### Prompt #9: What I Need to Pay (Client)
**User Type**: Client  
**Trigger**: "show me what i need to pay for"

**System Response**: Shows the COEs the user didn't pay for yet

**Display**: Designed structure (unless user asks for text only)

---

#### 4. Payment Status Queries (Admin)

##### Prompt #7: All Unpaid COEs (Admin)
**User Type**: Admin  
**Trigger**: "show me all unpaid coes"

**System Response**: Displays all unpaid COEs

**Display**: Designed structure (unless user asks for text only)

---

##### Prompt #8: All Paid COEs (Admin)
**User Type**: Admin  
**Trigger**: "show me all paid coes"

**System Response**: Displays all paid COEs

**Display**: Designed structure (unless user asks for text only)

---

#### 5. Location Queries

##### Prompt #10: All Locations (Admin/Client)
**User Type**: Admin / Client  
**Trigger**: "show me all locations"

**System Response**: Shows all locations with seats

**Display**: Designed structure (unless user asks for text only)

---

##### Prompt #11: Specific Location (Admin/Client)
**User Type**: Admin / Client  
**Trigger**: "show me location <location name>"

**System Response**: Shows the location with seats

**Display**: Designed structure (unless user asks for text only)

---

#### 6. General Questions

##### Prompt #13: General Question (Admin/Client)
**User Type**: Admin / Client  
**Trigger**: General question

**System Response**: "I can answer only about clubs, hotels, and restaurants"

**Display**: Text response

---

##### Prompt #14: General Question About Experiences (Admin/Client)
**User Type**: Admin / Client  
**Trigger**: General question about experiences

**System Response**: 
- Can be general or about locations (clubs/hotels/restaurants) the system knows about
- Uses location sentiments for known locations
- Can use internet for general information if location not in local database

**Display**: 
- Designed structure if it's a location we know about
- Text if general data
- Images from general information from the internet if we don't contain the location locally

**Notes**: 
- If relevant, system will ask leading questions like: "Is there a specific club/hotel/restaurant you are interested in?"
- Internet enabled for general information

---

#### 7. Bot Identity and Capabilities

##### Prompt #15: What Can You Do? (Client)
**User Type**: Client  
**Trigger**: "what can u do for me?"

**System Response**: "I can help you build your experience in clubs, hotels, and restaurants in several locations, reserve it, and assign a runner"

**Display**: Text response

---

##### Prompt #16: Who Are You? (Client)
**User Type**: Client  
**Trigger**: "who are you?"

**System Response**: "I'm THE1 bot. My function is to build your experience, make sure it is good for you, validating your experience with Amir and your runner. I have very strict rules and when you are logged in the system, only you have access to your data."

**Display**: Text response

---

#### 8. Runner Queries

##### Prompt #18: All Assigned Events (Runner)
**User Type**: Runner  
**Trigger**: "show me all the events im assigned to"

**System Response**: Shows all future events that the runner is assigned to (nearest one first, last one last)

**Display**: Designed structure (unless user asks for text only)

---

##### Prompt #19: My Next Event (Runner)
**User Type**: Runner  
**Trigger**: "where is my next event?"

**System Response**: Shows the runner the nearest next event assigned to him

**Display**: Designed structure (unless user asks for text only)

---

### Display Type Guidelines

- **Designed Structure**: Interactive UI components (COE cards, event cards, location cards, etc.) with action buttons and detailed information
- **Text Only**: Plain text response
- **User Override**: Users can request text-only responses even when structured display is available by explicitly asking for text format

### Prompt Expansion Strategy

The prompt system is designed with extensibility in mind:

1. **New Prompts**: Can be added by updating the prompt registry without requiring architectural changes
2. **Pattern Recognition**: OpenAI LLM handles variations in phrasing and natural language
3. **Tool Integration**: New prompts can leverage existing tools or trigger creation of new tools
4. **Display Types**: New display types can be added to support new interaction patterns
5. **Role-Based**: New prompts can be assigned to specific user roles (Admin, Client, Runner)

---

## Conversation Flow Patterns

*Note: The following are example conversation patterns. The complete list of supported prompts is documented in the "Supported Prompts and Interaction Patterns" section above.*

### Pattern 1: "Plan my experience"

```
User: "Plan my experience"
Bot: "I'd love to help! Let me ask a few questions to create the perfect experience for you..."
  → "What dates are you looking for? (e.g., Nov 15-20, 2025)"
  → "What's your budget range? (e.g., $5000-$10000)"
  → "Any location preferences? (city, venue type)"
  → "Party size?"
  → "Any specific preferences? (nightlife, dining, music genres, etc.)"

[Bot collects answers, stores in conversation context]

Bot: "Great! Let me find the best events for you..."
  → Calls get_events_by_date(start_date, end_date, filters)
  → Analyzes sentiment data from locations/events
  → If sufficient data: Auto-selects events using sentiment matching
  → If insufficient: Presents top 3-5 options for user to choose
  
Bot: [If auto-selected]
  → Calls create_coe_draft() with selected events
  → Returns structured COE response with status: 'draft'
  → Informs user: "I've created a draft COE for you. It's pending approval before it can be sent."

Bot: [If presenting options]
  → Displays event cards with sentiment highlights
  → User selects events
  → Bot calls create_coe_draft() with user selections
  → Returns structured COE response with status: 'draft'
  → Informs user: "I've created a draft COE for you. It's pending approval before it can be sent."
```

### Pattern 2: "What events are available on [date]?"

```
User: "What events are available on Nov 18, 2025?"
Bot: "Let me check what's happening on November 18, 2025..."
  → Calls get_events_by_date('2025-11-18', '2025-11-18')
  → Formats response with event cards
  → Includes sentiment highlights
```

### Pattern 3: "Update the COE we just created"

```
User: "Update the COE we just created - change dates to Nov 20-25"
Bot: [References conversation context for active COE ID]
  → Calls get_coe_details(coe_id) to verify
  → Calls update_coe(coe_id, { start_date, end_date })
  → Returns updated structured COE response
```

### Pattern 4: "Show me my COEs"

```
User: "Show me my COEs"
Bot: "Here are your COEs..."
  → Calls get_my_coes()
  → Displays COE list cards with status badges
  → Each card is clickable to view details
```

---

## Structured Response Format

When the bot creates, updates, or displays a COE, it returns a structured JSON response that the frontend renders as an interactive component:

```json
{
  "type": "coe_created" | "coe_updated" | "coe_list" | "coe_details",
  "coe_id": "mongodb_id",
  "coe": {
    // Full COE object
  },
  "message": "I've created a COE for you with 3 events...",
  "actions": [
    {
      "label": "Edit",
      "action": "edit_coe",
      "coe_id": "..."
    },
    {
      "label": "View Details",
      "action": "view_coe",
      "coe_id": "..."
    },
    {
      "label": "Delete",
      "action": "delete_coe",
      "coe_id": "..."
    }
  ]
}
```

### Frontend Rendering

The EJS bot interface detects `type: "coe_*"` responses and renders:

1. **COE Card Component**:
   - Header: COE name, status badge, dates
   - Event list: Event names, dates, locations
   - Pricing: Subtotal, taxes, fees, total
   - Selected seats: Seat codes, capacities, prices
   - Action buttons: Edit, View Details, Delete, Approve, Share

2. **COE List Component**:
   - Grid/list of COE cards
   - Filter by status
   - Sort by date/price

3. **Inline Controls**:
   - Edit button opens inline editor or modal
   - Delete button with confirmation
   - Status transitions (Approve, Send, Accept, Reject)

---

## Context and Memory Management

### Conversation Context Tracking

The bot maintains context in the conversation:

1. **Active COE References**:
   - When a COE is created/updated, store `coe_id` in conversation metadata
   - Bot can reference: "the COE we just created", "update it", "add another event"

2. **Multi-Turn Flows**:
   - Track preference collection state
   - Store partial data until all required fields collected
   - Example: User provides dates → Bot asks for budget → User provides budget → Bot creates COE

3. **Conversation Metadata**:
   ```javascript
   {
     active_coe_id: "mongodb_id",
     collecting_preferences: true,
     preference_data: {
       dates: { start: "...", end: "..." },
       budget: { min: 5000, max: 10000 },
       // ...
     },
     user_tz: "America/New_York", // User's timezone
     locale: "en-US", // User's locale for formatting
     last_prompt_category: "coe_creation", // For analytics
     event_log: [ // Compact event log for traceability
       { timestamp: "...", action: "tool_called", tool: "create_coe_draft" },
       { timestamp: "...", action: "preference_collected", field: "dates" }
     ]
   }
   ```

### Time Zone and Date Handling

**Standardization**:
- All dates stored in MongoDB as UTC ISO 8601 format
- User timezone stored in `BotConversation.user_tz` (IANA timezone database name, e.g., "America/New_York")
- Location timezone stored in `Location.timezone` field

**Date Parsing**:
- Bot parses natural language dates ("Nov 15-20, 2025", "next Friday")
- All parsed dates validated and normalized to ISO format with explicit timezone
- Ambiguous inputs rejected with request for clarification
- Date utility function enforces timezone rules:
  ```javascript
  function parseAndNormalizeDate(dateString, userTimezone, locationTimezone) {
    // Parse natural language date
    // Apply user timezone context
    // Convert to location timezone for event matching
    // Return ISO 8601 with timezone
  }
  ```

**Validation Rules**:
- Reject dates without timezone context
- Reject ambiguous formats (e.g., "11/12/2025" - is it Nov 12 or Dec 11?)
- Require explicit timezone for multi-location COEs
- Store both user-local and UTC representations for display

### Sentiment Data Integration

**Location Sentiment**:
- Stored in `Location.sentiment[]` (type A or B)
- Also in `Location.seats[].sentiment[]` and `Location.units[].sentiment[]`

**Usage in Bot**:
- When bot queries events, include sentiment data in response
- When auto-selecting events, use sentiment to match user preferences
- Present sentiment highlights in event cards:
  - "This venue is known for [sentiment type A text]"
  - "This table offers [sentiment type B text]"

---

## Permission Matrix

| Tool | Admin | Client | Runner |
|------|-------|--------|--------|
| `get_events_by_date` | ✅ | ✅ | ✅ |
| `create_coe_draft` | ✅ (any client) | ✅ (self only)** | ❌ |
| `update_coe` | ✅ (any) | ✅ (own, draft/approved only)*** | ❌ |
| `get_my_coes` | ✅ | ✅ | ✅ |
| `get_coe_details` | ✅ (any) | ✅ (own + assigned) | ✅ (assigned) |
| `delete_coe` | ✅ (any) | ✅ (own, draft/approved only) | ❌ |

\*\* *Client creation requires `ENABLE_CLIENT_COE_CREATION=true` feature flag*  
\*\*\* *Client editing requires `ENABLE_CLIENT_COE_EDITING=true` feature flag*  
*See `FEATURE-FLAGS.md` for details.*

---

## File Structure

```
services/
  botService.js          # Existing - conversation management, OpenAI integration
  botTools.js            # NEW - tool registry, function calling definitions
  botToolHandlers.js     # NEW - actual tool implementations (calls existing services)
  
models/
  BotConversation.js     # Existing - conversation storage
  BotUsageLog.js         # NEW - OpenAI usage and cost tracking
  BotAuditLog.js         # NEW - Bot action audit trails
  IdempotencyCache.js    # NEW - Idempotency key storage
  
routes/
  bot.js                 # Existing - API endpoints
```

---

## Dynamic Tool Discovery and Registration

### How the Bot Accesses Functions (Existing and Future)

The bot system is designed with **dynamic tool discovery** in mind. This means:

1. **Tool Registry Pattern**: All available tools are registered in `services/botTools.js` as a registry/configuration file
2. **Runtime Discovery**: When the bot processes a user message, it queries the tool registry to get the list of available tools
3. **OpenAI Function Calling**: The tool registry is passed to OpenAI as function definitions, allowing OpenAI to decide which tool to call based on the user's intent
4. **Handler Mapping**: Each tool has a corresponding handler in `services/botToolHandlers.js` that executes the actual logic

### Adding New Functions to the Bot

When a new function needs to be accessible to the bot:

#### Step 1: Create the Backend Service/Function
- Implement the function in the appropriate service file (e.g., `eventService.js`, `coeService.js`, etc.)
- Ensure it follows existing patterns and includes proper error handling
- Add validation and permission checks

#### Step 2: Register the Tool
Add the tool definition to `services/botTools.js`:

```javascript
// services/botTools.js
const toolRegistry = {
  // ... existing tools ...
  
  'new_function_name': {
    name: 'new_function_name',
    description: 'Clear description of what this function does',
    parameters: {
      type: 'object',
      properties: {
        param1: {
          type: 'string',
          description: 'Description of parameter'
        },
        // ... more parameters
      },
      required: ['param1']
    },
    permissions: ['admin', 'client'], // Who can use this
    handler: 'newFunctionHandler' // Name of handler function
  }
};
```

#### Step 3: Create the Handler
Add the handler function to `services/botToolHandlers.js`:

```javascript
// services/botToolHandlers.js
async function newFunctionHandler(params, userId, idempotencyKey) {
  // 1. Idempotency check (if key provided)
  if (idempotencyKey) {
    const existingResult = await checkIdempotency(idempotencyKey);
    if (existingResult) {
      return existingResult; // Return cached result
    }
  }
  
  // 2. Permission check
  const user = await User.findById(userId);
  if (!toolRegistry['new_function_name'].permissions.includes(user.role)) {
    throw new Error('Permission denied');
  }
  
  // 3. Call the actual service function
  const result = await someService.newFunction(params);
  
  // 4. Store idempotency result (if key provided)
  if (idempotencyKey) {
    await storeIdempotencyResult(idempotencyKey, result);
  }
  
  // 5. Format response
  return {
    success: true,
    data: result,
    displayType: 'designed_structure' // or 'text'
  };
}
```

**Idempotency Implementation**:
- All mutating tools (create, update, delete) accept optional `idempotency_key`
- Keys are unique per user and operation
- Results are cached for 24 hours
- Prevents duplicate operations on OpenAI/network retries

// Export the handler
module.exports = {
  // ... existing handlers ...
  newFunctionHandler
};
```

#### Step 4: Update Tool Handler Map
Map the handler name to the function in `botToolHandlers.js`:

```javascript
const handlerMap = {
  'get_events_by_date': getEventsByDateHandler,
  'create_coe_draft': createCOEDraftHandler,
  // ... existing mappings ...
  'new_function_name': newFunctionHandler // Add new mapping
};
```

### How It Works at Runtime

1. **User sends message**: "show me unpaid COEs"
2. **Bot queries tool registry**: Gets all available tools with their descriptions
3. **OpenAI analyzes intent**: OpenAI sees the user wants to see unpaid COEs and matches it to `get_unpaid_coes` tool
4. **OpenAI returns tool call**: `{ tool: 'get_unpaid_coes', parameters: {} }`
5. **Bot looks up handler**: Finds `getUnpaidCOEsHandler` in the handler map
6. **Handler executes**: Calls `coeService.getUnpaidCOEs()` or similar
7. **Response formatted**: Returns structured data to user

### Key Benefits

1. **No Bot Service Changes**: Adding a new tool doesn't require modifying `botService.js`
2. **Automatic Discovery**: OpenAI automatically discovers new tools from the registry
3. **Type Safety**: Tool parameters are validated through OpenAI's function calling
4. **Permission Control**: Each tool declares its permission requirements
5. **Extensibility**: New tools can be added without breaking existing functionality

### Tool Registry Structure

The tool registry is a simple JavaScript object that can be:
- **Statically defined**: All tools in one file (current approach)
- **Dynamically loaded**: Tools loaded from database or config files (future enhancement)
- **Modular**: Tools organized by category (future enhancement)

### Tool Schema Versioning

Each tool in the registry includes a `schema_version` field to support non-breaking evolution:

```javascript
'create_coe_draft': {
  name: 'create_coe_draft',
  schema_version: '1.0.0', // Semantic versioning
  description: 'Create a new COE with selected events and seats',
  // ... rest of tool definition
}
```

**Versioning Strategy**:
- **Major version** (1.x.x): Breaking changes - old clients may not work
- **Minor version** (x.1.x): New optional parameters added
- **Patch version** (x.x.1): Bug fixes, documentation updates

**Backward Compatibility**:
- Tools maintain backward compatibility within the same major version
- When breaking changes are needed, increment major version and support both versions temporarily
- Deprecate old versions with clear migration paths

### Example: Adding a New Tool for "Get Runner Schedule"

```javascript
// 1. Add to botTools.js registry
'get_runner_schedule': {
  name: 'get_runner_schedule',
  description: 'Get the schedule for a specific runner including all assigned events',
  parameters: {
    type: 'object',
    properties: {
      runner_id: {
        type: 'string',
        description: 'The ID of the runner'
      },
      start_date: {
        type: 'string',
        description: 'Start date for the schedule (ISO format)'
      },
      end_date: {
        type: 'string',
        description: 'End date for the schedule (ISO format)'
      }
    },
    required: ['runner_id']
  },
  permissions: ['admin', 'runner'],
  handler: 'getRunnerScheduleHandler'
}

// 2. Add handler to botToolHandlers.js
async function getRunnerScheduleHandler(params, userId) {
  const user = await User.findById(userId);
  
  // Permission check
  if (!['admin', 'runner'].includes(user.role)) {
    throw new Error('Permission denied');
  }
  
  // If runner, can only see their own schedule
  if (user.role === 'runner' && params.runner_id !== userId) {
    throw new Error('Runners can only view their own schedule');
  }
  
  // Call service (this function might not exist yet, but will be created)
  const schedule = await runnerService.getRunnerSchedule(params.runner_id, {
    start_date: params.start_date,
    end_date: params.end_date
  });
  
  return {
    success: true,
    data: schedule,
    displayType: 'designed_structure'
  };
}

// 3. Add to handler map
const handlerMap = {
  // ... existing ...
  'get_runner_schedule': getRunnerScheduleHandler
};
```

**Note**: The backend service function (`runnerService.getRunnerSchedule()`) can be created later. The bot tool can be registered first, and when the service is ready, it will automatically work.

---

### Implementation Flow

1. **User Message** → `botService.sendBotMessage(userId, prompt)`
2. **Tool Detection** → `botTools.detectToolIntent(messages)` (optional, or let OpenAI decide)
3. **OpenAI Function Calling** → OpenAI returns tool name and parameters
4. **Tool Execution** → `botToolHandlers[toolName](params, userId)`
5. **Permission Check** → Verify user role and ownership
6. **Service Call** → Call existing service (e.g., `coeService.createCOE()`)
7. **Result Formatting** → Format as structured response
8. **Response** → Add to conversation, return to user

---

## COE Status Workflow (Bot-Created)

1. **Creation**: Bot creates COE with status `draft` and `created_method: 'automated'`
2. **Approval Required**: 
   - If created by **Client**: Requires **Admin** approval (`draft` → `approved`)
   - If created by **Admin**: Requires **Client** approval (`draft` → `approved`)
3. **Send to Client**: `approved` → `sent`
4. **Client Response**: `sent` → `accepted` or `rejected`
5. **Completion**: `accepted` → `completed` (after events)
6. **Cancellation**: Any status → `cancelled`

**Key Point**: Bot-created COEs start as `draft` and require approval before they can be sent to the client. The approver depends on who created the COE (admin approves client-created, client approves admin-created).

---

## Error Handling

### Error Taxonomy

All errors follow a standardized taxonomy for consistent bot responses and UI rendering:

```javascript
// Error structure
{
  code: 'ERROR_CODE', // Machine-readable error code
  message: 'User-friendly message', // Human-readable message
  category: 'validation' | 'permission' | 'service' | 'network' | 'conversation',
  retryable: true | false, // Can user retry this action?
  field_errors: { // Field-level validation errors (if applicable)
    'field_name': 'Error message for this field'
  },
  context: { // Additional context for debugging
    tool: 'create_coe_draft',
    correlation_id: '...'
  }
}
```

**Error Categories**:

1. **Validation Errors** (`validation`):
   - `INVALID_DATE_FORMAT`: Date parsing failed
   - `MISSING_REQUIRED_FIELD`: Required parameter missing
   - `INVALID_PARAMETER_VALUE`: Parameter value out of range
   - `FIELD_VALIDATION_ERROR`: Field-level validation failed
   - **Retryable**: Yes (user can correct input)

2. **Permission Errors** (`permission`):
   - `PERMISSION_DENIED`: User lacks required role
   - `RESOURCE_OWNERSHIP_MISMATCH`: User doesn't own the resource
   - `ACTION_NOT_ALLOWED`: Action not allowed in current state
   - **Retryable**: No (requires permission change)

3. **Service Errors** (`service`):
   - `SERVICE_UNAVAILABLE`: Backend service down
   - `DATABASE_ERROR`: Database operation failed
   - `EXTERNAL_API_ERROR`: Third-party API error
   - **Retryable**: Yes (temporary issue)

4. **Network Errors** (`network`):
   - `TIMEOUT`: Request timed out
   - `CONNECTION_ERROR`: Network connection failed
   - `RATE_LIMIT_EXCEEDED`: Too many requests
   - **Retryable**: Yes (with backoff)

5. **Conversation Errors** (`conversation`):
   - `INVALID_REFERENCE`: Referenced COE/event not found
   - `MISSING_CONTEXT`: Required context missing from conversation
   - `AMBIGUOUS_REQUEST`: Multiple matches, need clarification
   - **Retryable**: Yes (user can clarify)

### Tool Execution Errors

- **Permission Denied**: Return error code `PERMISSION_DENIED` with user-friendly message
- **Validation Error**: Return error code with `field_errors` object for field-level feedback
- **Service Error**: Return error code `SERVICE_ERROR`, log full details, return generic message to user
- **Network/DB Error**: Return error code with `retryable: true`, implement retry logic with exponential backoff

### Conversation Errors

- **Invalid COE Reference**: Error code `INVALID_REFERENCE`, message: "I couldn't find that COE. Let me show you your COEs..."
- **Missing Required Data**: Error code `MISSING_CONTEXT`, message: "I need a bit more information. What dates are you looking for?"
- **Ambiguous Request**: Error code `AMBIGUOUS_REQUEST`, message: "I found multiple COEs. Which one did you mean?" with list of matches

### Error Response Format

All tool handlers return errors in this format:

```javascript
{
  success: false,
  error: {
    code: 'ERROR_CODE',
    message: 'User-friendly message',
    category: 'validation',
    retryable: true,
    field_errors: { /* if applicable */ },
    context: {
      tool: 'create_coe_draft',
      correlation_id: '...'
    }
  }
}
```

---

## Rate Limiting and Cost Management

### OpenAI API Cost Controls

**Cost Tracking**:
- Track OpenAI token usage per user per request
- Store in database: `user_id`, `timestamp`, `model`, `tokens_used`, `cost_usd`
- Calculate cost based on model pricing:
  - `gpt-4o-mini`: $0.15/$0.60 per 1M tokens (input/output)
  - `gpt-4o`: $2.50/$10.00 per 1M tokens (input/output)

**Implementation**:
```javascript
// Track OpenAI usage
async function trackOpenAIUsage(userId, model, tokens, cost) {
  await BotUsageLog.create({
    user_id: userId,
    timestamp: new Date(),
    model: model,
    tokens_input: tokens.prompt,
    tokens_output: tokens.completion,
    cost_usd: cost,
    correlation_id: req.correlationId
  });
}
```

**Rate Limiting**:
- Per-user rate limits: 100 requests per hour, 1000 requests per day
- Per-IP rate limits: 200 requests per hour (prevents abuse)
- Tool-specific limits: Expensive tools (COE creation) limited to 10 per hour per user

**Cost Alerts**:
- Alert admin when user exceeds $50/day in OpenAI costs
- Alert admin when system-wide costs exceed $500/day
- Daily cost reports for budget tracking

### Rate Limit Implementation

```javascript
// Rate limiting middleware
const rateLimiter = {
  user: rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 100, // 100 requests per hour
    keyGenerator: (req) => req.user._id.toString()
  }),
  ip: rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 200,
    keyGenerator: (req) => req.ip
  }),
  tool: rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 10, // For expensive tools
    keyGenerator: (req) => `${req.user._id}:${req.body.tool}`
  })
};
```

---

## Observability and Monitoring

### Bot Metrics

Track the following metrics for bot performance and usage:

**Tool Usage Metrics**:
- Tool call count per tool per day
- Success/failure rate per tool
- Median latency per tool (p50, p95, p99)
- Error rate by error category

**Cost Metrics**:
- Total OpenAI costs per day/week/month
- Cost per user per day
- Cost per tool call
- Token usage trends

**User Engagement Metrics**:
- Active users per day
- Messages per user per session
- Average conversation length
- Conversion rate: conversations → COE creation → approval

**Performance Metrics**:
- Bot response time (end-to-end)
- OpenAI API latency
- Tool execution latency
- Database query time

**SLOs (Service Level Objectives)**:
- Bot response time: p95 < 5 seconds
- Tool execution: p95 < 2 seconds
- OpenAI API: p95 < 3 seconds
- Uptime: 99.5% availability

### Audit Trails

**Bot Action Audit Log**:
- Log all bot tool calls with:
  - `user_id`: Who triggered the action
  - `tool_name`: Which tool was called
  - `parameters_hash`: Hash of parameters (for privacy)
  - `result_hash`: Hash of result (for verification)
  - `correlation_id`: Request correlation ID
  - `timestamp`: When action occurred
  - `success`: Whether action succeeded
  - `error_code`: Error code if failed

**Implementation**:
```javascript
// Audit log model
const BotAuditLogSchema = new mongoose.Schema({
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  tool_name: { type: String, required: true, index: true },
  parameters_hash: { type: String }, // SHA256 hash of parameters
  result_hash: { type: String }, // SHA256 hash of result
  correlation_id: { type: String, index: true },
  timestamp: { type: Date, default: Date.now, index: true },
  success: { type: Boolean, required: true },
  error_code: { type: String },
  execution_time_ms: { type: Number }
}, { timestamps: true });

// Indexes for efficient querying
BotAuditLogSchema.index({ user_id: 1, timestamp: -1 });
BotAuditLogSchema.index({ tool_name: 1, timestamp: -1 });
BotAuditLogSchema.index({ correlation_id: 1 });
```

**Correlation ID Propagation**:
- Generate `correlation_id` at bot request entry point
- Propagate through: Bot Service → Tool Handler → Backend Service → Database
- Include in all logs, errors, and responses
- Enables end-to-end request tracing

### Logging Strategy

**Log Levels**:
- **ERROR**: Tool failures, service errors, permission denies
- **WARN**: Rate limit hits, validation failures, retries
- **INFO**: Tool calls, COE creation, status changes
- **DEBUG**: Detailed parameter values, intermediate steps (only in development)

**Structured Logging**:
```javascript
logger.info('tool_called', {
  correlation_id: req.correlationId,
  user_id: userId,
  tool: 'create_coe_draft',
  parameters: { /* sanitized */ },
  timestamp: new Date().toISOString()
});
```

---

**Note**: Future enhancements and planned features are documented in `../TBD/bot-future-enhancements.md`.

---

## Testing Strategy

1. **Unit Tests**: Test each tool handler independently
2. **Integration Tests**: Test full conversation flows
3. **Permission Tests**: Verify role-based access
4. **E2E Tests**: Test via EJS bot interface
5. **Error Scenarios**: Test invalid inputs, missing data, permission errors

---

## Environment Variables

```env
OPENAI_API_KEY=sk-proj-...
OPENAI_MODEL=gpt-4o-mini  # or gpt-4o for better function calling

# Rate Limiting
RATE_LIMIT_USER_PER_HOUR=100
RATE_LIMIT_IP_PER_HOUR=200
RATE_LIMIT_TOOL_PER_HOUR=10

# Cost Controls
OPENAI_COST_ALERT_USER_DAILY=50  # USD
OPENAI_COST_ALERT_SYSTEM_DAILY=500  # USD

# Observability
ENABLE_AUDIT_LOGGING=true
ENABLE_METRICS=true
LOG_LEVEL=info  # error, warn, info, debug
```

---

## Next Steps

1. ✅ Create `services/botTools.js` - Tool registry with OpenAI function definitions
2. ✅ Create `services/botToolHandlers.js` - Tool implementations
3. ✅ Update `services/botService.js` - Integrate function calling
4. ✅ Update `routes/bot.js` - Handle structured responses
5. ✅ Update EJS bot interface - Render structured COE components
6. ✅ Add sentiment data to event queries
7. ✅ Implement preference collection flow
8. ✅ Test full "Plan my experience" flow

