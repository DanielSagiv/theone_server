/**
 * Test script to debug event replacement issue
 * 
 * This script:
 * 1. Logs in as admin
 * 2. Creates a COE for the specified client
 * 3. Gets the COE and finds an event to replace
 * 4. Gets alternative events
 * 5. Replaces the event
 * 6. Verifies the replacement worked
 */

const axios = require('axios');
const BASE_URL = process.env.BASE_URL || 'http://localhost:3006';

async function testReplaceEvent() {
  try {
    console.log('=== Testing Event Replacement ===\n');
    
    // Step 1: Login as admin
    console.log('Step 1: Logging in as admin...');
    const loginResponse = await axios.post(`${BASE_URL}/v1/auth/signin`, {
      email: 'sagiv.daniel.p@gmail.com',
      password: '123456'
    });
    
    if (!loginResponse.data.success) {
      console.error('❌ Login failed:', loginResponse.data.error);
      return;
    }
    
    const token = loginResponse.data.data.token;
    const user = loginResponse.data.data.user;
    console.log('✅ Login successful');
    console.log('   User ID:', user._id);
    console.log('   User Role:', user.role);
    console.log('   Token:', token.substring(0, 20) + '...\n');
    
    // Step 2: Get existing COE or create one
    console.log('Step 2: Checking for existing COE...');
    let coesResponse = await axios.get(
      `${BASE_URL}/v1/coes?client_id=68dd73127f9a8aea777d2f34&status=draft`,
      {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      }
    );
    
    let coe;
    let coeId;
    
    // Handle both response structures
    const existingCoesArray = Array.isArray(coesResponse.data.data) 
      ? coesResponse.data.data 
      : (coesResponse.data.data?.coes || []);
    
    if (coesResponse.data.success && existingCoesArray.length > 0) {
      coe = existingCoesArray[0];
      coeId = coe._id;
      console.log('✅ Found existing COE:', {
        id: coeId,
        name: coe.name,
        eventsCount: coe.events?.length || 0
      });
    } else {
      console.log('No existing COE found, creating via bot...');
      const createCoeResponse = await axios.post(
        `${BASE_URL}/v1/bot/message`,
        { 
          prompt: 'Create a COE draft using the following data: Client ID: 68dd73127f9a8aea777d2f34 Start date: 2025-12-14 End date: 2025-12-20 Budget: $18000 USD Number of people: 8'
        },
        {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        }
      );
      
      console.log('Bot response received, waiting 3 seconds...');
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      coesResponse = await axios.get(
        `${BASE_URL}/v1/coes?client_id=68dd73127f9a8aea777d2f34&status=draft`,
        {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        }
      );
      
      // Handle both response structures: { data: { coes: [...] } } or { data: [...] }
      const coesArray = Array.isArray(coesResponse.data.data) 
        ? coesResponse.data.data 
        : (coesResponse.data.data?.coes || []);
      
      if (!coesResponse.data.success || coesArray.length === 0) {
        console.error('❌ COE was not created');
        console.log('Response:', JSON.stringify(coesResponse.data, null, 2));
        return;
      }
      
      coe = coesArray[0];
      coeId = coe._id;
      console.log('✅ COE created:', {
        id: coeId,
        name: coe.name
      });
    }
    
    // Get full COE details
    const fullCoeResponse = await axios.get(
      `${BASE_URL}/v1/coes/${coeId}`,
      {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      }
    );
    
    if (!fullCoeResponse.data.success) {
      console.error('❌ Failed to get COE details');
      return;
    }
    
    const fullCoe = fullCoeResponse.data.data;
    console.log('✅ COE details:', {
      id: fullCoe._id,
      name: fullCoe.name,
      status: fullCoe.status,
      eventsCount: fullCoe.events?.length || 0,
      events: fullCoe.events?.map(e => ({
        event_id: e.event_id?.toString() || e.event_id,
        event_name: e.event_id?.name || 'Unknown',
        sequence: e.sequence
      })) || []
    });
    
    if (!fullCoe.events || fullCoe.events.length === 0) {
      console.error('❌ COE has no events to replace');
      return;
    }
    
    // Step 4: Get the first event and find alternatives
    const firstEvent = fullCoe.events[0];
    // Handle both populated and non-populated event_id
    const eventId = firstEvent.event_id?._id?.toString() || firstEvent.event_id?.toString() || firstEvent.event_id;
    const eventName = firstEvent.event_id?.name || 'Unknown';
    console.log('\nStep 4: Getting alternatives for event:', {
      eventId: eventId,
      eventName: eventName,
      eventIdType: typeof firstEvent.event_id,
      isObject: typeof firstEvent.event_id === 'object' && firstEvent.event_id !== null
    });
    
    const alternativesResponse = await axios.get(
      `${BASE_URL}/v1/coes/${coeId}/events/${eventId}/alternatives`,
      {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      }
    );
    
    if (!alternativesResponse.data.success || !alternativesResponse.data.data || alternativesResponse.data.data.length === 0) {
      console.error('❌ No alternatives found');
      return;
    }
    
    const alternatives = alternativesResponse.data.data;
    console.log('✅ Found alternatives:', alternatives.length);
    
    // Find "para test event"
    const paraTestEvent = alternatives.find(alt => 
      alt.name && alt.name.toLowerCase().includes('para')
    );
    
    if (!paraTestEvent) {
      console.log('⚠️  "para test event" not found, using first alternative');
      var selectedAlternative = alternatives[0];
    } else {
      var selectedAlternative = paraTestEvent;
    }
    
    console.log('Selected alternative:', {
      id: selectedAlternative._id,
      name: selectedAlternative.name
    });
    
    // Step 5: Replace the event
    console.log('\nStep 5: Replacing event...');
    const replaceResponse = await axios.put(
      `${BASE_URL}/v1/coes/${coeId}/events/${eventId}`,
      {
        new_event_id: selectedAlternative._id,
        preserve_seats: false
      },
      {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      }
    );
    
    if (!replaceResponse.data.success) {
      console.error('❌ Replace failed:', replaceResponse.data.error);
      return;
    }
    
    console.log('✅ Replace request successful');
    console.log('Response:', JSON.stringify(replaceResponse.data, null, 2));
    
    // Step 6: Verify the replacement
    console.log('\nStep 6: Verifying replacement...');
    const verifyResponse = await axios.get(
      `${BASE_URL}/v1/coes/${coeId}`,
      {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      }
    );
    
    if (!verifyResponse.data.success) {
      console.error('❌ Failed to get COE for verification');
      return;
    }
    
    const updatedCoe = verifyResponse.data.data;
    console.log('Updated COE events:', {
      eventsCount: updatedCoe.events?.length || 0,
      events: updatedCoe.events?.map(e => ({
        event_id: e.event_id?.toString() || e.event_id,
        event_name: e.event_id?.name || 'Unknown',
        sequence: e.sequence
      })) || []
    });
    
    // Check if old event is gone
    const hasOldEvent = updatedCoe.events?.some(e => {
      const eId = e.event_id?.toString() || e.event_id;
      return eId === eventId;
    });
    
    // Check if new event is present
    const hasNewEvent = updatedCoe.events?.some(e => {
      const eId = e.event_id?.toString() || e.event_id;
      return eId === selectedAlternative._id.toString();
    });
    
    console.log('\n=== Verification Results ===');
    console.log('Old event still present:', hasOldEvent ? '❌ YES (BUG!)' : '✅ NO');
    console.log('New event present:', hasNewEvent ? '✅ YES' : '❌ NO (BUG!)');
    console.log('Events count:', updatedCoe.events?.length || 0);
    
    if (hasOldEvent || !hasNewEvent) {
      console.log('\n❌ REPLACEMENT FAILED');
      console.log('Expected: Old event removed, new event added');
      console.log('Actual: Old event', hasOldEvent ? 'still present' : 'removed', ', New event', hasNewEvent ? 'present' : 'missing');
    } else {
      console.log('\n✅ REPLACEMENT SUCCESSFUL');
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    if (error.response) {
      console.error('   Status:', error.response.status);
      console.error('   Data:', JSON.stringify(error.response.data, null, 2));
    } else if (error.request) {
      console.error('   No response received');
    } else {
      console.error('   Error:', error);
    }
    process.exit(1);
  }
}

// Run the test
testReplaceEvent();

