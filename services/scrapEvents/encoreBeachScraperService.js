/**
 * Encore Beach Club listing scraper — wynnsocial.com/events (UrVenue calendar).
 */
const { withBrowserPage } = require('../../utils/venueScraperBrowser');
const {
  getEncoreBeachVenueConfig,
  normalizeEncoreScope,
  resolveEncoreVenue,
  isEncoreListingVenue,
  inferEncoreVenueTypeFromEventCode,
} = require('../../utils/encoreBeachVenueConfig');
const {
  parseIsoDateFromUrvenueEventCode,
  getCurrentAndNextCalendarMonths,
  isoDateInCalendarMonths,
} = require('./scrapEventsShared');

const LOG_PREFIX = '[Encore Beach scraper]';

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
 * @param {string|null} isoDate
 * @returns {string}
 */
function buildDateDisplay(isoDate) {
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
 * @returns {object}
 */
function normalizeEncoreBeachEvent(raw) {
  const eventCode = String(raw.eventCode || '').toUpperCase();
  const venueResolved = resolveEncoreVenue({
    venueName: raw.venueName,
    eventCode,
  });
  const isoDate = parseIsoDateFromUrvenueEventCode(eventCode) || null;
  const name = (raw.name || 'Event').replace(/\s+/g, ' ').trim();
  const detailUrl = (raw.detailUrl || '').split('?')[0];
  const externalKey = eventCode
    ? `encore-beach|${eventCode}`
    : `encore-beach|${slugify(name)}|${isoDate || ''}|${venueResolved.venueType}`;

  return {
    externalKey,
    eventId: eventCode || null,
    eventCode: eventCode || null,
    name,
    venueName: venueResolved.venueName,
    category: venueResolved.category,
    venueType: venueResolved.venueType,
    type: venueResolved.type,
    locationId: venueResolved.locationId,
    dateDisplay: buildDateDisplay(isoDate) || (raw.dateDisplayRaw || '').trim(),
    isoDate,
    startTime: raw.startTime || '',
    imageUrl: raw.imageUrl || '',
    detailUrl,
    bookUrl: detailUrl,
    isCustomPromo: false,
  };
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
 * @param {Date} date
 * @returns {string}
 */
function formatCalendarMonthLabel(date) {
  return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

/**
 * @param {import('puppeteer-core').Page} page
 * @param {string} monthLabel
 */
async function clickCalendarMonth(page, monthLabel) {
  const normalized = monthLabel.replace(/\s+/g, ' ').trim();
  await page.evaluate((label) => {
    const links = Array.from(
      document.querySelectorAll('a.uvjs-calendar-loadmonth, a, button, li')
    );
    const el = links.find(
      (a) =>
        (a.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase() ===
        label.toLowerCase()
    );
    if (el && typeof el.click === 'function') el.click();
  }, normalized);
}

/**
 * @param {import('puppeteer-core').Page} page
 * @returns {Promise<object[]>}
 */
async function extractEncoreListingItems(page) {
  return page.evaluate(() => {
    const clean = (t) => (t || '').replace(/\s+/g, ' ').trim();
    const byCode = new Map();

    document.querySelectorAll('li.eventitem').forEach((li) => {
      const codeMatch = (li.className || '').match(/\b(EVE\d+)\b/i);
      const anchor = li.querySelector('a.uv-boxitem[href*="/event/EVE"], a[href*="/event/EVE"]');
      if (!anchor) return;
      const href = anchor.href || anchor.getAttribute('href') || '';
      const codeFromHref = (href.match(/\/event\/(EVE\d+)/i) || [])[1];
      const code = (codeMatch ? codeMatch[1] : codeFromHref || '').toUpperCase();
      if (!code) return;

      const venueEl = li.querySelector('.uv-events-venue, .venueurl');
      const venueName = clean(venueEl?.textContent) || '';
      const aria = clean(li.getAttribute('aria-label') || '');
      let name = aria;
      if (venueName && name.toLowerCase().endsWith(venueName.toLowerCase())) {
        name = clean(name.slice(0, -venueName.length).replace(/\s*[-–—]\s*$/, ''));
      }
      if (!name) {
        name = clean(anchor.getAttribute('aria-label') || '') || clean(anchor.textContent);
      }
      const bg =
        li.querySelector('.uv-lazyimage')?.getAttribute('data-bg') ||
        li.querySelector('img')?.getAttribute('src') ||
        '';

      if (!byCode.has(code)) {
        byCode.set(code, {
          eventCode: code,
          name: name || 'Event',
          venueName,
          detailUrl: href.split('?')[0],
          imageUrl: bg,
          dateDisplayRaw: clean(li.querySelector('.uv-list-date')?.textContent),
          startTime: '',
        });
      }
    });

    return [...byCode.values()];
  });
}

/**
 * @param {import('puppeteer-core').Page} page
 * @returns {Promise<{ rawRows: object[], warnings: string[] }>}
 */
async function scrapeEncoreBeachListingPage(page) {
  const warnings = [];
  await dismissEncorePopups(page);
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
    const rows = await extractEncoreListingItems(page);
    rows.forEach((row) => {
      if (!byCode.has(row.eventCode)) byCode.set(row.eventCode, row);
    });
  }

  if (byCode.size === 0) {
    const fallback = await extractEncoreListingItems(page);
    fallback.forEach((row) => {
      if (!byCode.has(row.eventCode)) byCode.set(row.eventCode, row);
    });
    if (byCode.size > 0) {
      warnings.push('Calendar month navigation returned no rows; used visible page items');
    }
  }

  const { currentYm, nextYm } = getCurrentAndNextCalendarMonths(now);
  let rawRows = [...byCode.values()].filter((row) => {
    if (!isEncoreListingVenue(row.venueName) && !inferEncoreVenueTypeFromEventCode(row.eventCode)) {
      return false;
    }
    if (!isEncoreListingVenue(row.venueName) && inferEncoreVenueTypeFromEventCode(row.eventCode)) {
      // code-only Encore — keep
    } else if (!isEncoreListingVenue(row.venueName)) {
      return false;
    }
    const iso = parseIsoDateFromUrvenueEventCode(row.eventCode);
    return isoDateInCalendarMonths(iso, currentYm, nextYm);
  });

  // Prefer venue-labeled Encore; drop Field Club etc. already filtered
  rawRows = rawRows.filter(
    (row) =>
      isEncoreListingVenue(row.venueName) ||
      inferEncoreVenueTypeFromEventCode(row.eventCode)
  );

  if (rawRows.length === 0 && byCode.size > 0) {
    warnings.push(
      `No Encore Beach events in ${currentYm} or ${nextYm} (${byCode.size} total calendar items)`
    );
  }

  return { rawRows, warnings, monthScope: { currentYm, nextYm } };
}

/**
 * @param {{ scope?: string }} [options]
 * @returns {Promise<object>}
 */
async function fetchEncoreBeachEventsPreview(options = {}) {
  const cfg = getEncoreBeachVenueConfig();
  const scope = normalizeEncoreScope(options.scope);
  const warnings = [];
  let browserError = null;

  try {
    const { result, browserError: pageError } = await withBrowserPage(
      cfg.listingUrl,
      async (page) => scrapeEncoreBeachListingPage(page),
      { waitMs: 5000, logPrefix: LOG_PREFIX }
    );

    if (pageError) {
      browserError = pageError;
    } else {
      if (result?.warnings?.length) warnings.push(...result.warnings);

      let events = (result?.rawRows || [])
        .map((raw) => normalizeEncoreBeachEvent(raw))
        .filter((e) => e.eventId && isEncoreListingVenue(e.venueName));

      if (scope === 'daylife') {
        events = events.filter((e) => e.venueType === 'day_club');
      } else if (scope === 'nightlife') {
        events = events.filter((e) => e.venueType === 'night_club');
      }

      events.sort((a, b) => {
        const da = a.isoDate || '';
        const db = b.isoDate || '';
        if (da !== db) return da.localeCompare(db);
        return (a.name || '').localeCompare(b.name || '');
      });

      console.log(
        `${LOG_PREFIX} fetchEncoreBeachEventsPreview: ${events.length} event(s) scope=${scope}`
      );

      return {
        sourceUrl: cfg.listingUrl,
        scrapedAt: new Date().toISOString(),
        scope,
        events,
        warnings,
        browserError: events.length === 0 ? browserError : null,
      };
    }
  } catch (err) {
    browserError = err.message || String(err);
    console.error(`${LOG_PREFIX} fetchEncoreBeachEventsPreview error:`, browserError);
  }

  return {
    sourceUrl: cfg.listingUrl,
    scrapedAt: new Date().toISOString(),
    scope,
    events: [],
    warnings,
    browserError,
  };
}

module.exports = {
  fetchEncoreBeachEventsPreview,
  normalizeEncoreBeachEvent,
  scrapeEncoreBeachListingPage,
  slugify,
  buildDateDisplay,
};
