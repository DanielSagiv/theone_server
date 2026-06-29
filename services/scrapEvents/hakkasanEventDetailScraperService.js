const { withBrowserPage } = require('../../utils/venueScraperBrowser');
const {
  collectUrvenueInventoryRawRows,
  extractUrvenueEventDescription,
  parseUrvenueInventoryItemFromRaw,
  waitForUrvenueInventoryRows,
} = require('./urvenueInventoryDom');

const LOG_PREFIX = '[Hakkasan detail scraper]';

const TABLES_SECTION_LABEL = 'Tables';

const EXCLUDED_TABLE_PATTERNS = [
  /bachelorette\s+packages?/i,
  /table\s+share\s+experience/i,
];

/** Booketing Hakkasan TABLES → THE1 location seat codes (human labels). */
const HAKKASAN_TABLE_TO_SEAT_CODE = {
  'main room owners': 'Main Room Owners',
  'main room stage': 'Main Room Stage',
  'main room lower dance floor': 'Main Room Lower Dance Floor',
  'main room upper dancefloor': 'Main Room Upper Dancefloor',
  'main room upper dance floor': 'Main Room Upper Dancefloor',
  'main room 3rd/4th rows': 'Main Room 3rd/4th Rows',
  'main room 3rd 4th rows': 'Main Room 3rd/4th Rows',
  'mezzanine center': 'Mezzanine Center',
  'mezzanine side': 'Mezzanine Side',
  'mezzanine skybox': 'Mezzanine Skybox',
};

/**
 * Normalize table label from DOM text (night-style Arrive by).
 * @param {string} raw
 * @returns {string}
 */
function normalizeTableName(raw) {
  let name = (raw || '')
    .replace(/\s+More Info.*$/i, '')
    .replace(/\s+Table\s*$/i, '')
    .replace(/\s+\d+\s+Arrive\b.*$/i, '')
    .replace(/\s+\d+\s+\d{1,2}:\d{2}\s*(?:am|pm)\b.*$/i, '')
    .replace(/\s+\d+\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  return name;
}

/**
 * Resolve seat mapping for a normalized Hakkasan table name.
 * @param {string} key
 * @returns {{ seatCode: string|null, the1Category: string|null }}
 */
function resolveHakkasanSeatMapping(key) {
  const seatCode = HAKKASAN_TABLE_TO_SEAT_CODE[key] || null;
  return { seatCode, the1Category: null };
}

/**
 * @param {string} name
 * @returns {boolean}
 */
function isExcludedHakkasanTable(name) {
  const n = (name || '').trim();
  return EXCLUDED_TABLE_PATTERNS.some((re) => re.test(n));
}

/**
 * @param {import('puppeteer-core').Page} page
 */
async function dismissHakkasanPopups(page) {
  await page.evaluate(() => {
    document.querySelectorAll('.uwsjs-closepop, .uws-closepop, button.trustarc-agree-btn').forEach((el) => {
      if (typeof el.click === 'function') el.click();
    });
  });
}

/**
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
 * Scrape Hakkasan event detail page: expand TABLES and parse inventory.
 * @param {import('puppeteer-core').Page} page
 * @returns {Promise<{ items: object[], description: string, warnings: string[] }>}
 */
async function scrapeHakkasanEventDetailPage(page) {
  const warnings = [];

  await dismissHakkasanPopups(page);
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
    if (isExcludedHakkasanTable(item.name)) {
      warnings.push(`Skipped non-standard inventory: "${item.name}"`);
      return;
    }
    const key = normalizeTableName(item.name);
    const { seatCode, the1Category } = resolveHakkasanSeatMapping(key);
    if (!seatCode) {
      warnings.push(`Unmapped Hakkasan table: "${item.name}"`);
    }
    items.push({ ...item, seatCode, the1Category, sectionKey: key });
  });

  console.log(
    `${LOG_PREFIX} scrapeHakkasanEventDetailPage: ${items.length} inventory row(s), ${warnings.length} warning(s)`
  );

  return {
    items,
    description: raw.description || '',
    warnings,
  };
}

/**
 * Fetch Hakkasan event detail inventory from URL.
 * @param {string} detailUrl
 * @returns {Promise<{ items: object[], description: string, warnings: string[], browserError: string|null }>}
 */
async function fetchHakkasanEventDetailInventory(detailUrl) {
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
      (page) => scrapeHakkasanEventDetailPage(page),
      { waitMs: 10000, logPrefix: LOG_PREFIX }
    );
    if (pageError) {
      browserError = pageError;
    } else if (result) {
      scrapeResult = result;
    }
  } catch (err) {
    browserError = err.message || String(err);
    console.error(`${LOG_PREFIX} fetchHakkasanEventDetailInventory error:`, browserError);
  }

  return {
    ...scrapeResult,
    browserError,
  };
}

module.exports = {
  fetchHakkasanEventDetailInventory,
  scrapeHakkasanEventDetailPage,
  HAKKASAN_TABLE_TO_SEAT_CODE,
  normalizeTableName,
  resolveHakkasanSeatMapping,
};
