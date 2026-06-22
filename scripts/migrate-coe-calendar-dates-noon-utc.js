/**
 * One-time prod helper: shift COE trip dates from midnight UTC to noon UTC.
 * Run after deploying calendarDateOnly normalization (server).
 *
 * Usage (review first with DRY_RUN=1):
 *   DRY_RUN=1 node scripts/migrate-coe-calendar-dates-noon-utc.js
 *   node scripts/migrate-coe-calendar-dates-noon-utc.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const COE = require('../models/COE');
const { parseCalendarDateInput, formatCalendarDateYmd } = require('../utils/calendarDateOnly');

const DRY_RUN = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';

/**
 * @param {Date|null|undefined} value
 * @returns {Date|null}
 */
function noonifyIfMidnightUtc(value) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    return null;
  }
  if (
    value.getUTCHours() === 0 &&
    value.getUTCMinutes() === 0 &&
    value.getUTCSeconds() === 0 &&
    value.getUTCMilliseconds() === 0
  ) {
    const ymd = formatCalendarDateYmd(value);
    return ymd ? parseCalendarDateInput(ymd) : null;
  }
  return null;
}

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) {
    throw new Error('MONGODB_URI or MONGO_URI required');
  }
  await mongoose.connect(uri);
  console.log('[migrate-coe-dates] connected', { dryRun: DRY_RUN });

  const cursor = COE.find({}).cursor();
  let scanned = 0;
  let updated = 0;

  for await (const coe of cursor) {
    scanned += 1;
    const set = {};
    const startNoon = noonifyIfMidnightUtc(coe.start_date);
    const endNoon = noonifyIfMidnightUtc(coe.end_date);
    if (startNoon) set.start_date = startNoon;
    if (endNoon) set.end_date = endNoon;

    const rd = coe.original_request_data?.requested_dates;
    if (rd) {
      const rs = noonifyIfMidnightUtc(rd.start_date);
      const re = noonifyIfMidnightUtc(rd.end_date);
      if (rs) set['original_request_data.requested_dates.start_date'] = rs;
      if (re) set['original_request_data.requested_dates.end_date'] = re;
    }

    if (Object.keys(set).length === 0) {
      continue;
    }

    updated += 1;
    console.log('[migrate-coe-dates] patch', coe._id.toString(), set);
    if (!DRY_RUN) {
      await COE.updateOne({ _id: coe._id }, { $set: set });
    }
  }

  console.log('[migrate-coe-dates] done', { scanned, updated, dryRun: DRY_RUN });
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('[migrate-coe-dates] failed', err);
  process.exit(1);
});
