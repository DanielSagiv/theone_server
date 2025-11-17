# COE Creation via Bot - Stage 2: Event Search, Sentiment Matching & Draft COE Creation

## Overview
This document outlines **Stage 2** of the COE (Curated One Experience) creation flow via the bot/AI interface. After collecting user preferences in Stage 1, Stage 2 focuses on:
1. Processing submitted preferences
2. Searching for relevant events based on preferences
3. Matching events using sentiment data with **OpenAI semantic understanding**
4. Auto-selecting events and seats
5. Creating a draft COE
6. Displaying the draft for user review and editing

**Key Innovation:** Stage 2 leverages OpenAI for semantic understanding of user preferences, enabling accurate matching between free-text preferences and event sentiment data. This approach provides superior accuracy compared to keyword/regex matching and generates human-readable explanations for matches.

## Prerequisites
- **Stage 1 Complete**: User preferences collection card is implemented and functional
- **User has submitted preferences** via the preferences form
- **Preferences include**: City, start date, end date, budget, party size, seat preferences, specific preferences
- **OpenAI API Access**: OpenAI API key configured (`OPENAI_API_KEY` environment variable)
- **OpenAI Models Available**:
  - Chat completion model: `gpt-4o-mini` (or configured `OPENAI_MODEL`)
  - Embeddings model: `text-embedding-3-small` (for semantic similarity)

## Current State Analysis

### Already Implemented ✅
- `handleCreateCOEDraft` tool exists in `services/botToolHandlers.js`
- `autoSelectEventsBySentiment` function in `services/botSentimentService.js`
- `selectSeatsByBudgetAndCapacity` function in `services/botAutoFillService.js`
- Event querying by date range in `handleGetEventsByDate`
- Basic sentiment matching logic
- COE creation endpoint and service
- Draft COE display (via `formatCOEResponse`)

### What Needs Implementation 🔨
1. **Preference Extraction**: Parse structured preferences from form submission message
2. **City Filter**: Add city filtering to event search
3. **Enhanced Sentiment Matching with OpenAI**: Use OpenAI for semantic understanding and matching of free-text preferences
4. **Auto-Trigger**: Automatically call `create_coe_draft` after preferences submission
5. **Draft COE UI**: Enhanced display with edit capabilities and AI-generated match reasons

## Implementation Phases

### Phase 2.1: Preference Extraction & Parsing
**Priority:** High (Foundation for all other phases)  
**Estimated Complexity:** Medium  
**Dependencies:** None

#### Objectives
- Extract structured preferences from user's form submission message
- Parse all preference fields (city, dates, budget, party size, text preferences)
- Validate extracted preferences
- Store preferences in conversation context

#### Implementation Details

**Location:** `services/botPreferenceService.js` (enhance existing or create new functions)

**New Functions:**
```javascript
/**
 * Extract structured preferences from form submission message
 * @param {string} message - User message containing preferences
 * Format: "City: Las Vegas\nStart date: 2025-11-15\nEnd date: 2025-11-20\n..."
 * @returns {Object} Structured preferences object
 */
function extractPreferencesFromFormSubmission(message) {
  // Returns:
  // {
  //   city: 'Las Vegas',
  //   start_date: '2025-11-15',
  //   end_date: '2025-11-20',
  //   budget: { amount: 5000, currency: 'USD' },
  //   party_size: 4,
  //   seat_preferences: 'VIP table near the stage',
  //   specific_preferences: 'EDM music, upscale atmosphere'
  // }
}

/**
 * Convert text preferences to sentiment keywords
 * @param {string} seatPreferences - Seat/table preferences text
 * @param {string} specificPreferences - Specific preferences text
 * @returns {Array<string>} Array of preference keywords for sentiment matching
 */
function extractPreferenceKeywords(seatPreferences, specificPreferences) {
  // Extract keywords like: ['VIP', 'luxury', 'EDM', 'upscale', 'birthday', 'near stage']
  // Map to sentiment categories: ['nightlife', 'luxury', 'music', 'dining', etc.]
}
```

**Key Features:**
- Parse structured message format from preferences form
- Handle variations in message format
- Extract city name (for location filtering)
- Parse dates (ISO format or natural language)
- Extract budget amount and currency
- Parse party size
- Extract free-text preferences
- Validate all extracted data
- Return structured object for tool usage

