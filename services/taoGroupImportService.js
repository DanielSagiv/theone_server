const axios = require('axios');
const cheerio = require('cheerio');
const Location = require('../models/Location');
const Event = require('../models/Event');
const { inheritSeatsFromLocation } = require('./locationEventService');

const TAO_EVENTS_LISTING_URL = process.env.TAO_EVENTS_URL || 'https://taogroup.com/events/?event_venue=121&event_city=81&';
const REQUEST_DELAY_MS = 800;

/** Lazy-load puppeteer-core so server starts even if it's not installed */
let _puppeteer = null;
function getPuppeteer() {
  if (_puppeteer !== null) return _puppeteer;
  try {
    _puppeteer = require('puppeteer-core');
  } catch {
    _puppeteer = false;
  }
  return _puppeteer;
}

/** Path to Chrome/Chromium for puppeteer-core (no bundled browser). Set PUPPETEER_EXECUTABLE_PATH if needed. */
function getChromePath() {
  if (process.env.PUPPETEER_EXECUTABLE_PATH) return process.env.PUPPETEER_EXECUTABLE_PATH;
  if (process.platform === 'darwin') return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  if (process.platform === 'linux') return '/usr/bin/google-chrome';
  return null;
}

/**
 * Fetch HTML using headless browser so client-rendered content (e.g. Tao Group) is available.
 * Tao's listing page is client-rendered; plain HTTP returns no event list, so browser is required.
 * @param {string} url
 * @returns {Promise<{ html: string|null, browserError: string|null }>}
 */
async function fetchHtmlWithBrowser(url) {
  const puppeteer = getPuppeteer();
  const executablePath = getChromePath();
  if (!puppeteer) {
    console.log('[Tao import] fetchHtmlWithBrowser: puppeteer-core not installed (npm install puppeteer-core)');
    return { html: null, browserError: 'puppeteer-core not installed. Run: npm install puppeteer-core' };
  }
  if (!executablePath) {
    console.log('[Tao import] fetchHtmlWithBrowser: Chrome path not found. Set PUPPETEER_EXECUTABLE_PATH in .env (e.g. /Applications/Google Chrome.app/Contents/MacOS/Google Chrome on Mac)');
    return { html: null, browserError: 'Chrome not found. Set PUPPETEER_EXECUTABLE_PATH in .env to your Chrome path.' };
  }
  console.log('[Tao import] fetchHtmlWithBrowser: launching browser for', url);
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      executablePath,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
    });
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    await page.waitForSelector('a[href*="/events/"], a[href*="/event/"]', { timeout: 15000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 5000));
    let html = await page.content();
    const nextDataFromWindow = await page.evaluate(() => {
      const el = document.getElementById('__NEXT_DATA__');
      if (el && el.textContent) return el.textContent;
      if (typeof window.__NEXT_DATA__ !== 'undefined') return JSON.stringify(window.__NEXT_DATA__);
      return null;
    }).catch(() => null);
    if (nextDataFromWindow && typeof html === 'string' && html.indexOf('id="__NEXT_DATA__"') === -1) {
      html = html.replace('</head>', '<script id="__NEXT_DATA__" type="application/json">' + nextDataFromWindow + '</script></head>');
      console.log('[Tao import] fetchHtmlWithBrowser: injected __NEXT_DATA__ from page');
    }
    const len = html ? html.length : 0;
    console.log('[Tao import] fetchHtmlWithBrowser: got content length=', len);
    return { html, browserError: null };
  } catch (e) {
    const msg = (e.message || 'Browser launch or page load failed').split(/\n/)[0].trim();
    console.warn('[Tao import] fetchHtmlWithBrowser failed:', msg);
    return { html: null, browserError: msg };
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

/**
 * Fetch HTML from URL with browser-like headers (no JS execution)
 * @param {string} url
 * @returns {Promise<string>}
 */
async function fetchHtml(url) {
  console.log('[Tao import] fetchHtml: requesting', url);
  const { data, status } = await axios.get(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9'
    },
    timeout: 20000,
    maxRedirects: 5
  });
  const len = typeof data === 'string' ? data.length : 0;
  console.log('[Tao import] fetchHtml: response status=', status, 'body length=', len);
  if (len > 0 && len < 5000) {
    console.log('[Tao import] fetchHtml: body preview (first 800 chars)', data.substring(0, 800));
  }
  return data;
}

