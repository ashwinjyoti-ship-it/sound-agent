import express from 'express';
import { CLAUDE_API_KEY, GEMINI_API_KEY, ORCHESTRATOR_TOKEN } from '../config';
import { chatWithClaude } from '../services/claude';
import { chatWithGemini } from '../services/gemini';
import { OrchestratorClient } from '../services/orchestrator';

const router = express.Router();

// Matches errors that warrant falling back to Gemini
const isClaudeUnavailable = (msg: string) =>
  /Claude API (4\d\d|5\d\d|unreachable)|fetch failed|ECONNREFUSED|ENOTFOUND|network/i.test(msg);

router.get('/health', async (_req, res) => {
  const claudeStatus = await (async () => {
    if (!CLAUDE_API_KEY) return { ok: false, error: 'CLAUDE_API_KEY not set' };
    try {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': CLAUDE_API_KEY,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 10,
          messages: [{ role: 'user', content: 'hi' }],
        }),
      });
      const body = await r.json() as any;
      return { ok: r.ok, status: r.status, model: body.model, error: r.ok ? undefined : (body.error?.message || JSON.stringify(body)) };
    } catch (e: any) {
      return { ok: false, error: e.message };
    }
  })();

  res.json({
    claude: claudeStatus,
    gemini: { configured: !!GEMINI_API_KEY },
    orchestrator: { configured: !!ORCHESTRATOR_TOKEN },
  });
});

router.post('/', async (req, res) => {
  try {
    const { messages, activeTask } = req.body;

    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'messages array required' });
    }

    if (!CLAUDE_API_KEY || !ORCHESTRATOR_TOKEN) {
      return res.status(500).json({ error: 'Server not configured: missing API keys' });
    }

    const orchestrator = new OrchestratorClient(ORCHESTRATOR_TOKEN);

    let result: { reply: string; taskDone: boolean };
    try {
      result = await chatWithClaude(messages, orchestrator, activeTask);
    } catch (primaryErr: any) {
      if (isClaudeUnavailable(primaryErr.message || '') && GEMINI_API_KEY) {
        console.warn('Claude unavailable, falling back to Gemini:', primaryErr.message);
        result = await chatWithGemini(messages, orchestrator, activeTask);
      } else {
        throw primaryErr;
      }
    }

    res.json({ reply: result.reply, taskDone: result.taskDone });
  } catch (err: any) {
    console.error('Chat error:', err);
    const msg = (err.message || '');
    const reply = isClaudeUnavailable(msg)
      ? "AI's having a moment — Anthropic servers seem to be down. Try again in a bit."
      : 'Something went wrong on my end. Try again.';
    res.status(500).json({ error: msg, reply });
  }
});

export { router as chatRoute };
