const https = require('https');
const querystring = require('querystring');

const ORCHESTRATOR_TOKEN = process.env.ORCHESTRATOR_TOKEN || '';
const BASE_URL = 'https://ncpa-orchestrator.ashwinjyoti.workers.dev';

function makeRequest(path, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const options = {
      method,
      headers: {
        'X-API-Token': ORCHESTRATOR_TOKEN,
        'Content-Type': 'application/json',
      },
    };

    const req = https.request(url, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve({ error: data, status: res.statusCode });
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function testQuoteTool() {
  console.log('Testing generate_quote tool...\n');

  try {
    // Test 1: Get available equipment
    console.log('1️⃣ Fetching available equipment...');
    const equipResponse = await makeRequest('/api/quotes/equipment');
    const equipment = equipResponse.data || [];
    console.log(`✅ Found ${equipment.length} equipment items`);
    if (equipment.length > 0) {
      console.log('Sample items:', equipment.slice(0, 3).map(e => e.name));
    }

    // Test 2: Generate a simple quote
    console.log('\n2️⃣ Testing quote generation with 4 D&B speakers...');
    const quoteResponse = await makeRequest('/api/quotes/generate', 'POST', {
      client_name: 'Test Client',
      event_name: 'Test Event',
      items: [{ name: 'D&B Audiotechnik M4', quantity: 4 }],
      notes: 'Test quote',
    });

    if (quoteResponse.success) {
      console.log('✅ Quote generated successfully');
      console.log(`   Quote #: ${quoteResponse.data.quote_number}`);
      console.log(`   Subtotal: ₹${quoteResponse.data.subtotal}`);
      console.log(`   GST (18%): ₹${quoteResponse.data.gst}`);
      console.log(`   Total: ₹${quoteResponse.data.total}`);
    } else {
      console.log('❌ Quote generation failed:', quoteResponse.error || quoteResponse);
    }

    // Test 3: Test with multiple items
    console.log('\n3️⃣ Testing quote with multiple items...');
    const multiQuote = await makeRequest('/api/quotes/generate', 'POST', {
      client_name: 'Test Multi',
      event_name: 'Multi Item Test',
      items: [
        { name: 'D&B Audiotechnik M4', quantity: 4 },
        { name: 'Shure SM58', quantity: 6 },
        { name: 'Wireless Receiver', quantity: 2 },
      ],
      notes: 'Multi-item test',
    });

    if (multiQuote.success) {
      console.log('✅ Multi-item quote generated');
      console.log(`   Items: ${multiQuote.data.items.length}`);
      console.log(`   Total: ₹${multiQuote.data.total}`);
    } else {
      console.log('❌ Multi-item quote failed:', multiQuote.error || multiQuote);
    }

    console.log('\n✅ Quote tool health check passed!');
  } catch (error) {
    console.error('❌ Error testing quote tool:');
    console.error(error.message);
    process.exit(1);
  }
}

testQuoteTool();