/**
 * Try to extract events and venues from Tao Group listing page (Next.js __NEXT_DATA__ or HTML)
 * @param {string} html
 * @param {string} baseUrl
 * @returns {{ events: Array<{ taoEventId?: string, name: string, detailUrl?: string, venue?: { taoVenueId?: string, name: string, city?: string } }>, venues: Array<{ taoVenueId?: string, name: string, city?: string }> }}
 */
function parseListingPage(html, baseUrl = 'https://taogroup.com') {
  const $ = cheerio.load(html);
  const events = [];
  const venueMap = new Map();

  // Next.js: try __NEXT_DATA__
  const nextData = $('script#__NEXT_DATA__').html();
  console.log('[Tao import] parseListingPage: __NEXT_DATA__ present=', !!nextData, 'length=', nextData ? nextData.length : 0);
  if (nextData) {
    try {
      const json = JSON.parse(nextData);
      const props = json.props?.pageProps ?? json.props ?? {};
      const topKeys = Object.keys(props);
      console.log('[Tao import] parseListingPage: pageProps keys=', topKeys.join(', '));
      const eventsList = props.events ?? props.eventsList ?? props.data?.events ?? props.pageProps?.events ?? [];
      const venuesList = props.venues ?? props.venuesList ?? props.data?.venues ?? props.pageProps?.venues ?? [];
      console.log('[Tao import] parseListingPage: eventsList length=', Array.isArray(eventsList) ? eventsList.length : 'not array', 'venuesList length=', Array.isArray(venuesList) ? venuesList.length : 'not array');
      if (Array.isArray(eventsList)) {
        eventsList.forEach(ev => {
          const venue = ev.venue ?? ev.venue_name ?? {};
          const venueId = ev.venue_id ?? venue?.id ?? venue?.slug;
          const venueName = typeof venue === 'string' ? venue : (venue?.name ?? ev.venue_name ?? 'Unknown Venue');
          const city = ev.city ?? venue?.city ?? ev.venue_city ?? '';
          const eventId = ev.id ?? ev.event_id ?? ev.slug;
          const name = ev.name ?? ev.title ?? ev.event_name ?? 'Event';
          const path = ev.url ?? ev.slug ?? ev.path ?? (eventId ? `/events/${eventId}` : null);
          const detailUrl = path ? (path.startsWith('http') ? path : `${baseUrl.replace(/\/$/, '')}${path.startsWith('/') ? path : '/' + path}`) : undefined;
          events.push({
            taoEventId: eventId ? String(eventId) : undefined,
            name,
            detailUrl,
            venue: { taoVenueId: venueId ? String(venueId) : undefined, name: venueName, city }
          });
          const key = venueId ?? `${venueName}|${city}`;
          if (!venueMap.has(key)) venueMap.set(key, { taoVenueId: venueId ? String(venueId) : undefined, name: venueName, city });
        });
      }
      if (Array.isArray(venuesList)) {
        venuesList.forEach(v => {
          const id = v.id ?? v.venue_id ?? v.slug;
          const key = id ?? `${v.name}|${v.city || ''}`;
          if (!venueMap.has(key)) venueMap.set(key, { taoVenueId: id ? String(id) : undefined, name: v.name ?? v.title ?? 'Venue', city: v.city ?? '' });
        });
      }
    } catch (e) {
      console.warn('[Tao import] parseListingPage: __NEXT_DATA__ parse failed', e.message);
    }
  }

  // Fallback: find event links in HTML (events or event path)
  if (events.length === 0) {
    console.log('[Tao import] parseListingPage: no events from __NEXT_DATA__, trying fallback a[href*="/events/"] and a[href*="/event/"]');
    const seen = new Set();
    $('a[href*="/events/"], a[href*="/event/"]').each((_, el) => {
      const href = $(el).attr('href');
      const text = $(el).text().trim();
      if (!href || seen.has(href)) return;
      seen.add(href);
      const fullUrl = href.startsWith('http') ? href : `${baseUrl.replace(/\/$/, '')}${href.startsWith('/') ? href : '/' + href}`;
      const slug = href.replace(/.*\/(?:events?)\//i, '').replace(/[?#].*$/, '').trim();
      if (!slug) return;
      events.push({
        taoEventId: slug,
        name: text || slug,
        detailUrl: fullUrl,
        venue: { name: 'Tao Group Venue', city: '' }
      });
    });
    if (events.length > 0) {
      console.log('[Tao import] parseListingPage: fallback found', events.length, 'event links');
      events.forEach(ev => {
        const key = ev.venue?.name ?? 'Tao Group Venue';
        if (!venueMap.has(key)) venueMap.set(key, { name: ev.venue?.name ?? 'Tao Group Venue', city: ev.venue?.city ?? '' });
      });
    } else {
      console.log('[Tao import] parseListingPage: fallback found 0 event links. Sample of script tags:', $('script').length, 'Sample of all links:', $('a[href]').length);
    }
  }

  const venues = Array.from(venueMap.values());
  console.log('[Tao import] parseListingPage: result events=', events.length, 'venues=', venues.length);
  return { events, venues };
}

/**
 * Fetch event detail page and parse into enriched event payload (name, description, start, end, image, etc.)
 * @param {string} detailUrl
 * @returns {Promise<Object|null>} Enriched fields or null
 */
async function fetchEventDetails(detailUrl) {
  try {
    console.log('[Tao import] fetchEventDetails: fetching', detailUrl);
    const html = await fetchHtml(detailUrl);
    const $ = cheerio.load(html);
    const nextData = $('script#__NEXT_DATA__').html();
    if (nextData) {
      const json = JSON.parse(nextData);
      const props = json.props?.pageProps ?? json.props ?? {};
      const ev = props.event ?? props.data ?? {};
      return {
        name: ev.name ?? ev.title ?? '',
        description: ev.description ?? ev.desc ?? ev.long_description ?? '',
        start_datetime: ev.start_datetime ?? ev.start ?? ev.date ?? ev.event_date,
        end_datetime: ev.end_datetime ?? ev.end ?? ev.end_date,
        timezone: ev.timezone ?? ev.time_zone ?? 'America/Los_Angeles',
        image: ev.image ?? ev.image_url ?? ev.flyer ?? ev.thumbnail,
        venue_name: ev.venue_name ?? ev.venue?.name,
        venue_id: ev.venue_id ?? ev.venue?.id,
        city: ev.city ?? ev.venue?.city
      };
    }
    // Fallback: meta or visible text
    const name = $('meta[property="og:title"]').attr('content') || $('h1').first().text().trim();
    const desc = $('meta[property="og:description"]').attr('content') || $('meta[name="description"]').attr('content') || '';
    const img = $('meta[property="og:image"]').attr('content') || $('img').first().attr('src');
    console.log('[Tao import] fetchEventDetails: no __NEXT_DATA__, using meta/h1. name=', !!name, 'img=', !!img);
    return { name, description: desc, image: img };
  } catch (e) {
    console.warn('[Tao import] fetchEventDetails failed', detailUrl, e.message);
    return null;
  }
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Sanitize table name to a valid seat code (alphanumeric, dashes).
 * @param {string} name
 * @returns {string}
 */
function tableNameToCode(name) {
  if (!name || typeof name !== 'string') return 'TABLE-1';
  return name.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9-]/g, '').slice(0, 40) || 'TABLE-1';
}