**Edge Cases:**
- Missing fields (use defaults or ask user)
- Invalid date formats
- Invalid budget values
- Empty text preferences
- City name variations (normalize)

---

### Phase 2.2: Enhanced Event Search with City Filter
**Priority:** High  
**Estimated Complexity:** Low-Medium  
**Dependencies:** Phase 2.1 (for city extraction)

#### Objectives
- Add city filtering to event search
- Filter events by location city matching user's selected city
- Ensure events are within date range
- Filter by budget constraints (event price + seat prices)
- Filter by party size (seat capacity >= party_size)

#### Implementation Details

**Location:** `services/botToolHandlers.js` - `handleGetEventsByDate`

**Enhancements:**
```javascript
// Add city filter to event query
if (preferences.city) {
  // Find locations in the specified city
  const locationsInCity = await Location.find({
    'address.city': { $regex: new RegExp(preferences.city, 'i') },
    status: 'active'
  }).select('_id');
  
  const locationIds = locationsInCity.map(loc => loc._id);
  
  // Filter events by location
  filter.location_id = { $in: locationIds };
}

// Add budget filter (if provided)
if (preferences.budget?.amount) {
  // Filter events where base_price + seat prices fit within budget
  // This may require aggregation or post-filtering
}

// Add party size filter
if (preferences.party_size) {
  // Filter events with seats that have capacity >= party_size
  // This may require post-filtering after population
}
```

**Key Features:**
- City-based location filtering (case-insensitive)
- Budget-aware filtering (consider event price + seat prices)
- Party size filtering (seat capacity matching)
- Maintain existing date range filtering
- Maintain existing status filtering
- Return events with populated location data

**Edge Cases:**
- City not found (return empty or suggest alternatives)
- No events in city (inform user)
- Budget too low (suggest increasing or show partial results)
- Party size too large (suggest splitting or show available options)

---

### Phase 2.3: Enhanced Sentiment Matching with OpenAI
**Priority:** High  
**Estimated Complexity:** Medium  
**Dependencies:** Phase 2.1 (for preference extraction), OpenAI API access

#### Objectives
- Use OpenAI to understand user preferences semantically
- Extract structured preferences from free-text using AI
- Match preferences against sentiment data using semantic similarity
- Generate human-readable match reasons
- Rank events by AI-calculated match scores

#### Implementation Details

**Location:** `services/botSentimentService.js`

**Approach:** Hybrid OpenAI-based matching using:
1. **OpenAI Chat Completion** for preference extraction and understanding
2. **OpenAI Embeddings** for semantic similarity matching
3. **OpenAI Chat Completion** for generating match reasons

**New Functions:**
```javascript
/**
 * Use OpenAI to extract structured preferences from free text
 * @param {string} seatPreferences - Seat/table preferences text
 * @param {string} specificPreferences - Specific preferences text
 * @returns {Promise<Object>} Structured preferences with categories, keywords, intent
 */
async function extractStructuredPreferences(seatPreferences, specificPreferences) {
  const prompt = `Extract and categorize user preferences from this text:
"${seatPreferences} ${specificPreferences}"

