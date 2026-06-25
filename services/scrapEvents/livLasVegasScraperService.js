const { withBrowserPage } = require('../../utils/venueScraperBrowser');

const LIV_EVENTS_LISTING_URL =
  process.env.LIV_EVENTS_LISTING_URL || 'https://www.livnightclub.com/las-vegas/events/';

const LOG_PREFIX = '[LIV scraper]';

/**
 * Parse YYYYMMDD from LIV event code (e.g. EVE121488100020260626).
 * @param {string} eventCode
 * @returns {string|null} ISO date YYYY-MM-DD
 */
function parseIsoDateFromEventCode(eventCode) {
  if (!eventCode || typeof eventCode !== 'string') return null;
  const match = eventCode.match(/(\d{4})(\d{2})(\d{2})$/);
  if (!match) return null;
  const [, y, m, d] = match;
  return `${y}-${m}-${d}`;
}

/**
 * Build human-readable date from parts and optional event code year.
 * @param {object} raw
 * @returns {string}
 */
function buildDateDisplay(raw) {
  if (raw.uwsdate) return raw.uwsdate.trim();
  const iso = parseIsoDateFromEventCode(raw.code);
  if (iso) {
    const d = new Date(`${iso}T12:00:00`);
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
    }
  }
  const parts = [raw.weekday, raw.month, raw.day].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  return parts || '';
}

/**
 * Slugify for externalKey fallback.
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
 * Normalize raw DOM row into preview DTO.
 * @param {object} raw
 * @returns {object}
 */
function normalizeLivEvent(raw) {
  const detailUrl = (raw.href || '').split('?')[0];
  const dateDisplay = buildDateDisplay(raw);
  const isoDate = parseIsoDateFromEventCode(raw.code);
  const externalKey = raw.code
    ? `liv|${raw.code}`
    : `liv|${slugify(raw.name)}|${slugify(raw.venue)}|${isoDate || dateDisplay}`;

  return {
    externalKey,
    eventCode: raw.code || null,
    name: raw.name || 'Event',
    venueName: raw.venue || '',
    category: raw.cat || '',
    dateDisplay,
    isoDate,
    startTime: raw.time || '',
    imageUrl: raw.img || '',
    detailUrl,
    bookUrl: detailUrl,
  };
}

/**
 * Extract event rows from rendered LIV listing page inside the browser.
 * @param {import('puppeteer-core').Page} page
 * @returns {Promise<object[]>}
 */
async function extractLivEventsFromPage(page) {
  return page.evaluate(() => {
    const items = Array.from(document.querySelectorAll('.uws-event-list-item[data-eventcode]'));
    return items.map((item) => {
      const code = item.getAttribute('data-eventcode');
      const link =
        item.querySelector('a.hd-link[href*="/event/"]') ||
        item.querySelector('a[href*="/event/"]');
      const img = item.querySelector('img[src]');
      return {
        code,
        href: link ? link.href : '',
        cat: item.querySelector('.venueurl span')?.textContent?.trim() || '',
        name:
          item.querySelector('.uv-event-name-title, .uwsname')?.textContent?.trim() || '',
        venue:
          item.querySelector('.uv-ev-venue, .uwsvenuename')?.textContent?.trim() || '',
        time: item.querySelector('.uwsdtime')?.textContent?.trim() || '',
        weekday: item.querySelector('.uv-ev-weekday')?.textContent?.trim() || '',
        month: item.querySelector('.uv-ev-month')?.textContent?.trim() || '',
        day: item.querySelector('.uv-ev-day')?.textContent?.trim() || '',
        uwsdate: item.querySelector('.uwsddate')?.textContent?.trim() || '',
        img: img ? img.src : '',
      };
    });
  });
}

/**
 * Sort preview events by iso date then start time.
 * @param {object[]} events
 * @returns {object[]}
 */
function sortLivEvents(events) {
  return [...events].sort((a, b) => {
    const dateCmp = (a.isoDate || '').localeCompare(b.isoDate || '');
    if (dateCmp !== 0) return dateCmp;
    return (a.startTime || '').localeCompare(b.startTime || '');
  });
}

/**
 * Fetch and parse all LIV Las Vegas listing events (preview only, no DB writes).
 * @returns {Promise<{ sourceUrl: string, scrapedAt: string, count: number, events: object[], warnings: string[], browserError?: string }>}
 */
async function fetchLivLasVegasEventsPreview() {
  const sourceUrl = LIV_EVENTS_LISTING_URL;
  const warnings = [];

  const { result, browserError } = await withBrowserPage(
    sourceUrl,
    extractLivEventsFromPage,
    {
      waitForSelector: '.uws-event-list-item[data-eventcode], .uws-integration.uws-events',
      clickLoadMore: true,
      logPrefix: LOG_PREFIX,
    }
  );

  if (browserError) {
    return {
      sourceUrl,
      scrapedAt: new Date().toISOString(),
      count: 0,
      events: [],
      warnings,
      browserError,
    };
  }

  const rawRows = Array.isArray(result) ? result : [];
  const byKey = new Map();

  rawRows.forEach((row) => {
    const normalized = normalizeLivEvent(row);
    const dedupeKey = normalized.eventCode || normalized.detailUrl || normalized.externalKey;
    if (!dedupeKey) return;
    if (!byKey.has(dedupeKey)) {
      byKey.set(dedupeKey, normalized);
    }
  });

  if (rawRows.length > byKey.size) {
    warnings.push(`Deduped ${rawRows.length} DOM rows to ${byKey.size} unique events.`);
  }
  if (byKey.size === 0) {
    warnings.push('No events found. The page layout may have changed or Cloudflare blocked the scraper.');
  }

  const events = sortLivEvents([...byKey.values()]);

  console.log(`${LOG_PREFIX} fetchLivLasVegasEventsPreview: ${events.length} events from ${sourceUrl}`);

  return {
    sourceUrl,
    scrapedAt: new Date().toISOString(),
    count: events.length,
    events,
    warnings,
  };
}

module.exports = {
  fetchLivLasVegasEventsPreview,
  parseIsoDateFromEventCode,
  normalizeLivEvent,
};
