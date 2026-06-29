const { withBrowserPage } = require('../../utils/venueScraperBrowser');
const {
  collectUrvenueInventoryRawRows,
  extractUrvenueEventDescription,
  parseUrvenueInventoryItemFromRaw,
  waitForUrvenueInventoryRows,
} = require('./urvenueInventoryDom');

const LOG_PREFIX = '[Marquee Dayclub detail scraper]';

const TABLES_SECTION_LABEL = 'Tables';

const EXCLUDED_TABLE_PATTERNS = [
  /bachelorette\s+packages?/i,
  /table\s+share\s+experience/i,
];

/** Longest-match-first: Booketing TABLES → THE1 location seat codes. */
const MARQUEE_DAYCLUB_TABLE_NAME_ALIASES = [
  ['grand cabana', 'Grand Cabana'],
  ['prime cabana', 'Prime Cabana'],
  ['prime daybed', 'Prime Daybed'],
  ['cabana', 'Cabana'],
  ['daybed', 'Daybed'],
];

/** @type {Record<string, string>} */
const MARQUEE_DAYCLUB_TABLE_TO_SEAT_CODE = Object.fromEntries(MARQUEE_DAYCLUB_TABLE_NAME_ALIASES);

/**
 * Normalize table label from DOM text (dayclub-style).
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
 * Resolve seat mapping for a normalized Marquee Dayclub table name.
 * @param {string} key
 * @returns {{ seatCode: string|null, the1Category: string|null }}
 */
function mapMarqueeDayclubTableToSeatCode(key) {
  const normalized = (key || '').trim().toLowerCase();
  for (const [pattern, seatCode] of MARQUEE_DAYCLUB_TABLE_NAME_ALIASES) {
    if (normalized === pattern) {
      return { seatCode, the1Category: null };
    }
  }
  return { seatCode: null, the1Category: null };
}

/**
 * @param {string} key
 * @returns {{ seatCode: string|null, the1Category: string|null }}
 */
function resolveMarqueeDayclubSeatMapping(key) {
  return mapMarqueeDayclubTableToSeatCode(key);
}

/**
 * @param {string} name
 * @returns {boolean}
 */
function isExcludedMarqueeDayclubTable(name) {
  const n = (name || '').trim();
  return EXCLUDED_TABLE_PATTERNS.some((re) => re.test(n));
}

/**
 * @param {import('puppeteer-core').Page} page
 */
async function dismissMarqueeDayclubPopups(page) {
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
 * Scrape Marquee Dayclub event detail page: expand TABLES and parse inventory.
 * @param {import('puppeteer-core').Page} page
 * @returns {Promise<{ items: object[], description: string, warnings: string[] }>}
 */
async function scrapeMarqueeDayclubEventDetailPage(page) {
  const warnings = [];

  await dismissMarqueeDayclubPopups(page);
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
    if (isExcludedMarqueeDayclubTable(item.name)) {
      warnings.push(`Skipped non-standard inventory: "${item.name}"`);
      return;
    }
    const key = normalizeTableName(item.name);
    const { seatCode, the1Category } = resolveMarqueeDayclubSeatMapping(key);
    if (!seatCode) {
      warnings.push(`Unmapped Marquee Dayclub table: "${item.name}"`);
    }
    items.push({ ...item, seatCode, the1Category, sectionKey: key });
  });

  console.log(
    `${LOG_PREFIX} scrapeMarqueeDayclubEventDetailPage: ${items.length} inventory row(s), ${warnings.length} warning(s)`
  );

  return {
    items,
    description: raw.description || '',
    warnings,
  };
}

/**
 * Fetch Marquee Dayclub event detail inventory from URL.
 * @param {string} detailUrl
 * @returns {Promise<{ items: object[], description: string, warnings: string[], browserError: string|null }>}
 */
async function fetchMarqueeDayclubEventDetailInventory(detailUrl) {
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
      (page) => scrapeMarqueeDayclubEventDetailPage(page),
      { waitMs: 10000, logPrefix: LOG_PREFIX }
    );
    if (pageError) {
      browserError = pageError;
    } else if (result) {
      scrapeResult = result;
    }
  } catch (err) {
    browserError = err.message || String(err);
    console.error(`${LOG_PREFIX} fetchMarqueeDayclubEventDetailInventory error:`, browserError);
  }

  return {
    ...scrapeResult,
    browserError,
  };
}

module.exports = {
  fetchMarqueeDayclubEventDetailInventory,
  scrapeMarqueeDayclubEventDetailPage,
  MARQUEE_DAYCLUB_TABLE_NAME_ALIASES,
  MARQUEE_DAYCLUB_TABLE_TO_SEAT_CODE,
  normalizeTableName,
  mapMarqueeDayclubTableToSeatCode,
  resolveMarqueeDayclubSeatMapping,
};