Return JSON with:
{
  "categories": ["luxury", "music", "atmosphere"],
  "keywords": ["VIP", "EDM", "upscale", "birthday"],
  "intent": "special occasion celebration with premium experience",
  "requirements": ["private area", "live music", "upscale atmosphere"],
  "priority": "high" // or "medium", "low"
}`;

  const completion = await openaiClient.chat.completions.create({
    model: MODEL, // Same model as bot (gpt-4o-mini)
    messages: [
      {
        role: 'system',
        content: 'You are an expert at understanding user preferences for events and experiences. Always return valid JSON.'
      },
      {
        role: 'user',
        content: prompt
      }
    ],
    response_format: { type: 'json_object' },
    temperature: 0.3 // Lower temperature for consistent extraction
  });

  return JSON.parse(completion.choices[0].message.content);
}

/**
 * Use OpenAI embeddings to calculate semantic similarity
 * @param {Object} structuredPreferences - Extracted preferences
 * @param {Array} events - Events with sentiment data
 * @returns {Promise<Array>} Events with match scores
 */
async function matchEventsWithEmbeddings(structuredPreferences, events) {
  // Create embedding for user preferences
  const preferencesText = [
    structuredPreferences.intent,
    ...structuredPreferences.categories,
    ...structuredPreferences.keywords,
    ...structuredPreferences.requirements
  ].join(' ');

  const preferencesEmbedding = await openaiClient.embeddings.create({
    model: 'text-embedding-3-small', // Cost-effective embedding model
    input: preferencesText
  });

  // Match each event
  const eventMatches = await Promise.all(events.map(async (event) => {
    // Combine all event sentiment and attributes
    const eventText = [
      ...(event.location_sentiment || []).map(s => s.text),
      ...(event.seat_sentiment || []).map(s => s.text),
      ...(event.location_attributes?.musicGenres || []),
      ...(event.location_attributes?.cuisine || []),
      event.location_attributes?.dressCode || '',
      event.location_attributes?.agePolicy || ''
    ].filter(Boolean).join(' ');

    if (!eventText) {
      return { event_id: event.event_id, match_score: 0.3, event };
    }

    // Get embedding for event
    const eventEmbedding = await openaiClient.embeddings.create({
      model: 'text-embedding-3-small',
      input: eventText
    });

    // Calculate cosine similarity
    const similarity = cosineSimilarity(
      preferencesEmbedding.data[0].embedding,
      eventEmbedding.data[0].embedding
    );

    return {
      event_id: event.event_id,
      match_score: Math.max(0, Math.min(1, similarity)), // Clamp to 0-1
      event
    };
  }));

  // Sort by match score
  return eventMatches.sort((a, b) => b.match_score - a.match_score);
}

/**
 * Use OpenAI to generate human-readable match reasons
 * @param {Object} event - Event object
 * @param {Object} structuredPreferences - User preferences
 * @param {number} matchScore - Calculated match score
 * @returns {Promise<Array<string>>} Array of match reasons
 */
async function generateMatchReasons(event, structuredPreferences, matchScore) {
  const prompt = `Explain why this event matches the user's preferences:

User Intent: ${structuredPreferences.intent}
User Categories: ${structuredPreferences.categories.join(', ')}
User Keywords: ${structuredPreferences.keywords.join(', ')}

Event: ${event.event_name}
Location Sentiment: ${JSON.stringify(event.location_sentiment?.slice(0, 3) || [])}
Seat Sentiment: ${JSON.stringify(event.seat_sentiment?.slice(0, 3) || [])}
Attributes: ${JSON.stringify(event.location_attributes || {})}

Match Score: ${matchScore.toFixed(2)}

Provide 2-3 concise reasons (one sentence each) explaining the match.
Return as JSON array: ["reason 1", "reason 2", "reason 3"]`;

  const completion = await openaiClient.chat.completions.create({
    model: MODEL,
    messages: [
      {
        role: 'system',
        content: 'You are an expert at explaining why events match user preferences. Always return valid JSON array.'
      },
      {
        role: 'user',
        content: prompt
      }
    ],
    response_format: { type: 'json_object' },
    temperature: 0.5 // Slightly higher for more natural explanations
  });

  const result = JSON.parse(completion.choices[0].message.content);
  return result.reasons || result.match_reasons || [];
}

/**
 * Helper: Calculate cosine similarity between two vectors
 * @param {Array<number>} vecA
 * @param {Array<number>} vecB
 * @returns {number} Similarity score (-1 to 1, normalized to 0-1)
 */
function cosineSimilarity(vecA, vecB) {
  if (vecA.length !== vecB.length) return 0;
  
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  
  const similarity = dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  // Normalize from [-1, 1] to [0, 1]
  return (similarity + 1) / 2;
}
```

