const { withBrowserPage } = require('../../utils/venueScraperBrowser');
const {
  collectUrvenueInventoryRawRows,
  extractUrvenueEventDescription,
  parseUrvenueInventoryItemFromRaw,
  waitForUrvenueInventoryRows,
} = require('./urvenueInventoryDom');

const LOG_PREFIX = '[OMNIA detail scraper]';

const TABLES_SECTION_LABEL = 'Tables';

/** Inventory rows excluded from seat mapping (packages / shares). */
const EXCLUDED_TABLE_PATTERNS = [
  /bachelorette\s+packages?/i,
  /table\s+share\s+experience/i,
];

/**
 * Booketing table title → THE1 OMNIA seat code (human labels).
 * @type {Record<string, string>}
 */
const OMNIA_NIGHT_TABLE_TO_SEAT_CODE = {
  'main room dance floor': 'Main Room Dance Floor',
  'main room upper dance floor': 'Main Room Upper Dance Floor',
  'main room 2nd tier': 'Main Room 2nd Tier',
  'main room 3rd tier': 'Main Room 3rd Tier',
  'main room balcony large': 'Main Room Balcony Large',
  'main room balcony small': 'Main Room Balcony Small',
  'main room sky box': 'Main Room Sky Box',
  'heart owners': 'Heart Owners',
  'heart dance floor': 'Heart Dance Floor',
  'heart 2nd tier': 'Heart 2nd Tier',
  'terrace cabana': 'Terrace Cabana',
  'terrace strip view': 'Terrace Strip View',
  'terrace 2nd tier': 'Terrace 2nd Tier',
  'dance floor': 'Dance Floor',
};

/** Booketing OMNIA Dayclub TABLES → Omnia DayClub location seat codes. */
const OMNIA_DAY_TABLE_TO_SEAT_CODE = {
  'premium villa': 'Premium Villa',
  villa: 'Villa',
  'stage cabana': 'Stage Cabana',
  'poolside couch': 'Poolside Couch',
  'dance floor': 'Dance Floor',
  'upper dance floor': 'Upper Dance Floor',
  daybed: 'Daybed',
  daybeds: 'Daybed',
  'front row skyline table': 'Front Row Skyline Table',
  'skyline table': 'Skyline Table',
  'skybar table': 'Skybar Table',
};

/** @deprecated alias */
const OMNIA_TABLE_TO_SEAT_CODE = OMNIA_NIGHT_TABLE_TO_SEAT_CODE;

/**
 * Normalize table label from DOM text.
 * @param {string} raw
 * @returns {string}
 */
function normalizeTableName(raw) {
  let name = (raw || '')
    .replace(/\s+More Info.*$/i, '')
    .replace(/\s+Table\s*$/i, '')
    .replace(/\s+\d+\s+Arrive\b.*$/i, '')
    // Dayclub rows: "Premium Villa 15 11:00am" (capacity + time, no "Arrive")
    .replace(/\s+\d+\s+\d{1,2}:\d{2}\s*(?:am|pm)\b.*$/i, '')
    .replace(/\s+\d+\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  return name;
}

/**
 * Resolve seat mapping for a normalized OMNIA table name.
 * @param {string} key
 * @param {'night_club'|'day_club'} [venueType]
 * @returns {{ seatCode: string|null, the1Category: string|null }}
 */
function resolveOmniaSeatMapping(key, venueType = 'night_club') {
  const map =
    venueType === 'day_club' ? OMNIA_DAY_TABLE_TO_SEAT_CODE : OMNIA_NIGHT_TABLE_TO_SEAT_CODE;
  const seatCode = map[key] || null;
  return { seatCode, the1Category: null };
}

/**
 * Whether inventory row should be skipped (non-standard packages).
 * @param {string} name
 * @returns {boolean}
 */
function isExcludedOmniaTable(name) {
  const n = (name || '').trim();
  return EXCLUDED_TABLE_PATTERNS.some((re) => re.test(n));
}

/**
 * Dismiss newsletter / overlay popups if present.
 * @param {import('puppeteer-core').Page} page
 */
async function dismissOmniaPopups(page) {
  await page.evaluate(() => {
    document.querySelectorAll('.uwsjs-closepop, .uws-closepop, button.trustarc-agree-btn').forEach((el) => {
      if (typeof el.click === 'function') el.click();
    });
  });
}

/**
 * Wait until experiences inventory is loaded (not "Loading Experiences…").
 * @param {import('puppeteer-core').Page} page
 * @param {number} timeoutMs
 */
async function waitForExperiencesLoaded(page, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const loading = await page.evaluate(() => {
      const text = document.body?.innerText || '';
      return /loading\s+experiences/i.test(text);
    });
    if (!loading) return;
    await new Promise((r) => setTimeout(r, 500));
  }
}

