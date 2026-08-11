/**
 * Encore Beach Club event detail — SEATING tab inventory (wynnsocial.com / UrVenue).
 */
const { withBrowserPage } = require('../../utils/venueScraperBrowser');
const {
  collectUrvenueInventoryRawRows,
  extractUrvenueEventDescription,
  parseUrvenueInventoryItemFromRaw,
  waitForUrvenueInventoryRows,
} = require('./urvenueInventoryDom');

const LOG_PREFIX = '[Encore Beach detail scraper]';

/** Longest-match-first aliases: scraped title → THE1 seat code. */
const ENCORE_TABLE_NAME_ALIASES = [
  ['dance floor water couch', 'Dance Floor Water Couch'],
  ['dancefloor water couch', 'Dance Floor Water Couch'],
  ['dance floor section', 'Dance Floor Section'],
  ['center pool lily pad', 'Center Pool Lily Pad'],
  ['large backstage section', 'Large Backstage Section'],
  ['medium backstage section', 'Medium Backstage Section'],
  ['small backstage section', 'Backstage Section'],
  ['backstage section', 'Backstage Section'],
  ['center l couch section', 'Center L Couch'],
  ['center l couch', 'Center L Couch'],
  ['lower bungalow', 'Lower Bungalow'],
  ['lower cabana', 'Lower Cabana'],
  ['patio section', 'Patio Section'],
  ['gaming section', 'Gaming Section'],
  ['beach couch', 'Beach Couch'],
  ['water couch', 'Water Couch'],
  ['lily pad', 'Lily Pad'],
  ['l couch', 'L Couch'],
  ['daybed', 'Daybed'],
  ['dancefloor', 'Dance Floor Water Couch'],
  ['dance floor', 'Dance Floor Section'],
  ['stage backstage', 'Backstage Section'],
  ['backstage', 'Backstage Section'],
];

/**
 * @param {string} raw
 * @returns {string}
 */
