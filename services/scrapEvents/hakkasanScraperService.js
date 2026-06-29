const { withBrowserPage } = require('../../utils/venueScraperBrowser');
const { getHakkasanVenueConfig } = require('../../utils/hakkasanVenueConfig');
const {
  parseIsoDateFromUrvenueEventCode,
  getCurrentAndNextCalendarMonths,
  isoDateInCalendarMonths,
} = require('./scrapEventsShared');

const LOG_PREFIX = '[Hakkasan scraper]';
const BOOKETING_ORIGIN = 'https://booketing.com';

/** v1: Studio / R&Bae events use different TABLES — exclude from importable listing. */
const STUDIO_EVENT_PATTERN = /\b(r\s*&\s*bae|the\s+studio)\b/i;

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
  if (!m) return null;
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
function cleanHakkasanListingName(name, href) {
  let n = (name || '').replace(/\s+/g, ' ').trim();
  const boilerplateAt = n.search(/\bHakkasan Nightclub inside\b/i);
  if (boilerplateAt > 0) n = n.slice(0, boilerplateAt).trim();
  n = n.replace(/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\d{1,2}\w{3}(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)?\s*\d{1,2}\/\d{1,2}\s*/i, '').trim();
  if (!n || n.length > 80) {
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
 * Whether listing row is a Studio / R&Bae event (v1 out of scope).
 * @param {string} name
 * @returns {boolean}
 */
function isHakkasanStudioEvent(name) {
  return STUDIO_EVENT_PATTERN.test(String(name || ''));
}

/**
 * @param {object} raw
 * @param {{ venueName: string, category: string }} venueMeta
 * @returns {object}
 */
function normalizeHakkasanEvent(raw, venueMeta) {
  const venueName = venueMeta?.venueName || 'Hakkasan Las Vegas';
  const category = venueMeta?.category || 'Nightlife';
  const href = raw.href || '';
  const absoluteDetail = href.startsWith('http') ? href : `${BOOKETING_ORIGIN}${href}`;
  const detailUrl = absoluteDetail.split('?')[0];
  const isoDate = parseIsoDateFromUrvenueEventCode(raw.code);
  const name = cleanHakkasanListingName((raw.text || '').trim(), href) || 'Event';
  const datePrefix = (raw.datePrefix || '').trim();
  const dateDisplay = buildDateDisplay(isoDate, datePrefix || parseLinkText(raw.text || '').datePrefix);
  const isStudioEvent = isHakkasanStudioEvent(name);
  const externalKey = raw.code
    ? `hakkasan|${raw.code}`
    : `hakkasan|${slugify(name)}|${isoDate || dateDisplay}`;

  return {
    externalKey,
    eventCode: raw.code || null,
    name,
    venueName,
    category,
    venueType: 'night_club',
    type: 'night_club',
    dateDisplay,
    isoDate,
    startTime: raw.startTime || '',
    imageUrl: raw.imageUrl || '',
    detailUrl,
    bookUrl: absoluteDetail,
    isCustomPromo: false,
    isStudioEvent,
    skipReason: isStudioEvent ? 'Studio / R&Bae events are not supported in v1' : null,
  };
}

/**
 * @param {import('puppeteer-core').Page} page
 */
async function dismissHakkasanPopups(page) {
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

    return [...byCode.values()].map(({ hasNameEl, textLen, ...row }) => row);
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
 * @param {string} listingUrl
 * @returns {Promise<{ rawRows: object[], warnings: string[] }>}
 */
async function scrapeHakkasanListingPage(page, listingUrl) {
  const warnings = [];
  await dismissHakkasanPopups(page);
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
    const iso = parseIsoDateFromUrvenueEventCode(row.code);
    return isoDateInCalendarMonths(iso, currentYm, nextYm);
  });

  if (rawRows.length === 0 && byCode.size > 0) {
    warnings.push(
      `No events in ${currentYm} or ${nextYm} after month filter (${byCode.size} total links on page)`
    );
  }

  return { rawRows, warnings, monthScope: { currentYm, nextYm } };
}

/**
 * Fetch Hakkasan events preview from Booketing calendar.
 * @returns {Promise<object>}
 */
async function fetchHakkasanEventsPreview() {
  const cfg = getHakkasanVenueConfig();
  const warnings = [];
  let browserError = null;
  let monthScope = null;

  try {
    const { result, browserError: pageError } = await withBrowserPage(
      cfg.listingUrl,
      async (page) => scrapeHakkasanListingPage(page, cfg.listingUrl),
      { waitMs: 8000, logPrefix: LOG_PREFIX }
    );

    if (pageError) {
      browserError = pageError;
    } else {
      if (result?.warnings?.length) warnings.push(...result.warnings);
      if (result?.monthScope) monthScope = result.monthScope;

      const events = (result?.rawRows || [])
        .map((raw) =>
          normalizeHakkasanEvent(raw, {
            venueName: cfg.venueName,
            category: cfg.category,
          })
        )
        .filter((e) => e.eventCode)
        .sort((a, b) => {
          const da = a.isoDate || '';
          const db = b.isoDate || '';
          if (da !== db) return da.localeCompare(db);
          return (a.name || '').localeCompare(b.name || '');
        });

      console.log(
        `${LOG_PREFIX} fetchHakkasanEventsPreview: ${events.length} event(s)${browserError ? ` (browser error: ${browserError})` : ''}`
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
    console.error(`${LOG_PREFIX} fetchHakkasanEventsPreview error:`, browserError);
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

module.exports = {
  fetchHakkasanEventsPreview,
  normalizeHakkasanEvent,
  isHakkasanStudioEvent,
  parseIsoDateFromUrvenueEventCode,
};
