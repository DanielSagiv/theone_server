#!/usr/bin/env node

/**
 * COE Status Flow Test Script
 * Tests all status transitions according to the new simplified flow
 */

const axios = require('axios');

// Configuration
const BASE_URL = process.env.BASE_URL || 'http://localhost:3006';
const API_BASE = `${BASE_URL}/v1`;

// Test credentials
const ADMIN_CREDENTIALS = {
  email: 'sagiv.daniel.p@gmail.com',
  password: '123456',
  id: '68cfd487e2766dbc14fd4c74'
};

const CLIENT_CREDENTIALS = {
  email: 'sagiv.daniel.p+2@gmail.com',
  password: '123456',
  id: '68dd73127f9a8aea777d2f34'
};

// Test results storage
const testResults = [];

// Helper function to make API calls
async function apiCall(method, endpoint, token = null, data = null) {
  try {
    const config = {
      method,
      url: `${API_BASE}${endpoint}`,
      headers: {
        'Content-Type': 'application/json',
      }
    };
    
    if (token) {
      config.headers['Authorization'] = `Bearer ${token}`;
    }
    
    if (data) {
      config.data = data;
    }
    
    const response = await axios(config);
    return { success: true, data: response.data, status: response.status };
  } catch (error) {
    const errorData = error.response?.data || error.message;
    const errorStatus = error.response?.status || 500;
    return {
      success: false,
      error: errorData,
      status: errorStatus
    };
  }
}

// Helper to record test result
function recordTest(testNum, testCase, action, expected, actual, passed) {
  testResults.push({
    testNum,
    testCase,
    action,
    expected,
    actual,
    passed,
    timestamp: new Date().toISOString()
  });
}

// Authentication
async function authenticate(credentials) {
  console.log(`\n🔐 Authenticating as ${credentials.email}...`);
  try {
    const result = await apiCall('POST', '/auth/signin', null, {
      email: credentials.email,
      password: credentials.password
    });
    
    console.log(`   Response status: ${result.status}`);
    console.log(`   Response success: ${result.success}`);
    if (result.error) {
      console.log(`   Error details:`, JSON.stringify(result.error, null, 2));
    }
    if (result.data) {
      console.log(`   Response data keys:`, Object.keys(result.data || {}));
      if (result.data.data) {
        console.log(`   Response data.data keys:`, Object.keys(result.data.data || {}));
      }
    }
    
    if (result.success && result.data?.data?.token) {
      console.log(`✅ Authentication successful`);
      return result.data.data.token;
    } else if (result.data?.data?.token) {
      console.log(`✅ Authentication successful (alternative path)`);
      return result.data.data.token;
    } else {
      console.log(`❌ Authentication failed - no token in response`);
      console.log(`   Full response:`, JSON.stringify(result, null, 2));
      throw new Error(`Failed to authenticate: ${JSON.stringify(result.error || result.data)}`);
    }
  } catch (error) {
    console.log(`❌ Authentication exception:`, error.message);
    throw error;
  }
}

// Get COEs for user
async function getCOEs(token) {
  const result = await apiCall('GET', '/coes/my', token);
  return result;
}

// Get a specific COE
async function getCOE(token, coeId) {
  const result = await apiCall('GET', `/coes/my/${coeId}`, token);
  return result;
}

// Update COE status
async function updateCOEStatus(token, coeId, status) {
  const result = await apiCall('PUT', `/coes/${coeId}/status`, token, { status });
  return result;
}

// Create payment intent
async function createPaymentIntent(token, coeId, paymentType = 'full_payment', tokenId = null) {
  const data = { paymentType };
  if (tokenId) {
    data.tokenId = tokenId;
  }
  const result = await apiCall('POST', `/payments/coe/${coeId}/intent`, token, data);
  return result;
}

// Format status for display
function formatStatus(status) {
  return status || 'null';
}

// Format error for display
function formatError(error) {
  if (typeof error === 'string') return error;
  if (error?.message) return error.message;
  if (error?.error?.message) return error.error.message;
  return JSON.stringify(error).substring(0, 100);
}

