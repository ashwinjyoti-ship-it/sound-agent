import express from 'express';
import { CLAUDE_API_KEY, ORCHESTRATOR_TOKEN } from '../config';
import { chatWithClaude } from '../services/claude';
import { OrchestratorClient } from '../services/orchestrator';

const router = express.Router();

router.post('/', async (req, res) => {
  try {
    const { messages } = req.body;

    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'messages array required' });
    }

    if (!CLAUDE_API_KEY || !ORCHESTRATOR_TOKEN) {
      return res.status(500).json({ error: 'Server not configured: missing API keys' });
    }

    const orchestrator = new OrchestratorClient(ORCHESTRATOR_TOKEN);
    const reply = await chatWithClaude(messages, orchestrator);

    res.json({ reply });
  } catch (err: any) {
    console.error('Chat error:', err);
    res.status(500).json({ error: err.message || 'Chat failed' });
  }
});

export { router as chatRoute };