/**
 * Click TABLES accordion section.
 * @param {import('puppeteer-core').Page} page
 */
async function clickTablesAccordion(page) {
  await page.evaluate((sectionLabel) => {
    const nodes = Array.from(document.querySelectorAll('button, a, div, span, li'));
    const el = nodes.find((n) =>
      new RegExp(`^${sectionLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i').test(
        (n.textContent || '').trim()
      )
    );
    if (el && typeof el.click === 'function') el.click();
  }, TABLES_SECTION_LABEL);
}

/**
 * Parse inventory rows from expanded OMNIA event detail page.
 * @param {import('puppeteer-core').Page} page
 * @returns {Promise<object>}
 */
async function extractDetailInventory(page) {
  const rawRows = await collectUrvenueInventoryRawRows(page);
  const items = rawRows
    .map((raw) => parseUrvenueInventoryItemFromRaw(raw, { nameStyle: 'omnia' }))
    .filter(Boolean);
  const description = await extractUrvenueEventDescription(page);
  return { items, description };
}

/**
 * Scrape OMNIA event detail page: expand TABLES and parse inventory.
 * @param {import('puppeteer-core').Page} page
 * @param {{ venueType?: 'night_club'|'day_club' }} [options]
 * @returns {Promise<{ items: object[], description: string, warnings: string[] }>}
 */
async function scrapeOmniaEventDetailPage(page, options = {}) {
  const venueType = options.venueType === 'day_club' ? 'day_club' : 'night_club';
  const warnings = [];

  await dismissOmniaPopups(page);
  await waitForExperiencesLoaded(page);
  await new Promise((r) => setTimeout(r, 1500));

  await clickTablesAccordion(page);
  await waitForUrvenueInventoryRows(page, { timeoutMs: 25000, minRows: 1 });

  let raw = await extractDetailInventory(page);
  if ((raw.items || []).length === 0) {
    await clickTablesAccordion(page);
    await waitForUrvenueInventoryRows(page, { timeoutMs: 15000, minRows: 1 });
    raw = await extractDetailInventory(page);
  }
  const items = [];

  (raw.items || []).forEach((item) => {
    if (isExcludedOmniaTable(item.name)) {
      warnings.push(`Skipped non-standard inventory: "${item.name}"`);
      return;
    }
    const key = normalizeTableName(item.name);
    const { seatCode, the1Category } = resolveOmniaSeatMapping(key, venueType);
    if (!seatCode) {
      warnings.push(`Unmapped OMNIA table: "${item.name}"`);
    }
    items.push({ ...item, seatCode, the1Category, sectionKey: key });
  });

  console.log(
    `${LOG_PREFIX} scrapeOmniaEventDetailPage (${venueType}): ${items.length} inventory row(s), ${warnings.length} warning(s)`
  );

  return {
    items,
    description: raw.description || '',
    warnings,
  };
}

/**
 * Fetch OMNIA event detail inventory from URL.
 * @param {string} detailUrl
 * @param {{ venueType?: 'night_club'|'day_club' }} [options]
 * @returns {Promise<{ items: object[], description: string, warnings: string[], browserError: string|null }>}
 */
async function fetchOmniaEventDetailInventory(detailUrl, options = {}) {
  const venueType = options.venueType === 'day_club' ? 'day_club' : 'night_club';
  const url = (detailUrl || '').trim();
  if (!url) {
    return {
      items: [],
      description: '',
      warnings: ['Missing detail URL'],
      browserError: 'Missing detail URL',
    };
  }

  let browserError = null;
  let scrapeResult = { items: [], description: '', warnings: [] };

  try {
    const { result, browserError: pageError } = await withBrowserPage(
      url,
      (page) => scrapeOmniaEventDetailPage(page, { venueType }),
      { waitMs: 10000, logPrefix: LOG_PREFIX }
    );
    if (pageError) {
      browserError = pageError;
    } else if (result) {
      scrapeResult = result;
    }
  } catch (err) {
    browserError = err.message || String(err);
    console.error(`${LOG_PREFIX} fetchOmniaEventDetailInventory error:`, browserError);
  }

  return {
    ...scrapeResult,
    browserError,
  };
}

module.exports = {
  fetchOmniaEventDetailInventory,
  scrapeOmniaEventDetailPage,
  OMNIA_TABLE_TO_SEAT_CODE,
  OMNIA_NIGHT_TABLE_TO_SEAT_CODE,
  OMNIA_DAY_TABLE_TO_SEAT_CODE,
  normalizeTableName,
  resolveOmniaSeatMapping,
};
