/**
 * One-off: $push one distinct test performer onto specific events (local/staging use).
 * Usage: from server root, `node scripts/seed-test-performers-one-each.js`
 * Requires DB_URI or MONGODB_URI in .env (same as server.js / other scripts)
 */
require('dotenv').config();
const mongoose = require('mongoose');

const EVENT_IDS = [
  '69bc7797490aafe1b1dcbd04',
  '69c3b24bb69477497843d8b5',
  '69c3b5acc8a3505b2be271a1',
];

const PERFORMERS = [
  {
    perfcode: 'TEST-PER-01',
    importance: 'headliner',
    apprtime: '22:00',
    name: 'Test Artist Alpha',
    description: 'Seed performer for DB test (event 1).',
    links: [{ url: 'https://example.com/alpha', label: 'Example' }],
  },
  {
    perfcode: 'TEST-PER-02',
    importance: 'support',
    apprtime: '21:00',
    name: 'Test Artist Beta',
    description: 'Seed performer for DB test (event 2).',
    links: [{ url: 'https://example.com/beta', label: 'Example' }],
  },
  {
    perfcode: 'TEST-PER-03',
    importance: 'guest',
    apprtime: '20:00',
    name: 'Test Artist Gamma',
    description: 'Seed performer for DB test (event 3).',
    links: [{ url: 'https://example.com/gamma', label: 'Example' }],
  },
];

async function main() {
  const uri = process.env.DB_URI || process.env.MONGODB_URI;
  if (!uri) {
    console.error('Missing DB_URI or MONGODB_URI in environment');
    process.exit(1);
  }

  await mongoose.connect(uri);
  const col = mongoose.connection.collection('events');

  for (let i = 0; i < EVENT_IDS.length; i++) {
    const id = EVENT_IDS[i];
    const performer = PERFORMERS[i];
    const oid = new mongoose.Types.ObjectId(id);
    const res = await col.updateOne({ _id: oid }, { $push: { performers: performer } });
    if (res.matchedCount === 0) {
      console.error(`No event found: ${id}`);
    } else {
      console.log(`Updated ${id}: matched=${res.matchedCount} modified=${res.modifiedCount}`);
    }
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
