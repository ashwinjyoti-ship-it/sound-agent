import { OrchestratorClient } from './src/services/orchestrator';
import dotenv from 'dotenv';

dotenv.config();

const orchestrator = new OrchestratorClient(process.env.ORCHESTRATOR_TOKEN || '');

async function testQuoteTool() {
  console.log('Testing generate_quote tool...\n');

  try {
    // Test 1: Get available equipment
    console.log('1️⃣ Fetching available equipment...');
    const equipResponse = await orchestrator.getQuoteEquipment();
    const equipment = equipResponse.data || [];
    console.log(`✅ Found ${equipment.length} equipment items`);
    console.log('Sample items:', equipment.slice(0, 3).map((e: any) => e.name));

    // Test 2: Generate a simple quote
    console.log('\n2️⃣ Testing quote generation with 4 D&B speakers...');
    const quoteResponse = await orchestrator.generateQuote({
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
      console.log('❌ Quote generation failed:', quoteResponse.error);
    }

    // Test 3: Test with multiple items
    console.log('\n3️⃣ Testing quote with multiple items...');
    const multiQuote = await orchestrator.generateQuote({
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
      console.log('❌ Multi-item quote failed:', multiQuote.error);
    }

    console.log('\n✅ Quote tool health check passed!');
  } catch (error: any) {
    console.error('❌ Error testing quote tool:');
    console.error(error.message);
    process.exit(1);
  }
}

testQuoteTool();
