/**
 * Date Parsing Utility
 * @description Parses natural language dates and handles timezone conversions
 * 
 * Supports formats like:
 * - "Nov 15-20, 2025"
 * - "November 15 to 20, 2025"
 * - "next Friday"
 * - "in 2 weeks"
 * - ISO 8601 dates
 */

/**
 * Parse natural language date string to Date object
 * @param {string} dateString - Natural language date string
 * @param {string} userTimezone - User's timezone (IANA format, e.g., "America/New_York")
 * @param {Date} referenceDate - Reference date for relative dates (default: now)
 * @returns {Object} { startDate: Date, endDate: Date | null, isRange: boolean }
 */
function parseNaturalLanguageDate(dateString, userTimezone = 'UTC', referenceDate = new Date()) {
  if (!dateString || typeof dateString !== 'string') {
    throw new Error('Invalid date string');
  }

  const trimmed = dateString.trim();
  
  // Try ISO 8601 format first
  if (trimmed.match(/^\d{4}-\d{2}-\d{2}/)) {
    const date = new Date(trimmed);
    if (!isNaN(date.getTime())) {
      return {
        startDate: date,
        endDate: null,
        isRange: false
      };
    }
  }

  // Try date range patterns
  // Pattern: "Nov 15-20, 2025" or "November 15 to 20, 2025"
  const rangePattern = /(\w+)\s+(\d+)(?:\s*[-–—to]\s*)(\d+),?\s+(\d{4})/i;
  const rangeMatch = trimmed.match(rangePattern);
  if (rangeMatch) {
    const [, monthName, startDay, endDay, year] = rangeMatch;
    const monthIndex = getMonthIndex(monthName);
    if (monthIndex !== -1) {
      const startDate = new Date(year, monthIndex, parseInt(startDay));
      const endDate = new Date(year, monthIndex, parseInt(endDay));
      return {
        startDate,
        endDate,
        isRange: true
      };
    }
  }

  // Pattern: "Nov 15 - Nov 20, 2025" (different months)
  const crossMonthPattern = /(\w+)\s+(\d+)(?:\s*[-–—to]\s*)(\w+)\s+(\d+),?\s+(\d{4})/i;
  const crossMonthMatch = trimmed.match(crossMonthPattern);
  if (crossMonthMatch) {
    const [, startMonth, startDay, endMonth, endDay, year] = crossMonthMatch;
    const startMonthIndex = getMonthIndex(startMonth);
    const endMonthIndex = getMonthIndex(endMonth);
    if (startMonthIndex !== -1 && endMonthIndex !== -1) {
      const startDate = new Date(year, startMonthIndex, parseInt(startDay));
      const endDate = new Date(year, endMonthIndex, parseInt(endDay));
      return {
        startDate,
        endDate,
        isRange: true
      };
    }
  }

  // Pattern: "Nov 15, 2025" (single date)
  const singleDatePattern = /(\w+)\s+(\d+),?\s+(\d{4})/i;
  const singleMatch = trimmed.match(singleDatePattern);
  if (singleMatch) {
    const [, monthName, day, year] = singleMatch;
    const monthIndex = getMonthIndex(monthName);
    if (monthIndex !== -1) {
      const date = new Date(year, monthIndex, parseInt(day));
      return {
        startDate: date,
        endDate: null,
        isRange: false
      };
    }
  }

  // Relative dates: "next Friday", "in 2 weeks", "tomorrow"
  if (trimmed.toLowerCase().includes('tomorrow')) {
    const tomorrow = new Date(referenceDate);
    tomorrow.setDate(tomorrow.getDate() + 1);
    return {
      startDate: tomorrow,
      endDate: null,
      isRange: false
    };
  }

  if (trimmed.toLowerCase().includes('next')) {
    // Simple "next Friday" - add 7 days
    const nextWeek = new Date(referenceDate);
    nextWeek.setDate(nextWeek.getDate() + 7);
    return {
      startDate: nextWeek,
      endDate: null,
      isRange: false
    };
  }

  // Pattern: "in X weeks/days"
  const relativePattern = /in\s+(\d+)\s+(weeks?|days?)/i;
  const relativeMatch = trimmed.match(relativePattern);
  if (relativeMatch) {
    const [, amount, unit] = relativeMatch;
    const futureDate = new Date(referenceDate);
    if (unit.toLowerCase().startsWith('week')) {
      futureDate.setDate(futureDate.getDate() + (parseInt(amount) * 7));
    } else {
      futureDate.setDate(futureDate.getDate() + parseInt(amount));
    }
    return {
      startDate: futureDate,
      endDate: null,
      isRange: false
    };
  }

  // If we can't parse it, throw error
  throw new Error(`Unable to parse date: "${dateString}". Please use formats like "Nov 15-20, 2025" or ISO 8601 format.`);
}

