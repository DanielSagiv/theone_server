# Event Search Feature - Implementation Plan

## Overview

This feature enables users (admin and client) to search for events using natural language prompts. The system uses AI to understand user intent and extract search parameters from flexible, unstructured prompts. Users can search for events by:
- **City**: "What are the events in Las Vegas?"
- **Venue/Club with Date Range**: "What are the events at XS Nightclub in December?"
- **Performer**: "What are the events with Drake anywhere?"

The AI will intelligently parse these prompts and extract the relevant search criteria, even when the user's input is unclear or uses different phrasing.

## Version History

- **v1.0.0** (2025-01-XX): Initial feature plan

---

## Table of Contents

1. [Feature Requirements](#feature-requirements)
2. [Architecture Overview](#architecture-overview)
3. [Backend Implementation](#backend-implementation)
4. [AI Intent Recognition](#ai-intent-recognition)
5. [Mobile Implementation](#mobile-implementation)
6. [Testing Plan](#testing-plan)
7. [Timeline](#timeline)

---

## Feature Requirements

### User Stories

1. **As a user**, I want to search for events in a specific city, so I can see what's available there.
2. **As a user**, I want to search for events at a specific venue/club within a date range, so I can plan my visit.
3. **As a user**, I want to search for events featuring a specific performer, so I can find their shows regardless of location.
4. **As a user**, I want to use natural language to search, so I don't have to learn a specific query format.

### Search Patterns

The system must recognize and handle these three primary search patterns:

#### Pattern A: City-Based Search
- **Example Prompts**:
  - "What are the events in Las Vegas?"
  - "Show me events in Miami"
  - "Events happening in New York"
  - "What's going on in LA?"
- **Extracted Parameters**:
  - `city`: "Las Vegas" (or variations like "Vegas", "Las Vegas, NV")
  - `date_range`: Optional (if not specified, default to upcoming events)
  - `location`: null
  - `performer`: null

#### Pattern B: Venue/Club with Date Range
- **Example Prompts**:
  - "What are the events at XS Nightclub in December?"
  - "Show me events at Marquee between Nov 15 and Nov 20"
  - "What's happening at Tao in the next week?"
  - "Events at Hakkasan from Dec 1 to Dec 10"
- **Extracted Parameters**:
  - `location_name`: "XS Nightclub" (or venue name variations)
  - `date_range`: { start_date, end_date } (extracted from prompt)
  - `city`: Optional (can be inferred from venue if venue is unique)
  - `performer`: null

#### Pattern C: Performer-Based Search
- **Example Prompts**:
  - "What are the events with Drake anywhere?"
  - "Show me Drake's shows"
  - "Where is Calvin Harris performing?"
  - "Find events featuring The Weeknd"
- **Extracted Parameters**:
  - `performer`: "Drake" (or performer name variations)
  - `location`: null (search across all locations)
  - `city`: Optional (if specified, filter to that city)
  - `date_range`: Optional (if not specified, default to upcoming events)

### Combined Patterns

The system should also handle combined queries:
- "What are the events with Drake in Las Vegas in December?"
- "Show me events at XS Nightclub with Calvin Harris next week"

---

## Architecture Overview

### Current System Analysis

#### Existing Components

1. **Bot Service** (`server/services/botService.js`):
   - Handles user prompts via OpenAI
   - Uses function calling to execute tools
   - Maintains conversation history

2. **Bot Tools** (`server/services/botTools.js`):
   - Registry of available tools
   - Currently has `get_events_by_date` tool

3. **Bot Tool Handlers** (`server/services/botToolHandlers.js`):
   - `handleGetEventsByDate`: Queries events by date range with optional location filter
   - Supports location filtering by name or city
   - Returns events with location details, pricing, availability

4. **Event Model** (`server/models/Event.js`):
   - `location_id`: Reference to Location
   - `start_datetime`, `end_datetime`: Event timing
   - `performers`: Array of performer objects with `perfcode`, `importance`, `apprtime`
   - `name`, `description`: Event details
   - Indexes: `location_id`, `start_datetime`, text search on `name` and `description`

5. **Location Model** (`server/models/Location.js`):
   - `address.city`: City name
   - `name`: Venue/club name
   - `type`: night_club, day_club, restaurant, hotel

6. **Event Routes** (`server/routes/events.js`):
   - `GET /v1/events`: Admin-only endpoint with filtering
   - Supports: `location_id`, `status`, `type`, `start_date`, `end_date`, `search`

#### Gaps Identified

1. **No Performer Search**: Current `get_events_by_date` tool doesn't support searching by performer name
2. **Limited AI Intent Recognition**: Current system relies on explicit parameters, not natural language parsing
3. **No Flexible Query Builder**: Need a service that can build MongoDB queries from extracted intent
4. **No Client-Accessible Event Search**: Current `/v1/events` route requires admin role

---

## Backend Implementation

### Phase 1: Create Event Search Service

**File**: `server/services/eventSearchService.js`

**Purpose**: Centralized service for building flexible event queries based on extracted search parameters.

**Functions**:

#### 1. `searchEvents(searchParams, options = {})`
**Description**: Main search function that builds and executes MongoDB queries based on search parameters.

**Parameters**:
```javascript
{
  city: string | null,              // City name (e.g., "Las Vegas")
  location_name: string | null,     // Venue/club name (e.g., "XS Nightclub")
  performer: string | null,         // Performer name (e.g., "Drake")
  start_date: Date | null,          // Start date for date range
  end_date: Date | null,            // End date for date range
  status: string | 'active',        // Event status filter
  limit: number | 100,              // Max results
  skip: number | 0                  // Pagination offset
}
```

**Returns**: 
```javascript
{
  events: Array<Event>,             // Array of event documents
  total: number,                     // Total count (for pagination)
  pagination: {
    page: number,
    limit: number,
    total: number,
    pages: number
  }
}
```

**Implementation Logic**:
1. Build MongoDB filter object based on provided parameters
2. Handle city filtering: Find locations in city, then filter events by `location_id`
3. Handle venue filtering: Find location by name (case-insensitive), then filter events
4. Handle performer filtering: Search in `performers` array using `perfcode` or fuzzy matching on performer names
5. Handle date range: Filter by `start_datetime` and `end_datetime`
6. Execute query with population of `location_id`
7. Return formatted results

**Code Structure**:
```javascript
const Event = require('../models/Event');
const Location = require('../models/Location');
const mongoose = require('mongoose');

/**
 * Search events based on flexible parameters
 * @param {Object} searchParams - Search criteria
 * @param {Object} options - Query options (pagination, sorting, etc.)
 * @returns {Promise<Object>} Search results with events and pagination
 */
async function searchEvents(searchParams, options = {}) {
  try {
    const {
      city,
      location_name,
      performer,
      start_date,
      end_date,
      status = 'active'
    } = searchParams;

    const {
      limit = 100,
      skip = 0,
      sort = { start_datetime: 1 }
    } = options;

    // Build base filter
    const filter = {};

    // Status filter
    if (status) {
      filter.status = status;
    }

    // Date range filter
    if (start_date || end_date) {
      filter.start_datetime = {};
      if (start_date) {
        filter.start_datetime.$gte = new Date(start_date);
      }
      if (end_date) {
        filter.start_datetime.$lte = new Date(end_date);
      }
    } else {
      // Default: only upcoming events if no date specified
      filter.start_datetime = { $gte: new Date() };
    }

    // Location filter (city or venue)
    if (city || location_name) {
      const locationFilter = {};
      
      if (city) {
        locationFilter['address.city'] = { $regex: city, $options: 'i' };
      }
      
      if (location_name) {
        locationFilter.name = { $regex: location_name, $options: 'i' };
      }

      const locations = await Location.find(locationFilter).select('_id');
      
      if (locations.length > 0) {
        filter.location_id = { $in: locations.map(loc => loc._id) };
      } else {
        // No matching locations found, return empty result
        return {
          events: [],
          total: 0,
          pagination: {
            page: Math.floor(skip / limit) + 1,
            limit,
            total: 0,
            pages: 0
          }
        };
      }
    }

    // Performer filter
    if (performer) {
      // Search in performers array
      // Note: Currently performers only have perfcode, not name
      // We'll need to enhance this with a performer name lookup or fuzzy matching
      // For now, we'll search by perfcode if it matches, or use text search on event name/description
      filter.$or = [
        { 'performers.perfcode': { $regex: performer, $options: 'i' } },
        { name: { $regex: performer, $options: 'i' } },
        { description: { $regex: performer, $options: 'i' } }
      ];
    }

    // Execute query
    const [events, total] = await Promise.all([
      Event.find(filter)
        .populate('location_id', 'name type address geo media sentiment')
        .select('name description type start_datetime end_datetime base_price currency status media seats performers')
        .sort(sort)
        .skip(skip)
        .limit(limit),
      Event.countDocuments(filter)
    ]);

    return {
      events,
      total,
      pagination: {
        page: Math.floor(skip / limit) + 1,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    };
  } catch (error) {
    console.error('[EventSearchService] Error searching events:', error);
    throw error;
  }
}

module.exports = {
  searchEvents
};
```

**Notes**:
- Performer search is limited by current Event model (only `perfcode` stored, not performer names)
- May need to enhance Event model or create a Performer lookup table in the future
- For MVP, performer search will use fuzzy matching on event name/description

---

### Phase 2: Create AI Intent Extraction Service

**File**: `server/services/eventSearchIntentService.js`

**Purpose**: Use OpenAI to extract structured search parameters from natural language prompts.

**Functions**:

#### 1. `extractSearchIntent(userPrompt, conversationContext = {})`
**Description**: Uses OpenAI to parse user prompt and extract search parameters.

**Parameters**:
- `userPrompt` (string): User's natural language query
- `conversationContext` (object): Optional context from conversation history

**Returns**:
```javascript
{
  intent_type: 'city' | 'venue' | 'performer' | 'combined' | 'unclear',
  parameters: {
    city: string | null,
    location_name: string | null,
    performer: string | null,
    start_date: string | null,  // ISO 8601 format
    end_date: string | null,    // ISO 8601 format
    date_text: string | null    // Original date text from prompt
  },
  confidence: number,            // 0-1 confidence score
  clarification_needed: boolean,
  clarification_message: string | null
}
```

**Implementation**:
```javascript
const OpenAI = require('openai');
const { parseAndNormalizeDate } = require('../utils/dateParser');

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const openaiClient = OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;
const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

/**
 * Extract event search intent from user prompt
 * @param {string} userPrompt - User's natural language query
 * @param {Object} conversationContext - Optional conversation context
 * @returns {Promise<Object>} Extracted search intent and parameters
 */
async function extractSearchIntent(userPrompt, conversationContext = {}) {
  if (!openaiClient) {
    throw new Error('OpenAI API key not configured');
  }

  try {
    const systemPrompt = `You are an expert at understanding event search queries. Extract structured search parameters from user prompts.

The user can search for events in three ways:
1. By CITY: "What are the events in Las Vegas?" → city: "Las Vegas"
2. By VENUE/CLUB with DATE RANGE: "What are the events at XS Nightclub in December?" → location_name: "XS Nightclub", date_range: December
3. By PERFORMER: "What are the events with Drake anywhere?" → performer: "Drake"

You must extract:
- city: City name (normalize variations like "Vegas" → "Las Vegas", "LA" → "Los Angeles", "NYC" → "New York")
- location_name: Venue/club name (exact name or common variations)
- performer: Performer/DJ/artist name
- date_range: Start and end dates in ISO 8601 format, or relative dates like "next week", "December", "in 2 months"

Return JSON with:
{
  "intent_type": "city" | "venue" | "performer" | "combined" | "unclear",
  "city": "city name or null",
  "location_name": "venue name or null",
  "performer": "performer name or null",
  "date_text": "original date text from prompt or null",
  "start_date": "ISO 8601 date or null",
  "end_date": "ISO 8601 date or null",
  "confidence": 0.0-1.0,
  "clarification_needed": true/false,
  "clarification_message": "message if clarification needed or null"
}

IMPORTANT:
- Convert relative dates to ISO 8601 (e.g., "next week" → calculate from today)
- Normalize city names to full names
- If intent is unclear, set clarification_needed: true
- If date range is ambiguous (e.g., "December"), use start of month as start_date and end of month as end_date`;

    const completion = await openaiClient.chat.completions.create({
      model: MODEL,
      messages: [
        {
          role: 'system',
          content: systemPrompt
        },
        {
          role: 'user',
          content: userPrompt
        }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.3 // Lower temperature for consistent extraction
    });

    const extracted = JSON.parse(completion.choices[0].message.content);

    // Post-process dates using existing date parser utility
    if (extracted.date_text && !extracted.start_date) {
      try {
        const parsed = parseAndNormalizeDate(extracted.date_text, conversationContext.user_tz || 'UTC');
        extracted.start_date = parsed.startDate?.toISOString() || null;
        extracted.end_date = parsed.endDate?.toISOString() || null;
      } catch (error) {
        console.warn('[EventSearchIntentService] Date parsing failed:', error);
      }
    }

    return extracted;
  } catch (error) {
    console.error('[EventSearchIntentService] Error extracting intent:', error);
    throw error;
  }
}

module.exports = {
  extractSearchIntent
};
```

**Integration with Date Parser**:
- Reuse existing `parseAndNormalizeDate` utility from `server/utils/dateParser.js`
- Handle timezone from conversation context if available

---

### Phase 3: Create New Bot Tool

**File**: `server/services/botTools.js`

**Add New Tool**: `search_events`

**Tool Definition**:
```javascript
search_events: {
  name: 'search_events',
  description: 'Search for events using natural language. Use this tool when users ask about events in a city, events at a venue/club, or events with a specific performer. Examples: "What are the events in Las Vegas?", "Show me events at XS Nightclub in December", "What are the events with Drake anywhere?". The tool will intelligently extract search parameters from the user\'s prompt.',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'User\'s natural language search query (e.g., "events in Las Vegas", "Drake shows", "XS Nightclub in December")'
      },
      city: {
        type: 'string',
        description: 'City name (optional - will be extracted from query if present)'
      },
      location_name: {
        type: 'string',
        description: 'Venue/club name (optional - will be extracted from query if present)'
      },
      performer: {
        type: 'string',
        description: 'Performer/DJ/artist name (optional - will be extracted from query if present)'
      },
      start_date: {
        type: 'string',
        description: 'Start date in ISO 8601 format (optional - will be extracted from query if present)',
        format: 'date-time'
      },
      end_date: {
        type: 'string',
        description: 'End date in ISO 8601 format (optional - will be extracted from query if present)',
        format: 'date-time'
      }
    },
    required: ['query']
  },
  schema_version: '1.0.0',
  permissions: ['admin', 'client', 'runner'],
  handler: 'handleSearchEvents'
}
```

**Tool Handler**: `server/services/botToolHandlers.js`

**Function**: `handleSearchEvents`

```javascript
const { extractSearchIntent } = require('./eventSearchIntentService');
const { searchEvents } = require('./eventSearchService');

/**
 * Handle event search tool call
 * @param {Object} params - Tool parameters
 * @param {Object} user - Current user
 * @param {string} correlationId - Correlation ID for tracing
 * @returns {Promise<Object>} Search results
 */
async function handleSearchEvents(params, user, correlationId) {
  try {
    const { query, city, location_name, performer, start_date, end_date } = params;

    console.log('[BOT] handleSearchEvents called:', {
      query,
      provided_params: { city, location_name, performer, start_date, end_date },
      correlationId
    });

    // Extract intent from query if parameters not explicitly provided
    let searchParams = {
      city: city || null,
      location_name: location_name || null,
      performer: performer || null,
      start_date: start_date || null,
      end_date: end_date || null
    };

    // If query is provided and parameters are missing, use AI to extract intent
    if (query && (!city && !location_name && !performer)) {
      console.log('[BOT] Extracting search intent from query:', query);
      const intent = await extractSearchIntent(query, {
        user_tz: user.timezone || 'UTC'
      });

      console.log('[BOT] Extracted intent:', intent);

      if (intent.clarification_needed) {
        return {
          success: false,
          message: intent.clarification_message || 'I need more information to search for events. Could you specify a city, venue, or performer?',
          data: []
        };
      }

      // Merge extracted parameters
      searchParams = {
        city: searchParams.city || intent.city || null,
        location_name: searchParams.location_name || intent.location_name || null,
        performer: searchParams.performer || intent.performer || null,
        start_date: searchParams.start_date || intent.start_date || null,
        end_date: searchParams.end_date || intent.end_date || null
      };
    }

    // Execute search
    const results = await searchEvents(searchParams, {
      limit: 50,
      skip: 0
    });

    // Format response
    const formattedEvents = results.events.map(event => ({
      id: event._id.toString(),
      name: event.name,
      description: event.description,
      type: event.type,
      start_datetime: event.start_datetime,
      end_datetime: event.end_datetime,
      base_price: event.base_price,
      currency: event.currency || 'USD',
      status: event.status,
      location: event.location_id ? {
        id: event.location_id._id.toString(),
        name: event.location_id.name,
        type: event.location_id.type,
        city: event.location_id.address?.city,
        country: event.location_id.address?.country,
        address: event.location_id.address || null,
        geo: event.location_id.geo || null,
        media: event.location_id.media || []
      } : null,
      performers: event.performers || [],
      media: event.media || []
    }));

    return {
      success: true,
      data: formattedEvents,
      total: results.total,
      pagination: results.pagination,
      message: `Found ${results.total} event(s) matching your search.`
    };
  } catch (error) {
    console.error('[BOT] handleSearchEvents error:', error);
    return {
      success: false,
      message: `Error searching events: ${error.message}`,
      data: []
    };
  }
}
```

**Update Bot System Message**:
- Add instruction to use `search_events` tool when users ask about events in cities, venues, or with performers
- Update `server/services/botService.js` system message in `getOrCreateConversation`

---

### Phase 4: Create Client-Accessible API Endpoint

**File**: `server/routes/events.js`

**New Endpoint**: `GET /v1/events/search`

**Purpose**: Allow clients (not just admins) to search events using the same flexible search service.

**Implementation**:
```javascript
const { authenticateToken } = require('../middleware/auth');
const { searchEvents } = require('../services/eventSearchService');
const { extractSearchIntent } = require('../services/eventSearchIntentService');

/**
 * GET /v1/events/search
 * @description Search events using natural language or structured parameters
 * @access Client, Admin, Runner
 */
router.get('/search', authenticateToken, async (req, res) => {
  try {
    const {
      query,           // Natural language query (optional)
      city,            // City name (optional)
      location_name,   // Venue/club name (optional)
      performer,       // Performer name (optional)
      start_date,      // ISO 8601 start date (optional)
      end_date,        // ISO 8601 end date (optional)
      status = 'active',
      page = 1,
      limit = 20
    } = req.query;

    // Build search parameters
    let searchParams = {
      city: city || null,
      location_name: location_name || null,
      performer: performer || null,
      start_date: start_date || null,
      end_date: end_date || null,
      status
    };

    // If query is provided, extract intent
    if (query && (!city && !location_name && !performer)) {
      try {
        const intent = await extractSearchIntent(query, {
          user_tz: req.user.timezone || 'UTC'
        });

        if (!intent.clarification_needed) {
          searchParams = {
            city: searchParams.city || intent.city || null,
            location_name: searchParams.location_name || intent.location_name || null,
            performer: searchParams.performer || intent.performer || null,
            start_date: searchParams.start_date || intent.start_date || null,
            end_date: searchParams.end_date || intent.end_date || null,
            status
          };
        } else {
          return res.status(400).json({
            success: false,
            error: {
              message: intent.clarification_message || 'Please provide more specific search criteria.',
              code: 'CLARIFICATION_NEEDED'
            }
          });
        }
      } catch (error) {
        console.error('[EventsRoute] Error extracting search intent:', error);
        // Continue with provided parameters if extraction fails
      }
    }

    // Execute search
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const results = await searchEvents(searchParams, {
      limit: parseInt(limit),
      skip,
      sort: { start_datetime: 1 }
    });

    res.json({
      success: true,
      data: results.events,
      pagination: results.pagination
    });
  } catch (error) {
    console.error('Error searching events:', error);
    res.status(500).json({
      success: false,
      error: {
        message: 'Failed to search events',
        details: error.message
      }
    });
  }
});
```

**Security**:
- Use `authenticateToken` (not `requireAdmin`)
- All authenticated users can search events
- Only return events with `status: 'active'` by default (unless admin specifies otherwise)

---

## AI Intent Recognition

### Prompt Engineering Strategy

The AI intent extraction service uses a carefully crafted system prompt to:
1. **Recognize Search Patterns**: Identify city, venue, or performer queries
2. **Normalize Variations**: Convert "Vegas" → "Las Vegas", "LA" → "Los Angeles"
3. **Extract Dates**: Parse natural language dates ("December", "next week") to ISO 8601
4. **Handle Ambiguity**: Detect when clarification is needed

### Examples of Intent Extraction

| User Prompt | Extracted Intent |
|------------|-----------------|
| "What are the events in Las Vegas?" | `{ intent_type: 'city', city: 'Las Vegas' }` |
| "Show me events at XS Nightclub in December" | `{ intent_type: 'venue', location_name: 'XS Nightclub', start_date: '2025-12-01T00:00:00Z', end_date: '2025-12-31T23:59:59Z' }` |
| "What are the events with Drake anywhere?" | `{ intent_type: 'performer', performer: 'Drake' }` |
| "Events in Miami with Calvin Harris next week" | `{ intent_type: 'combined', city: 'Miami', performer: 'Calvin Harris', start_date: <next week start>, end_date: <next week end> }` |

### Error Handling

- **Unclear Intent**: Return `clarification_needed: true` with helpful message
- **Missing Dates**: Default to upcoming events (start_date = today)
- **Invalid Dates**: Log warning and use default date range
- **No Results**: Return empty array with message "No events found matching your criteria"

---

## Mobile Implementation

### Phase 1: Update Bot Interface

**File**: `mobile/app/(tabs)/bot.js`

**Changes**:
- No changes needed initially - bot will automatically use new `search_events` tool
- Users can type natural language queries in the bot chat

### Phase 2: Create Event Search Screen (Optional)

**File**: `mobile/app/event-search.js` (new file)

**Purpose**: Dedicated screen for event search with filters and results list.

**Features**:
- Search input field (natural language)
- Filter chips (City, Venue, Performer)
- Results list with event cards
- Pull-to-refresh
- Pagination

**Implementation**:
- Use existing `EventCard` component if available
- Call `/v1/events/search` API endpoint
- Display results in `FlatList` or `SectionList`

**Note**: This is optional for MVP. Bot interface may be sufficient initially.

---

## Testing Plan

### Unit Tests

1. **EventSearchService Tests**:
   - Test city filtering
   - Test venue filtering
   - Test performer filtering (with current limitations)
   - Test date range filtering
   - Test combined filters
   - Test pagination

2. **EventSearchIntentService Tests**:
   - Test city extraction ("Las Vegas", "Vegas", "LA")
   - Test venue extraction ("XS Nightclub", "Marquee")
   - Test performer extraction ("Drake", "Calvin Harris")
   - Test date extraction ("December", "next week", "Nov 15-20")
   - Test combined queries
   - Test unclear queries (should return clarification_needed)

### Integration Tests

1. **Bot Tool Integration**:
   - Test bot recognizes event search prompts
   - Test bot calls `search_events` tool
   - Test bot formats and displays results

2. **API Endpoint Tests**:
   - Test `/v1/events/search` with natural language query
   - Test `/v1/events/search` with structured parameters
   - Test authentication and authorization
   - Test pagination

### Manual Testing Scenarios

1. **City Search**:
   - "What are the events in Las Vegas?"
   - "Show me events in Miami"
   - Verify results are filtered by city

2. **Venue Search**:
   - "What are the events at XS Nightclub in December?"
   - "Show me events at Marquee next week"
   - Verify results are filtered by venue and date range

3. **Performer Search**:
   - "What are the events with Drake anywhere?"
   - "Where is Calvin Harris performing?"
   - Verify results include performer (note: limited by current data model)

4. **Combined Search**:
   - "Events in Las Vegas with Drake in December"
   - Verify all filters are applied

5. **Edge Cases**:
   - Empty results
   - Invalid city/venue/performer
   - Ambiguous queries (should ask for clarification)
   - Date parsing edge cases

---

## Timeline

### Phase 1: Backend Core (Week 1)
- [ ] Create `eventSearchService.js`
- [ ] Create `eventSearchIntentService.js`
- [ ] Add `search_events` bot tool
- [ ] Implement `handleSearchEvents` handler
- [ ] Update bot system message

### Phase 2: API Endpoint (Week 1-2)
- [ ] Create `GET /v1/events/search` endpoint
- [ ] Add authentication (client, admin, runner)
- [ ] Test API endpoint

### Phase 3: Testing & Refinement (Week 2)
- [ ] Unit tests for services
- [ ] Integration tests for bot tool
- [ ] Manual testing scenarios
- [ ] Fix bugs and edge cases

### Phase 4: Mobile (Optional - Week 3)
- [ ] Test bot interface with new tool
- [ ] Create dedicated search screen (if needed)
- [ ] Mobile testing

### Phase 5: Documentation & Deployment (Week 3)
- [ ] Update API documentation
- [ ] Update bot prompts documentation
- [ ] Deploy to staging
- [ ] User acceptance testing

---

## Future Enhancements

### Performer Database

**Current Limitation**: Event model only stores `perfcode` (GXN performer code), not performer names. Performer search uses fuzzy matching on event name/description.

**Future Enhancement**: Create a `Performer` model or lookup table:
```javascript
{
  perfcode: String,      // GXN performer code
  name: String,          // Performer name
  aliases: [String],     // Alternative names
  genre: String,         // Music genre
  popularity: Number     // Popularity score
}
```

This would enable accurate performer search by name.

### Advanced Search Features

- **Genre Filtering**: "EDM events in Las Vegas"
- **Price Range**: "Events under $500 in Miami"
- **Availability**: "Events with available seats in December"
- **Sentiment Matching**: "Luxury events in Las Vegas" (using sentiment data)

### Search Analytics

- Track popular search queries
- Identify trending cities, venues, performers
- Optimize search results based on user behavior

---

## Dependencies

### Existing Services/Utilities
- `server/utils/dateParser.js` - Date parsing utility
- `server/models/Event.js` - Event model
- `server/models/Location.js` - Location model
- OpenAI API - For intent extraction

### New Dependencies
- None (all dependencies already in use)

---

## Security Considerations

1. **Authentication**: All endpoints require `authenticateToken`
2. **Authorization**: Event search is available to all authenticated users (admin, client, runner)
3. **Input Validation**: Validate and sanitize all search parameters
4. **Rate Limiting**: Consider rate limiting for search endpoints to prevent abuse
5. **Data Exposure**: Only return events with appropriate status (default: 'active')

---

## Notes

- **Performer Search Limitation**: Current implementation uses fuzzy matching on event name/description. For accurate performer search, consider enhancing the Event model or creating a Performer lookup table.
- **Date Parsing**: Reuses existing `parseAndNormalizeDate` utility for consistency with COE creation flow.
- **Bot Integration**: The new `search_events` tool will be automatically available in the bot interface once implemented.
- **Backward Compatibility**: Existing `get_events_by_date` tool remains available for explicit date range queries.

---

## Changelog

### v1.0.0 (2025-01-XX)
- Initial feature plan
- Defined search patterns (city, venue, performer)
- Planned backend services and bot tool integration
- Outlined mobile implementation approach

