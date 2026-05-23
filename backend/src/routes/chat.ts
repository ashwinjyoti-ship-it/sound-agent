import express from 'express';
import { CLAUDE_API_KEY, ORCHESTRATOR_TOKEN } from '../config';
import { chatWithClaude } from '../services/claude';
import { OrchestratorClient } from '../services/orchestrator';

const router = express.Router();

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
    const result = await chatWithClaude(messages, orchestrator, activeTask);

    res.json({ reply: result.reply, taskDone: result.taskDone });
  } catch (err: any) {
    console.error('Chat error:', err);
    const msg = (err.message || '');
    const isAiDown = /Claude API (5\d\d|unreachable)|fetch failed|ECONNREFUSED|ENOTFOUND|network/i.test(msg);
    const reply = isAiDown
      ? "AI's having a moment — Anthropic servers seem to be down. Try again in a bit."
      : 'Something went wrong on my end. Try again.';
    res.status(500).json({ error: msg, reply });
  }
});

export { router as chatRoute };