/**
 * Using Puppeteer page: open event detail URL, click "VIP table reservations", expand "Tables", extract table names and prices.
 * @param {Object} page - Puppeteer page
 * @param {string} detailUrl - Event detail URL
 * @returns {Promise<{ name?: string, description?: string, start_datetime?: any, end_datetime?: any, timezone?: string, image?: string, tables: Array<{ name: string, price?: number, capacity?: number }> }|null>}
 */
async function fetchEventDetailsAndTablesWithBrowser(page, detailUrl) {
  try {
    await page.goto(detailUrl, { waitUntil: 'networkidle2', timeout: 25000 });
    await delay(2000);

    const clickByText = async (text) => {
      const clicked = await page.evaluate((search) => {
        const nodes = document.querySelectorAll('a, button, [role="button"], [role="tab"], div[class*="accordion"], div[class*="expand"], h2, h3, span');
        for (const el of nodes) {
          const t = (el.textContent || '').trim();
          if (t && t.toLowerCase().includes(search.toLowerCase())) {
            el.click();
            return true;
          }
        }
        return false;
      }, text);
      return clicked;
    };

    const clickedVip = await clickByText('vip table');
    if (!clickedVip) await clickByText('table reservation');
    await delay(2500);

    const expandTables = await clickByText('tables');
    await delay(expandTables ? 1500 : 1000);

    const tables = await page.evaluate(() => {
      const results = [];
      const text = document.body.innerText || document.body.textContent || '';
      const lines = text.split(/\n/).map(s => s.trim()).filter(s => s.length > 0 && s.length < 100);
      const skip = /^(tables|vip|reservation|buy|click|expand|event|date|time|view all|back|menu)/i;
      const listItems = document.querySelectorAll('li, [role="listitem"], tr, div[class*="table"], div[class*="row"]');
      const fromDom = [];
      listItems.forEach((el) => {
        const t = (el.textContent || '').trim();
        if (t.length > 1 && t.length < 80 && !skip.test(t)) {
          const pricePart = t.match(/\$[\d,]+/);
          const price = pricePart ? parseInt(pricePart[0].replace(/[$,]/g, ''), 10) : undefined;
          const name = t.replace(/\$[\d,]+.*$/, '').replace(/\s+/g, ' ').trim();
          if (name) fromDom.push({ name, price });
        }
      });
      const seen = new Set();
      for (const item of fromDom) {
        if (!seen.has(item.name)) {
          seen.add(item.name);
          results.push(item);
        }
      }
      if (results.length === 0) {
        for (const line of lines) {
          if (line.length > 1 && line.length < 60 && !skip.test(line) && !/^[\d:]+$/.test(line)) {
            const pricePart = line.match(/\$[\d,]+/);
            const price = pricePart ? parseInt(pricePart[0].replace(/[$,]/g, ''), 10) : undefined;
            const name = line.replace(/\$[\d,]+.*$/, '').trim();
            if (name && !seen.has(name)) {
              seen.add(name);
              results.push({ name, price });
            }
          }
        }
      }
      return results;
    });

    const name = await page.evaluate(() => {
      const og = document.querySelector('meta[property="og:title"]');
      if (og && og.content) return og.content;
      const h1 = document.querySelector('h1');
      return h1 ? h1.textContent.trim() : '';
    });
    const image = await page.evaluate(() => {
      const og = document.querySelector('meta[property="og:image"]');
      return og ? og.getAttribute('content') : null;
    });

    let start_datetime = null;
    let end_datetime = null;
    let timezone = 'America/Los_Angeles';
    const html = await page.content();
    const $ = cheerio.load(html);
    const nextData = $('script#__NEXT_DATA__').html();
    if (nextData) {
      try {
        const json = JSON.parse(nextData);
        const props = json.props?.pageProps ?? json.props ?? {};
        const ev = props.event ?? props.data ?? {};
        start_datetime = ev.start_datetime ?? ev.start ?? ev.date ?? ev.event_date ?? null;
        end_datetime = ev.end_datetime ?? ev.end ?? ev.end_date ?? null;
        timezone = ev.timezone ?? ev.time_zone ?? timezone;
      } catch (_) {
        // ignore parse errors
      }
    }

    console.log('[Tao import] fetchEventDetailsAndTablesWithBrowser: tables count=', tables.length, 'for', detailUrl);
    return {
      name,
      image,
      tables: Array.isArray(tables) ? tables : [],
      start_datetime: start_datetime || undefined,
      end_datetime: end_datetime || undefined,
      timezone
    };
  } catch (e) {
    console.warn('[Tao import] fetchEventDetailsAndTablesWithBrowser failed', detailUrl, e.message);
    return null;
  }
}

