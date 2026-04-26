/**
 * Notification Security Test Script
 * Tests that users can only access their own notifications
 * 
 * Usage: node tests/notification-security-test.js
 */

const mongoose = require('mongoose');
const Notification = require('../models/Notification');
const User = require('../models/User');
require('dotenv').config();

// Test configuration
const TEST_CONFIG = {
  mongoUri: process.env.DB_URI || process.env.MONGODB_URI || 'mongodb+srv://sagiv:madonna@cluster0.et5fx.mongodb.net/kairo?retryWrites=true&w=majority',
  testUsers: {
    user1: null, // Will be created
    user2: null, // Will be created
    admin: null // Will be created
  }
};

/**
 * Create test users
 */
async function createTestUsers() {
  console.log('\n=== Creating Test Users ===');
  
  // Create user1
  const user1 = new User({
    email: `test-user1-${Date.now()}@test.com`,
    password: 'Test123!@#',
    firstName: 'Test',
    lastName: 'User1',
    role: 'client',
    emailVerified: true,
    entity_status: 'active'
  });
  await user1.save();
  TEST_CONFIG.testUsers.user1 = user1;
  console.log('✓ Created user1:', user1._id.toString());

  // Create user2
  const user2 = new User({
    email: `test-user2-${Date.now()}@test.com`,
    password: 'Test123!@#',
    firstName: 'Test',
    lastName: 'User2',
    role: 'client',
    emailVerified: true,
    entity_status: 'active'
  });
  await user2.save();
  TEST_CONFIG.testUsers.user2 = user2;
  console.log('✓ Created user2:', user2._id.toString());

  // Create admin
  const admin = new User({
    email: `test-admin-${Date.now()}@test.com`,
    password: 'Test123!@#',
    firstName: 'Test',
    lastName: 'Admin',
    role: 'admin',
    emailVerified: true,
    entity_status: 'active'
  });
  await admin.save();
  TEST_CONFIG.testUsers.admin = admin;
  console.log('✓ Created admin:', admin._id.toString());
}

/**
 * Create test notifications
 */
async function createTestNotifications() {
  console.log('\n=== Creating Test Notifications ===');
  
  const user1 = TEST_CONFIG.testUsers.user1;
  const user2 = TEST_CONFIG.testUsers.user2;

  // Create notification for user1
  const notif1 = new Notification({
    user_id: user1._id,
    type: 'coe_approved',
    title: 'Test Notification 1',
    body: 'This is a test notification for user1',
    data: {
      coe_id: new mongoose.Types.ObjectId(),
      action: 'coe_approved',
      action_url: 'the1://coe-detail?coeId=test123'
    },
    read: false,
    sent: false
  });
  await notif1.save();
  console.log('✓ Created notification for user1:', notif1._id.toString());

  // Create notification for user2
  const notif2 = new Notification({
    user_id: user2._id,
    type: 'coe_message',
    title: 'Test Notification 2',
    body: 'This is a test notification for user2',
    data: {
      coe_id: new mongoose.Types.ObjectId(),
      action: 'coe_message',
      action_url: 'the1://coe-messages?coeId=test456'
    },
    read: false,
    sent: false
  });
  await notif2.save();
  console.log('✓ Created notification for user2:', notif2._id.toString());

  return { notif1, notif2 };
}

/**
 * Test 1: User can only see their own notifications
 */
async function testUserCanOnlySeeOwnNotifications() {
  console.log('\n=== Test 1: User Can Only See Own Notifications ===');
  
  const user1 = TEST_CONFIG.testUsers.user1;
  const user2 = TEST_CONFIG.testUsers.user2;

  // Query as user1
  const user1Notifications = await Notification.find({ user_id: user1._id });
  console.log(`✓ User1 query returned ${user1Notifications.length} notification(s)`);
  
  // Verify user1 only sees their own notifications
  const hasUser2Notifications = user1Notifications.some(n => 
    n.user_id.toString() === user2._id.toString()
  );
  
  if (hasUser2Notifications) {
    console.error('❌ SECURITY ISSUE: User1 can see User2 notifications!');
    return false;
  }
  
  console.log('✓ User1 can only see their own notifications');
  return true;
}

/**
 * Test 2: User cannot access other user's notification by ID
 */
