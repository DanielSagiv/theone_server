const cheerio = require('cheerio');
const { withBrowserPage } = require('../../utils/venueScraperBrowser');
const { getMarqueeNightclubVenueConfig } = require('../../utils/marqueeNightclubVenueConfig');
const { slugFromDetailUrl } = require('./marqueeNightclubScraperService');

const LOG_PREFIX = '[Marquee Nightclub detail scraper]';

const TABLES_SECTION_LABEL = 'Tables';

const BOILERPLATE_DESCRIPTION_PATTERNS = [
  /need help\?/i,
  /702-850-2757/i,
  /concierge team/i,
  /remarkable experience/i,
  /online experience/i,
];

/** Longest-match-first: Tao Group TABLES → THE1 location seat codes. */
const MARQUEE_NIGHTCLUB_TABLE_NAME_ALIASES = [
  ['full upper dance floor', 'Full Upper Dance Floor'],
  ['upper dance floor', 'Upper Dance Floor'],
  ['third tier main room', 'Third Tier Main Room'],
  ['dance floor', 'Dance Floor'],
  ['cloud', 'Cloud'],
  ['salon', 'Salon'],
];

/** @type {Record<string, string>} */
const MARQUEE_NIGHTCLUB_TABLE_TO_SEAT_CODE = Object.fromEntries(
  MARQUEE_NIGHTCLUB_TABLE_NAME_ALIASES
);

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * @param {string} raw
 * @returns {string}
 */
