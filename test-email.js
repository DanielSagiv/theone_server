/**
 * Email Service Test Script
 * Run this to test sending emails via AWS SES
 * 
 * Usage: node test-email.js
 * 
 * Prerequisites:
 * 1. Set up environment variables in .env file:
 *    - FROM_EMAIL=noreply@the1.vip
 *    - FRONTEND_URL=http://localhost:3006
 *    - AWS_REGION=us-west-2
 *    - AWS_ACCESS_KEY_ID=your-key
 *    - AWS_SECRET_ACCESS_KEY=your-secret
 * 
 * 2. Verify your test email address in AWS SES Console
 *    (required when in sandbox mode)
 * 
 * 3. Update TEST_EMAIL below with your verified email
 */

require('dotenv').config();
const emailService = require('./utils/emailService');

// ⚠️ UPDATE THIS WITH YOUR VERIFIED EMAIL ADDRESS
const TEST_EMAIL = 'motti@the1.vip';

/**
 * Test sending a simple email
 */
async function testSimpleEmail() {
  console.log('\n📧 Test 1: Simple Email');
  console.log('========================');
  
  try {
    const result = await emailService.sendEmail({
      to: TEST_EMAIL,
      subject: 'Test Email from The1 Platform',
      html: '<h1>Hello!</h1><p>This is a test email from The1 Platform email service.</p>'
    });
    
    console.log('✅ Email sent successfully!');
    console.log('Message ID:', result.messageId);
    return true;
  } catch (error) {
    console.error('❌ Failed to send email:', error.message);
    return false;
  }
}

/**
 * Test sending verification email
 */
async function testVerificationEmail() {
  console.log('\n📧 Test 2: Verification Email');
  console.log('==============================');
  
  const testUser = {
    email: TEST_EMAIL,
    firstName: 'Test',
    lastName: 'User'
  };
  
  const testToken = 'a'.repeat(64); // Dummy 64-char token
  
  try {
    const result = await emailService.sendVerificationEmail(testUser, testToken);
    console.log('✅ Verification email sent successfully!');
    console.log('Message ID:', result.messageId);
    return true;
  } catch (error) {
    console.error('❌ Failed to send verification email:', error.message);
    return false;
  }
}

/**
 * Test sending password reset email
 */
async function testPasswordResetEmail() {
  console.log('\n📧 Test 3: Password Reset Email');
  console.log('================================');
  
  const testUser = {
    email: TEST_EMAIL,
    firstName: 'Test'
  };
  
  const testToken = 'b'.repeat(64); // Dummy 64-char token
  
  try {
    const result = await emailService.sendPasswordResetEmail(testUser, testToken);
    console.log('✅ Password reset email sent successfully!');
    console.log('Message ID:', result.messageId);
    return true;
  } catch (error) {
    console.error('❌ Failed to send password reset email:', error.message);
    return false;
  }
}

/**
 * Test sending welcome email
 */
async function testWelcomeEmail() {
  console.log('\n📧 Test 4: Welcome Email');
  console.log('========================');
  
  const testUser = {
    email: TEST_EMAIL,
    firstName: 'Test'
  };
  
  try {
    const result = await emailService.sendWelcomeEmail(testUser);
    console.log('✅ Welcome email sent successfully!');
    console.log('Message ID:', result.messageId);
    return true;
  } catch (error) {
    console.error('❌ Failed to send welcome email:', error.message);
    return false;
  }
}

/**
 * Test sending admin notification
 */
async function testAdminNotification() {
  console.log('\n📧 Test 5: Admin Notification');
  console.log('==============================');
  
  try {
    const result = await emailService.sendAdminNotificationEmail(
      TEST_EMAIL,
      'Test Notification',
      'This is a test admin notification from the email service.'
    );
    console.log('✅ Admin notification sent successfully!');
    console.log('Message ID:', result.messageId);
    return true;
  } catch (error) {
    console.error('❌ Failed to send admin notification:', error.message);
    return false;
  }
}

/**
 * Validate environment configuration
 */
function validateConfig() {
  console.log('\n🔧 Configuration Check');
  console.log('======================');
  
  const required = {
    'FROM_EMAIL': process.env.FROM_EMAIL,
    'FRONTEND_URL': process.env.FRONTEND_URL,
    'AWS_REGION': process.env.AWS_REGION,
    'AWS_ACCESS_KEY_ID': process.env.AWS_ACCESS_KEY_ID,
    'AWS_SECRET_ACCESS_KEY': process.env.AWS_SECRET_ACCESS_KEY
  };
  
  let allValid = true;
  
  for (const [key, value] of Object.entries(required)) {
    if (value) {
      console.log(`✅ ${key}: ${key.includes('SECRET') || key.includes('KEY') ? '***' : value}`);
    } else {
      console.log(`❌ ${key}: NOT SET`);
      allValid = false;
    }
  }
  
  if (TEST_EMAIL === 'your-verified-email@example.com') {
    console.log('\n⚠️  WARNING: Update TEST_EMAIL constant in test-email.js');
    allValid = false;
  }
  
  return allValid;
}

/**
 * Main test runner
 */
async function runTests() {
  console.log('\n================================================');
  console.log('     The1 Platform Email Service Test');
  console.log('================================================');
  
  // Validate configuration
  if (!validateConfig()) {
    console.log('\n❌ Configuration is incomplete. Please set all required environment variables.');
    console.log('\nRequired variables:');
    console.log('  - FROM_EMAIL=noreply@the1.vip');
    console.log('  - FRONTEND_URL=http://localhost:3006');
    console.log('  - AWS_REGION=us-west-2');
    console.log('  - AWS_ACCESS_KEY_ID=your-key');
    console.log('  - AWS_SECRET_ACCESS_KEY=your-secret');
    console.log('\nAlso update TEST_EMAIL in test-email.js with your verified email.');
    process.exit(1);
  }
  
  console.log('\n✅ Configuration looks good!\n');
  console.log('⏳ Starting email tests...\n');
  
  // Run tests
  const results = {
    simple: await testSimpleEmail(),
    verification: await testVerificationEmail(),
    passwordReset: await testPasswordResetEmail(),
    welcome: await testWelcomeEmail(),
    adminNotification: await testAdminNotification()
  };
  
  // Summary
  console.log('\n================================================');
  console.log('                Test Summary');
  console.log('================================================');
  
  const passed = Object.values(results).filter(r => r).length;
  const total = Object.keys(results).length;
  
  console.log(`\nTotal: ${passed}/${total} tests passed\n`);
  
  Object.entries(results).forEach(([test, passed]) => {
    console.log(`${passed ? '✅' : '❌'} ${test}`);
  });
  
  if (passed === total) {
    console.log('\n🎉 All tests passed! Email service is working correctly.');
    console.log('\n📬 Check your inbox at:', TEST_EMAIL);
  } else {
    console.log('\n⚠️  Some tests failed. Check the errors above.');
    console.log('\nCommon issues:');
    console.log('  - Email not verified in AWS SES (sandbox mode)');
    console.log('  - Invalid AWS credentials');
    console.log('  - AWS SES not configured in region');
    console.log('  - Network connectivity issues');
  }
  
  console.log('\n================================================\n');
}

// Run tests
runTests().catch(error => {
  console.error('\n❌ Test runner failed:', error);
  process.exit(1);
});

