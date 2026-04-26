# AI Direct Preference Matching - Implementation Plan

**Status**: 🔵 Planning  
**Version**: 1.0  
**Date**: January 2025  
**Author**: AI Assistant

## Overview

Replace keyword-based matching with direct AI semantic comparison between user preferences and seat sentiments. This will make the system more accurate by using AI to understand context and meaning, rather than relying on simple string matching.

**Key Principle**: Only perform AI checks for preferences/exclusions if the user has explicitly provided preference text. If no preference text is provided, skip AI preference matching entirely (no AI calls, no preference-based filtering or scoring).

## Problem Statement

### Current Approach (Keyword Matching)

**For Exclusions:**
1. Extract keywords from user preference: `["toilet", "bathroom", "restroom"]`
2. Check if keyword appears in seat sentiment using `includes()`
3. If keyword found, use AI to verify if seat is actually "near" the excluded thing
4. ❌ **Problem**: Keyword matching causes false positives
   - Seat sentiment: "not next to the toilets" 
   - Keyword: "toilet" → matches (even though seat is NOT near toilets)
   - Result: Unnecessary AI call and potential errors

**For Positive Preferences:**
1. Extract structured preferences: `{categories: [...], keywords: [...], requirements: [...], intent: "..."}`
2. Use AI to score how well seat sentiment matches structured preferences
3. ✅ This is already AI-based, but only uses structured data, not the user's original text

### Issues with Keyword Matching

1. **False Positives**: "not next to toilets" matches "toilet" keyword
2. **Missing Context**: User says "I do not want to seat next to the toilets" but we only check for "toilet"
3. **Loss of Nuance**: Full user preference text has more context than extracted keywords
4. **Unnecessary Complexity**: Two-step process (keyword match → AI verify) instead of one AI call

## Proposed Solution

### Direct AI Comparison

Use AI to directly compare:
- **User's full preference text** (e.g., "I do not want to seat next to the toilets")
- **Seat sentiment from database** (e.g., "VIP area, not next to toilets")

AI determines:
- For exclusions: Does this seat violate the user's exclusion preference?
- For positive preferences: How well does this seat match the user's wants?

### Critical Requirement: Skip AI Checks If No Preference Text

**If user does NOT provide preference text:**
- ❌ **NO** AI calls for exclusion filtering
- ❌ **NO** AI calls for preference matching
- ✅ Seats are selected based on quality score and budget only
- ✅ Faster performance (no AI overhead)

**If user DOES provide preference text:**
- ✅ Use AI to directly compare user text to seat sentiment
- ✅ More accurate semantic understanding
- ✅ No keyword matching needed

### Benefits

1. ✅ **More Accurate**: AI understands full context, not just keywords
2. ✅ **Simpler Logic**: One AI call instead of keyword matching + AI verification
3. ✅ **Better Semantic Understanding**: AI can understand synonyms, variations, and context
4. ✅ **Future-Proof**: Works with any user preference text, no need to maintain keyword lists

## Implementation Plan

### Phase 1: Exclusion Preferences (Direct AI Comparison)

**Important**: Only perform exclusion filtering if user has provided exclusion preference text. If no text provided, skip this stage entirely (all seats pass through, no AI calls).

#### 1.1 Create New AI Function

**Function**: `checkIfSeatViolatesExclusionPreference(userExclusionText, seatSentimentText)`

**Location**: `/services/botAutoFillService.js` (after line 270, before `calculatePreferenceMatchScore`)

**Inputs**:
- `userExclusionText`: Full user exclusion preference text
  - Source: `preferences.seat_preferences` OR `structuredPreferences.exclusion_intent` OR `preferences.notes`
  - Example: "I do not want to seat next to the toilets"
- `seatSentimentText`: Combined sentiment text from location seat
  - Example: "VIP area, not next to toilets, great view"