function normalizeTableName(raw) {
  return (raw || '')
    .replace(/\s+More Info.*$/i, '')
    .replace(/\s+Table\s*$/i, '')
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
function mapMarqueeNightclubTableToSeatCode(key) {
  const normalized = (key || '').trim().toLowerCase();
  for (const [pattern, seatCode] of MARQUEE_NIGHTCLUB_TABLE_NAME_ALIASES) {
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
function resolveMarqueeNightclubSeatMapping(key) {
  const normalized = normalizeTableName(key);
  for (const [pattern, seatCode] of MARQUEE_NIGHTCLUB_TABLE_NAME_ALIASES) {
    if (normalized === pattern || normalized.includes(pattern)) {
      return { seatCode, the1Category: null };
    }
  }
  return { seatCode: null, the1Category: null };
}

/**
 * @param {string} description
 * @returns {string}
 */
function sanitizeMarqueeNightclubDescription(description) {
  const text = (description || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  if (BOILERPLATE_DESCRIPTION_PATTERNS.some((re) => re.test(text))) {
    return '';
  }
  return text;
}

/**
 * @param {import('puppeteer-core').Page} page
 * @param {string} text
 * @returns {Promise<boolean>}
 */
async function clickByText(page, text) {
  return page.evaluate((search) => {
    const nodes = document.querySelectorAll(
      'a, button, [role="button"], [role="tab"], div[class*="accordion"], span'
    );
    for (const el of nodes) {
      const t = (el.textContent || '').trim();
      if (t && t.toLowerCase().includes(search.toLowerCase())) {
        el.click();
        return true;
      }
    }
    return false;
  }, text);
}

/**
 * @param {import('puppeteer-core').Page} page
 */
async function clickTablesAccordion(page) {
  await page.evaluate((sectionLabel) => {
    const nodes = Array.from(document.querySelectorAll('button, a, div, span, li, h2, h3'));
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
 * @param {object} listingEvent
 * @returns {Promise<boolean>}
 */
async function clickVipReservationsOnListingTile(page, listingEvent) {
  const slug = slugFromDetailUrl(listingEvent.detailUrl);
  const eventId = String(listingEvent.eventId || '');
  const name = (listingEvent.name || '').toLowerCase();

  const linkHandles = await page.$$('a[href*="/event/"]');
  for (const handle of linkHandles) {
    const meta = await handle.evaluate((el) => ({
      href: (el.getAttribute('href') || '').toLowerCase(),
      text: (el.textContent || '').toLowerCase(),
    }));

    const matchesSlug = slug && meta.href.includes(slug);
    const matchesId = eventId && meta.href.includes(eventId.toLowerCase());
    const matchesName = name && meta.text.includes(name.slice(0, 28));
    if (!matchesSlug && !matchesId && !matchesName) continue;

    const box = await handle.boundingBox();
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await delay(400);
    }

    const cardHandle = await handle.evaluateHandle((el) => {
      let node = el;
      for (let i = 0; i < 8 && node; i += 1) {
        if (node.querySelector && node.querySelector('a, button')) return node;
        node = node.parentElement;
      }
      return el.parentElement || el;
    });

    const vipClicked = await cardHandle.evaluate((card) => {
      const vipPattern = /vip\s*reservations?/i;
      const buttons = Array.from(card.querySelectorAll('a, button, [role="button"]'));
      const match = buttons.find((btn) => vipPattern.test((btn.textContent || '').trim()));
      if (match && typeof match.click === 'function') {
        match.click();
        return true;
      }
      return false;
    });

    await cardHandle.dispose();

    if (vipClicked) {
      await delay(2500);
      return true;
    }
  }

  return false;
}

/**
 * @param {import('puppeteer-core').Page} page
 * @returns {Promise<object[]>}
 */
async function scrapeTablesFromPage(page) {
  return page.evaluate((aliases) => {
    const results = [];
    const tierPatterns = aliases.map(([pattern]) => pattern);

    const findTablesSection = () => {
      const all = document.querySelectorAll(
        'section, [class*="section"], [class*="tables"], [class*="Tables"], div[class*="accordion"], div[class*="content"]'
      );
      for (const el of all) {
        const text = (el.textContent || '').toLowerCase();
        if (text.includes('tables') && (text.includes('minimum spend') || text.includes('pay now'))) {
          return el;
        }
      }
      return null;
    };

    const section = findTablesSection();
    const root = section || document.body;
    const lines = (root.textContent || '')
      .split(/\n/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && s.length < 160);

    for (const line of lines) {
      const lineLower = line.toLowerCase();
      let matchedPattern = '';
      for (const pattern of tierPatterns) {
        if (lineLower.includes(pattern) && line.length < 90) {
          matchedPattern = pattern;
          break;
        }
      }
      if (!matchedPattern) continue;

      const minSpendMatch = line.match(/minimum\s*spend\s*\$?([\d,]+)/i);
      const payNowMatch = line.match(/pay\s*now\s*\$?([\d,]+)/i);
      const price = minSpendMatch
        ? parseInt(minSpendMatch[1].replace(/,/g, ''), 10)
        : payNowMatch
          ? parseInt(payNowMatch[1].replace(/,/g, ''), 10)
          : null;
      if (!price || price <= 0) continue;

      const guestsMatch = line.match(/(\d+)\s*guests?/i);
      const capacity = guestsMatch ? parseInt(guestsMatch[1], 10) : undefined;
      const alias = aliases.find(([pattern]) => pattern === matchedPattern);
      const label = alias ? alias[1] : matchedPattern;

      const existing = results.find((r) => r.name.toLowerCase() === label.toLowerCase());
      if (!existing) {
        results.push({
          name: label,
          minSpend: price,
          capacity: capacity && capacity <= 30 ? capacity : undefined,
        });
      } else if (!existing.minSpend || price < existing.minSpend) {
        existing.minSpend = price;
        if (capacity && capacity <= 30) existing.capacity = capacity;
      }
    }

    if (results.length === 0 && section) {
      const cards = root.querySelectorAll('[class*="card"], [class*="item"], [class*="tier"], li');
      cards.forEach((el) => {
        const t = (el.textContent || '').trim();
        if (t.length < 8 || t.length > 220) return;
        let matchedPattern = '';
        for (const pattern of tierPatterns) {
          if (t.toLowerCase().includes(pattern)) {
            matchedPattern = pattern;
            break;
          }
        }
        if (!matchedPattern) return;
        const minSpendMatch = t.match(/minimum\s*spend\s*\$?([\d,]+)/i);
        const price = minSpendMatch ? parseInt(minSpendMatch[1].replace(/,/g, ''), 10) : 0;
        if (price <= 0) return;
        const alias = aliases.find(([pattern]) => pattern === matchedPattern);
        const label = alias ? alias[1] : matchedPattern;
        if (!results.some((r) => r.name === label)) {
          results.push({ name: label, minSpend: price });
        }
      });
    }

    return results;
  }, MARQUEE_NIGHTCLUB_TABLE_NAME_ALIASES);
}

/**
 * @param {import('puppeteer-core').Page} page
 * @returns {Promise<object>}
 */
async function parseEventMetadataFromPage(page) {
  const html = await page.content();
  const $ = cheerio.load(html);
  let name = '';
  let description = '';
  let start_datetime = null;
  let end_datetime = null;
  let timezone = 'America/Los_Angeles';
  let image = null;

  const nextData = $('script#__NEXT_DATA__').html();
  if (nextData) {
    try {
      const json = JSON.parse(nextData);
      const props = json.props?.pageProps ?? json.props ?? {};
      const ev = props.event ?? props.data ?? {};
      name = ev.name ?? ev.title ?? '';
      description = ev.description ?? ev.desc ?? ev.long_description ?? '';
      start_datetime = ev.start_datetime ?? ev.start ?? ev.date ?? ev.event_date ?? null;
      end_datetime = ev.end_datetime ?? ev.end ?? ev.end_date ?? null;
      timezone = ev.timezone ?? ev.time_zone ?? timezone;
      image = ev.image ?? ev.image_url ?? ev.flyer ?? ev.thumbnail ?? null;
    } catch (_) {
      // ignore parse errors
    }
  }

  if (!name) {
    name = await page.evaluate(() => {
      const og = document.querySelector('meta[property="og:title"]');
      if (og && og.content) return og.content;
      const h1 = document.querySelector('h1');
      return h1 ? h1.textContent.trim() : '';
    });
  }
  if (!image) {
    image = await page.evaluate(() => {
      const og = document.querySelector('meta[property="og:image"]');
      return og ? og.getAttribute('content') : null;
    });
  }

  return {
    name,
    description: sanitizeMarqueeNightclubDescription(description),
    start_datetime,
    end_datetime,
    timezone,
    image,
  };
}

/**
 * @param {import('puppeteer-core').Page} page
 * @param {object} listingEvent
 * @param {string} listingUrl
 * @returns {Promise<{ items: object[], description: string, warnings: string[], metadata: object }>}
 */
async function scrapeMarqueeNightclubEventDetailPage(page, listingEvent, listingUrl) {
  const warnings = [];
  const cfg = getMarqueeNightclubVenueConfig();

  if (!page.url().includes('taogroup.com')) {
    await page.goto(listingUrl, { waitUntil: 'load', timeout: 45000 });
    await delay(3000);
  }

  let vipClicked = await clickVipReservationsOnListingTile(page, listingEvent);
  if (!vipClicked && listingEvent.detailUrl) {
    warnings.push('VIP Reservations tile click failed; trying event detail page fallback');
    await page.goto(listingEvent.detailUrl, { waitUntil: 'load', timeout: 20000 });
    await delay(2000);
    const clickedVip = await clickByText(page, 'vip reservation');
    if (!clickedVip) await clickByText(page, 'table reservation');
    await delay(2500);
    vipClicked = true;
  }

  if (!vipClicked) {
    warnings.push('Could not open VIP Reservations flow');
  }

  await clickTablesAccordion(page);
  await delay(1500);
  await clickTablesAccordion(page);
  await delay(1000);

  const rawTables = await scrapeTablesFromPage(page);
  const metadata = await parseEventMetadataFromPage(page);

  const items = [];
  (rawTables || []).forEach((item) => {
    const key = normalizeTableName(item.name);
    const { seatCode, the1Category } = resolveMarqueeNightclubSeatMapping(key);
    if (!seatCode) {
      warnings.push(`Unmapped Marquee Nightclub table: "${item.name}"`);
    }
    items.push({
      name: item.name,
      minSpend: item.minSpend,
      capacity: item.capacity,
      seatCode,
      the1Category,
      sectionKey: key,
    });
  });

  console.log(
    `${LOG_PREFIX} scrapeMarqueeNightclubEventDetailPage: ${items.length} inventory row(s), ${warnings.length} warning(s)`
  );

  return {
    items,
    description: metadata.description || '',
    warnings,
    metadata,
    listingUrl: cfg.listingUrl,
  };
}

/**
 * Fetch Marquee Nightclub TABLES inventory via VIP Reservations tile flow.
 * @param {object} listingEvent
 * @returns {Promise<{ items: object[], description: string, warnings: string[], metadata: object, browserError: string|null }>}
 */
async function fetchMarqueeNightclubEventDetailInventory(listingEvent) {
  if (!listingEvent || !listingEvent.eventId) {
    return {
      items: [],
      description: '',
      warnings: ['Missing listing event or eventId'],
      metadata: {},
      browserError: 'Missing listing event or eventId',
    };
  }

  const cfg = getMarqueeNightclubVenueConfig();
  let browserError = null;
  let scrapeResult = { items: [], description: '', warnings: [], metadata: {} };

  try {
    const { result, browserError: pageError } = await withBrowserPage(
      cfg.listingUrl,
      (page) => scrapeMarqueeNightclubEventDetailPage(page, listingEvent, cfg.listingUrl),
      { waitMs: 5000, logPrefix: LOG_PREFIX }
    );
    if (pageError) {
      browserError = pageError;
    } else if (result) {
      scrapeResult = result;
    }
  } catch (err) {
    browserError = err.message || String(err);
    console.error(`${LOG_PREFIX} fetchMarqueeNightclubEventDetailInventory error:`, browserError);
  }

  return {
    ...scrapeResult,
    browserError,
  };
}

module.exports = {
  fetchMarqueeNightclubEventDetailInventory,
  scrapeMarqueeNightclubEventDetailPage,
  MARQUEE_NIGHTCLUB_TABLE_NAME_ALIASES,
  MARQUEE_NIGHTCLUB_TABLE_TO_SEAT_CODE,
  normalizeTableName,
  mapMarqueeNightclubTableToSeatCode,
  resolveMarqueeNightclubSeatMapping,
  sanitizeMarqueeNightclubDescription,
};
