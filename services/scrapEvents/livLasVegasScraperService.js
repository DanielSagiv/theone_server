const { withBrowserPage, clickLoadMoreUntilDone } = require('../../utils/venueScraperBrowser');

const LIV_EVENTS_LISTING_URL =
  process.env.LIV_EVENTS_LISTING_URL || 'https://www.livnightclub.com/las-vegas/events/';

const LOG_PREFIX = '[LIV scraper]';
const EVENT_ITEM_SELECTOR = '.uws-event-list-item[data-eventcode]';

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
    isCustomPromo: Boolean(raw.isCustom),
  };
}

/**
 * Parse LIV event code from detail URL.
 * @param {string} href
 * @returns {string|null}
 */
function parseEventCodeFromHref(href) {
  if (!href) return null;
  const match = href.match(/\/event\/(EVE\d+)/i);
  return match ? match[1] : null;
}

/**
 * Score raw row richness for merge preference.
 * @param {object} row
 * @returns {number}
 */
function livRowRichness(row) {
  return [row.name, row.venue, row.time, row.cat, row.img, row.href].filter(Boolean).length;
}

/**
 * Merge agenda, calendar, and custom rows (keep richer row per event code or URL).
 * @param {object[]} primary
 * @param {object[]} secondary
 * @param {object[]} [tertiary]
 * @returns {object[]}
 */
function mergeLivEventRows(primary, secondary, tertiary = []) {
  const byKey = new Map();
  [...primary, ...secondary, ...tertiary].forEach((row) => {
    const code = row.code || parseEventCodeFromHref(row.href);
    const key = code
      ? code.toUpperCase()
      : (row.href || '').split('?')[0].toLowerCase();
    if (!key) return;
    const existing = byKey.get(key);
    if (!existing || livRowRichness(row) > livRowRichness(existing)) {
      byKey.set(key, { ...row, code: code || null });
    }
  });
  return [...byKey.values()];
}

/**
 * Scroll listing to trigger lazy-rendered event cards.
 * @param {import('puppeteer-core').Page} page
 */
async function scrollListingToRenderLazyCards(page) {
  await page.evaluate(async () => {
    const step = Math.max(window.innerHeight || 800, 400);
    const max = document.body.scrollHeight;
    for (let y = 0; y <= max; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 150));
    }
    window.scrollTo(0, 0);
  });
  await new Promise((r) => setTimeout(r, 1000));
}

/**
 * Extract visible custom/promo rows (no data-eventcode, e.g. special-events landing pages).
 * @param {import('puppeteer-core').Page} page
 * @returns {Promise<object[]>}
 */
async function extractLivCustomEventsFromPage(page) {
  return page.evaluate(() => {
    const isVisible = (el) => {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return (
        rect.height > 0 &&
        rect.width > 0 &&
        style.display !== 'none' &&
        style.visibility !== 'hidden'
      );
    };

    const items = Array.from(
      document.querySelectorAll('.uws-event-list-item:not([data-eventcode])')
    ).filter(isVisible);

    return items
      .map((item) => {
        const link =
          item.querySelector('a.hd-link[href]') ||
          item.querySelector('a[href*="/special-events/"]') ||
          item.querySelector('a[href]');
        const img = item.querySelector('img[src]');
        const href = link ? link.href.split('?')[0] : '';
        if (!href) return null;

        return {
          code: null,
          href,
          cat: item.querySelector('.venueurl span')?.textContent?.trim() || '',
          name:
            item.querySelector('.uv-event-name-title, .uwsname')?.textContent?.trim() ||
            img?.getAttribute('alt') ||
            link?.getAttribute('aria-label') ||
            '',
          venue:
            item.querySelector('.uv-ev-venue, .uwsvenuename')?.textContent?.trim() || '',
          time: item.querySelector('.uwsdtime')?.textContent?.trim() || '',
          weekday: item.querySelector('.uv-ev-weekday')?.textContent?.trim() || '',
          month: item.querySelector('.uv-ev-month')?.textContent?.trim() || '',
          day: item.querySelector('.uv-ev-day')?.textContent?.trim() || '',
          uwsdate: item.querySelector('.uwsddate')?.textContent?.trim() || '',
          img: img ? img.src : '',
          isCustom: true,
        };
      })
      .filter(Boolean);
  });
}

/**
 * Count visible event list tiles (standard + custom promo cards).
 * @param {import('puppeteer-core').Page} page
 * @returns {Promise<number>}
 */
