const { withBrowserPage } = require('../../utils/venueScraperBrowser');
const {
  getMarqueeDayclubVenueConfig,
  inferMarqueeDayclubFromEventCode,
} = require('../../utils/marqueeDayclubVenueConfig');
const {
  parseIsoDateFromUrvenueEventCode,
  getCurrentAndNextCalendarMonths,
  isoDateInCalendarMonths,
} = require('./scrapEventsShared');

const LOG_PREFIX = '[Marquee Dayclub scraper]';
const BOOKETING_ORIGIN = 'https://booketing.com';

/**
 * @param {string} value
 * @returns {string}
 */
function slugify(value) {
  return (value || '')
    .toString()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * @param {string} href
 * @returns {string|null}
 */
function nameFromEventHref(href) {
  if (!href) return null;
  const m = href.match(/\/event\/\d+\/\d+\/([^/?]+)/i);
  if (!m || !m[1]) return null;
  return m[1]
    .split('-')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * @param {string} name
 * @param {string} href
 * @returns {string}
 */
function cleanMarqueeDayclubListingName(name, href) {
  let n = (name || '').replace(/\s+/g, ' ').trim();
  const flyerAt = n.search(/\bFlyer:\s*/i);
  if (flyerAt >= 0) {
    n = n.slice(flyerAt + 7).trim();
  }
  n = n.replace(/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\d{1,2}\w{3}(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)?\s*\d{1,2}\/\d{1,2}\s*/i, '').trim();
  if (!n || n.length > 80 || /^book$/i.test(n)) {
    n = nameFromEventHref(href) || n;
  }
  return n || 'Event';
}

/**
 * @param {string} rawText
 * @returns {{ name: string, datePrefix: string }}
 */
function parseLinkText(rawText) {
  const text = (rawText || '').replace(/\s+/g, ' ').trim();
  const m = text.match(/^((?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),?\s+\w{3}\s+\d{1,2})(.*)$/i);
  if (m) {
    return { datePrefix: m[1].trim(), name: (m[2] || '').trim() || text };
  }
  return { datePrefix: '', name: text || 'Event' };
}

/**
 * @param {string|null} isoDate
 * @param {string} datePrefix
 * @returns {string}
 */
function buildDateDisplay(isoDate, datePrefix) {
  if (datePrefix && /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),?\s+\w{3}\s+\d{1,2}/i.test(datePrefix)) {
    return datePrefix;
  }
  if (!isoDate) return '';
  const d = new Date(`${isoDate}T12:00:00`);
  if (Number.isNaN(d.getTime())) return isoDate;
  return d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/**
 * @param {object} raw
 * @param {{ venueName: string, category: string }} venueMeta
 * @returns {object}
 */
function normalizeMarqueeDayclubEvent(raw, venueMeta) {
  const venueName = venueMeta?.venueName || 'Marquee Dayclub';
  const category = venueMeta?.category || 'Daylife';
  const href = raw.href || '';
  const absoluteDetail = href.startsWith('http') ? href : `${BOOKETING_ORIGIN}${href}`;
  const detailUrl = absoluteDetail.split('?')[0];
  const isoDate = parseIsoDateFromUrvenueEventCode(raw.code);
  const name = cleanMarqueeDayclubListingName((raw.text || '').trim(), href) || 'Event';
  const datePrefix = (raw.datePrefix || '').trim();
  const dateDisplay = buildDateDisplay(isoDate, datePrefix || parseLinkText(raw.text || '').datePrefix);
  const externalKey = raw.code
    ? `marquee-dayclub|${raw.code}`
    : `marquee-dayclub|${slugify(name)}|${isoDate || dateDisplay}`;

  return {
    externalKey,
    eventCode: raw.code || null,
    name,
    venueName,
    category,
    venueType: 'day_club',
    type: 'day_club',
    dateDisplay,
    isoDate,
    startTime: raw.startTime || '',
    imageUrl: raw.imageUrl || '',
    detailUrl,
    bookUrl: absoluteDetail,
    isCustomPromo: false,
    hasNameEl: raw.hasNameEl !== false,
  };
}

/**
 * @param {import('puppeteer-core').Page} page
 */
async function dismissMarqueeDayclubPopups(page) {
  await page.evaluate(() => {
    document
      .querySelectorAll('.uwsjs-closepop, .uws-closepop, button.trustarc-agree-btn')
      .forEach((el) => {
        if (typeof el.click === 'function') el.click();
      });
  });
}

/**
 * @param {import('puppeteer-core').Page} page
 * @returns {Promise<object[]>}
 */
async function extractCalendarEventLinks(page) {
  return page.evaluate(() => {
    const clean = (t) => (t || '').replace(/\s+/g, ' ').trim();
    const byCode = new Map();

    document.querySelectorAll('a[href*="eventcode="]').forEach((a) => {
      const href = a.getAttribute('href') || '';
      const codeMatch = href.match(/eventcode=(EVE\d+)/i);
      if (!codeMatch) return;
      const code = codeMatch[1].toUpperCase();

      const nameFromEl = clean(a.querySelector('.name')?.textContent);
      const datePrefix = clean(a.querySelector('.ddate')?.textContent) || '';
      const fallbackText = clean(a.textContent).slice(0, 120);
      const name = nameFromEl || fallbackText;
      const imageUrl = a.querySelector('img')?.getAttribute('src') || '';
      const hasNameEl = Boolean(nameFromEl);
      const textLen = (a.textContent || '').length;

      const candidate = { code, href, text: name, datePrefix, imageUrl, startTime: '', hasNameEl, textLen };
      const prev = byCode.get(code);
      if (!prev) {
        byCode.set(code, candidate);
        return;
      }
      if (candidate.hasNameEl && !prev.hasNameEl) {
        byCode.set(code, candidate);
        return;
      }
      if (candidate.hasNameEl === prev.hasNameEl && candidate.textLen < prev.textLen) {
        byCode.set(code, candidate);
      }
    });

    return [...byCode.values()];
  });
}

/**
 * @param {import('puppeteer-core').Page} page
 * @param {string} monthLabel
 */
async function clickCalendarMonth(page, monthLabel) {
  const normalized = monthLabel.replace(/\s+/g, ' ').trim();
  await page.evaluate((label) => {
    const links = Array.from(document.querySelectorAll('a.uvjs-calendar-loadmonth'));
    const el = links.find((a) =>
      (a.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase() === label.toLowerCase()
    );
    if (el && typeof el.click === 'function') el.click();
  }, normalized);
}

/**
 * @param {Date} date
 * @returns {string}
 */
function formatCalendarMonthLabel(date) {
  return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

/**
 * @param {import('puppeteer-core').Page} page
 * @returns {Promise<{ rawRows: object[], warnings: string[] }>}
 */
async function scrapeMarqueeDayclubListingPage(page) {
  const warnings = [];
  await dismissMarqueeDayclubPopups(page);
  await new Promise((r) => setTimeout(r, 3000));

  const now = new Date();
  const currentMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const monthLabels = [
    formatCalendarMonthLabel(currentMonth),
    formatCalendarMonthLabel(nextMonth),
  ];

  const byCode = new Map();

  for (const label of monthLabels) {
    await clickCalendarMonth(page, label);
    await new Promise((r) => setTimeout(r, 2000));
    const rows = await extractCalendarEventLinks(page);
    rows.forEach((row) => {
      if (!byCode.has(row.code)) byCode.set(row.code, row);
    });
  }

  if (byCode.size === 0) {
    const fallback = await extractCalendarEventLinks(page);
    fallback.forEach((row) => {
      if (!byCode.has(row.code)) byCode.set(row.code, row);
    });
    if (byCode.size > 0) {
      warnings.push('Calendar month navigation returned no rows; used visible page links as fallback');
    }
  }

  const { currentYm, nextYm } = getCurrentAndNextCalendarMonths(now);
  const rawRows = [...byCode.values()].filter((row) => {
    if (!inferMarqueeDayclubFromEventCode(row.code)) return false;
    const iso = parseIsoDateFromUrvenueEventCode(row.code);
    return isoDateInCalendarMonths(iso, currentYm, nextYm);
  });

  if (rawRows.length === 0 && byCode.size > 0) {
    warnings.push(
      `No Marquee Dayclub events in ${currentYm} or ${nextYm} after month filter (${byCode.size} total links on page)`
    );
  }

  return { rawRows, warnings, monthScope: { currentYm, nextYm } };
}

/**
 * Fetch Marquee Dayclub events preview from Booketing calendar.
 * @returns {Promise<object>}
 */
async function fetchMarqueeDayclubEventsPreview() {
  const cfg = getMarqueeDayclubVenueConfig();
  const warnings = [];
  let browserError = null;
  let monthScope = null;

  try {
    const { result, browserError: pageError } = await withBrowserPage(
      cfg.listingUrl,
      async (page) => scrapeMarqueeDayclubListingPage(page),
      { waitMs: 8000, logPrefix: LOG_PREFIX }
    );

    if (pageError) {
      browserError = pageError;
    } else {
      if (result?.warnings?.length) warnings.push(...result.warnings);
      if (result?.monthScope) monthScope = result.monthScope;

      const events = (result?.rawRows || [])
        .map((raw) =>
          normalizeMarqueeDayclubEvent(raw, {
            venueName: cfg.venueName,
            category: cfg.category,
          })
        )
        .filter((e) => e.eventCode && inferMarqueeDayclubFromEventCode(e.eventCode))
        .sort((a, b) => {
          const da = a.isoDate || '';
          const db = b.isoDate || '';
          if (da !== db) return da.localeCompare(db);
          return (a.name || '').localeCompare(b.name || '');
        });

      console.log(
        `${LOG_PREFIX} fetchMarqueeDayclubEventsPreview: ${events.length} event(s)${browserError ? ` (browser error: ${browserError})` : ''}`
      );

      return {
        sourceUrl: cfg.listingUrl,
        scrapedAt: new Date().toISOString(),
        events,
        warnings,
        browserError: events.length === 0 ? browserError : null,
        monthScope,
      };
    }
  } catch (err) {
    browserError = err.message || String(err);
    console.error(`${LOG_PREFIX} fetchMarqueeDayclubEventsPreview error:`, browserError);
  }

  return {
    sourceUrl: cfg.listingUrl,
    scrapedAt: new Date().toISOString(),
    events: [],
    warnings,
    browserError,
    monthScope,
  };
}

/**
 * Build detail URL with eventcode query param when missing.
 * @param {string} detailUrl
 * @param {string} eventCode
 * @returns {string|null}
 */
function buildMarqueeDayclubEventDetailUrl(detailUrl, eventCode) {
  const url = (detailUrl || '').trim();
  const code = (eventCode || '').trim();
  if (!url) return null;
  if (!code || /[?&]eventcode=/i.test(url)) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}eventcode=${encodeURIComponent(code)}`;
}

/**
 * @param {string} detailUrl
 * @param {string} marqueeDayclubEventCode
 * @returns {string|null}
 */
function ensureMarqueeDayclubEventCodeOnDetailUrl(detailUrl, marqueeDayclubEventCode) {
  return buildMarqueeDayclubEventDetailUrl(detailUrl, marqueeDayclubEventCode);
}

module.exports = {
  fetchMarqueeDayclubEventsPreview,
  normalizeMarqueeDayclubEvent,
  buildMarqueeDayclubEventDetailUrl,
  ensureMarqueeDayclubEventCodeOnDetailUrl,
  parseIsoDateFromUrvenueEventCode,
};
