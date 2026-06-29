const { withBrowserPage } = require('../../utils/venueScraperBrowser');
const { getMarqueeNightclubVenueConfig } = require('../../utils/marqueeNightclubVenueConfig');

const LOG_PREFIX = '[Marquee Nightclub scraper]';
const TAO_GROUP_ORIGIN = 'https://taogroup.com';

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
 * @param {string|null|undefined} detailUrl
 * @returns {string}
 */
function slugFromDetailUrl(detailUrl) {
  if (!detailUrl) return '';
  const m = String(detailUrl).match(/\/events?\/([^/?#]+)/i);
  return m ? m[1].toLowerCase().replace(/\/$/, '') : '';
}

/**
 * Parse leading M-D-YYYY from Tao event slug (e.g. 6-29-2026-marquee-mondays).
 * @param {string} slug
 * @returns {string|null}
 */
function isoDateFromTaoSlug(slug) {
  if (!slug || typeof slug !== 'string') return null;
  const match = slug.trim().match(/^(\d{1,2})-(\d{1,2})-(\d{4})/);
  if (!match) return null;
  const [, month, day, year] = match;
  const m = parseInt(month, 10);
  const d = parseInt(day, 10);
  const y = parseInt(year, 10);
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * Parse listing tile date line (e.g. "Mon, Jun 29 2026").
 * @param {string} text
 * @returns {string|null}
 */
function isoDateFromListingDateDisplay(text) {
  if (!text || typeof text !== 'string') return null;
  const d = new Date(text.trim());
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * @param {string|Date|null|undefined} val
 * @returns {string|null}
 */
function isoDateFromValue(val) {
  if (!val) return null;
  const d = val instanceof Date ? val : new Date(val);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Parse leading M/D/YYYY from Tao-style event names.
 * @param {string} name
 * @returns {string|null}
 */
function isoDateFromEventName(name) {
  if (!name || typeof name !== 'string') return null;
  const match = name.trim().match(/^\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!match) return null;
  const [, month, day, year] = match;
  const m = parseInt(month, 10);
  const d = parseInt(day, 10);
  const y = parseInt(year, 10);
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
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
 * @param {{ venueName: string, category: string, type: string }} venueMeta
 * @param {boolean} hasVipReservations
 * @returns {object}
 */
function normalizeMarqueeNightclubEvent(raw, venueMeta, hasVipReservations) {
  const venueName = venueMeta?.venueName || 'Marquee Nightclub';
  const category = venueMeta?.category || 'Nightlife';
  const type = venueMeta?.type || 'night_club';
  const eventId = raw.taoEventId ? String(raw.taoEventId) : '';
  const href = raw.detailUrl || '';
  const detailUrl = href.startsWith('http') ? href.split('?')[0] : `${TAO_GROUP_ORIGIN}${href.split('?')[0]}`;
  const slug = slugFromDetailUrl(raw.detailUrl) || (raw.taoEventId ? String(raw.taoEventId) : '');
  const isoDate =
    isoDateFromValue(raw.start_datetime) ||
    isoDateFromTaoSlug(slug) ||
    isoDateFromListingDateDisplay(raw.dateDisplayRaw) ||
    isoDateFromEventName(raw.name) ||
    null;
  const name = (raw.name || 'Event').replace(/\s+/g, ' ').trim();
  const dateDisplay = buildDateDisplay(isoDate) || (raw.dateDisplayRaw || '').trim();
  const externalKey = eventId
    ? `marquee-nightclub|${eventId}`
    : `marquee-nightclub|${slugify(name)}|${isoDate || dateDisplay}`;

  return {
    externalKey,
    eventId: eventId || null,
    name,
    venueName,
    category,
    venueType: type,
    type,
    dateDisplay,
    isoDate,
    startTime: raw.startTime || '',
    imageUrl: raw.imageUrl || '',
    detailUrl,
    hasVipReservations: hasVipReservations !== false,
    skippedReason: hasVipReservations === false ? 'Buy Tickets only (no VIP Reservations)' : null,
    isCustomPromo: false,
    hasNameEl: true,
  };
}

/**
 * Parse Marquee Nightclub venue calendar tiles from the rendered DOM.
 * @param {import('puppeteer-core').Page} page
 * @returns {Promise<object[]>}
 */
async function parseMarqueeNightclubListingFromDom(page) {
  return page.evaluate((origin) => {
    const vipPattern = /vip\s*reservations?/i;
    const rows = [];
    const seen = new Set();

    document.querySelectorAll('.event-list__item').forEach((item) => {
      const detailLink =
        item.querySelector('a[href*="taogroup.com/event/"]') ||
        item.querySelector('a[href*="/event/"]');
      if (!detailLink) return;

      const href = detailLink.getAttribute('href') || '';
      const slugMatch = href.match(/\/event\/([^/?#]+)/i);
      const slug = slugMatch ? slugMatch[1].replace(/\/$/, '') : '';
      if (!slug || seen.has(slug)) return;
      seen.add(slug);

      const contentEl =
        item.querySelector('.event-list-post__content') ||
        item.querySelector('.event-list-post__text');
      const lines = (contentEl?.innerText || '')
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean);

      let name = '';
      let dateDisplay = '';
      if (lines.length >= 2) {
        name = lines[0];
        dateDisplay = lines[lines.length - 1];
      } else if (lines.length === 1) {
        name = lines[0];
      }

      if (!name) {
        const img = item.querySelector('img[alt]');
        name = (img?.getAttribute('alt') || slug).trim();
      }

      const detailUrl = href.startsWith('http')
        ? href.split('?')[0]
        : `${origin}${href.startsWith('/') ? href : `/${href}`}`.split('?')[0];

      const buttons = Array.from(item.querySelectorAll('a, button, [role="button"]'));
      const hasVip = buttons.some((btn) => vipPattern.test((btn.textContent || '').trim()));

      const imgEl = item.querySelector('img[src]');
      const imageUrl = imgEl?.getAttribute('src') || '';

      const vipLink = item.querySelector('a[href*="booketing.com"]');
      const booketingUrl = vipLink?.getAttribute('href') || '';
      const codeMatch = booketingUrl.match(/eventcode=([^&]+)/i);

      rows.push({
        slug,
        name,
        dateDisplay,
        detailUrl,
        hasVipReservations: hasVip,
        booketingEventCode: codeMatch ? codeMatch[1] : '',
        imageUrl,
      });
    });

    return rows;
  }, TAO_GROUP_ORIGIN);
}

/**
 * @param {import('puppeteer-core').Page} page
 * @returns {Promise<{ rawRows: object[], vipById: Map<string, boolean>, warnings: string[] }>}
 */
async function scrapeMarqueeNightclubListingPage(page) {
  const warnings = [];
  await page.waitForSelector('.event-list__item', { timeout: 20000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 3000));

  const domRows = await parseMarqueeNightclubListingFromDom(page);
  const rawRows = (domRows || []).map((row) => ({
    taoEventId: row.slug,
    name: row.name,
    detailUrl: row.detailUrl,
    dateDisplayRaw: row.dateDisplay,
    booketingEventCode: row.booketingEventCode,
    imageUrl: row.imageUrl,
    hasVipReservations: row.hasVipReservations,
  }));

  const vipById = new Map(
    rawRows.map((row) => [String(row.taoEventId), Boolean(row.hasVipReservations)])
  );

  if (rawRows.length === 0) {
    warnings.push('No event tiles found on Marquee Nightclub listing page');
  }

  return { rawRows, vipById, warnings };
}

/**
 * Fetch Marquee Nightclub events preview from taogroup.com venue calendar.
 * @returns {Promise<object>}
 */
async function fetchMarqueeNightclubEventsPreview() {
  const cfg = getMarqueeNightclubVenueConfig();
  const warnings = [];
  let browserError = null;

  try {
    const { result, browserError: pageError } = await withBrowserPage(
      cfg.listingUrl,
      async (page) => scrapeMarqueeNightclubListingPage(page),
      { waitMs: 5000, logPrefix: LOG_PREFIX }
    );

    if (pageError) {
      browserError = pageError;
    } else {
      if (result?.warnings?.length) warnings.push(...result.warnings);

      const events = (result?.rawRows || [])
        .map((raw) =>
          normalizeMarqueeNightclubEvent(
            raw,
            {
              venueName: cfg.venueName,
              category: cfg.category,
              type: cfg.type,
            },
            raw.hasVipReservations
          )
        )
        .filter((e) => e.eventId)
        .sort((a, b) => {
          const da = a.isoDate || '';
          const db = b.isoDate || '';
          if (da !== db) return da.localeCompare(db);
          return (a.name || '').localeCompare(b.name || '');
        });

      console.log(
        `${LOG_PREFIX} fetchMarqueeNightclubEventsPreview: ${events.length} event(s)${browserError ? ` (browser error: ${browserError})` : ''}`
      );

      return {
        sourceUrl: cfg.listingUrl,
        scrapedAt: new Date().toISOString(),
        events,
        warnings,
        browserError: events.length === 0 ? browserError : null,
      };
    }
  } catch (err) {
    browserError = err.message || String(err);
    console.error(`${LOG_PREFIX} fetchMarqueeNightclubEventsPreview error:`, browserError);
  }

  return {
    sourceUrl: cfg.listingUrl,
    scrapedAt: new Date().toISOString(),
    events: [],
    warnings,
    browserError,
  };
}

module.exports = {
  fetchMarqueeNightclubEventsPreview,
  normalizeMarqueeNightclubEvent,
  scrapeMarqueeNightclubListingPage,
  parseMarqueeNightclubListingFromDom,
  slugFromDetailUrl,
  isoDateFromEventName,
  isoDateFromTaoSlug,
  isoDateFromListingDateDisplay,
};