/**
 * Find or create Location from Tao venue data
 * @param {Object} venue - { taoVenueId?, name, city? }
 * @param {string} userId
 * @returns {Promise<{ location: Object, created: boolean }>}
 */
async function findOrCreateVenue(venue, userId) {
  const name = (venue.name || '').trim() || 'Tao Group Venue';
  const city = (venue.city || '').trim();
  console.log('[Tao import] findOrCreateVenue: name=', name, 'city=', city, 'taoVenueId=', venue.taoVenueId);

  const defaultSeats = [
    { code: 'TABLE-1', label: 'Table 1', category: 'stage_tables', section: 'Main', capacity: 4, minSpendUSD: 500, priceTier: 1 },
    { code: 'TABLE-2', label: 'Table 2', category: 'stage_tables', section: 'Main', capacity: 6, minSpendUSD: 750, priceTier: 2 },
    { code: 'TABLE-3', label: 'Table 3', category: 'four_tops', section: 'Dance', capacity: 4, minSpendUSD: 400, priceTier: 1 },
    { code: 'TABLE-4', label: 'Table 4', category: 'four_tops', section: 'Dance', capacity: 4, minSpendUSD: 400, priceTier: 1 },
    { code: 'GA', label: 'General Admission', category: 'lower_dance', section: 'GA', capacity: 1, minSpendUSD: 0, priceTier: 1 }
  ];

  if (venue.taoVenueId) {
    const existing = await Location.findOne({ taoVenueId: venue.taoVenueId });
    if (existing) {
      console.log('[Tao import] findOrCreateVenue: found existing by taoVenueId', existing._id);
      if (!existing.seats || existing.seats.length === 0) {
        existing.seats = defaultSeats;
        await existing.save();
        console.log('[Tao import] findOrCreateVenue: added placeholder seats to existing venue');
      }
      return { location: existing, created: false };
    }
  }

  const byNameCity = await Location.findOne({
    name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'),
    'address.city': city || { $in: ['', null, undefined] }
  });
  if (byNameCity) {
    console.log('[Tao import] findOrCreateVenue: found existing by name+city', byNameCity._id);
    if (venue.taoVenueId && !byNameCity.taoVenueId) {
      byNameCity.taoVenueId = venue.taoVenueId;
      await byNameCity.save();
    }
    if (!byNameCity.seats || byNameCity.seats.length === 0) {
      byNameCity.seats = defaultSeats;
      await byNameCity.save();
      console.log('[Tao import] findOrCreateVenue: added placeholder seats to existing venue');
    }
    return { location: byNameCity, created: false };
  }

  console.log('[Tao import] findOrCreateVenue: creating new Location with placeholder seats');
  const location = await Location.create({
    type: 'night_club',
    name,
    address: { city: city || undefined, country: 'USA' },
    status: 'active',
    taoVenueId: venue.taoVenueId || undefined,
    seats: defaultSeats,
    createdBy: userId,
    updatedBy: userId
  });
  return { location, created: true };
}

