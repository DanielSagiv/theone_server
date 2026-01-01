/**
 * Check for duplicate notifications in the database
 * Usage: node scripts/check-duplicate-notifications.js
 */

const mongoose = require('mongoose');
const Notification = require('../models/Notification');
require('dotenv').config();

async function checkDuplicates() {
  try {
    const mongoUri = process.env.DB_URI || process.env.MONGODB_URI || 'mongodb+srv://sagiv:madonna@cluster0.et5fx.mongodb.net/kairo?retryWrites=true&w=majority';
    
    console.log('Connecting to database...');
    await mongoose.connect(mongoUri);
    console.log('✓ Connected\n');

    // Find duplicate notifications (same user, type, message_id)
    const duplicates = await Notification.aggregate([
      {
        $match: {
          type: 'coe_message',
          'data.message_id': { $exists: true, $ne: null }
        }
      },
      {
        $group: {
          _id: {
            user_id: '$user_id',
            message_id: '$data.message_id'
          },
          count: { $sum: 1 },
          notification_ids: { $push: '$_id' },
          created_dates: { $push: '$createdAt' }
        }
      },
      {
        $match: { count: { $gt: 1 } }
      },
      {
        $sort: { count: -1 }
      }
    ]);

    console.log(`Found ${duplicates.length} sets of duplicate notifications\n`);

    if (duplicates.length > 0) {
      console.log('Duplicate notifications:');
      duplicates.forEach((dup, index) => {
        console.log(`\n${index + 1}. User: ${dup._id.user_id}, Message: ${dup._id.message_id}`);
        console.log(`   Count: ${dup.count}`);
        console.log(`   Notification IDs: ${dup.notification_ids.map(id => id.toString()).join(', ')}`);
        console.log(`   Created dates: ${dup.created_dates.map(d => new Date(d).toISOString()).join(', ')}`);
      });

      console.log('\n⚠️  You have duplicate notifications in the database.');
      console.log('   The unique index cannot be created until duplicates are removed.');
      console.log('   Run: node scripts/clean-duplicate-notifications.js');
    } else {
      console.log('✓ No duplicate notifications found. Unique index can be created.');
    }

    await mongoose.connection.close();
    console.log('\n✓ Done');
  } catch (error) {
    console.error('Error:', error);
    await mongoose.connection.close();
    process.exit(1);
  }
}

checkDuplicates();

