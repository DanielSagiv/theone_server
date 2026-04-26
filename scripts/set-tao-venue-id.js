/**
 * Set taoVenueId on the manually created "Tao Night club" so Tao import finds it and does not create a new location.
 * Run once from server dir: node scripts/set-tao-venue-id.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const Location = require('../models/Location');

const TAO_VENUE_ID = '121'; // from listing URL event_venue=121 (Tao Las Vegas)

async function main() {
  const mongoUri = process.env.DB_URI || process.env.MONGODB_URI;
  if (!mongoUri) {
    console.error('Missing DB_URI or MONGODB_URI');
    process.exit(1);
  }
  await mongoose.connect(mongoUri);
  const loc = await Location.findOne({ name: /Tao Night club/i });
  if (!loc) {
    console.error('No location named "Tao Night club" found.');
    process.exit(1);
  }
  loc.taoVenueId = TAO_VENUE_ID;
  await loc.save();
  console.log('Updated location', loc._id.toString(), 'name=', loc.name, 'taoVenueId=', loc.taoVenueId);
  await mongoose.connection.close();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
