import express from 'express';
import cors from 'cors';
import { PORT, FRONTEND_URL } from './config';
import { chatRoute } from './routes/chat';

const app = express();

// CORS — allow the Pages frontend
app.use(cors({
  origin: [FRONTEND_URL, 'http://localhost:3000', 'http://localhost:5173'],
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json());

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'sound-agent-api' });
});

// Main chat endpoint
app.use('/api/chat', chatRoute);

// 404
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Server error:', err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`Sound Agent API running on port ${PORT}`);
  console.log(`CORS origin: ${FRONTEND_URL}`);
});
