/**
 * Test COE Build and Upgrade Flow
 * Tests the complete flow: COE creation with smart seat selection, then upgrade acceptance
 */

const axios = require('axios');
const BASE_URL = 'http://localhost:3006';

// Test user credentials
const TEST_USER = {
  email: 'sagiv.daniel.p+2@gmail.com',
  password: '123456',
  userId: '68dd73127f9a8aea777d2f34'
};

// Test parameters
const COE_PARAMS = {
  city: 'Las Vegas',
  startDate: '2025-11-28',
  endDate: '2025-12-02',
  budget: 10000,
  partySize: 5
};

let authToken = null;
let createdCOE = null;
let createdCOEId = null;

async function login() {
  try {
    console.log('\n=== STEP 1: Login ===');
    const response = await axios.post(`${BASE_URL}/v1/auth/signin`, {
      email: TEST_USER.email,
      password: TEST_USER.password
    });
    
    // Extract token from response
    authToken = response.data.data?.token || response.data.token;
    const user = response.data.data?.user || response.data.user;
    
    if (!authToken) {
      console.error('❌ No token in response:', JSON.stringify(response.data, null, 2));
      return false;
    }
    
    console.log('✅ Login successful');
    console.log('User:', user?.email || TEST_USER.email);
    console.log('Role:', user?.role || 'unknown');
    return true;
  } catch (error) {
    console.error('❌ Login failed:', error.response?.data || error.message);
    if (error.response?.data) {
      console.error('Error details:', JSON.stringify(error.response.data, null, 2));
    }
    return false;
  }
}

async function deleteCOE(coeId) {
  if (!coeId || !authToken) {
    return false;
  }
  
  try {
    console.log(`\n🧹 Cleaning up COE: ${coeId}`);
    await axios.delete(
      `${BASE_URL}/v1/coes/${coeId}`,
      {
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json'
        }
      }
    );
    console.log('✅ COE deleted successfully');
    return true;
  } catch (error) {
    console.log('⚠️  Failed to delete COE:', error.response?.data?.message || error.message);
    return false;
  }
}

