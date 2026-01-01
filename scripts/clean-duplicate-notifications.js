/**
 * Clean duplicate notifications - keeps the oldest one, deletes the rest
 * Usage: node scripts/clean-duplicate-notifications.js
 */

const mongoose = require('mongoose');
const Notification = require('../models/Notification');
require('dotenv').config();

async function cleanDuplicates() {
  try {
    const mongoUri = process.env.DB_URI || process.env.MONGODB_URI || 'mongodb+srv://sagiv:madonna@cluster0.et5fx.mongodb.net/kairo?retryWrites=true&w=majority';
    
    console.log('Connecting to database...');
    await mongoose.connect(mongoUri);
    console.log('✓ Connected\n');

    // Find duplicate notifications
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
          notifications: {
            $push: {
              id: '$_id',
              createdAt: '$createdAt'
            }
          }
        }
      },
      {
        $match: { count: { $gt: 1 } }
      }
    ]);

    console.log(`Found ${duplicates.length} sets of duplicate notifications\n`);

    let totalDeleted = 0;

    for (const dup of duplicates) {
      // Sort by creation date (oldest first)
      const sorted = dup.notifications.sort((a, b) => 
        new Date(a.createdAt) - new Date(b.createdAt)
      );

      // Keep the oldest one, delete the rest
      const toDelete = sorted.slice(1);
      
      console.log(`Processing duplicates for user ${dup._id.user_id}, message ${dup._id.message_id}:`);
      console.log(`  Keeping: ${sorted[0].id} (created: ${new Date(sorted[0].createdAt).toISOString()})`);
      
      for (const notif of toDelete) {
        await Notification.findByIdAndDelete(notif.id);
        console.log(`  Deleted: ${notif.id} (created: ${new Date(notif.createdAt).toISOString()})`);
        totalDeleted++;
      }
    }

    console.log(`\n✓ Cleanup complete. Deleted ${totalDeleted} duplicate notifications.`);

    await mongoose.connection.close();
    console.log('✓ Done');
  } catch (error) {
    console.error('Error:', error);
    await mongoose.connection.close();
    process.exit(1);
  }
}

cleanDuplicates();

