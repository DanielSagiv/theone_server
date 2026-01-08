const OpenAI = require('openai');
const { parseAndNormalizeDate } = require('../utils/dateParser');

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const openaiClient = OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;
const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

/**
 * Event Search Intent Service
 * @description Uses OpenAI to extract structured search parameters from natural language prompts
 */

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
- If date range is ambiguous (e.g., "December"), use start of month as start_date and end of month as end_date
- Today's date is ${new Date().toISOString()}`;

    console.log('[EventSearchIntentService] Extracting intent from prompt:', userPrompt);

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

    console.log('[EventSearchIntentService] Raw extracted intent:', extracted);

    // Post-process dates using existing date parser utility
    if (extracted.date_text && (!extracted.start_date || !extracted.end_date)) {
      try {
        const parsed = parseAndNormalizeDate(
          extracted.date_text,
          conversationContext.user_tz || 'UTC'
        );
        if (parsed.startDate) {
          extracted.start_date = parsed.startDate.toISOString();
        }
        if (parsed.endDate) {
          extracted.end_date = parsed.endDate.toISOString();
        }
      } catch (error) {
        console.warn('[EventSearchIntentService] Date parsing failed:', error);
        // Continue with what we have
      }
    }

    // Validate that we have at least one search parameter
    if (!extracted.city && !extracted.location_name && !extracted.performer) {
      extracted.clarification_needed = true;
      extracted.clarification_message = 'I need more information to search for events. Could you specify a city, venue, or performer?';
    }

    console.log('[EventSearchIntentService] Final extracted intent:', extracted);

    return extracted;
  } catch (error) {
    console.error('[EventSearchIntentService] Error extracting intent:', error);
    throw error;
  }
}

module.exports = {
  extractSearchIntent
};









