# COE Creation via Bot - Stage 1: User Preferences Collection

## Overview
This document outlines **Stage 1** of the COE (Curated One Experience) creation flow via the bot/AI interface. This stage focuses on collecting user preferences through an interactive card interface.

## User Triggers

### 1. Natural Language Prompt
**User Input:**
- `"build my experience"`
- `"create my experience"`
- `"plan my experience"`
- `"build me an experience"`
- Similar variations handled by OpenAI LLM

**Bot Response:**
- Bot recognizes the intent to create a COE
- Triggers the preferences collection card

### 2. Quick Action Button
**UI Element:**
- "Create Experience" button in the bot interface
- Located under the bot response frame (above the prompt input area)
- Lightning icon displayed next to the button

**User Action:**
- User clicks "Create Experience" button
- System immediately displays the preferences collection card

## Preferences Collection Card

### Card Structure
The system displays an interactive card/form to collect the following user preferences:

#### 1. **Start Date and End Date**
- **Field Type:** Date picker (or text input with date validation)
- **Required:** Yes
- **Format:** ISO 8601 date format (YYYY-MM-DD)
- **Validation:**
  - Start date must be in the future
  - End date must be >= start date
  - Natural language date parsing supported (e.g., "next week", "Nov 15-20, 2025")
- **UI:** Two date input fields or a date range picker

#### 2. **Budget**
- **Field Type:** Number input with currency selector
- **Required:** Yes
- **Format:** Numeric value (decimal supported)
- **Currency:** Default USD (configurable)
- **Validation:**
  - Must be > 0
  - Maximum value validation (if applicable)
- **UI:** Currency symbol prefix, number input field

#### 3. **Number of People**
- **Field Type:** Number input
- **Required:** Yes
- **Format:** Integer
- **Validation:**
  - Must be >= 1
  - Maximum party size limit (if applicable)
- **UI:** Number input with increment/decrement buttons

#### 4. **Seat/Table Preferences**
- **Field Type:** Free text textarea
- **Required:** No (optional)
- **Purpose:** User can specify preferences for:
  - Table location (e.g., "near the stage", "by the window", "VIP section")
  - Table type (e.g., "booth", "high-top", "reserved table")
  - Special requirements (e.g., "wheelchair accessible", "private area")
- **UI:** Multi-line text input with placeholder text
- **Placeholder Example:** "E.g., VIP table near the stage, private booth, outdoor seating"

#### 5. **Specific Preferences**
- **Field Type:** Free text textarea
- **Required:** No (optional)
- **Purpose:** User can specify:
  - Music preferences (e.g., "EDM", "hip-hop", "live DJ")
  - Atmosphere preferences (e.g., "upscale", "casual", "party vibe")
  - Dietary restrictions (e.g., "vegetarian options", "gluten-free")
  - Special occasions (e.g., "birthday celebration", "anniversary")
  - Any other specific requirements or preferences
- **UI:** Multi-line text input with placeholder text
- **Placeholder Example:** "E.g., EDM music, upscale atmosphere, birthday celebration"

## Card UI/UX Design

### Visual Design
- **Card Style:** Matches existing bot structured response cards
- **Layout:** Clean, organized form layout
- **Spacing:** Adequate padding and margins for readability
- **Responsive:** Mobile-friendly design

### Form Behavior
- **Validation:** Real-time validation with error messages
- **Submit Button:** "Continue" or "Build My Experience" button at the bottom
- **Cancel Option:** "Cancel" or "Back" button to dismiss the card
- **Loading State:** Shows loading indicator when processing

### Error Handling
- **Required Fields:** Clear indication of required vs optional fields
- **Validation Errors:** Inline error messages below each field
- **Date Validation:** Clear error if dates are invalid or in the past
- **Budget Validation:** Error if budget is invalid or too low

## Data Structure

### Collected Preferences Object
```javascript
{
  start_date: "2025-11-15", // ISO 8601 date string
  end_date: "2025-11-20",   // ISO 8601 date string
  budget: {
    amount: 5000,           // Number
    currency: "USD"         // String (default: "USD")
  },
  party_size: 4,            // Integer (number of people)
  seat_preferences: "VIP table near the stage, private area", // String (optional)
  specific_preferences: "EDM music, upscale atmosphere, birthday celebration" // String (optional)
}
```