**Output**: `boolean`
- `true`: Seat violates user's exclusion preference → EXCLUDE
- `false`: Seat does NOT violate preference → INCLUDE

**AI Prompt Strategy**:
```
Analyze if this seat description violates the user's exclusion preference.

User's Exclusion Preference: "[userExclusionText]"
Seat Description: "[seatSentimentText]"

Return JSON with:
{
  "violates_preference": true/false,
  "confidence": "high"/"medium"/"low",
  "reasoning": "brief explanation"
}

Examples:
- User: "I do not want to seat next to the toilets"
  Seat: "next to the toilets" → violates_preference: TRUE
  
- User: "I do not want to seat next to the toilets"
  Seat: "not next to the toilets" → violates_preference: FALSE
  
- User: "I do not want to seat near the bathroom"
  Seat: "VIP area, great view" → violates_preference: FALSE
```

**Error Handling**:
- If AI unavailable: Return `false` (conservative - don't exclude without AI confirmation)
- If error: Log and return `false`
- If no user exclusion text: Return `false` (skip exclusion check entirely)

**Important**: Only perform AI check if user has provided exclusion preference text. If no text, skip exclusion filtering entirely.

#### 1.2 Replace Exclusion Filtering Logic

**Location**: `/services/botAutoFillService.js` (lines 667-773)

**Critical Requirement**: 
- **IF** user provides exclusion preference text → Use AI to check all seats
- **IF** user does NOT provide exclusion preference text → **SKIP** this stage entirely (all seats pass through, no AI calls)

**Current Flow** (to be replaced):
```javascript
// 1. Get exclusion keywords array
const exclusionKeywords = exclusions.map(ex => ex.toLowerCase().trim());

// 2. Check if keyword appears in sentiment (keyword matching)
const exclusionMatches = exclusionKeywords.filter(exclusion => {
  if (locationSeatSentimentText.includes(exclusion)) return true;
  // ... singular/plural handling
});

// 3. If keyword found, use AI to verify
if (exclusionMatches.length > 0) {
  for (const exclusion of exclusionMatches) {
    const isNear = await checkIfSeatIsNearExcludedThing(locationSeatSentimentText, exclusion);
    if (isNear) shouldExclude = true;
  }
}
```

**New Flow**:
```javascript
// 1. Get user's full exclusion preference text
const userExclusionText = preferences.seat_preferences || 
                          structuredPreferences?.exclusion_intent || 
                          preferences.notes || 
                          null;

// 2. ONLY if user has exclusion preference text, check seats with AI
// If no preference text, skip exclusion filtering entirely (no AI check)
if (userExclusionText && userExclusionText.trim()) {
  const violatesPreference = await checkIfSeatViolatesExclusionPreference(
    userExclusionText,
    locationSeatSentimentText
  );
  
  if (violatesPreference) {
    // Exclude seat
    return { eventSeat, shouldInclude: false };
  }
}
// If no userExclusionText, seat passes through (shouldInclude: true)
```

**Changes**:
- ❌ Remove keyword extraction and matching entirely (lines 671, 691-716)
- ❌ Remove loop checking individual keywords (lines 732-741)
- ❌ Remove `checkIfSeatIsNearExcludedThing` function entirely
- ❌ Remove `exclusions` array check - use `userExclusionText` instead
- ✅ Add direct AI comparison for each seat
- ✅ Use full user preference text instead of keywords
- ✅ Skip exclusion filtering if no user preference text provided (no AI calls)

#### 1.3 Update Diagnostics and Logging

**Diagnostics**:
- If no user exclusion text provided: Skip exclusion filtering stage entirely
- If user exclusion text provided: Track excluded seats and reasons
- `matchingKeywords`: Populate from `structuredPreferences.exclusions` for error messages (extracted keywords for display)

**Enhanced logging**:
```javascript
console.log('[SEAT SELECTION] Exclusion preference check:', {
  seat_code: eventSeat.code,
  user_exclusion: userExclusionText.substring(0, 100),
  sentiment_snippet: locationSeatSentimentText.substring(0, 100),
  violates_preference: violatesPreference,
  confidence: result.confidence,
  reasoning: result.reasoning
});
```

### Phase 2: Positive Preferences (Enhance Existing AI Matching)

**Important**: Only perform positive preference matching if user has provided preference text. If no text, skip preference matching entirely (return score 0, no AI calls).

#### 2.1 Enhance `calculatePreferenceMatchScore` Function

**Location**: `/services/botAutoFillService.js` (lines 290-450)

**Current Approach**:
- Takes structured preferences object: `{categories, keywords, requirements, intent}`
- Builds prompt from structured data
- ✅ Already AI-based, but only uses structured data, not original user text

**Important**: Only perform preference matching if user has provided preference text. If no text, skip AI call entirely (return 0 score).

**Enhancement**:
- Add optional parameter: `userPreferenceText` (original user text)
- Include original text in AI prompt for better semantic understanding
- **Important**: If no `userPreferenceText` provided, skip preference matching (return 0 score)

**New Function Signature**:
```javascript
async function calculatePreferenceMatchScore(
  sentimentText, 
  structuredPreferences, 
  sentimentItems = null,
  userPreferenceText = null  // NEW: Original user preference text (required for AI check)
)

**Behavior**:
- If `userPreferenceText` provided: Use AI to match against seat sentiment
- If `userPreferenceText` NOT provided: Return 0 (skip AI check entirely)
```

**Enhanced Prompt**:
```
Analyze how well this seat's sentiment data matches the user's preferences.

**User's Original Preference Text**: "[userPreferenceText]"
**User's Structured Preferences**:
- Categories: [...]
- Keywords: [...]
- Requirements: [...]
- Intent: "..."

**Seat Sentiment Data**: "[sentimentText]"

Return match_score 0-100 based on how well the seat matches the user's preferences.
Use the original text to understand full context and intent.
```

**Implementation**:
- If `userPreferenceText` provided, include it in prompt along with structured preferences
- If not provided, skip AI preference matching entirely (return 0 score, no AI call)
- No backward compatibility needed - if user doesn't provide preference text, don't match preferences

#### 2.2 Update Positive Preference Scoring

**Location**: `/services/botAutoFillService.js` (lines 850-870)

**Current Usage**:
```javascript
preferenceMatchScore = await calculatePreferenceMatchScore(
  locationSeatSentimentText,
  structuredPreferences,
  locationSeat.sentiment
);
```

**Updated Usage**:
```javascript
// Get user's positive preference text
const userPreferenceText = preferences.seat_preferences || 
                          preferences.specific_preferences || 
                          preferences.notes ||
                          structuredPreferences?.intent ||
                          null;

// ONLY perform preference matching if user has provided preference text
if (userPreferenceText && userPreferenceText.trim() && structuredPreferences) {
  preferenceMatchScore = await calculatePreferenceMatchScore(
    locationSeatSentimentText,
    structuredPreferences,
    locationSeat.sentiment,
    userPreferenceText  // NEW: Pass original text
  );
} else {
  // No user preference text - skip AI preference matching (score = 0)
  preferenceMatchScore = 0;
}
```

### Phase 3: Code Cleanup

#### 3.1 Remove Old Functions

**Functions to Remove**:
- `checkIfSeatIsNearExcludedThing()` - Replaced by `checkIfSeatViolatesExclusionPreference()`
  - Remove entirely (no backward compatibility needed)
  - Remove all keyword matching logic

#### 3.2 Update Comments and Documentation

- Update function documentation
- Add comments explaining direct AI comparison approach
- Document that AI checks only happen when user provides preference text
- Remove references to keyword matching

## Data Sources and Priority

### Exclusion Preference Text

**Priority Order**:
1. `preferences.seat_preferences` - Direct user input (highest priority)
2. `structuredPreferences.exclusion_intent` - AI-extracted intent
3. `preferences.notes` - General notes that might contain exclusions
4. `null` - No exclusion preference (skip exclusion filtering entirely)

**Behavior**: If `userExclusionText` is `null` or empty, skip exclusion filtering stage completely (no AI calls, all seats pass through).

**Example**:
```javascript
const userExclusionText = preferences.seat_preferences ||      // "I do not want to seat next to the toilets"
                          structuredPreferences?.exclusion_intent ||  // "do not want seats near toilets or bathrooms"
                          preferences.notes ||                        // Fallback
                          null;
```

### Positive Preference Text

**Priority Order**:
1. `preferences.seat_preferences` - Direct user input
2. `preferences.specific_preferences` - Specific preferences field
3. `preferences.notes` - General notes
4. `structuredPreferences?.intent` - AI-extracted intent
5. `null` - No preference text (skip AI preference matching entirely, score = 0)

**Behavior**: If `userPreferenceText` is `null` or empty, skip AI preference matching entirely (return score 0, no AI call). Only perform preference matching if user has explicitly provided preference text.

## Testing Plan

### Unit Tests

1. **Exclusion Preference Function**
   - Test with various user exclusion texts
   - Test with seat sentiments that should be excluded
   - Test with seat sentiments that should NOT be excluded
   - Test with edge cases (empty strings, null values)

2. **Positive Preference Function**
   - Test with original user text
   - Test without original text (backward compatibility)
   - Test scoring accuracy

### Integration Tests

1. **End-to-End Seat Selection**
   - Create COE with exclusion preference
   - Verify seats are correctly excluded/included
   - Check logs for AI reasoning

2. **Edge Cases**
   - No exclusion preference provided → Skip exclusion filtering (expected behavior)
   - No positive preference text provided → Skip preference matching (expected behavior)
   - No seat sentiment available → Skip preference/exclusion checks (allow seat through)
   - AI service unavailable (fallback behavior)
   - Empty preference text strings → Skip AI checks (treat as no preference)

### Test Scenarios

**Scenario 1: Exclusion with "not" in sentiment**
- User: "I do not want to seat next to the toilets"
- Seat: "not next to the toilets, VIP area"
- Expected: ✅ Seat included (does NOT violate preference)

**Scenario 2: Exclusion with violation**
- User: "I do not want to seat next to the toilets"
- Seat: "next to the toilets, great view"
- Expected: ❌ Seat excluded (violates preference)

**Scenario 3: Positive preference matching**
- User: "I want a VIP area for my birthday celebration"
- Seat: "VIP section, perfect for celebrations"
- Expected: High match score (80-100)

**Scenario 4: No preference text**
- User: (no preference provided)
- Seat: "VIP area"
- Expected: Skip preference matching entirely (preferenceMatchScore = 0, no exclusion check, no AI calls)
- Seat selection based on quality score and budget only

**Scenario 5: Exclusion check skipped**
- User: (no exclusion preference provided)
- Seat: "next to the toilets"
- Expected: ✅ Seat included (no exclusion filtering performed, no AI call)

## Rollout Strategy

### Step 1: Implement Exclusion Preference Function (Phase 1)
- Create `checkIfSeatViolatesExclusionPreference()`
- Test thoroughly
- Deploy to staging

### Step 2: Replace Exclusion Filtering Logic
- Update Stage 4 filtering (lines 667-773)
- Remove keyword matching
- Deploy to staging, test

### Step 3: Enhance Positive Preference Function (Phase 2)
- Update `calculatePreferenceMatchScore()` signature
- Add user preference text parameter
- Update all call sites
- Test, deploy

### Step 4: Monitor and Optimize
- Monitor AI API usage and costs
- Check error rates
- Verify accuracy improvements
- Optimize prompts if needed

### Step 5: Cleanup (Phase 3)
- Deprecate old functions
- Update documentation
- Remove unused code in future version

## Risks and Mitigation

### Risk 1: AI API Costs Increase
**Mitigation**:
- Monitor API usage
- Cache results if same seat/preference combination
- Use lower temperature for consistency
- Consider batch processing if needed

### Risk 2: AI Availability
**Mitigation**:
- Graceful fallback (don't exclude without AI confirmation)
- Log errors for monitoring
- Alert on high error rates

### Risk 3: Accuracy Issues
**Mitigation**:
- Comprehensive testing with edge cases
- Monitor logs for AI reasoning
- Collect user feedback
- Iterate on prompts if needed

### Risk 4: Performance Impact
**Mitigation**:
- Use `Promise.all` for parallel AI calls (already implemented)
- Monitor response times
- Consider rate limiting if needed

## Success Metrics

1. **Accuracy**
   - ✅ Seats with "not next to toilets" are NOT excluded when user wants "not next to toilets"
   - ✅ Seats with "next to toilets" ARE excluded when user wants "not next to toilets"
   - ✅ Better semantic understanding of user preferences

2. **Performance**
   - AI calls per seat selection:
     - If user provides exclusion text only: ~1 call per seat (exclusion check)
     - If user provides positive preference text only: ~1 call per seat (preference matching)
     - If user provides both: ~2 calls per seat (exclusion + preference)
     - If user provides NO preference text: 0 AI calls (skip entirely, faster performance)
   - Response time: Faster when no preferences (no AI calls), similar when preferences provided

3. **Code Quality**
   - Simplified logic (no keyword matching)
   - Better maintainability
   - Clear function responsibilities

## No Backward Compatibility Needed

**Simplified Approach**:
- ✅ If user provides preference text → Use AI to match against seat sentiments
- ✅ If user does NOT provide preference text → Skip preference/exclusion checks entirely (no AI calls)
- ✅ No fallback to keyword matching or structured preferences
- ✅ Cleaner, simpler logic - only check preferences if user explicitly provides them
- ✅ No breaking changes to API or database (preferences object structure unchanged)

## Future Enhancements

1. **Caching**: Cache AI results for common seat/preference combinations
2. **Batch Processing**: Process multiple seats in single AI call if supported
3. **Feedback Loop**: Use user feedback to improve prompts
4. **Multi-language**: Support preferences in different languages
5. **Context Awareness**: Consider user history and previous preferences

## Files to Modify

1. `/services/botAutoFillService.js`
   - Add `checkIfSeatViolatesExclusionPreference()` function
   - Update `calculatePreferenceMatchScore()` function
   - Replace exclusion filtering logic (Stage 4)
   - Update positive preference scoring call site

2. Documentation
   - This MD file
   - Update function documentation
   - Update architecture docs if needed

## Questions and Decisions

### Q1: Should we keep the old `checkIfSeatIsNearExcludedThing()` function?
**Decision**: Remove entirely - no backward compatibility needed. Replace with `checkIfSeatViolatesExclusionPreference()`.

### Q2: What if user provides both exclusion and positive preferences in same text?
**Decision**: 
- For exclusions: Use `seat_preferences` or `exclusion_intent` if it contains exclusion language
- For positive matching: Use the same text for positive preference matching
- AI can understand both contexts in the same text

### Q3: What if user doesn't provide any preference text?
**Decision**: Skip AI checks entirely - don't perform exclusion filtering or preference matching. No AI calls, score = 0 for preferences.

### Q4: Should we cache AI results?
**Decision**: Not in Phase 1. Consider in future if needed.

### Q5: What if AI returns unexpected response?
**Decision**: Return conservative default (false for exclusions = don't exclude, 0 for scores = no preference match), log error.

---

## Approval

- [ ] Technical Review
- [ ] Implementation Approval
- [ ] Testing Plan Approval

**Status**: 🔵 Planning - Awaiting Approval
