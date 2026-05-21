import { Hono } from 'hono';
import type { Env } from '../index';
import type { NcpaDB } from '../lib/db';

type Variables = { db: NcpaDB };
const app = new Hono<{ Bindings: Env; Variables: Variables }>();

app.get('/list', async (c) => {
  const db = c.get('db');
  const crew = await db.getAllCrew();
  return c.json({ success: true, data: crew, meta: { count: crew.length } });
});

app.get('/availability', async (c) => {
  const db = c.get('db');
  const date = c.req.query('date');
  if (!date) return c.json({ success: false, error: 'date query param required (YYYY-MM-DD)' }, 400);
  const availability = await db.getCrewAvailabilityOnDate(date);
  return c.json({ success: true, data: availability });
});

app.get('/assignments/:month', async (c) => {
  const db = c.get('db');
  const month = c.req.param('month');
  const assignments = await db.getAssignmentsForMonth(month);
  return c.json({ success: true, data: assignments, meta: { count: assignments.length } });
});

app.delete('/assignments', async (c) => {
  const db = c.get('db');
  const { event_ids } = await c.req.json();
  if (!Array.isArray(event_ids)) return c.json({ success: false, error: 'event_ids[] required' }, 400);
  await db.clearAssignmentsForEvents(event_ids);
  for (const id of event_ids) {
    await db.updateEvent(id, { crew: null as any, foh_crew: null as any, stage_crew: null as any });
  }
  return c.json({ success: true, data: { cleared: event_ids.length } });
});

app.get('/dayoffs', async (c) => {
  const db = c.get('db');
  const crewName = c.req.query('crew_name');
  const today = new Date().toISOString().slice(0, 10);
  let sql: string, params: any[];
  if (crewName) {
    sql = `SELECT cu.id, cu.crew_id, c.name as crew_name, cu.unavailable_date, cu.reason
           FROM crew_unavailability cu JOIN crew c ON c.id = cu.crew_id
           WHERE c.name = ? AND cu.unavailable_date >= ? ORDER BY cu.unavailable_date`;
    params = [crewName, today];
  } else {
    sql = `SELECT cu.id, cu.crew_id, c.name as crew_name, cu.unavailable_date, cu.reason
           FROM crew_unavailability cu JOIN crew c ON c.id = cu.crew_id
           WHERE cu.unavailable_date >= ? ORDER BY c.name, cu.unavailable_date`;
    params = [today];
  }
  const { results } = await (db as any).env.DB_CREW.prepare(sql).bind(...params).all();
  return c.json({ success: true, data: results });
});

app.post('/dayoffs', async (c) => {
  const db = c.get('db');
  const { crew_name, dates, reason } = await c.req.json();
  if (!crew_name || !Array.isArray(dates) || !dates.length) {
    return c.json({ success: false, error: 'crew_name and dates[] required' }, 400);
  }
  const { results: crewRows } = await (db as any).env.DB_CREW.prepare('SELECT id FROM crew WHERE name = ?').bind(crew_name).all() as { results: any[] };
  if (!crewRows.length) return c.json({ success: false, error: `Crew member not found: ${crew_name}` }, 404);
  const crewId = crewRows[0].id;
  const added: string[] = [], skipped: string[] = [];
  for (const date of dates) {
    const result = await (db as any).env.DB_CREW.prepare(
      'INSERT OR IGNORE INTO crew_unavailability (crew_id, unavailable_date, reason) VALUES (?, ?, ?)'
    ).bind(crewId, date, reason || null).run();
    if (result.meta.changes > 0) added.push(date); else skipped.push(date);
  }
  return c.json({ success: true, data: { crew_name, added, skipped } });
});

app.delete('/dayoffs', async (c) => {
  const db = c.get('db');
  const { crew_name, dates } = await c.req.json();
  if (!crew_name || !Array.isArray(dates) || !dates.length) {
    return c.json({ success: false, error: 'crew_name and dates[] required' }, 400);
  }
  const { results: crewRows } = await (db as any).env.DB_CREW.prepare('SELECT id FROM crew WHERE name = ?').bind(crew_name).all() as { results: any[] };
  if (!crewRows.length) return c.json({ success: false, error: `Crew member not found: ${crew_name}` }, 404);
  const crewId = crewRows[0].id;
  const ph = dates.map(() => '?').join(',');
  const result = await (db as any).env.DB_CREW.prepare(
    `DELETE FROM crew_unavailability WHERE crew_id = ? AND unavailable_date IN (${ph})`
  ).bind(crewId, ...dates).run();
  return c.json({ success: true, data: { crew_name, removed: result.meta.changes } });
});

export { app as crewRoutes };
