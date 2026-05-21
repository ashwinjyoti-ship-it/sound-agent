import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { NcpaDB } from './lib/db';
import { showRoutes } from './routes/shows';
import { crewRoutes } from './routes/crew';
import { scheduleRoutes } from './routes/schedule';
import { inventoryRoutes } from './routes/inventory';
import { quoteRoutes } from './routes/quotes';

export interface Env {
  API_TOKEN: string;
  DB_SOUND: D1Database;
  DB_CREW: D1Database;
  DB_INVENTORY: D1Database;
}

type Variables = { db: NcpaDB };

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

app.use('/api/*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-API-Token'],
}));

app.get('/health', (c) => c.json({ status: 'ok', service: 'ncpa-orchestrator' }));

app.use('/api/*', async (c, next) => {
  const token = c.req.header('X-API-Token');
  if (token !== c.env.API_TOKEN) {
    return c.json({ success: false, error: 'Unauthorized. Provide X-API-Token header.' }, 401);
  }
  await next();
});

app.use('/api/*', async (c, next) => {
  c.set('db', new NcpaDB(c.env));
  await next();
});

app.route('/api/schedule', scheduleRoutes);
app.route('/api/crew', crewRoutes);
app.route('/api/shows', showRoutes);
app.route('/api/inventory', inventoryRoutes);
app.route('/api/quotes', quoteRoutes);

app.notFound((c) => c.json({ success: false, error: 'Endpoint not found' }, 404));
app.onError((err, c) => {
  console.error('Orchestrator error:', err);
  return c.json({ success: false, error: err.message || 'Internal server error' }, 500);
});

export default app;
