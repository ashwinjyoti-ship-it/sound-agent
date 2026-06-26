import dotenv from 'dotenv';
import { CLAUDE_API_KEY } from './src/config';
import {
  CLAUDE_CACHE_CONTROL,
  CLAUDE_MODEL,
  TOOLS,
  buildSystemPrompt,
} from './src/services/claude';

dotenv.config();

const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';

async function callClaude(body: Record<string, unknown>) {
  const res = await fetch(CLAUDE_API_URL, {
    method: 'POST',
    headers: {
      'x-api-key': CLAUDE_API_KEY,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const data = await res.json() as any;
  if (!res.ok) {
    throw new Error(`Claude API ${res.status}: ${data.error?.message || JSON.stringify(data)}`);
  }
  return data;
}

async function main() {
  if (!CLAUDE_API_KEY) {
    console.error('CLAUDE_API_KEY not set — cannot test prompt caching');
    process.exit(1);
  }

  const nowIST = new Date(Date.now() + (5 * 60 + 30) * 60 * 1000);
  const today = nowIST.toISOString().slice(0, 10);
  const currentYear = nowIST.getUTCFullYear();
  const systemPrompt = buildSystemPrompt(today, currentYear, '');

  const body = {
    model: CLAUDE_MODEL,
    max_tokens: 64,
    cache_control: CLAUDE_CACHE_CONTROL,
    system: systemPrompt,
    messages: [{ role: 'user', content: 'Reply with exactly: cache test ok' }],
    tools: TOOLS,
    tool_choice: { type: 'auto' },
  };

  console.log('Request 1 (expect cache_creation_input_tokens > 0)...');
  const first = await callClaude(body);
  console.log('usage:', first.usage);

  console.log('\nRequest 2 (identical — expect cache_read_input_tokens > 0)...');
  const second = await callClaude(body);
  console.log('usage:', second.usage);

  const cacheRead = second.usage?.cache_read_input_tokens ?? 0;
  if (cacheRead <= 0) {
    console.error(`\nFAIL: cache_read_input_tokens=${cacheRead} on second request`);
    process.exit(1);
  }

  console.log(`\nPASS: cache_read_input_tokens=${cacheRead} on second request`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