async function countVisibleEventTiles(page) {
  return page.evaluate(() => {
    const isVisible = (el) => {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return (
        rect.height > 0 &&
        rect.width > 0 &&
        style.display !== 'none' &&
        style.visibility !== 'hidden'
      );
    };
    return document.querySelectorAll('.uws-event-list-item').length
      ? Array.from(document.querySelectorAll('.uws-event-list-item')).filter(isVisible).length
      : 0;
  });
}

/**
 * Extract event rows from calendar single-link cards (fallback for agenda-only gaps).
 * @param {import('puppeteer-core').Page} page
 * @returns {Promise<object[]>}
 */
async function extractLivCalendarEventsFromPage(page) {
  return page.evaluate(() => {
    const links = Array.from(document.querySelectorAll('a.uws-cal-single-link[href*="/event/"]'));
    return links.map((link) => {
      const href = link.href || '';
      const codeMatch = href.match(/\/event\/(EVE\d+)/i);
      const code = codeMatch ? codeMatch[1] : null;
      const img = link.querySelector('img[src]');
      return {
        code,
        href,
        cat: link.querySelector('.venueurl span')?.textContent?.trim() || '',
        name: link.querySelector('.uwsname, .uv-event-name-title')?.textContent?.trim() || '',
        venue: link.querySelector('.uwsvenuename, .uv-ev-venue')?.textContent?.trim() || '',
        time: link.querySelector('.uwsdtime')?.textContent?.trim() || '',
        weekday: '',
        month: '',
        day: '',
        uwsdate: link.querySelector('.uwsddate')?.textContent?.trim() || '',
        img: img ? img.src : '',
      };
    });
  });
}

/**
 * Read expected event count from LIV widget class (uws-events-count-N).
 * @param {import('puppeteer-core').Page} page
 * @returns {Promise<number|null>}
 */