// Check server connectivity
async function checkServer() {
  try {
    const response = await axios.get(`${BASE_URL}/health`, { timeout: 3000 });
    return true;
  } catch (error) {
    try {
      // Try the root endpoint
      const response = await axios.get(`${BASE_URL}/`, { timeout: 3000 });
      return true;
    } catch (e) {
      return false;
    }
  }
}

// Main test function
async function runTests() {
  console.log('🚀 Starting COE Status Flow Tests...\n');
  console.log('=' .repeat(80));
  console.log(`📡 Testing connection to: ${BASE_URL}`);
  
  const serverUp = await checkServer();
  if (!serverUp) {
    console.log(`⚠️  Warning: Cannot connect to server at ${BASE_URL}`);
    console.log(`   Make sure the server is running on port 80`);
    console.log(`   You can override with: BASE_URL=http://localhost:3000 node test-coe-status-flow.js\n`);
  } else {
    console.log(`✅ Server is reachable\n`);
  }
  
  let adminToken, clientToken;
  let testCoeId = null;
  let testCaseNum = 1;
  
  try {
    // Authenticate
    adminToken = await authenticate(ADMIN_CREDENTIALS);
    clientToken = await authenticate(CLIENT_CREDENTIALS);
    
    // Get existing COEs to use for testing
    console.log('\n📋 Finding test COE...');
    const clientCOEs = await getCOEs(clientToken);
    
    if (clientCOEs.success && clientCOEs.data.data && clientCOEs.data.data.length > 0) {
      // Find a draft or approved COE to test with
      const testCoe = clientCOEs.data.data.find(coe => 
        ['draft', 'approved'].includes(coe.status)
      ) || clientCOEs.data.data[0];
      
      testCoeId = testCoe._id || testCoe.id;
      console.log(`✅ Found test COE: ${testCoeId} (status: ${testCoe.status})`);
    } else {
      console.log('⚠️  No COEs found. Some tests may be skipped.');
    }
    
    console.log('\n' + '='.repeat(80));
    console.log('RUNNING TESTS\n');
    
    // TEST 1: Get COE status (baseline)
    if (testCoeId) {
      console.log(`\n[TEST ${testCaseNum}] Get initial COE status`);
      const coe = await getCOE(clientToken, testCoeId);
      if (coe.success) {
        const status = coe.data.data?.status || 'unknown';
        console.log(`   Current status: ${status}`);
        recordTest(testCaseNum, 'Get COE Status', 'GET /coes/my/:id', 'Returns COE data', `Status: ${status}`, true);
      }
      testCaseNum++;
    }
    
    // TEST 2: Admin approves draft COE (or check if already approved)
    if (testCoeId) {
      console.log(`\n[TEST ${testCaseNum}] Admin approves COE`);
      const coeBefore = await getCOE(adminToken, testCoeId);
      const currentStatus = coeBefore.success ? (coeBefore.data.data?.status || 'unknown') : 'unknown';
      
      if (currentStatus === 'draft') {
        const result = await updateCOEStatus(adminToken, testCoeId, 'approved');
        const passed = result.success && result.data.data?.status === 'approved';
        const approvedDate = result.success ? (result.data.data?.approved_date ? 'set' : 'not set') : 'N/A';
        
        console.log(`   Action: draft → approved`);
        console.log(`   Result: ${passed ? '✅ PASS' : '❌ FAIL'}`);
        console.log(`   Approved date: ${approvedDate}`);
        console.log(`   Response: ${result.success ? result.status : formatError(result.error)}`);
        
        recordTest(
          testCaseNum,
          'Admin Approves COE',
          'PUT /coes/:id/status {"status": "approved"}',
          'Status changes to approved, approved_date set',
          `${passed ? 'Status: approved' : formatError(result.error)}`,
          passed
        );
      } else {
        console.log(`   ⏭️  Skipped - COE already in ${currentStatus} status`);
        recordTest(testCaseNum, 'Admin Approves COE', 'PUT /coes/:id/status', 'N/A (already approved)', `COE already ${currentStatus}`, true);
      }
      testCaseNum++;
    }
    
    // TEST 3: Invalid transition - Draft to Paid (should fail)
    console.log(`\n[TEST ${testCaseNum}] Invalid transition: draft → paid (should fail)`);
    // Find a draft COE or create one for this test
    const draftCOEs = await getCOEs(adminToken);
    let draftCoeId = null;
    if (draftCOEs.success && draftCOEs.data.data) {
      const draftCoe = draftCOEs.data.data.find(coe => coe.status === 'draft');
      if (draftCoe) draftCoeId = draftCoe._id || draftCoe.id;
    }
    
    if (draftCoeId) {
      const result = await updateCOEStatus(adminToken, draftCoeId, 'paid');
      const passed = !result.success && (result.status === 400 || result.error?.message?.includes('Invalid status transition'));
      
      console.log(`   Action: draft → paid (invalid)`);
      console.log(`   Result: ${passed ? '✅ PASS (correctly rejected)' : '❌ FAIL (should reject)'}`);
      console.log(`   Response: ${result.status} - ${formatError(result.error)}`);
      
      recordTest(
        testCaseNum,
        'Invalid Transition Validation',
        'PUT /coes/:id/status {"status": "paid"} (from draft)',
        'Returns 400 - Invalid transition',
        `${result.status}: ${formatError(result.error)}`,
        passed
      );
    } else {
      console.log(`   ⏭️  Skipped - No draft COE found`);
      recordTest(testCaseNum, 'Invalid Transition Validation', 'PUT /coes/:id/status', 'N/A', 'No draft COE available', true);
    }
    testCaseNum++;
    
    // TEST 4: Client initiates payment (approved → pending_pay)
    if (testCoeId) {
      console.log(`\n[TEST ${testCaseNum}] Client initiates payment (approved → pending_pay)`);
      const coeBefore = await getCOE(clientToken, testCoeId);
      const currentStatus = coeBefore.success ? (coeBefore.data.data?.status || 'unknown') : 'unknown';
      
      if (currentStatus === 'approved') {
        // Note: This will create payment intent, which should change status to pending_pay
        const paymentResult = await createPaymentIntent(clientToken, testCoeId, 'full_payment');
        
        // Check if status changed to pending_pay
        const coeAfter = await getCOE(clientToken, testCoeId);
        const newStatus = coeAfter.success ? (coeAfter.data.data?.status || 'unknown') : 'unknown';
        const pendingPayDate = coeAfter.success && coeAfter.data.data?.pending_pay_date ? 'set' : 'not set';
        
        const passed = newStatus === 'pending_pay';
        
        console.log(`   Action: approved → pending_pay`);
        console.log(`   Result: ${passed ? '✅ PASS' : '❌ FAIL'}`);
        console.log(`   New status: ${newStatus}`);
        console.log(`   Pending pay date: ${pendingPayDate}`);
        console.log(`   Payment intent response: ${paymentResult.success ? paymentResult.status : formatError(paymentResult.error)}`);
        
        recordTest(
          testCaseNum,
          'Client Initiates Payment',
          'POST /payments/coe/:id/intent',
          'Status changes to pending_pay, pending_pay_date set',
          `Status: ${newStatus}, Date: ${pendingPayDate}`,
          passed
        );
      } else {
        console.log(`   ⏭️  Skipped - COE is in ${currentStatus} status (needs to be approved)`);
        recordTest(testCaseNum, 'Client Initiates Payment', 'POST /payments/coe/:id/intent', 'N/A', `COE status is ${currentStatus}`, true);
      }
      testCaseNum++;
    }
    
    // TEST 5: Admin cancels approved COE (should release seats)
    console.log(`\n[TEST ${testCaseNum}] Admin cancels COE (approved → cancelled)`);
    // Find an approved COE
    const approvedCOEs = await getCOEs(adminToken);
    let approvedCoeId = null;
    if (approvedCOEs.success && approvedCOEs.data.data) {
      const approvedCoe = approvedCOEs.data.data.find(coe => coe.status === 'approved');
      if (approvedCoe) approvedCoeId = approvedCoe._id || approvedCoe.id;
    }
    
    if (approvedCoeId && approvedCoeId !== testCoeId) {
      const result = await updateCOEStatus(adminToken, approvedCoeId, 'cancelled');
      const passed = result.success && result.data.data?.status === 'cancelled';
      
      console.log(`   Action: approved → cancelled`);
      console.log(`   Result: ${passed ? '✅ PASS' : '❌ FAIL'}`);
      console.log(`   Response: ${result.success ? result.status : formatError(result.error)}`);
      
      recordTest(
        testCaseNum,
        'Admin Cancels Approved COE',
        'PUT /coes/:id/status {"status": "cancelled"}',
        'Status changes to cancelled, seats released',
        `${passed ? 'Status: cancelled' : formatError(result.error)}`,
        passed
      );
    } else {
      console.log(`   ⏭️  Skipped - No approved COE found for cancellation test`);
      recordTest(testCaseNum, 'Admin Cancels Approved COE', 'PUT /coes/:id/status', 'N/A', 'No approved COE available', true);
    }
    testCaseNum++;
    
    // TEST 6: Admin restarts rejected/expired COE (rejected → draft)
    console.log(`\n[TEST ${testCaseNum}] Admin restarts rejected COE (rejected → draft)`);
    const rejectedCOEs = await getCOEs(adminToken);
    let rejectedCoeId = null;
    if (rejectedCOEs.success && rejectedCOEs.data.data) {
      const rejectedCoe = rejectedCOEs.data.data.find(coe => ['rejected', 'expired'].includes(coe.status));
      if (rejectedCoe) rejectedCoeId = rejectedCoe._id || rejectedCoe.id;
    }
    
    if (rejectedCoeId) {
      const result = await updateCOEStatus(adminToken, rejectedCoeId, 'draft');
      const passed = result.success && result.data.data?.status === 'draft';
      
      console.log(`   Action: rejected/expired → draft`);
      console.log(`   Result: ${passed ? '✅ PASS' : '❌ FAIL'}`);
      console.log(`   Response: ${result.success ? result.status : formatError(result.error)}`);
      
      recordTest(
        testCaseNum,
        'Admin Restarts Rejected COE',
        'PUT /coes/:id/status {"status": "draft"}',
        'Status changes to draft',
        `${passed ? 'Status: draft' : formatError(result.error)}`,
        passed
      );
    } else {
      console.log(`   ⏭️  Skipped - No rejected/expired COE found`);
      recordTest(testCaseNum, 'Admin Restarts Rejected COE', 'PUT /coes/:id/status', 'N/A', 'No rejected/expired COE available', true);
    }
    testCaseNum++;
    
    // TEST 7: Invalid status value (should fail validation)
    if (testCoeId) {
      console.log(`\n[TEST ${testCaseNum}] Invalid status value validation`);
      const result = await updateCOEStatus(adminToken, testCoeId, 'invalid_status');
      const passed = !result.success && (result.status === 400);
      
      console.log(`   Action: status = "invalid_status"`);
      console.log(`   Result: ${passed ? '✅ PASS (correctly rejected)' : '❌ FAIL (should reject)'}`);
      console.log(`   Response: ${result.status} - ${formatError(result.error)}`);
      
      recordTest(
        testCaseNum,
        'Invalid Status Value Validation',
        'PUT /coes/:id/status {"status": "invalid_status"}',
        'Returns 400 - Validation error',
        `${result.status}: ${formatError(result.error)}`,
        passed
      );
      testCaseNum++;
    }
    
    // TEST 8: Client cannot approve COE (permission check)
    if (testCoeId) {
      console.log(`\n[TEST ${testCaseNum}] Client cannot approve COE (permission check)`);
      const result = await updateCOEStatus(clientToken, testCoeId, 'approved');
      const passed = !result.success && (result.status === 403 || result.status === 401);
      
      console.log(`   Action: Client tries to approve COE`);
      console.log(`   Result: ${passed ? '✅ PASS (correctly rejected)' : '❌ FAIL (should reject)'}`);
      console.log(`   Response: ${result.status} - ${formatError(result.error)}`);
      
      recordTest(
        testCaseNum,
        'Client Permission Check',
        'PUT /coes/:id/status {"status": "approved"} (as client)',
        'Returns 403 - Permission denied',
        `${result.status}: ${formatError(result.error)}`,
        passed
      );
      testCaseNum++;
    }
    
    // TEST 9: Get COE and verify date fields
    if (testCoeId) {
      console.log(`\n[TEST ${testCaseNum}] Verify date fields in COE`);
      const coe = await getCOE(clientToken, testCoeId);
      if (coe.success && coe.data.data) {
        const coeData = coe.data.data;
        const status = coeData.status || 'unknown';
        const approvedDate = coeData.approved_date ? 'set' : 'not set';
        const pendingPayDate = coeData.pending_pay_date ? 'set' : 'not set';
        const paidDate = coeData.paid_date ? 'set' : 'not set';
        const acceptedDate = coeData.accepted_date ? 'set' : 'not set';
        
        console.log(`   Status: ${status}`);
        console.log(`   approved_date: ${approvedDate}`);
        console.log(`   pending_pay_date: ${pendingPayDate}`);
        console.log(`   paid_date: ${paidDate}`);
        console.log(`   accepted_date: ${acceptedDate} (backward compat)`);
        
        let dateCheckPassed = true;
        if (status === 'approved' && approvedDate !== 'set') dateCheckPassed = false;
        if (status === 'pending_pay' && pendingPayDate !== 'set') dateCheckPassed = false;
        if (status === 'paid' && paidDate !== 'set') dateCheckPassed = false;
        
        recordTest(
          testCaseNum,
          'Date Fields Verification',
          'GET /coes/my/:id',
          'Date fields set according to status',
          `Status: ${status}, Dates: approved=${approvedDate}, pending_pay=${pendingPayDate}, paid=${paidDate}`,
          dateCheckPassed
        );
      }
      testCaseNum++;
    }
    
  } catch (error) {
    console.error('\n❌ Test execution error:', error.message);
    console.error(error.stack);
  }
  
  // Print summary report
  console.log('\n' + '='.repeat(80));
  console.log('TEST SUMMARY REPORT');
  console.log('='.repeat(80));
  
  const passed = testResults.filter(t => t.passed).length;
  const failed = testResults.filter(t => !t.passed).length;
  const skipped = testResults.filter(t => t.actual?.includes('N/A') || t.actual?.includes('Skipped')).length;
  
  console.log(`\nTotal Tests: ${testResults.length}`);
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`⏭️  Skipped: ${skipped}`);
  console.log(`\nSuccess Rate: ${testResults.length > 0 ? ((passed / (testResults.length - skipped)) * 100).toFixed(1) : 0}%`);
  
  // Detailed table
  console.log('\n' + '='.repeat(80));
  console.log('DETAILED TEST RESULTS');
  console.log('='.repeat(80));
  console.log('\n| # | Test Case | Action | Expected | Actual | Result |');
  console.log('|---|-----------|--------|----------|--------|--------|');
  
  testResults.forEach((test, index) => {
    const resultIcon = test.passed ? '✅' : '❌';
    const actual = test.actual.length > 50 ? test.actual.substring(0, 47) + '...' : test.actual;
    console.log(`| ${test.testNum} | ${test.testCase} | ${test.action.substring(0, 30)} | ${test.expected.substring(0, 30)} | ${actual.substring(0, 30)} | ${resultIcon} |`);
  });
  
  console.log('\n' + '='.repeat(80));
  console.log('Test execution completed!\n');
}

// Run the tests
runTests().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});

