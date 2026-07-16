/**
 * COE /coes/my time-range query helpers.
 * Run: node tests/coeListTimeRange.test.js
 */
const assert = require('assert');
const {
  parseTimeRangeQuery,
  buildCoeListEndDateExpr,
  buildCoeListTimeRangeMatch,
} = require('../utils/coeListTimeRange');

function testParseTimeRangeQuery() {
  assert.strictEqual(parseTimeRangeQuery('upcoming'), 'upcoming');
  assert.strictEqual(parseTimeRangeQuery('past'), 'past');
  assert.strictEqual(parseTimeRangeQuery('all'), 'all');
  assert.strictEqual(parseTimeRangeQuery('UPCOMING'), 'upcoming');
  assert.strictEqual(parseTimeRangeQuery(undefined), 'upcoming');
  assert.strictEqual(parseTimeRangeQuery('unknown'), 'upcoming');
}

function testBuildEndDateExpr() {
  const expr = buildCoeListEndDateExpr();
  assert.deepStrictEqual(expr, {
    $ifNull: ['$end_date', '$original_request_data.requested_dates.end_date'],
  });
}

function testBuildTimeRangeAll() {
  const match = buildCoeListTimeRangeMatch('all', new Date('2026-07-16T12:00:00.000Z'));
  assert.deepStrictEqual(match, {});
}

function testBuildTimeRangeUpcoming() {
  const match = buildCoeListTimeRangeMatch('upcoming', new Date('2026-07-16T12:00:00.000Z'));
  assert.ok(match.$expr);
  assert.ok(Array.isArray(match.$expr.$and));
  assert.strictEqual(match.$expr.$and[1].$gte[1], '2026-07-16');
}

function testBuildTimeRangePast() {
  const match = buildCoeListTimeRangeMatch('past', new Date('2026-07-16T12:00:00.000Z'));
  assert.ok(match.$expr);
  assert.ok(Array.isArray(match.$expr.$and));
  assert.strictEqual(match.$expr.$and[1].$lt[1], '2026-07-16');
}

function run() {
  testParseTimeRangeQuery();
  testBuildEndDateExpr();
  testBuildTimeRangeAll();
  testBuildTimeRangeUpcoming();
  testBuildTimeRangePast();
  console.log('coeListTimeRange.test.js: all passed');
}

run();