/**
 * Get month index from month name
 * @param {string} monthName - Month name (full or abbreviated)
 * @returns {number} Month index (0-11) or -1 if not found
 */
function getMonthIndex(monthName) {
  const months = {
    'january': 0, 'jan': 0,
    'february': 1, 'feb': 1,
    'march': 2, 'mar': 2,
    'april': 3, 'apr': 3,
    'may': 4,
    'june': 5, 'jun': 5,
    'july': 6, 'jul': 6,
    'august': 7, 'aug': 7,
    'september': 8, 'sep': 8, 'sept': 8,
    'october': 9, 'oct': 9,
    'november': 10, 'nov': 10,
    'december': 11, 'dec': 11
  };
  return months[monthName.toLowerCase()] ?? -1;
}

/**
 * Parse and normalize date with timezone handling
 * @param {string} dateString - Date string (natural language or ISO)
 * @param {string} userTimezone - User's timezone (IANA format)
 * @param {string} locationTimezone - Location's timezone (IANA format, optional)
 * @param {Date} referenceDate - Reference date for relative dates
 * @returns {Object} { startDate: Date (ISO), endDate: Date (ISO) | null, isRange: boolean }
 */
function parseAndNormalizeDate(dateString, userTimezone = 'UTC', locationTimezone = null, referenceDate = new Date()) {
  try {
    const parsed = parseNaturalLanguageDate(dateString, userTimezone, referenceDate);
    
    // Validate dates are in the future
    if (parsed.startDate < new Date()) {
      throw new Error('Start date must be in the future');
    }
    
    if (parsed.endDate && parsed.endDate < parsed.startDate) {
      throw new Error('End date must be after start date');
    }

    // For now, return dates as-is (ISO format)
    // In production, you might want to use a library like date-fns-tz or moment-timezone
    // to properly handle timezone conversions
    
    return {
      startDate: parsed.startDate.toISOString(),
      endDate: parsed.endDate ? parsed.endDate.toISOString() : null,
      isRange: parsed.isRange
    };
  } catch (error) {
    throw error;
  }
}

/**
 * Validate date format is not ambiguous
 * @param {string} dateString - Date string to validate
 * @returns {boolean} True if format is unambiguous
 */
function isUnambiguousDate(dateString) {
  // Reject formats like "11/12/2025" (could be Nov 12 or Dec 11)
  const ambiguousPattern = /^\d{1,2}\/\d{1,2}\/\d{4}$/;
  if (ambiguousPattern.test(dateString)) {
    return false;
  }
  return true;
}

/**
 * Format date range for display
 * @param {Date} startDate - Start date
 * @param {Date} endDate - End date (optional)
 * @param {string} locale - Locale for formatting (default: 'en-US')
 * @returns {string} Formatted date range
 */
function formatDateRange(startDate, endDate = null, locale = 'en-US') {
  const start = new Date(startDate);
  const end = endDate ? new Date(endDate) : null;

  if (!end || start.toDateString() === end.toDateString()) {
    return start.toLocaleDateString(locale, { 
      month: 'short', 
      day: 'numeric', 
      year: 'numeric' 
    });
  }

  // Same month
  if (start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear()) {
    return `${start.toLocaleDateString(locale, { month: 'short', day: 'numeric' })}-${end.toLocaleDateString(locale, { day: 'numeric', year: 'numeric' })}`;
  }

  // Different months
  return `${start.toLocaleDateString(locale, { month: 'short', day: 'numeric' })} - ${end.toLocaleDateString(locale, { month: 'short', day: 'numeric', year: 'numeric' })}`;
}

module.exports = {
  parseNaturalLanguageDate,
  parseAndNormalizeDate,
  isUnambiguousDate,
  formatDateRange,
  getMonthIndex
};