function normalizeTableName(raw) {
  return (raw || '')
    .replace(/\s+More Info.*$/i, '')
    .replace(/\s+Table\s*$/i, '')
    .replace(/\s+INQUIRY\s+ONLY\b.*$/i, '')
    .replace(/\s+\d+\s+guests?\b.*$/i, '')
    .replace(/\s+\d+\s+Arrive\b.*$/i, '')
    .replace(/\s+\d+\s+\d{1,2}:\d{2}\s*(?:am|pm)\b.*$/i, '')
    .replace(/\s+\d+\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * @param {string} key
 * @returns {{ seatCode: string|null, the1Category: string|null }}
 */
function mapEncoreTableToSeatCode(key) {
  const normalized = (key || '').trim().toLowerCase();
  for (const [pattern, seatCode] of ENCORE_TABLE_NAME_ALIASES) {
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
function resolveEncoreSeatMapping(key) {
  const normalized = normalizeTableName(key);
  const exact = mapEncoreTableToSeatCode(normalized);
  if (exact.seatCode) return exact;
  for (const [pattern, seatCode] of ENCORE_TABLE_NAME_ALIASES) {
    if (normalized.includes(pattern)) {
      return { seatCode, the1Category: null };
    }
  }
  return { seatCode: null, the1Category: null };
}

/**
 * @param {import('puppeteer-core').Page} page
 */
async function dismissEncorePopups(page) {
  await page.evaluate(() => {
    document
      .querySelectorAll('.uwsjs-closepop, .uws-closepop, button.trustarc-agree-btn')
      .forEach((el) => {
        if (typeof el.click === 'function') el.click();
      });
  });
}

/**
 * Open SEATING / Tables tab (or navigate ?tab=tables).
 * @param {import('puppeteer-core').Page} page
 */
async function openSeatingTab(page) {
  const clicked = await page.evaluate(() => {
    const nodes = Array.from(
      document.querySelectorAll('a, button, [role="tab"], li, span, div')
    );
    const el = nodes.find((n) => {
      const t = (n.textContent || '').replace(/\s+/g, ' ').trim();
      return /^(seating|tables)$/i.test(t);
    });
    if (el && typeof el.click === 'function') {
      el.click();
      return true;
    }
    return false;
  });

  if (!clicked) {
    const url = page.url();
    if (url && !/[?&]tab=tables/i.test(url)) {
      const sep = url.includes('?') ? '&' : '?';
      await page.goto(`${url.split('#')[0]}${sep}tab=tables`, {
        waitUntil: 'domcontentloaded',
        timeout: 60000,
      });
    }
  }
}

/**
 * @param {string} rawName
 * @returns {string}
 */
function cleanEncoreInventoryTitle(rawName) {
  const n = (rawName || '').replace(/\s+/g, ' ').trim();
  if (!n) return n;
  for (const [pattern] of ENCORE_TABLE_NAME_ALIASES) {
    const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`^(${escaped})\\b`, 'i');
    const m = n.match(re);
    if (m) return m[1];
  }
  // Truncate after first title-like token before prose ("… are located", "… is located")
  const prose = n.split(/\s+(?=(?:are|is)\s+located\b)/i)[0];
  return (prose || n).trim();
}

/**
 * @param {import('puppeteer-core').Page} page
 * @returns {Promise<{ items: object[], description: string }>}
 */
async function extractEncoreDetailInventory(page) {
  const rawRows = await collectUrvenueInventoryRawRows(page);
  const items = rawRows
    .map((raw) => parseUrvenueInventoryItemFromRaw(raw, { nameStyle: 'omnia' }))
    .filter(Boolean)
    .filter((item) => !/inquiry\s*only/i.test(item.name || ''))
    .map((item) => ({
      ...item,
      name: cleanEncoreInventoryTitle(item.name),
    }));
  const description = await extractUrvenueEventDescription(page);
  return { items, description };
}

/**
 * @param {import('puppeteer-core').Page} page
 * @returns {Promise<{ items: object[], description: string, warnings: string[] }>}
 */
async function scrapeEncoreBeachEventDetailPage(page) {
  const warnings = [];
  await dismissEncorePopups(page);
  await new Promise((r) => setTimeout(r, 1500));
  await openSeatingTab(page);
  await waitForUrvenueInventoryRows(page, { timeoutMs: 25000, minRows: 1 });

  let raw = await extractEncoreDetailInventory(page);
  if ((raw.items || []).length === 0) {
    await openSeatingTab(page);
    await waitForUrvenueInventoryRows(page, { timeoutMs: 15000, minRows: 1 });
    raw = await extractEncoreDetailInventory(page);
  }

  if ((raw.items || []).length === 0) {
    warnings.push('No SEATING inventory rows with F&B / Minimum Spend found');
  }

  return {
    items: raw.items || [],
    description: raw.description || '',
    warnings,
  };
}

/**
 * @param {object} listingEvent
 * @returns {Promise<object>}
 */
async function fetchEncoreBeachEventDetailInventory(listingEvent) {
  const detailUrl = (listingEvent?.detailUrl || listingEvent?.bookUrl || '').trim();
  if (!detailUrl) {
    return {
      items: [],
      metadata: {},
      warnings: ['Missing detail URL'],
      browserError: 'Missing detail URL',
    };
  }

  const seatingUrl = /[?&]tab=tables/i.test(detailUrl)
    ? detailUrl
    : `${detailUrl.split('?')[0]}${detailUrl.includes('?') ? '&' : '?'}tab=tables`;

  try {
    const { result, browserError } = await withBrowserPage(
      seatingUrl,
      async (page) => scrapeEncoreBeachEventDetailPage(page),
      { waitMs: 4000, logPrefix: LOG_PREFIX }
    );

    if (browserError) {
      return {
        items: [],
        metadata: { name: listingEvent.name },
        warnings: [],
        browserError,
      };
    }

    return {
      items: result?.items || [],
      metadata: {
        name: listingEvent.name,
        description: result?.description || '',
      },
      warnings: result?.warnings || [],
      browserError: null,
    };
  } catch (err) {
    const msg = err.message || String(err);
    console.error(`${LOG_PREFIX} fetchEncoreBeachEventDetailInventory:`, msg);
    return {
      items: [],
      metadata: { name: listingEvent.name },
      warnings: [],
      browserError: msg,
    };
  }
}

module.exports = {
  fetchEncoreBeachEventDetailInventory,
  scrapeEncoreBeachEventDetailPage,
  normalizeTableName,
  mapEncoreTableToSeatCode,
  resolveEncoreSeatMapping,
  cleanEncoreInventoryTitle,
  ENCORE_TABLE_NAME_ALIASES,
};