**Enhanced Main Function:**
```javascript
/**
 * Enhanced auto-select events using OpenAI for semantic matching
 * @param {Array} events - Available events
 * @param {Object} preferences - User preferences
 * @param {number} maxEvents - Maximum events to select
 * @returns {Promise<Array>} Selected events with AI-generated match reasons
 */
async function autoSelectEventsBySentiment(events, preferences, maxEvents = 5) {
  if (!events || events.length === 0) return [];

  // Step 1: Extract structured preferences using OpenAI
  const structuredPrefs = await extractStructuredPreferences(
    preferences.seat_preferences || '',
    preferences.specific_preferences || ''
  );

  // Step 2: Match events using embeddings
  const matchedEvents = await matchEventsWithEmbeddings(structuredPrefs, events);

  // Step 3: Generate match reasons for top events
  const topEvents = matchedEvents.slice(0, maxEvents);
  const eventsWithReasons = await Promise.all(
    topEvents.map(async (match) => {
      const reasons = await generateMatchReasons(
        match.event,
        structuredPrefs,
        match.match_score
      );

      return {
        event_id: match.event_id,
        event: match.event,
        sentimentScore: match.match_score,
        sentimentHighlights: reasons,
        matchReasons: reasons,
        structuredPreferences: structuredPrefs
      };
    })
  );

  return eventsWithReasons;
}
```

**Key Features:**
- **Semantic Understanding**: OpenAI understands context, synonyms, and intent
- **Structured Extraction**: Converts free text to structured categories and keywords
- **Embedding-Based Matching**: Uses semantic similarity (not just keyword matching)
- **Human-Readable Reasons**: AI generates explanations for matches
- **Handles Variations**: Understands "VIP", "premium", "exclusive" as similar
- **Context Awareness**: Understands "birthday celebration" = special occasion needs
- **Weighted Scoring**: Combines multiple factors (sentiment, attributes, intent)

**Cost Optimization:**
- Use `text-embedding-3-small` for embeddings (~$0.02 per 1M tokens)
- Use `gpt-4o-mini` for extraction/reasons (cost-effective)
- Batch embedding requests when possible
- Cache embeddings for frequently accessed events
- Estimated cost: ~$0.01-0.05 per matching operation (10 events)

**Edge Cases:**
- No sentiment data available (use attribute matching via embeddings)
- OpenAI API failure (fallback to keyword-based matching)
- Low match scores (return events with explanation)
- Ambiguous preferences (AI handles context)
- Rate limiting (implement retry logic with exponential backoff)

---

### Phase 2.4: Auto-Trigger COE Creation
**Priority:** High  
**Estimated Complexity:** Medium  
**Dependencies:** Phase 2.1, 2.2, 2.3

#### Objectives
- Detect preferences submission message pattern
- Extract preferences automatically
- Store preferences in conversation
- Automatically call `create_coe_draft` tool
- Handle errors gracefully
- Return draft COE response

#### Implementation Details

**Location:** `services/botService.js` - `processUserMessage`

**Flow:**
```javascript
// Detect preferences submission pattern
const preferencesPattern = /City:\s*(.+)\nStart date:\s*(.+)\nEnd date:\s*(.+)\nBudget:\s*(.+)\n/;

if (preferencesPattern.test(prompt)) {
  // Extract preferences
  const preferences = extractPreferencesFromFormSubmission(prompt);
  
  // Store in conversation
  await updateConversationPreferences(userId, preferences, 'preferences_submitted');
  
  // Auto-call create_coe_draft tool
  const toolResult = await executeTool('create_coe_draft', {
    start_date: preferences.start_date,
    end_date: preferences.end_date,
    preferences: {
      budget_range: { max: preferences.budget.amount },
      location_preferences: [preferences.city],
      party_size: preferences.party_size,
      preferences: extractPreferenceKeywords(
        preferences.seat_preferences,
        preferences.specific_preferences
      ),
      notes: `${preferences.seat_preferences}\n${preferences.specific_preferences}`
    }
  });
  
  // Return draft COE response
  return formatCOEResponse('coe_details', toolResult.data, 'Draft COE created!');
}
```

**Key Features:**
- Pattern matching for preferences submission
- Automatic preference extraction
- Conversation preference storage
- Automatic tool execution
- Error handling and user feedback
- Return structured COE response

**Edge Cases:**
- Invalid preferences format (ask user to resubmit)
- No events found (inform user, suggest alternatives)
- Budget too low (warn user, show partial results)
- Tool execution failure (show error, allow retry)

---

### Phase 2.5: Draft COE Display & Editing
**Priority:** Medium  
**Estimated Complexity:** High  
**Dependencies:** Phase 2.4

#### Objectives
- Display draft COE with enhanced information
- Show sentiment match reasons for each event
- Display pricing breakdown and budget comparison
- Add "Edit" functionality to modify COE
- Add "Approve" button to finalize COE
- Show selected seats with details

