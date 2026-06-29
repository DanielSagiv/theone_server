/**
 * Shared UrVenue / Booketing inventory row parsing (LIV, OMNIA, future venues).
 * Venue catalog price = Minimum Spend only (never Pay Now).
 */

/**
 * Parse Minimum Spend dollar amount from inventory row text.
 * @param {string} text
 * @returns {number|null}
 */
function parseUrvenueMinimumSpendFromItemText(text) {
  const raw = String(text || '');
  // Same line: "Minimum Spend $3,000.00" or "Minimum Spend 3,000.00"
  let minMatch = raw.match(/Minimum Spend\s*:?\s*\$?\s*([\d,]+\.?\d*)/i);
  if (!minMatch) {
    // Amount on following line (common on Booketing dayclub rows)
    minMatch = raw.match(/Minimum Spend\s*\n\s*\$?\s*([\d,]+\.?\d*)/i);
  }
  if (!minMatch) return null;
  const value = parseFloat(minMatch[1].replace(/,/g, ''));
  return Number.isFinite(value) ? value : null;
}

/**
 * Parse Pay Now deposit from inventory row text (debug only — not used for catalog price).
 * @param {string} text
 * @returns {number|null}
 */
function parseUrvenuePayNowFromItemText(text) {
  const payMatch = String(text || '').match(/Pay Now\s*([\d,]+\.?\d*)/i);
  if (!payMatch) return null;
  const value = parseFloat(payMatch[1].replace(/,/g, ''));
  return Number.isFinite(value) ? value : null;
}

/**
 * Venue catalog min spend from a scraped inventory item (Minimum Spend only).
 * @param {object|null|undefined} item
 * @returns {number|null}
 */
function venueCatalogMinSpendFromInventoryItem(item) {
  if (!item) return null;
  const fromField = item.minSpend;
  if (typeof fromField === 'number' && Number.isFinite(fromField) && fromField >= 0) {
    return fromField;
  }
  return null;
}

/**
 * Parse table name + pricing from raw DOM row captured in browser.
 * @param {{ innerText?: string, nameFromSelector?: string }} raw
 * @param {{ nameStyle?: 'liv'|'omnia' }} [options]
 * @returns {{ name: string, capacity: number|null, minSpend: number|null, payNow: number|null }|null}
 */
function parseUrvenueInventoryItemFromRaw(raw, options = {}) {
  const nameStyle = options.nameStyle === 'omnia' ? 'omnia' : 'liv';
  const clean = (t) => (t || '').replace(/\s+/g, ' ').trim();
  const text = clean(raw?.innerText);
  if (!text || /komodo|papi steak|fontainebleau restaurants/i.test(text)) {
    return null;
  }

  const lines = text.split('\n').map(clean).filter(Boolean);
  let name =
    clean(raw?.nameFromSelector) ||
    (nameStyle === 'omnia' ? lines[0] : null) ||
    text.split('More Info')[0].trim();
  name = name.replace(/\s+More Info.*$/i, '').trim();
  if (nameStyle === 'omnia') {
    name = name.replace(/\s+Table\s*$/i, '').trim();
  }

  const capMatch = text.match(/More Info\.\s*(\d+)/i);
  const minSpend = parseUrvenueMinimumSpendFromItemText(text);
  const payNow = parseUrvenuePayNowFromItemText(text);

  if (!name || minSpend == null) {
    return null;
  }

  return {
    name,
    capacity: capMatch ? parseInt(capMatch[1], 10) : null,
    minSpend,
    payNow,
  };
}

/**
 * Poll until UrVenue inventory rows with Minimum Spend are visible (post-accordion).
 * @param {import('puppeteer-core').Page} page
 * @param {{ timeoutMs?: number, minRows?: number }} [options]
 * @returns {Promise<number>} Row count found (0 if timed out)
 */
async function waitForUrvenueInventoryRows(page, options = {}) {
  const timeoutMs = options.timeoutMs ?? 25000;
  const minRows = options.minRows ?? 1;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const count = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('.uwsinv-item, .uws-inventory-item'))
        .filter((el) => {
          const st = window.getComputedStyle(el);
          return st.display !== 'none' && st.visibility !== 'hidden';
        })
        .filter((el) => /Minimum Spend/i.test(el.innerText || ''))
        .length;
    });
    if (count >= minRows) return count;
    await new Promise((r) => setTimeout(r, 500));
  }
  return 0;
}

/**
 * Collect raw inventory rows from an UrVenue detail page (browser context).
 * @param {import('puppeteer-core').Page} page
 * @returns {Promise<{ innerText: string, nameFromSelector: string }[]>}
 */
async function collectUrvenueInventoryRawRows(page) {
  return page.evaluate(() => {
    const clean = (t) => (t || '').replace(/\s+/g, ' ').trim();
    return Array.from(document.querySelectorAll('.uwsinv-item, .uws-inventory-item'))
      .filter((el) => {
        const st = window.getComputedStyle(el);
        return st.display !== 'none' && st.visibility !== 'hidden';
      })
      .map((el) => ({
        innerText: el.innerText || '',
        nameFromSelector: clean(
          el.querySelector('.uwsinv-name, .uws-inv-name, h5, h6')?.textContent
        ),
      }));
  });
}

/**
 * Extract event description paragraph from UrVenue detail page.
 * @param {import('puppeteer-core').Page} page
 * @returns {Promise<string>}
 */
async function extractUrvenueEventDescription(page) {
  return page.evaluate(() => {
    const clean = (t) => (t || '').replace(/\s+/g, ' ').trim();
    const paragraphs = Array.from(document.querySelectorAll('p'))
      .map((p) => clean(p.textContent))
      .filter(
        (t) =>
          t.length > 80 &&
          !/audioeye|accessibility|to open this toolbar|press opt\+a/i.test(t)
      );
    return paragraphs.length ? paragraphs[0] : '';
  });
}

module.exports = {
  parseUrvenueMinimumSpendFromItemText,
  parseUrvenuePayNowFromItemText,
  venueCatalogMinSpendFromInventoryItem,
  parseUrvenueInventoryItemFromRaw,
  collectUrvenueInventoryRawRows,
  extractUrvenueEventDescription,
  waitForUrvenueInventoryRows,
};
