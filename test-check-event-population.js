/**
 * Test script to check event population after replacement
 */

const axios = require('axios');
const BASE_URL = process.env.BASE_URL || 'http://localhost:3006';

async function testEventPopulation() {
  try {
    console.log('=== Testing Event Population ===\n');
    
    // Login as user
    console.log('Step 1: Logging in as user...');
    const loginResponse = await axios.post(`${BASE_URL}/v1/auth/signin`, {
      email: 'sagiv.daniel.p+2@gmail.com',
      password: '123456'
    });
    
    if (!loginResponse.data.success) {
      console.error('❌ Login failed:', loginResponse.data.error);
      return;
    }
    
    const token = loginResponse.data.data.token;
    console.log('✅ Login successful\n');
    
    // Get user's COEs
    console.log('Step 2: Getting user COEs...');
    const coesResponse = await axios.get(
      `${BASE_URL}/v1/coes/my`,
      {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      }
    );
    
    if (!coesResponse.data.success || !coesResponse.data.data || coesResponse.data.data.length === 0) {
      console.error('❌ No COEs found');
      return;
    }
    
    const coes = coesResponse.data.data;
    console.log(`✅ Found ${coes.length} COE(s)\n`);
    
    // Check each COE's events
    coes.forEach((coe, index) => {
      console.log(`\nCOE ${index + 1}: ${coe.name || coe._id}`);
      console.log(`  Status: ${coe.status}`);
      console.log(`  Events count: ${coe.events?.length || 0}`);
      
      if (coe.events && coe.events.length > 0) {
        coe.events.forEach((event, eventIndex) => {
          const eventId = event.event_id?._id?.toString() || event.event_id?.toString() || event.event_id;
          const eventName = event.event_id?.name || 'NOT POPULATED';
          const eventIdType = typeof event.event_id;
          const isObject = typeof event.event_id === 'object' && event.event_id !== null;
          const hasName = !!(event.event_id?.name);
          
          console.log(`  Event ${eventIndex + 1}:`);
          console.log(`    Event ID: ${eventId}`);
          console.log(`    Event Name: ${eventName}`);
          console.log(`    Event ID Type: ${eventIdType}`);
          console.log(`    Is Object: ${isObject}`);
          console.log(`    Has Name: ${hasName}`);
          console.log(`    Event ID Keys: ${event.event_id && typeof event.event_id === 'object' ? Object.keys(event.event_id).join(', ') : 'N/A'}`);
          
          if (!hasName) {
            console.log(`    ⚠️  WARNING: Event is not populated!`);
          }
        });
      }
    });
    
    // Get a specific COE by ID to check getCOEById
    if (coes.length > 0) {
      const firstCoeId = coes[0]._id || coes[0].id;
      console.log(`\n\nStep 3: Getting COE ${firstCoeId} using getCOEById...`);
      
      const coeDetailResponse = await axios.get(
        `${BASE_URL}/v1/coes/my/${firstCoeId}`,
        {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        }
      );
      
      if (coeDetailResponse.data.success && coeDetailResponse.data.data) {
        const coe = coeDetailResponse.data.data;
        console.log(`✅ COE loaded: ${coe.name || coe._id}`);
        console.log(`  Events count: ${coe.events?.length || 0}`);
        
        if (coe.events && coe.events.length > 0) {
          coe.events.forEach((event, eventIndex) => {
            const eventId = event.event_id?._id?.toString() || event.event_id?.toString() || event.event_id;
            const eventName = event.event_id?.name || 'NOT POPULATED';
            const hasName = !!(event.event_id?.name);
            
            console.log(`  Event ${eventIndex + 1}: ${eventName} (ID: ${eventId})`);
            if (!hasName) {
              console.log(`    ⚠️  WARNING: Event is not populated even after getCOEById!`);
            }
          });
        }
      }
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    if (error.response) {
      console.error('   Status:', error.response.status);
      console.error('   Data:', JSON.stringify(error.response.data, null, 2));
    }
    process.exit(1);
  }
}

testEventPopulation();