## Bot Integration

### Bot Tool Call
After user submits preferences, the bot will:
1. Validate all collected data
2. Call `create_coe_draft` tool with:
   - Extracted dates (`start_date`, `end_date`)
   - Budget information (`preferences.budget_range`)
   - Party size (`preferences.party_size`)
   - Location preferences (extracted from `seat_preferences` and `specific_preferences`)
   - Notes (combined from `seat_preferences` and `specific_preferences`)

### Conversation Flow
```
User: "build my experience" OR clicks "Create Experience" button
  ↓
Bot: Displays preferences collection card
  ↓
User: Fills in preferences and clicks "Continue"
  ↓
Bot: Validates preferences
  ↓
Bot: Calls create_coe_draft tool with preferences
  ↓
Bot: Displays COE draft response (Stage 2 - next phase)
```

## Implementation Notes

### Frontend (dashboard.ejs)
- Create new structured response type: `'coe_preferences_form'`
- Add `renderCOEPreferencesForm()` function
- Handle form submission and validation
- Pass collected data back to bot via message

### Backend (botService.js)
- Detect "build my experience" intent
- Return structured response with `type: 'coe_preferences_form'`
- Handle preferences submission in message processing

### Bot Tools (botTools.js)
- No new tool needed (uses existing `create_coe_draft`)
- Preferences are passed as parameters to `create_coe_draft`

### Response Formatter (botResponseFormatter.js)
- Add `formatCOEPreferencesFormResponse()` function
- Returns structured response for frontend rendering

## Validation Rules

### Start Date
- Must be provided
- Must be valid date format
- Must be in the future (not today or past)
- Error message: "Please select a future start date"

### End Date
- Must be provided
- Must be valid date format
- Must be >= start_date
- Error message: "End date must be on or after start date"

### Budget
- Must be provided
- Must be > 0
- Must be numeric
- Error message: "Please enter a valid budget amount"

### Number of People
- Must be provided
- Must be >= 1
- Must be integer
- Error message: "Please enter the number of people (minimum 1)"

### Optional Fields
- Seat/Table Preferences: No validation (free text)
- Specific Preferences: No validation (free text)

## Next Steps (Stage 2)
After preferences are collected and validated:
1. Bot calls `create_coe_draft` with preferences
2. System auto-selects events based on:
   - Date range
   - Budget constraints
   - Party size
   - Sentiment matching (from preferences)
3. Bot displays COE draft with:
   - Selected events
   - Selected seats/tables
   - Pricing breakdown
   - Runner assignment (if available)
4. User can review and approve/modify the COE draft

## Edge Cases

### Missing Required Fields
- Form cannot be submitted until all required fields are filled
- Clear visual indication of missing fields

### Invalid Date Range
- If end_date < start_date: Show error, prevent submission
- If dates are in the past: Show error, prevent submission

### Budget Too Low
- System may warn if budget is very low (e.g., < $100)
- Still allow submission, but bot may suggest increasing budget

### No Events Available
- If no events match the date range: Bot informs user and suggests alternative dates
- If events exist but exceed budget: Bot suggests increasing budget or reducing party size

## Testing Scenarios

1. **Happy Path:**
   - User provides all required fields
   - Valid dates and budget
   - Bot successfully creates COE draft

2. **Missing Fields:**
   - User tries to submit with missing required fields
   - Validation prevents submission
   - Error messages displayed

3. **Invalid Dates:**
   - User selects past dates
   - User selects end_date < start_date
   - Validation errors displayed

4. **Quick Action Button:**
   - User clicks "Create Experience" button
   - Preferences card appears immediately
   - Same flow as natural language prompt

5. **Cancel Flow:**
   - User clicks "Cancel" on preferences card
   - Card dismisses, returns to normal bot conversation

## Related Documentation
- [Bot Architecture Plan](./bot-architecture-plan.md) - Overall bot system architecture
- [COE Specification](./coe-specification.md) - COE data model and structure
- [MVP Specification](./mvp.md) - Overall platform MVP requirements

