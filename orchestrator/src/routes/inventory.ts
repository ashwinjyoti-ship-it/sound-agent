import { Hono } from 'hono';
import type { Env } from '../index';
import type { NcpaDB } from '../lib/db';

type Variables = { db: NcpaDB };
const app = new Hono<{ Bindings: Env; Variables: Variables }>();

app.get('/equipment', async (c) => {
  const db = c.get('db');
  const items = await db.getEquipmentTypes();
  return c.json({ success: true, data: items, meta: { count: items.length } });
});

app.get('/venues', async (c) => {
  const db = c.get('db');
  const venues = await db.getVenues();
  return c.json({ success: true, data: venues });
});

app.get('/at-venue/:venueId', async (c) => {
  const db = c.get('db');
  const venueId = parseInt(c.req.param('venueId'));
  if (isNaN(venueId)) return c.json({ success: false, error: 'Invalid venueId' }, 400);
  const items = await db.getItemsAtVenue(venueId);
  return c.json({ success: true, data: items, meta: { count: items.length } });
});

app.get('/movements/:itemId', async (c) => {
  const db = c.get('db');
  const itemId = parseInt(c.req.param('itemId'));
  if (isNaN(itemId)) return c.json({ success: false, error: 'Invalid itemId' }, 400);
  const movements = await db.getMovementsForItem(itemId);
  return c.json({ success: true, data: movements });
});

export { app as inventoryRoutes };