/**
 * Merge scraped Tao tables into Location seats (add new seats by code, update price if we have it).
 * @param {Object} location - Location document
 * @param {Array<{ name: string, price?: number, capacity?: number }>} tables
 */
function mergeTablesIntoLocation(location, tables) {
  if (!tables || tables.length === 0) return;
  const existingCodes = new Set((location.seats || []).map(s => (s.code || '').trim()));
  const toAdd = [];
  for (const t of tables) {
    const name = (t.name || '').trim();
    if (!name) continue;
    const code = tableNameToCode(name);
    if (existingCodes.has(code)) continue;
    existingCodes.add(code);
    toAdd.push({
      code,
      label: name,
      category: 'stage_tables',
      section: 'VIP',
      capacity: t.capacity || 4,
      minSpendUSD: t.price || 0,
      priceTier: 1
    });
  }
  if (toAdd.length > 0) {
    location.seats = (location.seats || []).concat(toAdd);
    location.markModified('seats');
    console.log('[Tao import] mergeTablesIntoLocation: added', toAdd.length, 'seats to', location.name);
  }
}

/**
 * Parse date from various formats for event start/end
 * @param {string|Date} val
 * @param {Date} fallback
 * @returns {Date}
 */
function parseEventDate(val, fallback) {
  if (!val) return fallback;
  if (val instanceof Date) return val;
  const d = new Date(val);
  return isNaN(d.getTime()) ? fallback : d;
}