#### Implementation Details

**Location:** 
- `services/botResponseFormatter.js` - Enhanced COE response formatting
- `views/test/dashboard.ejs` - Draft COE UI rendering

**Enhanced COE Response:**
```javascript
{
  type: 'coe_draft',
  coe_id: '...',
  coe: {
    // ... existing COE fields ...
    events: [
      {
        event_id: '...',
        event_name: '...',
        event_date: '...',
        location: { name: '...', city: '...' },
        selected_seats: [...],
        sentiment_match: {
          score: 0.85,
          reasons: ['Matched EDM music preference', 'VIP seating available'],
          highlights: ['Upscale atmosphere', 'Live DJ performance']
        }
      }
    ],
    pricing: {
      subtotal: 4500,
      taxes: 450,
      fees: 200,
      total: 5150,
      budget: 5000,
      over_budget: true,
      over_amount: 150
    }
  },
  actions: [
    { type: 'edit', label: 'Edit COE', tool: 'update_coe' },
    { type: 'approve', label: 'Approve & Create', tool: 'approve_coe' },
    { type: 'cancel', label: 'Cancel', action: 'cancel_draft' }
  ]
}
```

**UI Features:**
- Draft COE card with all details
- Event list with sentiment match indicators
- Pricing breakdown with budget comparison
- Seat details per event
- Edit button (opens edit modal/form)
- Approve button (finalizes COE)
- Cancel button (discards draft)

**Key Features:**
- Visual sentiment match indicators (score badges)
- Match reasons display per event
- Budget comparison (over/under budget warnings)
- Interactive edit functionality
- Approve workflow integration
- Responsive design

**Edge Cases:**
- Over budget (highlight, suggest adjustments)
- No sentiment matches (show neutral indicator)
- Missing seats (show warning, allow selection)
- Edit conflicts (handle concurrent edits)

---

## Data Flow

```
┌─────────────────────────────────────────────────────────────┐
│ User Submits Preferences Form (Stage 1 Complete)          │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ Phase 2.1: Extract Preferences from Message                │
│ - Parse structured message                                  │
│ - Extract: city, dates, budget, party_size, text prefs     │
│ - Validate all fields                                       │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ Phase 2.2: Search Events                                    │
│ - Filter by city (location.address.city)                   │
│ - Filter by date range (start_datetime, end_datetime)      │
│ - Filter by budget (event price + seat prices)              │
│ - Filter by party size (seat capacity >= party_size)        │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ Phase 2.3: Match Sentiment with OpenAI                     │
│ - Use OpenAI to extract structured preferences             │
│ - Generate embeddings for preferences & events               │
│ - Calculate semantic similarity (cosine similarity)         │
│ - Generate match reasons using OpenAI                      │
│ - Rank events by semantic match score                       │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ Phase 2.4: Auto-Create Draft COE                           │
│ - Call create_coe_draft tool                                │
│ - Auto-select top N events (by sentiment score)            │
│ - Auto-select seats (budget-aware, capacity-aware)         │
│ - Create COE in 'draft' status                              │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ Phase 2.5: Display Draft COE                               │
│ - Show selected events with sentiment match reasons         │
│ - Show selected seats with details                          │
│ - Show pricing breakdown vs budget                          │
│ - Provide Edit/Approve/Cancel actions                       │
└─────────────────────────────────────────────────────────────┘
```

## Technical Implementation Details

### Preference Message Format
The preferences form submits a structured message:
```
City: Las Vegas
Start date: 2025-11-15
End date: 2025-11-20
Budget: $5000 USD
Number of people: 4
Seat/Table preferences: VIP table near the stage, private booth
Specific preferences: EDM music, upscale atmosphere, birthday celebration
```

### Preference Extraction Pattern
```javascript
const PREFERENCE_PATTERNS = {
  city: /City:\s*(.+)/i,
  start_date: /Start date:\s*(.+)/i,
  end_date: /End date:\s*(.+)/i,
  budget: /Budget:\s*\$?(\d+(?:\.\d+)?)\s*(USD)?/i,
  party_size: /Number of people:\s*(\d+)/i,
  seat_preferences: /Seat\/Table preferences:\s*(.+?)(?:\n|$)/i,
  specific_preferences: /Specific preferences:\s*(.+?)(?:\n|$)/i
};
```