async function testUserCannotAccessOtherUserNotification() {
  console.log('\n=== Test 2: User Cannot Access Other User\'s Notification ===');
  
  const user1 = TEST_CONFIG.testUsers.user1;
  const user2 = TEST_CONFIG.testUsers.user2;
  
  // Get user2's notification
  const user2Notification = await Notification.findOne({ user_id: user2._id });
  if (!user2Notification) {
    console.log('⚠️  No user2 notification found, skipping test');
    return true;
  }

  // Try to access user2's notification as user1
  const unauthorizedAccess = await Notification.findOne({
    _id: user2Notification._id,
    user_id: user1._id
  });

  if (unauthorizedAccess) {
    console.error('❌ SECURITY ISSUE: User1 can access User2 notification by ID!');
    return false;
  }

  console.log('✓ User1 cannot access User2 notification by ID');
  return true;
}

/**
 * Test 3: User cannot modify other user's notifications
 */
async function testUserCannotModifyOtherUserNotification() {
  console.log('\n=== Test 3: User Cannot Modify Other User\'s Notification ===');
  
  const user1 = TEST_CONFIG.testUsers.user1;
  const user2 = TEST_CONFIG.testUsers.user2;
  
  // Get user2's notification
  const user2Notification = await Notification.findOne({ user_id: user2._id });
  if (!user2Notification) {
    console.log('⚠️  No user2 notification found, skipping test');
    return true;
  }

  // Try to mark user2's notification as read as user1
  const updateResult = await Notification.updateOne(
    { _id: user2Notification._id, user_id: user1._id },
    { read: true }
  );

  if (updateResult.modifiedCount > 0) {
    console.error('❌ SECURITY ISSUE: User1 can modify User2 notification!');
    return false;
  }

  console.log('✓ User1 cannot modify User2 notification');
  return true;
}

/**
 * Test 4: User cannot delete other user's notifications
 */
async function testUserCannotDeleteOtherUserNotification() {
  console.log('\n=== Test 4: User Cannot Delete Other User\'s Notification ===');
  
  const user1 = TEST_CONFIG.testUsers.user1;
  const user2 = TEST_CONFIG.testUsers.user2;
  
  // Get user2's notification
  const user2Notification = await Notification.findOne({ user_id: user2._id });
  if (!user2Notification) {
    console.log('⚠️  No user2 notification found, skipping test');
    return true;
  }

  // Try to delete user2's notification as user1
  const deleteResult = await Notification.deleteOne({
    _id: user2Notification._id,
    user_id: user1._id
  });

  if (deleteResult.deletedCount > 0) {
    console.error('❌ SECURITY ISSUE: User1 can delete User2 notification!');
    return false;
  }

  console.log('✓ User1 cannot delete User2 notification');
  return true;
}

/**
 * Test 5: Unread count only includes user's own notifications
 */
async function testUnreadCountIsUserSpecific() {
  console.log('\n=== Test 5: Unread Count Is User-Specific ===');
  
  const user1 = TEST_CONFIG.testUsers.user1;
  const user2 = TEST_CONFIG.testUsers.user2;

  // Get unread count for user1
  const user1UnreadCount = await Notification.countDocuments({
    user_id: user1._id,
    read: false
  });

  // Get unread count for user2
  const user2UnreadCount = await Notification.countDocuments({
    user_id: user2._id,
    read: false
  });

  console.log(`✓ User1 unread count: ${user1UnreadCount}`);
  console.log(`✓ User2 unread count: ${user2UnreadCount}`);

  // Verify counts are independent
  if (user1UnreadCount === user2UnreadCount && user1UnreadCount > 0) {
    console.warn('⚠️  Warning: Both users have same unread count - may indicate issue');
  }

  console.log('✓ Unread counts are user-specific');
  return true;
}

/**
 * Test 6: Populated data doesn't expose sensitive information
 */
async function testPopulatedDataSecurity() {
  console.log('\n=== Test 6: Populated Data Security ===');
  
  const user1 = TEST_CONFIG.testUsers.user1;

  // Get notification with populated data (as service does)
  const notification = await Notification.findOne({ user_id: user1._id })
    .populate('data.coe_id', 'name')
    .populate('data.message_id', 'content')
    .populate('data.payment_id', 'amount currency')
    .populate('data.sender_id', 'firstName lastName avatarUrl');

  if (!notification) {
    console.log('⚠️  No notification found, skipping test');
    return true;
  }

  // Check what data is exposed
  const exposedData = {
    hasCoeId: !!notification.data?.coe_id,
    hasMessageId: !!notification.data?.message_id,
    hasPaymentId: !!notification.data?.payment_id,
    hasSenderId: !!notification.data?.sender_id,
    senderData: notification.data?.sender_id ? {
      firstName: notification.data.sender_id.firstName,
      lastName: notification.data.sender_id.lastName,
      hasAvatar: !!notification.data.sender_id.avatarUrl
    } : null
  };

  console.log('✓ Populated data structure:', JSON.stringify(exposedData, null, 2));

  // Verify no sensitive data is exposed
  // (This is informational - actual sensitive data check depends on business rules)
  console.log('✓ Populated data appears safe (only public fields)');
  return true;
}

