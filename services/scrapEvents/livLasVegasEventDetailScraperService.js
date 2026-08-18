const { withBrowserPage } = require('../../utils/venueScraperBrowser');
const {
  collectUrvenueInventoryRawRows,
  extractUrvenueEventDescription,
  parseUrvenueInventoryItemFromRaw,
} = require('./urvenueInventoryDom');

const LOG_PREFIX = '[LIV detail scraper]';

/** Night club accordion sections */
const NIGHT_SECTIONS_TO_EXPAND = ['Stage', 'Dance Floor', 'Balcony'];

/** Beach club accordion sections (pilot: Cloonee @ LIV Beach) */
const BEACH_SECTIONS_TO_EXPAND = ['Cabanas', 'Couches', 'Daybeds', 'Club Area', 'Terrace'];

/**
 * Map normalized LIV site table name to THE1 Night club seat code.
 * @type {Record<string, string>}
 */
const LIV_NIGHT_TABLE_TO_SEAT_CODE = {
  stage: 'Stage',
  'dance floor': 'df',
  'center dance floor': 'cdf',
  'center upper dance floor': 'cudf',
  'upper dance floor': 'udf',
  'premium balcony': 'pb',
  '2nd row balcony': '2nrb',
};

/**
 * Beach table map — values must match LIV Beach Location.seats[].code exactly.
 * @type {Record<string, string|{ code: string, the1Category?: string }>}
 */
const LIV_BEACH_TABLE_TO_SEAT_CODE = {
  'beach villa': 'Beach Villa',
  'stage cabana': 'Stage Cabana',
  'beach cabana': 'Beach Cabana',
  'beach couch': 'Beach Couch',
  'dance floor': 'Dance Floor',
  'pool couch': 'Pool Couch',
  daybeds: 'Daybeds',
  'lower club': 'Lower Club',
  'center club': 'Center Club',
  'upper club': 'Upper Club',
  'premium upper club': 'Premium Upper Club',
  'premium terrace east': 'Premium Terrace East',
  'terrace reserve': 'Terrace Reserve',
  'terrace tables': 'Terrace Tables',
  'terrace daybed': 'Terrace Daybed',
  '2nd row premium terrace': 'Second Row Premium Terrace',
};

/**
 * Normalize table label from DOM text.
 * @param {string} raw
 * @returns {string}
 */
function normalizeTableName(raw) {
  return (raw || '')
    .replace(/\s+More Info.*$/i, '')
    .replace(/\s+\d+\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Resolve seat mapping for a normalized LIV table name.
 * @param {string} key
 * @param {'night_club'|'day_club'} venueType
 * @returns {{ seatCode: string|null, the1Category: string|null }}
 */
function resolveLivSeatMapping(key, venueType) {
  const map = venueType === 'day_club' ? LIV_BEACH_TABLE_TO_SEAT_CODE : LIV_NIGHT_TABLE_TO_SEAT_CODE;
  const entry = map[key];
  if (!entry) return { seatCode: null, the1Category: null };
  if (typeof entry === 'string') return { seatCode: entry, the1Category: null };
  return { seatCode: entry.code, the1Category: entry.the1Category || null };
}

/**
 * Dismiss newsletter / overlay popups if present.
 * @param {import('puppeteer-core').Page} page
 */
async function dismissLivPopups(page) {
  await page.evaluate(() => {
    document.querySelectorAll('.uwsjs-closepop, .uws-closepop').forEach((el) => {
      if (typeof el.click === 'function') el.click();
    });
  });
}

/**
 * Click accordion section by exact label.
 * @param {import('puppeteer-core').Page} page
 * @param {string} label
 */
async function clickSectionAccordion(page, label) {
  await page.evaluate((sectionLabel) => {
    const nodes = Array.from(document.querySelectorAll('button, a, div, span, li'));
    const el = nodes.find((n) =>
      new RegExp(`^${sectionLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i').test(
        (n.textContent || '').trim()
      )
    );
    if (el && typeof el.click === 'function') el.click();
  }, label);
}

/**
 * Parse inventory rows from expanded LIV event detail page.
 * @param {import('puppeteer-core').Page} page
 * @returns {Promise<object>}
 */
async function extractDetailInventory(page) {
  const rawRows = await collectUrvenueInventoryRawRows(page);
  const items = rawRows
    .map((raw) => parseUrvenueInventoryItemFromRaw(raw, { nameStyle: 'liv' }))
    .filter(Boolean);
  const description = await extractUrvenueEventDescription(page);
  return { items, description };
}

/**
 * Scrape LIV event detail page: expand sections and parse inventory.
 * @param {import('puppeteer-core').Page} page
 * @param {{ venueType?: 'night_club'|'day_club' }} [options]
 * @returns {Promise<{ items: object[], description: string, warnings: string[] }>}
 */
async function scrapeLivEventDetailPage(page, options = {}) {
  const venueType = options.venueType === 'day_club' ? 'day_club' : 'night_club';
  const sections =
    venueType === 'day_club' ? BEACH_SECTIONS_TO_EXPAND : NIGHT_SECTIONS_TO_EXPAND;
  const warnings = [];

  await dismissLivPopups(page);
  await new Promise((r) => setTimeout(r, 2000));

  for (const section of sections) {
    await clickSectionAccordion(page, section);
    await new Promise((r) => setTimeout(r, 1500));
  }

  const raw = await extractDetailInventory(page);
  const items = (raw.items || []).map((item) => {
    const key = normalizeTableName(item.name);
    const { seatCode, the1Category } = resolveLivSeatMapping(key, venueType);
    if (!seatCode) {
      warnings.push(`Unmapped LIV table: "${item.name}"`);
    }
    return { ...item, seatCode, the1Category, sectionKey: key };
  });

  console.log(
    `${LOG_PREFIX} scrapeLivEventDetailPage (${venueType}): ${items.length} inventory row(s), ${warnings.length} warning(s)`
  );

  return {
    items,
    description: raw.description || '',
    warnings,
  };
}

/**
 * Fetch LIV event detail inventory from URL.
 * @param {string} detailUrl
 * @param {{ venueType?: 'night_club'|'day_club' }} [options]
 * @returns {Promise<{ items: object[], description: string, warnings: string[], browserError?: string }>}
 */
async function fetchLivEventDetailInventory(detailUrl, options = {}) {
  const venueType = options.venueType === 'day_club' ? 'day_club' : 'night_club';

  const { result, browserError } = await withBrowserPage(
    detailUrl,
    (page) => scrapeLivEventDetailPage(page, { venueType }),
    { waitMs: 5000, logPrefix: LOG_PREFIX }
  );

  if (browserError) {
    return { items: [], description: '', warnings: [], browserError };
  }

  return result || { items: [], description: '', warnings: [] };
}

module.exports = {
  fetchLivEventDetailInventory,
  scrapeLivEventDetailPage,
  LIV_NIGHT_TABLE_TO_SEAT_CODE,
  LIV_BEACH_TABLE_TO_SEAT_CODE,
  LIV_TABLE_TO_SEAT_CODE: LIV_NIGHT_TABLE_TO_SEAT_CODE,
  normalizeTableName,
  resolveLivSeatMapping,
  NIGHT_SECTIONS_TO_EXPAND,
  BEACH_SECTIONS_TO_EXPAND,
};
