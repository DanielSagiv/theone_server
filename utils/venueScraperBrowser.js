/**
 * Shared headless-browser helpers for venue website scraping (scrap events, etc.).
 * Uses puppeteer-core + system Chrome (same approach as Tao Group import).
 */

/** Lazy-load puppeteer-core so server starts even if it is not installed */
let _puppeteer = null;

/**
 * @returns {object|false|null} puppeteer module, false if missing, null before first call
 */
function getPuppeteer() {
  if (_puppeteer !== null) return _puppeteer;
  try {
    _puppeteer = require('puppeteer-core');
  } catch {
    _puppeteer = false;
  }
  return _puppeteer;
}

/**
 * Path to Chrome/Chromium for puppeteer-core. Set PUPPETEER_EXECUTABLE_PATH if needed.
 * @returns {string|null}
 */
function getChromePath() {
  if (process.env.PUPPETEER_EXECUTABLE_PATH) return process.env.PUPPETEER_EXECUTABLE_PATH;
  if (process.platform === 'darwin') return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  if (process.platform === 'linux') return '/usr/bin/google-chrome';
  return null;
}

const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/**
 * Click "Load More" (or similar) until exhausted or max clicks reached.
 * @param {import('puppeteer-core').Page} page
 * @param {{ maxClicks?: number, delayMs?: number, logPrefix?: string }} [options]
 * @returns {Promise<number>} number of clicks performed
 */
async function clickLoadMoreUntilDone(page, options = {}) {
  const maxClicks = options.maxClicks ?? 20;
  const delayMs = options.delayMs ?? 1500;
  const logPrefix = options.logPrefix || '[venueScraperBrowser]';
  let clicks = 0;

  for (let i = 0; i < maxClicks; i++) {
    const clicked = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button, a, span'));
      const loadMore = buttons.find((b) => /load more/i.test((b.textContent || '').trim()));
      if (loadMore) {
        loadMore.click();
        return true;
      }
      return false;
    });
    if (!clicked) break;
    clicks += 1;
    await new Promise((r) => setTimeout(r, delayMs));
  }

  if (clicks > 0) {
    console.log(`${logPrefix} clickLoadMoreUntilDone: clicked ${clicks} time(s)`);
  }
  return clicks;
}

/**
 * Open URL in headless Chrome, run handler, then close browser.
 * @param {string} url
 * @param {(page: import('puppeteer-core').Page) => Promise<T>} pageHandler
 * @param {{ waitForSelector?: string, waitMs?: number, clickLoadMore?: boolean, logPrefix?: string }} [options]
 * @returns {Promise<{ result: T|null, browserError: string|null }>}
 * @template T
 */
async function withBrowserPage(url, pageHandler, options = {}) {
  const logPrefix = options.logPrefix || '[venueScraperBrowser]';
  const puppeteer = getPuppeteer();
  const executablePath = getChromePath();

  if (!puppeteer) {
    return {
      result: null,
      browserError: 'puppeteer-core not installed. Run: npm install puppeteer-core',
    };
  }
  if (!executablePath) {
    return {
      result: null,
      browserError: 'Chrome not found. Set PUPPETEER_EXECUTABLE_PATH in .env to your Chrome path.',
    };
  }

  let browser;
  try {
    console.log(`${logPrefix} withBrowserPage: launching browser for`, url);
    browser = await puppeteer.launch({
      headless: true,
      executablePath,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    });
    const page = await browser.newPage();
    await page.setUserAgent(DEFAULT_USER_AGENT);

    try {
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 });
    } catch (navErr) {
      if (navErr.message && navErr.message.includes('timeout')) {
        console.log(`${logPrefix} networkidle2 timed out, retrying with load`);
        await page.goto(url, { waitUntil: 'load', timeout: 25000 });
        await new Promise((r) => setTimeout(r, 8000));
      } else {
        throw navErr;
      }
    }

    if (options.waitForSelector) {
      await page.waitForSelector(options.waitForSelector, { timeout: 20000 }).catch(() => {});
    }
    if (options.waitMs) {
      await new Promise((r) => setTimeout(r, options.waitMs));
    } else {
      await new Promise((r) => setTimeout(r, 5000));
    }

    if (options.clickLoadMore) {
      await clickLoadMoreUntilDone(page, { logPrefix });
    }

    const result = await pageHandler(page);
    return { result, browserError: null };
  } catch (e) {
    const msg = (e.message || 'Browser launch or page load failed').split(/\n/)[0].trim();
    console.warn(`${logPrefix} withBrowserPage failed:`, msg);
    return { result: null, browserError: msg };
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

/**
 * Fetch rendered HTML from a client-rendered page.
 * @param {string} url
 * @param {{ waitForSelector?: string, clickLoadMore?: boolean, logPrefix?: string }} [options]
 * @returns {Promise<{ html: string|null, browserError: string|null }>}
 */
async function fetchHtmlWithBrowser(url, options = {}) {
  const { result, browserError } = await withBrowserPage(
    url,
    async (page) => page.content(),
    options
  );
  return { html: result, browserError };
}

module.exports = {
  getPuppeteer,
  getChromePath,
  clickLoadMoreUntilDone,
  withBrowserPage,
  fetchHtmlWithBrowser,
};
