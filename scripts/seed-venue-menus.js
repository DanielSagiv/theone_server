/**
 * Seed / upsert VenueMenu documents from data/*-menu.json files.
 * Idempotent by location_id. Does not modify Location.menu (GXN URL).
 *
 * Usage (from server/):
 *   node scripts/seed-venue-menus.js
 *   node scripts/seed-venue-menus.js --dry-run
 *   node scripts/seed-venue-menus.js --only=omnia-dayclub
 *
 * Uses DB_URI from .env (fallback MONGODB_URI).
 */

require('dotenv').config();
const dns = require('dns');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const Location = require('../models/Location');
const VenueMenu = require('../models/VenueMenu');

const LOG = '[seed-venue-menus]';

/** Prefer public DNS so Atlas SRV resolves in restricted environments. */
dns.setServers(['8.8.8.8', '1.1.1.1']);

const MENU_FILES = [
  {
    key: 'omnia-dayclub',
    file: 'omnia-dayclub-menu.json',
    fallbackPdf: '/menus/omnia-dayclub-menu.pdf',
  },
  {
    key: 'omnia-nightclub',
    file: 'omnia-nightclub-menu.json',
    fallbackPdf: '/menus/omnia-nightclub-menu.pdf',
  },
  {
    key: 'marquee-nightclub',
    file: 'marquee-nightclub-menu.json',
    fallbackPdf: '/menus/marquee-nightclub-menu.pdf',
  },
  {
    key: 'encore-beach-club',
    file: 'encore-beach-club-menu.json',
    fallbackPdf: '/menus/encore-beach-club-menu.pdf',
  },
];

/**
 * @returns {{ dryRun: boolean, only: string|null }}
 */
function parseArgs() {
  const dryRun = process.argv.includes('--dry-run');
  const onlyArg = process.argv.find(a => a.startsWith('--only='));
  const only = onlyArg ? onlyArg.slice('--only='.length).trim() : null;
  return { dryRun, only };
}

/**
 * Load a menu JSON payload from data/.
 * @param {string} fileName
 * @returns {object}
 */
function loadSeedJson(fileName) {
  const filePath = path.join(__dirname, '..', 'data', fileName);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing seed file: ${filePath}`);
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

/**
 * Resolve a Location by name regex, preferring type and Las Vegas when ambiguous.
 * @param {{ nameRegex: string, preferType?: string }} match
 * @returns {Promise<object|null>}
 */
async function resolveLocation(match) {
  const nameRegex = match?.nameRegex;
  if (!nameRegex) {
    return null;
  }
  const preferType = match.preferType || null;
  let candidates = await Location.find({ name: new RegExp(nameRegex, 'i') })
    .select('_id name type city address')
    .lean();

  if (!candidates.length) {
    return null;
  }

  if (preferType) {
    const typed = candidates.filter(c => c.type === preferType);
    if (typed.length) {
      candidates = typed;
    }
  }

  if (candidates.length > 1) {
    const lv = candidates.filter(c => {
      const city = String(c.city || '');
      const addr = String(c.address || '');
      return /las\s*vegas/i.test(city) || /las\s*vegas/i.test(addr);
    });
    if (lv.length) {
      candidates = lv;
    }
  }

  if (candidates.length > 1) {
    // Prefer exact case-insensitive name when regex is anchored; else shortest name
    const anchored = /^\^.*\$$/.test(nameRegex);
    if (anchored) {
      const re = new RegExp(nameRegex, 'i');
      const exact = candidates.filter(c => re.test(c.name));
      if (exact.length) {
        candidates = exact;
      }
    }
    if (candidates.length > 1) {
      candidates = [...candidates].sort((a, b) => a.name.length - b.name.length);
      console.warn(
        `${LOG} ambiguous matches for /${nameRegex}/i → picking ${candidates[0].name} among ${candidates
          .map(c => c.name)
          .join(', ')}`,
      );
    }
  }

  return candidates[0];
}

/**
 * Upsert one VenueMenu from seed JSON.
 * @param {object} entry
 * @param {boolean} dryRun
 * @returns {Promise<object>}
 */
async function seedOne(entry, dryRun) {
  const seed = loadSeedJson(entry.file);
  const location = await resolveLocation(seed.locationMatch || {});
  if (!location) {
    console.error(
      `${LOG} SKIP ${entry.key}: no Location for /${seed.locationMatch?.nameRegex}/i`,
    );
    return { key: entry.key, skipped: true, reason: 'location_not_found' };
  }

  console.log(
    `${LOG} ${entry.key} location=${location._id} name=${JSON.stringify(location.name)} type=${location.type}`,
  );

  const update = {
    location_id: location._id,
    title: seed.title || `${location.name} Menu`,
    status: seed.status || 'active',
    currency: seed.currency || 'USD',
    sourcePdfUrl: seed.sourcePdfUrl || entry.fallbackPdf,
    notes: seed.notes || '',
    sections: Array.isArray(seed.sections) ? seed.sections : [],
  };

  const sectionCount = update.sections.length;
  const itemCount = update.sections.reduce(
    (n, s) => n + (Array.isArray(s.items) ? s.items.length : 0),
    0,
  );
  console.log(
    `${LOG} ${entry.key} sections=${sectionCount} items=${itemCount} dryRun=${dryRun}`,
  );

  if (dryRun) {
    return {
      key: entry.key,
      dryRun: true,
      locationId: String(location._id),
      locationName: location.name,
      sections: sectionCount,
      items: itemCount,
    };
  }

  const menu = await VenueMenu.findOneAndUpdate(
    { location_id: location._id },
    { $set: update },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  ).lean();

  console.log(
    `${LOG} ${entry.key} upserted menu=${menu._id} sections=${menu.sections?.length || 0}`,
  );

  return {
    key: entry.key,
    menuId: String(menu._id),
    locationId: String(location._id),
    locationName: location.name,
    sections: menu.sections?.length || 0,
    items: itemCount,
  };
}

/**
 * Main seed entry.
 */
async function main() {
  const { dryRun, only } = parseArgs();
  const uri = process.env.DB_URI || process.env.MONGODB_URI;
  if (!uri) {
    console.error(`${LOG} Missing DB_URI (or MONGODB_URI)`);
    process.exit(1);
  }

  const entries = only
    ? MENU_FILES.filter(e => e.key === only || e.file.includes(only))
    : MENU_FILES;
  if (!entries.length) {
    console.error(`${LOG} No menu entries matched --only=${only}`);
    process.exit(1);
  }

  await mongoose.connect(uri);
  console.log(`${LOG} connected dryRun=${dryRun}`);

  const results = [];
  try {
    for (const entry of entries) {
      try {
        results.push(await seedOne(entry, dryRun));
      } catch (err) {
        console.error(`${LOG} ${entry.key} failed:`, err.message || err);
        results.push({ key: entry.key, error: String(err.message || err) });
      }
    }
  } finally {
    await mongoose.disconnect();
    console.log(`${LOG} disconnected`);
  }

  console.log(`${LOG} summary:`, JSON.stringify(results, null, 2));
}

main().catch(err => {
  console.error(`${LOG} failed:`, err);
  process.exit(1);
});
