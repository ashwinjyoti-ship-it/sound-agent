import dotenv from 'dotenv';
dotenv.config();

export const KIMI_API_KEY = process.env.KIMI_API_KEY || '';
export const KIMI_API_URL = 'https://api.moonshot.cn/v1/chat/completions';
export const ORCHESTRATOR_URL = 'https://ncpa-orchestrator.ashwinjyoti.workers.dev';
export const ORCHESTRATOR_TOKEN = process.env.ORCHESTRATOR_TOKEN || '';
export const PORT = parseInt(process.env.PORT || '3000', 10);
export const FRONTEND_URL = process.env.FRONTEND_URL || 'https://sound-agent.pages.dev';

if (!KIMI_API_KEY) console.warn('KIMI_API_KEY not set');
if (!ORCHESTRATOR_TOKEN) console.warn('ORCHESTRATOR_TOKEN not set');