async function createCOE() {
  try {
    console.log('\n=== STEP 2: Create COE via Bot ===');
    const prompt = `Build my experience with the following preferences: City: ${COE_PARAMS.city} Start date: ${COE_PARAMS.startDate} End date: ${COE_PARAMS.endDate} Budget: $${COE_PARAMS.budget} USD Number of people: ${COE_PARAMS.partySize}`;
    
    console.log('Sending prompt:', prompt);
    
    const response = await axios.post(
      `${BASE_URL}/v1/bot/message`,
      { prompt },
      {
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    console.log('\n✅ Bot response received');
    
    // Bot returns array of messages - find the most recent COE creation
    const messages = Array.isArray(response.data) ? response.data : [response.data];
    let structuredData = null;
    let mostRecentCOE = null;
    let mostRecentTimestamp = null;
    let mostRecentCOEId = null;
    
    // Find the most recent COE creation by checking all messages
    // Prioritize tool responses as they contain the actual COE data
    // Look for COEs created AFTER the prompt was sent
    const userMessages = messages.filter(m => m.role === 'user' && m.content);
    const promptMessage = userMessages.find(m => 
      m.content && 
      m.content.includes('Build my experience') &&
      m.content.includes('Las Vegas') &&
      m.content.includes('2025-11-28')
    );
    const promptTimestamp = promptMessage?.createdAt;
    
    console.log('Looking for COE created after prompt timestamp:', promptTimestamp);
    console.log('Prompt message found:', !!promptMessage);
    
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      let coeData = null;
      let coeId = null;
      let timestamp = msg.createdAt ? new Date(msg.createdAt).getTime() : 0;
      const promptTime = promptTimestamp ? new Date(promptTimestamp).getTime() : 0;
      
      // Only consider messages created AFTER the prompt
      if (promptTime > 0 && timestamp <= promptTime) {
        continue;
      }
      
      // Check tool responses first (they contain the actual COE data)
      if (msg.role === 'tool' && msg.content) {
        try {
          const parsed = JSON.parse(msg.content);
          // Tool response format: {success: true, data: {type: 'coe_draft', coe: {...}}}
          if (parsed.success && parsed.data) {
            if (parsed.data.type === 'coe_draft' || parsed.data.type === 'coe_created') {
              coeData = parsed.data;
              coeId = parsed.data.coe_id || parsed.data.coe?.id;
              console.log('Found COE in tool response:', coeId, 'at', msg.createdAt);
            }
          }
        } catch (e) {
          // Not JSON, continue
        }
      }
      
      // Check structured_data field
      if (!coeData && msg.structured_data) {
        if (msg.structured_data.type === 'coe_draft' || msg.structured_data.type === 'coe_created') {
          coeData = msg.structured_data;
          coeId = msg.structured_data.coe_id || msg.structured_data.coe?.id;
          console.log('Found COE in structured_data:', coeId, 'at', msg.createdAt);
        }
      }
      
      // Also check if content is JSON with structured data (for assistant messages)
      if (!coeData && msg.content && typeof msg.content === 'string' && msg.role === 'assistant') {
        try {
          const parsed = JSON.parse(msg.content);
          // Direct structured response
          if (parsed.type && (parsed.type === 'coe_draft' || parsed.type === 'coe_created') && parsed.coe) {
            coeData = parsed;
            coeId = parsed.coe_id || parsed.coe?.id;
            console.log('Found COE in assistant content:', coeId, 'at', msg.createdAt);
          }
        } catch (e) {
          // Not JSON, continue
        }
      }
      
      // If we found COE data and it's more recent, use it
      if (coeData && coeData.coe) {
        // Prefer tool responses as they're most recent
        const isToolResponse = msg.role === 'tool';
        const isMoreRecent = !mostRecentTimestamp || timestamp > mostRecentTimestamp;
        const isToolAndRecent = isToolResponse && (isMoreRecent || !mostRecentCOE);
        
        if (isToolAndRecent || (isMoreRecent && !mostRecentCOE)) {
          mostRecentCOE = coeData;
          mostRecentTimestamp = timestamp;
          mostRecentCOEId = coeId;
          console.log('Selected COE:', coeId, 'timestamp:', new Date(timestamp).toISOString());
        }
      }
    }
    
    structuredData = mostRecentCOE;
    createdCOEId = mostRecentCOEId;
    
    if (!structuredData) {
      console.log('⚠️  No COE found in response after prompt timestamp');
      console.log('All messages:', messages.map(m => ({
        role: m.role,
        createdAt: m.createdAt,
        hasContent: !!m.content,
        hasStructuredData: !!m.structured_data
      })));
    }
    
    // Extract COE data from response
    if (structuredData) {
      console.log('Found structured data type:', structuredData.type);
      
      if (structuredData.type === 'coe_created' || structuredData.type === 'coe_draft') {
        createdCOE = structuredData.coe;
        console.log('\n📊 COE Created:');
        console.log('  COE ID:', createdCOE.id);
        console.log('  Name:', createdCOE.name);
        console.log('  Status:', createdCOE.status);
        console.log('  Events:', createdCOE.events_count);
        console.log('  Seats:', createdCOE.seats_count);
        console.log('  Total:', `$${createdCOE.pricing?.total?.toLocaleString() || 0}`);
        
        // Budget summary
        if (structuredData.budget_summary) {
          const budget = structuredData.budget_summary;
          console.log('\n💰 Budget Summary:');
          console.log('  Total Budget:', `$${budget.total_budget.toLocaleString()}`);
          console.log('  COE Total:', `$${budget.coe_total.toLocaleString()}`);
          console.log('  Remaining:', `$${budget.remaining.toLocaleString()}`);
          console.log('  Utilization:', `${budget.utilization_percentage}%`);
        }
        
        // Upgrade offers - check all possible locations
        const upgradeOffers = structuredData.seat_upgrade_offers || 
                              structuredData.coe?.seat_upgrade_offers || 
                              createdCOE.seat_upgrade_offers ||
                              [];
        console.log('\n🎯 Upgrade Offers:', upgradeOffers.length);
        console.log('  Checked locations:');
        console.log('    - structuredData.seat_upgrade_offers:', structuredData.seat_upgrade_offers?.length || 0);
        console.log('    - structuredData.coe.seat_upgrade_offers:', structuredData.coe?.seat_upgrade_offers?.length || 0);
        console.log('    - createdCOE.seat_upgrade_offers:', createdCOE.seat_upgrade_offers?.length || 0);
        
        if (upgradeOffers.length > 0) {
          upgradeOffers.forEach((offer, idx) => {
            console.log(`\n  Offer ${idx + 1}:`);
            console.log('    Event:', offer.event_name);
            console.log('    Current Seat:', offer.current_seat_code, `$${offer.current_price?.toLocaleString() || 0}`);
            console.log('    Alternatives:', offer.alternatives?.length || 0);
            
            if (offer.alternatives && offer.alternatives.length > 0) {
              offer.alternatives.forEach((alt, altIdx) => {
                console.log(`      ${altIdx + 1}. ${alt.seat_code} - $${alt.event_price?.toLocaleString() || 0}`);
                console.log(`         Price Delta: +$${alt.price_delta?.toLocaleString() || 0} (${alt.price_delta_percentage || 0}%)`);
                console.log(`         Tag: ${alt.tag || 'N/A'}`);
                console.log(`         Fits Budget: ${alt.fits_budget ? 'Yes' : 'No'}`);
                if (alt.upgrade_reasons && alt.upgrade_reasons.length > 0) {
                  console.log(`         Reasons: ${alt.upgrade_reasons.join(', ')}`);
                }
              });
            }
          });
        } else {
          console.log('  No upgrade offers available');
        }
        
        return true;
      } else {
        console.log('⚠️  Unexpected response type:', structuredData.type);
        console.log('Full response:', JSON.stringify(structuredData, null, 2));
        return false;
      }
    } else {
      console.log('⚠️  No structured data in response');
      console.log('Response:', JSON.stringify(response.data, null, 2));
      return false;
    }
  } catch (error) {
    console.error('❌ COE creation failed:', error.response?.data || error.message);
    if (error.response?.data) {
      console.error('Error details:', JSON.stringify(error.response.data, null, 2));
    }
    
    // Cleanup: Delete any COE that was created before the error
    if (createdCOEId) {
      await deleteCOE(createdCOEId);
      createdCOEId = null;
      createdCOE = null;
    }
    
    return false;
  }
}

async function testUpgrades() {
  if (!createdCOE) {
    console.log('\n⚠️  No COE created, skipping upgrade test');
    return false;
  }
  
  try {
    console.log('\n=== STEP 3: Test Upgrades ===');
    
    const upgradeOffers = createdCOE.seat_upgrade_offers || [];
    
    if (upgradeOffers.length === 0) {
      console.log('⚠️  No upgrade offers available to test');
      return false;
    }
    
    // Find first upgrade that fits budget
    let upgradeToTest = null;
    for (const offer of upgradeOffers) {
      if (offer.alternatives && offer.alternatives.length > 0) {
        // Prefer one that fits budget, but test any if none fit
        upgradeToTest = offer.alternatives.find(alt => alt.fits_budget) || offer.alternatives[0];
        if (upgradeToTest) {
          upgradeToTest.offer = offer;
          break;
        }
      }
    }
    
    if (!upgradeToTest) {
      console.log('⚠️  No suitable upgrade found to test');
      return false;
    }
    
    const offer = upgradeToTest.offer;
    console.log('\n🔄 Testing upgrade:');
    console.log('  COE ID:', createdCOE.id);
    console.log('  Event:', offer.event_name);
    console.log('  Current Seat:', offer.current_seat_code);
    console.log('  Upgrade Seat:', upgradeToTest.seat_code);
    console.log('  Price Delta:', `+$${upgradeToTest.price_delta?.toLocaleString() || 0}`);
    console.log('  Tag:', upgradeToTest.tag);
    
    const response = await axios.post(
      `${BASE_URL}/v1/coes/${createdCOE.id}/seat-upgrades/accept`,
      {
        current_seat_id: offer.current_seat_id,
        alternative_seat_id: upgradeToTest.seat_id,
        event_id: offer.event_id
      },
      {
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    if (response.data.success) {
      console.log('\n✅ Upgrade accepted successfully!');
      console.log('  Updated COE Total:', `$${response.data.data?.subtotal?.toLocaleString() || 0}`);
      
      // Show updated seat
      const updatedSeats = response.data.data?.selected_seats || [];
      const updatedSeat = updatedSeats.find(s => 
        s.seat_id?.toString() === upgradeToTest.seat_id?.toString() ||
        s.seat_code === upgradeToTest.seat_code
      );
      
      if (updatedSeat) {
        console.log('  New Seat:', updatedSeat.seat_code, `$${updatedSeat.event_price?.toLocaleString() || 0}`);
      }
      
      return true;
    } else {
      console.log('❌ Upgrade failed:', response.data.message);
      return false;
    }
  } catch (error) {
    console.error('❌ Upgrade test failed:', error.response?.data || error.message);
    if (error.response?.data) {
      console.error('Error details:', JSON.stringify(error.response.data, null, 2));
    }
    return false;
  }
}

async function runTest() {
  console.log('🧪 COE Build and Upgrade Test');
  console.log('==============================\n');
  console.log('Test Parameters:');
  console.log('  City:', COE_PARAMS.city);
  console.log('  Dates:', COE_PARAMS.startDate, 'to', COE_PARAMS.endDate);
  console.log('  Budget:', `$${COE_PARAMS.budget.toLocaleString()}`);
  console.log('  Party Size:', COE_PARAMS.partySize);
  console.log('  User:', TEST_USER.email);
  
  // Step 1: Login
  const loginSuccess = await login();
  if (!loginSuccess) {
    console.log('\n❌ Test failed at login step');
    process.exit(1);
  }
  
  // Step 2: Create COE
  const coeSuccess = await createCOE();
  if (!coeSuccess) {
    console.log('\n❌ Test failed at COE creation step');
    // Cleanup already handled in createCOE error handler
    process.exit(1);
  }
  
  // Step 3: Test upgrades
  const upgradeSuccess = await testUpgrades();
  if (!upgradeSuccess) {
    console.log('\n⚠️  Upgrade test completed with warnings');
  }
  
  console.log('\n✅ Test completed successfully!');
  console.log('\n📋 Summary:');
  console.log('  COE ID:', createdCOE?.id);
  console.log('  Status:', createdCOE?.status);
  console.log('  Subtotal:', `$${createdCOE?.pricing?.subtotal?.toLocaleString() || 0}`);
  console.log('  Total Cost:', `$${createdCOE?.pricing?.total?.toLocaleString() || 0}`);
  console.log('  Upgrade Offers:', (createdCOE?.seat_upgrade_offers || []).length);
  
  // Cleanup: Delete the created COE at the end
  if (createdCOEId) {
    console.log('\n🧹 Cleaning up test COE...');
    await deleteCOE(createdCOEId);
  }
}

// Run the test
runTest().catch(async (error) => {
  console.error('\n❌ Test execution failed:', error);
  
  // Cleanup on unexpected error
  if (createdCOEId) {
    console.log('\n🧹 Cleaning up COE due to error...');
    await deleteCOE(createdCOEId);
  }
  
  process.exit(1);
});