async function readLivWidgetEventCount(page) {
  return page.evaluate(() => {
    const widget = document.querySelector('.uws-integration.uws-events');
    if (!widget || !widget.className) return null;
    const match = widget.className.match(/uws-events-count-(\d+)/);
    return match ? parseInt(match[1], 10) : null;
  });
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
 * Count event cards on the page.
 * @param {import('puppeteer-core').Page} page
 * @returns {Promise<number>}
 */
async function countEventCards(page) {
  return page.evaluate(
    (selector) => document.querySelectorAll(selector).length,
    EVENT_ITEM_SELECTOR
  );
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
 * Click a view tab by label (Agenda, List, Calendar).
 * @param {import('puppeteer-core').Page} page
 * @param {string} label
 * @returns {Promise<boolean>}
 */
async function clickViewTab(page, label) {
  return page.evaluate((tabLabel) => {
    const nodes = Array.from(document.querySelectorAll('button, a, span, li, div'));
    const tab = nodes.find((n) =>
      new RegExp(`^${tabLabel}$`, 'i').test((n.textContent || '').trim())
    );
    if (tab && typeof tab.click === 'function') {
      tab.click();
      return true;
    }
    return false;
  }, label);
}

/**
 * Poll until at least one event card is visible.
 * @param {import('puppeteer-core').Page} page
 * @param {number} [maxMs]
 * @returns {Promise<number>}
 */
async function pollForEventCards(page, maxMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    const count = await countEventCards(page);
    if (count > 0) return count;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return 0;
}

/**
 * Prepare LIV listing page: dismiss popups, activate Agenda/List view, wait for cards.
 * @param {import('puppeteer-core').Page} page
 * @returns {Promise<number>} visible event card count after prep
 */
async function prepareLivListingPage(page) {
  await page.waitForSelector('.uws-integration.uws-events', { timeout: 30000 }).catch(() => {});
  await dismissLivPopups(page);
  await new Promise((r) => setTimeout(r, 2000));
  await dismissLivPopups(page);

  await clickViewTab(page, 'Agenda');
  await new Promise((r) => setTimeout(r, 2000));
  let count = await pollForEventCards(page, 20000);

  if (count === 0) {
    console.log(`${LOG_PREFIX} prepareLivListingPage: Agenda view had 0 cards, trying List`);
    await clickViewTab(page, 'List');
    await new Promise((r) => setTimeout(r, 2000));
    count = await pollForEventCards(page, 20000);
  }

  console.log(`${LOG_PREFIX} prepareLivListingPage: ${count} event cards visible`);
  return count;
}

/**
 * Collect DOM diagnostics when scrape returns zero events.
 * @param {import('puppeteer-core').Page} page
 * @returns {Promise<object>}
 */
async function collectLivPageDiagnostics(page) {
  return page.evaluate(() => {
    const activeViewEl = document.querySelector(
      '.uws-events-view.uvsactive, .uws-events-view.uwsactive, .uws-events-view[class*="active"]'
    );
    return {
      title: document.title || '',
      eventListItems: document.querySelectorAll('.uws-event-list-item[data-eventcode]').length,
      calendarLinks: document.querySelectorAll('a.uws-cal-single-link[href*="/event/"]').length,
      hdLinks: document.querySelectorAll('a.hd-link[href*="/event/"]').length,
      eventsWidget: document.querySelectorAll('.uws-integration.uws-events').length,
      activeViewClass: activeViewEl ? activeViewEl.className : null,
      cloudflareBlocked: /cloudflare|blocked|attention required/i.test(document.title || ''),
    };
  });
}

/**
 * Format diagnostics for warnings array.
 * @param {object} diagnostics
 * @returns {string}
 */
function formatDiagnosticsWarning(diagnostics) {
  if (!diagnostics) {
    return 'No events found. The page may not have finished loading or Cloudflare blocked the scraper.';
  }
  if (diagnostics.cloudflareBlocked) {
    return `Cloudflare or bot protection detected (page title: "${diagnostics.title}").`;
  }
  return (
    `No events found after page prep. Diagnostics: title="${diagnostics.title}", ` +
    `eventCards=${diagnostics.eventListItems}, hdLinks=${diagnostics.hdLinks}, ` +
    `widget=${diagnostics.eventsWidget}, activeView="${diagnostics.activeViewClass || 'unknown'}".`
  );
}

/**
 * Full LIV listing scrape: prep, Load More, extract agenda + calendar fallback.
 * @param {import('puppeteer-core').Page} page
 * @returns {Promise<{ rows: object[], diagnostics: object|null, loadMoreMeta: object|null, widgetCount: number|null }>}
 */
async function scrapeLivListingPage(page) {
  await prepareLivListingPage(page);

  const loadMoreMeta = await clickLoadMoreUntilDone(page, {
    logPrefix: LOG_PREFIX,
    maxClicks: 100,
  });

  await scrollListingToRenderLazyCards(page);

  const agendaRows = await extractLivEventsFromPage(page);
  const customRows = await extractLivCustomEventsFromPage(page);
  const calendarRows = await extractLivCalendarEventsFromPage(page);
  const rows = mergeLivEventRows(agendaRows, calendarRows, customRows);
  const widgetCount = await readLivWidgetEventCount(page);
  const visibleTiles = await countVisibleEventTiles(page);

  console.log(
    `${LOG_PREFIX} scrapeLivListingPage: agenda=${agendaRows.length}, custom=${customRows.length}, calendar=${calendarRows.length}, merged=${rows.length}, visibleTiles=${visibleTiles}, widgetCount=${widgetCount}`
  );

  let diagnostics = null;
  if (!rows.length) {
    diagnostics = await collectLivPageDiagnostics(page);
    console.warn(`${LOG_PREFIX} scrapeLivListingPage diagnostics:`, diagnostics);
  } else if (widgetCount && rows.length < widgetCount) {
    diagnostics = {
      widgetCount,
      visibleTiles,
      scrapedCount: rows.length,
      loadMoreMeta,
    };
  }

  return { rows, diagnostics, loadMoreMeta, widgetCount, visibleTiles };
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

  const { result, browserError } = await withBrowserPage(sourceUrl, scrapeLivListingPage, {
    waitMs: 0,
    clickLoadMore: false,
    logPrefix: LOG_PREFIX,
  });

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

  const rawRows = Array.isArray(result?.rows) ? result.rows : [];
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
  if (result?.loadMoreMeta?.hitMaxCap) {
    warnings.push(
      'Load More click limit reached before the listing was fully expanded. Some events may be missing.'
    );
  }
  const widgetCount = result?.widgetCount;
  const visibleTiles = result?.visibleTiles;
  if (widgetCount && byKey.size < widgetCount) {
    const tileGap = visibleTiles ? widgetCount - visibleTiles : null;
    if (tileGap === 0 && byKey.size < visibleTiles) {
      warnings.push(
        `Scraped ${byKey.size} unique events from ${visibleTiles} visible tiles (widget reports ${widgetCount}). Duplicate promo tiles were deduped.`
      );
    } else {
      warnings.push(
        `Scraped ${byKey.size} unique events but the LIV widget reports ${widgetCount}. Some events may still be missing.`
      );
    }
  }
  if (byKey.size === 0) {
    warnings.push(formatDiagnosticsWarning(result?.diagnostics));
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
  prepareLivListingPage,
  scrapeLivListingPage,
};
