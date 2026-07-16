/**
 * Time-range query helpers for GET /coes/my (Experiences list).
 */

const COE_TIME_RANGE_VALUES = ['upcoming', 'past', 'all'];

/**
 * @param {unknown} value
 * @returns {'upcoming'|'past'|'all'}
 */
function parseTimeRangeQuery(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (COE_TIME_RANGE_VALUES.includes(normalized)) {
    return normalized;
  }
  return 'upcoming';
}

/**
 * Effective COE end date used for list filtering.
 * Prefers root end_date; falls back to original_request_data.requested_dates.end_date.
 * @returns {object}
 */
function buildCoeListEndDateExpr() {
  return {
    $ifNull: ['$end_date', '$original_request_data.requested_dates.end_date'],
  };
}

/**
 * @param {'upcoming'|'past'|'all'} timeRange
 * @param {Date} [today]
 * @returns {object}
 */
function buildCoeListTimeRangeMatch(timeRange, today = new Date()) {
  if (timeRange === 'all') {
    return {};
  }

  const endDateExpr = buildCoeListEndDateExpr();
  const todayKey = today.toISOString().slice(0, 10);
  const endDateDayExpr = {
    $dateToString: {
      format: '%Y-%m-%d',
      date: endDateExpr,
      timezone: 'UTC',
    },
  };

  if (timeRange === 'past') {
    return {
      $expr: {
        $and: [
          { $ne: [endDateExpr, null] },
          { $lt: [endDateDayExpr, todayKey] },
        ],
      },
    };
  }

  return {
    $expr: {
      $and: [
        { $ne: [endDateExpr, null] },
        { $gte: [endDateDayExpr, todayKey] },
      ],
    },
  };
}

module.exports = {
  COE_TIME_RANGE_VALUES,
  parseTimeRangeQuery,
  buildCoeListEndDateExpr,
  buildCoeListTimeRangeMatch,
};