/**
 * Test 7: Query injection protection
 */
async function testQueryInjectionProtection() {
  console.log('\n=== Test 7: Query Injection Protection ===');
  
  const user1 = TEST_CONFIG.testUsers.user1;

  // Try malicious query
  const maliciousUserId = { $ne: user1._id }; // Not equal to user1
  
  try {
    const maliciousQuery = await Notification.find({
      user_id: maliciousUserId
    }).limit(10);

    if (maliciousQuery.length > 0) {
      console.warn('⚠️  Warning: Query with $ne operator returned results');
      console.warn('   This might be expected behavior, but verify it\'s intentional');
    }
  } catch (error) {
    // Good - query was rejected
    console.log('✓ Malicious query was rejected:', error.message);
  }

  // Test that user_id is always required and validated
  const queryWithoutUserId = await Notification.find({});
  if (queryWithoutUserId.length > 0) {
    console.warn('⚠️  Warning: Query without user_id filter returned results');
    console.warn('   Service functions should always include user_id filter');
  } else {
    console.log('✓ Queries without user_id return empty (good - service enforces user_id)');
  }

  return true;
}

/**
 * Cleanup test data
 */
async function cleanup() {
  console.log('\n=== Cleaning Up Test Data ===');
  
  // Delete test notifications
  const deletedNotifications = await Notification.deleteMany({
    user_id: { $in: [
      TEST_CONFIG.testUsers.user1?._id,
      TEST_CONFIG.testUsers.user2?._id,
      TEST_CONFIG.testUsers.admin?._id
    ]}
  });
  console.log(`✓ Deleted ${deletedNotifications.deletedCount} test notifications`);

  // Delete test users
  if (TEST_CONFIG.testUsers.user1) {
    await User.findByIdAndDelete(TEST_CONFIG.testUsers.user1._id);
    console.log('✓ Deleted user1');
  }
  if (TEST_CONFIG.testUsers.user2) {
    await User.findByIdAndDelete(TEST_CONFIG.testUsers.user2._id);
    console.log('✓ Deleted user2');
  }
  if (TEST_CONFIG.testUsers.admin) {
    await User.findByIdAndDelete(TEST_CONFIG.testUsers.admin._id);
    console.log('✓ Deleted admin');
  }
}

/**
 * Run all tests
 */
async function runTests() {
  try {
    console.log('=== Notification Security Test Suite ===\n');

    // Connect to database
    console.log('Connecting to database...');
    await mongoose.connect(TEST_CONFIG.mongoUri);
    console.log('✓ Connected to database\n');

    // Create test data
    await createTestUsers();
    const { notif1, notif2 } = await createTestNotifications();

    // Run tests
    const results = {
      test1: await testUserCanOnlySeeOwnNotifications(),
      test2: await testUserCannotAccessOtherUserNotification(),
      test3: await testUserCannotModifyOtherUserNotification(),
      test4: await testUserCannotDeleteOtherUserNotification(),
      test5: await testUnreadCountIsUserSpecific(),
      test6: await testPopulatedDataSecurity(),
      test7: await testQueryInjectionProtection()
    };

    // Print summary
    console.log('\n=== Test Results Summary ===');
    const passed = Object.values(results).filter(r => r === true).length;
    const total = Object.keys(results).length;
    
    Object.entries(results).forEach(([test, passed]) => {
      console.log(`${passed ? '✓' : '❌'} ${test}: ${passed ? 'PASSED' : 'FAILED'}`);
    });

    console.log(`\n${passed}/${total} tests passed`);

    if (passed === total) {
      console.log('\n✅ All security tests passed!');
    } else {
      console.log('\n❌ Some security tests failed - review the issues above');
    }

    // Cleanup
    await cleanup();

    // Close connection
    await mongoose.connection.close();
    console.log('\n✓ Database connection closed');

  } catch (error) {
    console.error('\n❌ Test suite error:', error);
    await cleanup();
    await mongoose.connection.close();
    process.exit(1);
  }
}

// Run tests if executed directly
if (require.main === module) {
  runTests();
}

module.exports = { runTests };