### Sentiment Matching Algorithm (OpenAI-Based)
1. **Extract Structured Preferences**: Use OpenAI to understand and categorize free-text preferences
   - Extract categories (luxury, music, atmosphere, etc.)
   - Extract keywords and intent
   - Identify requirements and priorities
2. **Create Embeddings**: Generate embeddings for:
   - User preferences (intent + categories + keywords)
   - Event sentiment data (location + seat sentiment + attributes)
3. **Calculate Semantic Similarity**: Use cosine similarity between preference and event embeddings
4. **Generate Match Reasons**: Use OpenAI to create human-readable explanations
5. **Rank Events**: Sort by semantic similarity score (descending)
6. **Return Top Matches**: Return top N events with match scores and reasons

### Budget Filtering Logic
```javascript
// For each event:
const eventCost = event.base_price || 0;
const seatCosts = event.seats
  .filter(seat => seat.capacity >= party_size && seat.status === 'available')
  .map(seat => seat.event_price || seat.min_spend || 0);

const minTotalCost = eventCost + Math.min(...seatCosts);
const maxTotalCost = eventCost + Math.max(...seatCosts);

// Include if minTotalCost <= budget
```

## Testing Scenarios

### Happy Path
1. User submits preferences with all fields
2. System finds events in selected city
3. Sentiment matching finds good matches
4. Draft COE created successfully
5. User reviews and approves

### Edge Cases

#### No Events in City
- **Scenario**: User selects city with no events
- **Expected**: Inform user, suggest alternative cities or dates
- **Implementation**: Check event count, return helpful message

#### Budget Too Low
- **Scenario**: User budget is lower than available options
- **Expected**: Show partial results, warn about budget, suggest increase
- **Implementation**: Filter events, show budget warning in response

#### No Sentiment Matches
- **Scenario**: User preferences don't match any sentiment data
- **Expected**: Return events ranked by other factors (date, price, availability)
- **Implementation**: Fallback ranking when sentiment score is 0

#### Party Size Too Large
- **Scenario**: User party size exceeds available seat capacities
- **Expected**: Suggest splitting party or selecting multiple seats
- **Implementation**: Check seat capacities, provide suggestions

#### Invalid Preferences
- **Scenario**: User submits invalid or missing preferences
- **Expected**: Validate and ask for missing/invalid fields
- **Implementation**: Validation before processing

## Success Criteria

### Phase 2.1 ✅
- [ ] Preferences extracted correctly from form submission
- [ ] All preference fields parsed and validated
- [ ] Keywords extracted from text preferences
- [ ] Preferences stored in conversation context

### Phase 2.2 ✅
- [ ] Events filtered by city correctly
- [ ] Budget filtering works (event + seat prices)
- [ ] Party size filtering works (seat capacity)
- [ ] Date range filtering maintained

### Phase 2.3 ✅
- [ ] Keywords extracted from free text
- [ ] Sentiment matching uses keywords
- [ ] Location attributes considered
- [ ] Events ranked by sentiment score

### Phase 2.4 ✅
- [ ] Preferences submission detected automatically
- [ ] `create_coe_draft` called automatically
- [ ] Draft COE created successfully
- [ ] Errors handled gracefully

### Phase 2.5 ✅
- [ ] Draft COE displayed with all details
- [ ] Sentiment match reasons shown
- [ ] Pricing breakdown displayed
- [ ] Edit functionality works
- [ ] Approve functionality works

## Next Steps (Stage 3)
After Stage 2 is complete:
1. **COE Editing**: Allow users to modify draft COE (add/remove events, change seats)
2. **COE Approval**: Finalize draft COE and move to active status
3. **Payment Integration**: Handle payment for approved COE
4. **Runner Assignment**: Auto-assign or allow manual runner assignment
5. **Notifications**: Notify user and runner when COE is created/approved

## Related Documentation
- [Stage 1: User Preferences Collection](./bot-coe-creation-stage1.md) - Previous stage
- [Bot Architecture Plan](./bot-architecture-plan.md) - Overall bot system architecture
- [COE Specification](./coe-specification.md) - COE data model and structure
- [Sentiment Service](../services/botSentimentService.js) - Sentiment matching implementation

