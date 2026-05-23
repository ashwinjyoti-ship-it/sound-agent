import dotenv from 'dotenv';
dotenv.config();

export const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY || '';
export const ORCHESTRATOR_URL = 'https://ncpa-orchestrator.ashwinjyoti.workers.dev';
export const ORCHESTRATOR_TOKEN = process.env.ORCHESTRATOR_TOKEN || '';
export const PORT = parseInt(process.env.PORT || '3000', 10);
export const FRONTEND_URL = process.env.FRONTEND_URL || 'https://sound-agent.pages.dev';
export const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
export const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';

if (!CLAUDE_API_KEY) console.warn('CLAUDE_API_KEY not set');
if (!ORCHESTRATOR_TOKEN) console.warn('ORCHESTRATOR_TOKEN not set');
if (!OPENAI_API_KEY) console.warn('OPENAI_API_KEY not set — /api/transcribe will be unavailable');
if (!GEMINI_API_KEY) console.warn('GEMINI_API_KEY not set — Gemini fallback will be unavailable');
