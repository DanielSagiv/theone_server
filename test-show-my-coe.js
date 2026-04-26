/**
 * Test script to investigate "show my coe" issue
 * 
 * This script tests the flow:
 * 1. Login as client (sagiv.daniel.p+2@gmail.com)
 * 2. Send "show my coe" prompt
 * 3. Check if get_my_coes tool is called
 * 4. Check if structured_data is returned
 * 5. Check if coe_list type is in the response
 */

const axios = require('axios');
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

async function testShowMyCOE() {
  try {
    console.log('=== Testing "show my coe" flow ===\n');
    
    // Step 1: Login
    console.log('Step 1: Logging in as client...');
    const loginResponse = await axios.post(`${BASE_URL}/v1/auth/signin`, {
      email: 'sagiv.daniel.p+2@gmail.com',
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
    
    // Step 2: Send "show my coe" prompt
    console.log('Step 2: Sending "show my coe" prompt...');
    const botResponse = await axios.post(
      `${BASE_URL}/v1/bot/message`,
      { prompt: 'show my coe' },
      {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      }
    );
    
    console.log('✅ Bot response received');
    console.log('   Response status:', botResponse.status);
    console.log('   Response success:', botResponse.data.success);
    console.log('   Messages count:', botResponse.data.data?.length || 0);
    
    // Step 3: Check messages for structured data
    const messages = botResponse.data.data || [];
    console.log('\nStep 3: Analyzing messages...');
    
    let foundCOEList = false;
    let foundToolCall = false;
    let foundStructuredData = false;
    
    messages.forEach((msg, idx) => {
      console.log(`\nMessage ${idx + 1}:`, {
        role: msg.role,
        hasContent: !!msg.content,
        contentPreview: msg.content?.substring(0, 100),
        hasToolCalls: !!(msg.tool_calls && msg.tool_calls.length > 0),
        toolCallsCount: msg.tool_calls?.length || 0,
        hasStructuredData: !!msg.structured_data,
        structuredDataType: msg.structured_data?.type
      });
      
      // Check for tool calls
      if (msg.tool_calls && msg.tool_calls.length > 0) {
        foundToolCall = true;
        console.log('   🔧 Tool calls found:');
        msg.tool_calls.forEach(tc => {
          console.log(`      - ${tc.function?.name}(${tc.function?.arguments?.substring(0, 100)})`);
          if (tc.function?.name === 'get_my_coes') {
            console.log('      ✅ get_my_coes tool was called');
          }
        });
      }
      
      // Check for tool results
      if (msg.role === 'tool') {
        console.log('   🔧 Tool result:');
        try {
          const toolResult = JSON.parse(msg.content);
          console.log('      Success:', toolResult.success);
          console.log('      Has data:', !!toolResult.data);
          if (toolResult.data) {
            console.log('      Data type:', toolResult.data.type);
            if (toolResult.data.type === 'coe_list') {
              foundCOEList = true;
              console.log('      ✅ COE list found in tool result');
              console.log('      COEs count:', toolResult.data.coes?.length || 0);
            }
          }
          if (toolResult.error) {
            console.log('      Error:', toolResult.error.message);
          }
        } catch (e) {
          console.log('      ❌ Failed to parse tool result:', e.message);
        }
      }
      
      // Check for structured data in assistant message
      if (msg.role === 'assistant' && msg.structured_data) {
        foundStructuredData = true;
        console.log('   📋 Structured data found:');
        console.log('      Type:', msg.structured_data.type);
        if (msg.structured_data.type === 'coe_list') {
          foundCOEList = true;
          console.log('      ✅ COE list found in assistant message');
          console.log('      COEs count:', msg.structured_data.coes?.length || 0);
        }
      }
    });
    
    // Step 4: Summary
    console.log('\n=== Summary ===');
    console.log('Tool call detected:', foundToolCall ? '✅' : '❌');
    console.log('Structured data found:', foundStructuredData ? '✅' : '❌');
    console.log('COE list found:', foundCOEList ? '✅' : '❌');
    
    if (!foundCOEList) {
      console.log('\n❌ ISSUE: COE list not found in response');
      console.log('   This means the frontend will not render the COE card');
      console.log('   Possible causes:');
      console.log('   1. get_my_coes tool was not called');
      console.log('   2. Tool returned error');
      console.log('   3. Structured data not extracted from tool result');
      console.log('   4. Structured data not attached to assistant message');
    } else {
      console.log('\n✅ COE list found - should render correctly');
    }
    
    // Step 5: Check if user has COEs
    console.log('\nStep 5: Checking if user has COEs in database...');
    const coesCheck = await axios.get(
      `${BASE_URL}/v1/coes?client_id=${user._id}`,
      {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      }
    );
    
    if (coesCheck.data.success) {
      const coes = coesCheck.data.data?.coes || [];
      console.log(`   Found ${coes.length} COE(s) for this user`);
      if (coes.length > 0) {
        coes.forEach((coe, idx) => {
          console.log(`   COE ${idx + 1}:`, {
            id: coe._id,
            name: coe.name,
            status: coe.status,
            events_count: coe.events?.length || 0,
            seats_count: coe.selected_seats?.length || 0
          });
        });
      } else {
        console.log('   ⚠️  User has no COEs - this might be why no card is shown');
      }
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    if (error.response) {
      console.error('   Response status:', error.response.status);
      console.error('   Response data:', JSON.stringify(error.response.data, null, 2));
    } else if (error.request) {
      console.error('   No response received. Is the server running?');
      console.error('   Request URL:', error.config?.url);
    } else {
      console.error('   Error details:', error);
    }
    process.exit(1);
  }
}

// Run the test
testShowMyCOE();