/**
 * Try to parse a date from the start of an event name (e.g. "2/21/2026 - Jerzy - TAO Nightclub").
 * @param {string} name - Event name
 * @returns {Date|null} Date with time set to 22:00:00 local, or null if no match
 */
function parseDateFromEventName(name) {
  if (!name || typeof name !== 'string') return null;
  const match = name.trim().match(/^\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!match) return null;
  const [, month, day, year] = match;
  const m = parseInt(month, 10);
  const d = parseInt(day, 10);
  const y = parseInt(year, 10);
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = new Date(y, m - 1, d, 22, 0, 0, 0);
  return isNaN(date.getTime()) ? null : date;
}

/**
 * Run full Tao Group import: fetch listing, optionally drill into event details, upsert venues and events
 * @param {string} userId - Admin user id for created_by
 * @returns {Promise<{ summary: Object, data: Object }>}
 */
async function runTaoGroupImport(userId) {
  const summary = { venuesCreated: 0, venuesUpdated: 0, eventsCreated: 0, eventsUpdated: 0, failed: 0, errors: [] };
  const data = { success: [], failed: [] };

  console.log('[Tao import] runTaoGroupImport: start userId=', userId, 'url=', TAO_EVENTS_LISTING_URL);
  try {
    const browserResult = await fetchHtmlWithBrowser(TAO_EVENTS_LISTING_URL);
    let html = browserResult.html;
    const usedBrowser = !!html;
    const browserError = browserResult.browserError || null;
    if (!html) {
      console.log('[Tao import] runTaoGroupImport: no browser HTML, falling back to axios. browserError=', browserError);
      try {
        html = await fetchHtml(TAO_EVENTS_LISTING_URL);
      } catch (fetchErr) {
        summary.errors.push('Fetch failed: ' + (fetchErr.message || 'Network error'));
        return { summary, data };
      }
    }
    const htmlLen = typeof html === 'string' ? html.length : 0;
    console.log('[Tao import] runTaoGroupImport: listing page html length=', htmlLen, 'usedBrowser=', usedBrowser);
    const baseUrl = TAO_EVENTS_LISTING_URL.split('/').slice(0, 3).join('/');
    const { events: rawEvents, venues: rawVenues } = parseListingPage(html, baseUrl);

    if (rawEvents.length === 0) {
      if (browserError) {
        summary.errors.push('Tao Group events page is client-rendered; the server must use a browser to see events. ' + browserError);
      } else {
        const hint = usedBrowser
          ? 'Page structure may have changed or selector timed out.'
          : 'Listing page is client-rendered; browser fetch did not run or failed.';
        summary.errors.push('No events found on listing page. ' + hint);
      }
      console.log('[Tao import] runTaoGroupImport: no events parsed. usedBrowser=', usedBrowser, 'htmlLen=', htmlLen, 'browserError=', browserError);
      return { summary, data };
    }

    console.log('[Tao import] runTaoGroupImport: parsed rawEvents=', rawEvents.length, 'rawVenues=', rawVenues.length);

    const puppeteer = getPuppeteer();
    const executablePath = getChromePath();
    if (puppeteer && executablePath && rawEvents.some(e => e.detailUrl)) {
      console.log('[Tao import] runTaoGroupImport: fetching event details + VIP tables with browser');
      let browser;
      try {
        browser = await puppeteer.launch({
          headless: true,
          executablePath,
          args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
        });
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        for (const ev of rawEvents) {
          if (ev.detailUrl) {
            await delay(REQUEST_DELAY_MS);
            ev.detailsWithTables = await fetchEventDetailsAndTablesWithBrowser(page, ev.detailUrl);
          }
        }
      } catch (e) {
        console.warn('[Tao import] runTaoGroupImport: browser details fetch failed', e.message);
      } finally {
        if (browser) await browser.close().catch(() => {});
      }
    }

    const venueByKey = new Map();
    for (const v of rawVenues) {
      const key = v.taoVenueId ?? `${v.name}|${v.city || ''}`;
      venueByKey.set(key, v);
    }
    rawEvents.forEach(ev => {
      const key = ev.venue?.taoVenueId ?? `${ev.venue?.name ?? ''}|${ev.venue?.city ?? ''}`;
      if (key && !venueByKey.has(key)) venueByKey.set(key, ev.venue || { name: 'Tao Group Venue', city: '' });
    });

    const locationIdByKey = new Map();
    for (const [key, venue] of venueByKey) {
      try {
        const { location, created } = await findOrCreateVenue(venue, userId);
        locationIdByKey.set(key, location._id);
        if (created) summary.venuesCreated++;
        else summary.venuesUpdated++;
      } catch (e) {
        console.error('[Tao import] findOrCreateVenue error for', venue?.name, e.message, e.stack);
        summary.failed++;
        data.failed.push({ type: 'venue', name: venue.name, error: e.message });
        summary.errors.push(`Venue ${venue.name}: ${e.message}`);
      }
    }
    console.log('[Tao import] runTaoGroupImport: after venues locationIdByKey size=', locationIdByKey.size, 'venuesCreated=', summary.venuesCreated, 'venuesUpdated=', summary.venuesUpdated);

    const defaultStart = new Date();
    defaultStart.setHours(22, 0, 0, 0);
    const defaultEnd = new Date(defaultStart.getTime() + 4 * 60 * 60 * 1000);

    for (const ev of rawEvents) {
      try {
        let name = ev.name;
        let description = '';
        let startDatetime = defaultStart;
        let endDatetime = defaultEnd;
        let timezone = 'America/Los_Angeles';
        let imageUrl = null;
        let gotStartFromSource = false;
        const venueKey = ev.venue?.taoVenueId ?? `${ev.venue?.name ?? ''}|${ev.venue?.city ?? ''}`;
        const locationId = locationIdByKey.get(venueKey);
        if (rawEvents.indexOf(ev) < 3) {
          console.log('[Tao import] event:', ev.name, 'venueKey=', venueKey, 'locationId=', locationId ? String(locationId) : 'MISSING');
        }

        if (ev.detailsWithTables) {
          if (ev.detailsWithTables.name) name = ev.detailsWithTables.name;
          if (ev.detailsWithTables.image) imageUrl = ev.detailsWithTables.image;
          if (ev.detailsWithTables.start_datetime) {
            startDatetime = parseEventDate(ev.detailsWithTables.start_datetime, defaultStart);
            gotStartFromSource = true;
          }
          if (ev.detailsWithTables.end_datetime) endDatetime = parseEventDate(ev.detailsWithTables.end_datetime, defaultEnd);
          if (ev.detailsWithTables.timezone) timezone = ev.detailsWithTables.timezone;
        } else if (ev.detailUrl) {
          await delay(REQUEST_DELAY_MS);
          const details = await fetchEventDetails(ev.detailUrl);
          if (details) {
            if (details.name) name = details.name;
            if (details.description) description = details.description;
            if (details.start_datetime) {
              startDatetime = parseEventDate(details.start_datetime, defaultStart);
              gotStartFromSource = true;
            }
            if (details.end_datetime) endDatetime = parseEventDate(details.end_datetime, defaultEnd);
            if (details.timezone) timezone = details.timezone;
            if (details.image) imageUrl = details.image;
          }
        }

        if (!gotStartFromSource) {
          const fromName = parseDateFromEventName(name);
          if (fromName) {
            startDatetime = fromName;
            endDatetime = new Date(fromName.getTime() + 4 * 60 * 60 * 1000);
          }
        }

        if (!locationId) {
          console.warn('[Tao import] event skipped (no location):', name, 'venueKey=', venueKey);
          summary.failed++;
          data.failed.push({ type: 'event', name, error: 'No location found for venue' });
          continue;
        }

        let location = await Location.findById(locationId);
        if (!location) {
          summary.failed++;
          data.failed.push({ type: 'event', name, error: 'Location not found' });
          continue;
        }

        if (ev.detailsWithTables && ev.detailsWithTables.tables && ev.detailsWithTables.tables.length > 0) {
          mergeTablesIntoLocation(location, ev.detailsWithTables.tables);
          await location.save();
          location = await Location.findById(locationId);
        }

        let event = null;
        if (ev.taoEventId) {
          event = await Event.findOne({ taoEventId: ev.taoEventId });
        }
        if (!event) {
          event = await Event.findOne({
            location_id: locationId,
            name,
            start_datetime: { $gte: new Date(startDatetime.getTime() - 24 * 60 * 60 * 1000), $lte: new Date(startDatetime.getTime() + 24 * 60 * 60 * 1000) }
          });
        }

        const media = imageUrl ? [{ type: 'image', url: imageUrl, caption: '', order: 0 }] : [];
        let inheritanceResult = { seats: [], units: [], totalCapacity: 0 };
        try {
          inheritanceResult = await inheritSeatsFromLocation(locationId, { name, type: location.type });
        } catch (_) {
          // Location may have no seats
        }

        const totalCapacity = inheritanceResult.totalCapacity || 0;
        const seats = inheritanceResult.seats || [];
        const prices = seats.map(s => s.event_price ?? s.event_min_spend ?? s.min_spend ?? 0).filter(n => typeof n === 'number');
        const minPrice = prices.length > 0 ? Math.min(...prices) : 0;
        const eventPayload = {
          name,
          description,
          type: location.type,
          location_id: locationId,
          start_datetime: startDatetime,
          end_datetime: endDatetime,
          timezone,
          total_capacity: totalCapacity,
          total_available: totalCapacity,
          total_booked: 0,
          total_revenue: 0,
          base_price: minPrice,
          currency: 'USD',
          price_tier: 1,
          status: 'active',
          media,
          seats,
          units: inheritanceResult.units,
          taoEventId: ev.taoEventId || undefined,
          created_by: userId,
          updated_by: userId
        };

        if (event) {
          Object.assign(event, eventPayload);
          await event.save();
          summary.eventsUpdated++;
          data.success.push({ eventId: event._id, name, action: 'updated' });
          if (summary.eventsUpdated + summary.eventsCreated <= 5) console.log('[Tao import] event updated:', name);
        } else {
          const created = await Event.create(eventPayload);
          summary.eventsCreated++;
          data.success.push({ eventId: created._id, name, action: 'created' });
          if (summary.eventsCreated <= 5) console.log('[Tao import] event created:', name, created._id);
        }
      } catch (e) {
        console.error('[Tao import] event error:', ev.name, e.message, e.stack);
        summary.failed++;
        data.failed.push({ type: 'event', name: ev.name, error: e.message });
        summary.errors.push(`Event ${ev.name}: ${e.message}`);
      }
    }

    console.log('[Tao import] runTaoGroupImport: done summary=', JSON.stringify(summary));
    return { summary, data };
  } catch (e) {
    console.error('[Tao import] runTaoGroupImport error', e.message, e.stack);
    summary.errors.push(e.message || 'Import failed');
    throw e;
  }
}

module.exports = {
  runTaoGroupImport,
  parseListingPage,
  fetchEventDetails,
  findOrCreateVenue
};
