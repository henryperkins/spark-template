/**
 * CORS Test Script for Azure Search
 * 
 * This script helps verify CORS configuration for your Azure Search service.
 * Run this in your browser console at https://paradigmfind.com
 */

// Configuration
const CONFIG = {
  endpoint: 'https://thesearch.search.windows.net',
  indexName: 'documents',
  apiVersion: '2025-08-01-preview',
  // Replace with your actual API key for testing
  apiKey: 'YOUR_API_KEY_HERE'
};

/**
 * Test CORS configuration with detailed diagnostics
 */
async function testAzureSearchCORS() {
  console.log('🔍 Testing Azure Search CORS Configuration...\n');
  
  const url = `${CONFIG.endpoint}/indexes/${CONFIG.indexName}/docs/search?api-version=${CONFIG.apiVersion}`;
  
  console.log('📍 Endpoint:', CONFIG.endpoint);
  console.log('📄 Index:', CONFIG.indexName);
  console.log('🔖 API Version:', CONFIG.apiVersion);
  console.log('🌐 Origin:', window.location.origin);
  console.log('');
  
  try {
    console.log('🚀 Making test request...');
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'api-key': CONFIG.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        search: '*',
        top: 1,
        count: false
      })
    });
    
    if (response.ok) {
      const data = await response.json();
      console.log('✅ SUCCESS! CORS is properly configured.');
      console.log('📊 Response:', data);
      return true;
    } else {
      console.error('❌ HTTP Error:', response.status, response.statusText);
      const errorText = await response.text();
      console.error('📨 Error Details:', errorText);
      return false;
    }
    
  } catch (error) {
    console.error('❌ CORS Error Detected!');
    console.error('📝 Error Message:', error.message);
    console.error('');
    
    if (error.message.includes('Failed to fetch') || error.message.includes('CORS')) {
      console.log('🔧 CORS Configuration Required:');
      console.log('');
      console.log('1. Go to Azure Portal:');
      console.log('   https://portal.azure.com/#blade/HubsExtension/BrowseResource/resourceType/Microsoft.Search%2FsearchServices');
      console.log('');
      console.log('2. Select your Search service: "thesearch"');
      console.log('');
      console.log('3. Navigate to: Settings → CORS');
      console.log('');
      console.log('4. Add the following origin:');
      console.log(`   ${window.location.origin}`);
      console.log('');
      console.log('5. Check "Allow credentials" if using authentication');
      console.log('');
      console.log('6. Click Save and wait 2-3 minutes for propagation');
      console.log('');
      console.log('💡 Alternative: Enable proxy mode');
      console.log('   Set VITE_AZURE_SEARCH_PROXY=true in your environment');
    }
    
    return false;
  }
}

/**
 * Check if CORS preflight request works
 */
async function testPreflightRequest() {
  console.log('🔍 Testing CORS Preflight Request...\n');
  
  const url = `${CONFIG.endpoint}/indexes/${CONFIG.indexName}/docs/search?api-version=${CONFIG.apiVersion}`;
  
  try {
    const response = await fetch(url, {
      method: 'OPTIONS',
      headers: {
        'Origin': window.location.origin,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'Content-Type, api-key'
      }
    });
    
    console.log('📊 Preflight Response Status:', response.status);
    console.log('📋 Preflight Response Headers:');
    for (const [key, value] of response.headers.entries()) {
      console.log(`  ${key}: ${value}`);
    }
    
    const allowOrigin = response.headers.get('Access-Control-Allow-Origin');
    if (allowOrigin === window.location.origin || allowOrigin === '*') {
      console.log('✅ Preflight check PASSED');
      return true;
    } else {
      console.error('❌ Preflight check FAILED');
      console.error('Expected Origin:', window.location.origin);
      console.error('Got:', allowOrigin);
      return false;
    }
    
  } catch (error) {
    console.error('❌ Preflight request failed:', error.message);
    return false;
  }
}

/**
 * Run all tests
 */
async function runAllTests() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║   Azure Search CORS Configuration Test                    ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');
  
  // Test 1: Preflight
  console.log('📋 Test 1: CORS Preflight Request');
  console.log('─────────────────────────────────');
  const preflightOk = await testPreflightRequest();
  console.log('');
  
  // Test 2: Actual request
  console.log('📋 Test 2: Actual Search Request');
  console.log('────────────────────────────────');
  const requestOk = await testAzureSearchCORS();
  console.log('');
  
  // Summary
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║   Test Summary                                            ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log(`Preflight Test: ${preflightOk ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`Request Test:   ${requestOk ? '✅ PASS' : '❌ FAIL'}`);
  console.log('');
  
  if (preflightOk && requestOk) {
    console.log('🎉 All tests passed! CORS is properly configured.');
  } else {
    console.log('🔧 CORS configuration needed. Follow the instructions above.');
  }
  
  return preflightOk && requestOk;
}

// Export for use in browser console
window.testAzureCORS = {
  runAllTests,
  testAzureSearchCORS,
  testPreflightRequest,
  CONFIG
};

console.log('✅ CORS Test Script Loaded!');
console.log('');
console.log('Available commands:');
console.log('• testAzureCORS.runAllTests() - Run all CORS tests');
console.log('• testAzureCORS.testAzureSearchCORS() - Test search request');
console.log('• testAzureCORS.testPreflightRequest() - Test preflight request');
console.log('');
console.log('💡 Quick start: testAzureCORS.runAllTests()');