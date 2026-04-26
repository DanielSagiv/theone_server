/**
 * One-off script: create "Tao Night club" location with the provided seats.
 * Run from server dir: node scripts/create-tao-location.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const Location = require('../models/Location');
const User = require('../models/User');

const LOCATION_PAYLOAD = {
  name: 'Tao Night club',
  type: 'night_club',
  description: 'desc',
  address: {
    line1: 'addr',
    line2: 'add2',
    city: 'LV',
    state: 'Nevada',
    postalCode: '89109',
    country: 'United States'
  },
  attributes: {
    bottleService: false
  },
  seats: [
    { code: 'prime table c', category: 'prime', the1Category: 'prime table t1', capacity: 10, minSpendUSD: 1500, qualityScore: 5, priceTier: 1 },
    { code: 'Entry Level c', category: 'entry_level', the1Category: 'Entry Level t1', capacity: 6, minSpendUSD: 500, qualityScore: 5, priceTier: 1 },
    { code: 'Dance Floor c', category: 'dance_floor', the1Category: 'Dance Floor t1', capacity: 10, minSpendUSD: 2000, qualityScore: 5, priceTier: 1 },
    { code: 'Standard c', category: 'standard', the1Category: 'Standard th1', capacity: 10, minSpendUSD: 1000, qualityScore: 5, priceTier: 1 },
    { code: 'Small 1st Tier Prime c', category: 'small_1st_tier_prime', the1Category: 'Small 1st Tier Prime t1', capacity: 4, minSpendUSD: 1000, qualityScore: 5, priceTier: 1 }
  ]
};

async function main() {
  const mongoUri = process.env.DB_URI || process.env.MONGODB_URI;
  if (!mongoUri) {
    console.error('Missing DB_URI or MONGODB_URI in .env');
    process.exit(1);
  }
  await mongoose.connect(mongoUri);
  const admin = await User.findOne({ role: 'admin' });
  const userId = admin ? admin._id : new mongoose.Types.ObjectId();
  const loc = await Location.create({
    ...LOCATION_PAYLOAD,
    createdBy: userId,
    updatedBy: userId
  });
  console.log('Created location:', loc._id.toString());
  console.log('Name:', loc.name);
  console.log('Seats:', loc.seats.length);
  await mongoose.connection.close();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
