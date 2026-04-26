require('dotenv').config();
const notificationService = require('./services/notificationService');

async function testFirebase() {
  try {
    notificationService.initializeFirebase();
    console.log('✅ Firebase initialized successfully');
    process.exit(0);
  } catch (error) {
    console.error('❌ Firebase initialization failed:', error.message);
    console.error('Full error:', error);
    process.exit(1);
  }
}

testFirebase();











