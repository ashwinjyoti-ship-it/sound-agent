import { Hono } from 'hono';
import type { Env } from '../index';
import type { NcpaDB } from '../lib/db';

type Variables = { db: NcpaDB };
const app = new Hono<{ Bindings: Env; Variables: Variables }>();

app.post('/create', async (c) => {
  const db = c.get('db');
  const { month, events } = await c.req.json();
  if (!month || !Array.isArray(events)) {
    return c.json({ success: false, error: 'month and events[] required' }, 400);
  }
  const insertedIds: number[] = [];
  const skipped: any[] = [];
  for (const ev of events) {
    try {
      const existing = await db.getEvents({ from: ev.event_date, to: ev.event_date, venue: ev.venue });
      const dup = existing.find(e => e.program.trim() === ev.program.trim());
      if (dup) { skipped.push({ event: ev.program, reason: `Duplicate on ${ev.event_date} at ${ev.venue}` }); continue; }
      const id = await db.insertEvent({
        event_date: ev.event_date, program: ev.program, venue: ev.venue, team: ev.team,
        sound_requirements: ev.sound_requirements, call_time: ev.call_time, crew: ev.crew,
        foh_crew: ev.foh_crew,
        stage_crew: Array.isArray(ev.stage_crew) ? ev.stage_crew.join(', ') : ev.stage_crew,
        requirements_updated: ev.requirements_updated ?? false,
      });
      if (id) insertedIds.push(id as number);
    } catch (err: any) {
      skipped.push({ event: ev.program, reason: err.message });
    }
  }
  return c.json({ success: true, data: { inserted: insertedIds, count: insertedIds.length, skipped }, meta: { count: insertedIds.length + skipped.length } });
});

app.get('/:month', async (c) => {
  const db = c.get('db');
  const events = await db.getEventsByMonth(c.req.param('month'));
  return c.json({ success: true, data: events, meta: { count: events.length } });
});

app.delete('/:month', async (c) => {
  const db = c.get('db');
  const events = await db.getEventsByMonth(c.req.param('month'));
  let deleted = 0;
  for (const ev of events) {
    if (ev.id) { await db.deleteEvent(ev.id); deleted++; }
  }
  return c.json({ success: true, data: { deleted }, meta: { count: deleted } });
});

app.post('/import-csv', async (c) => {
  const db = c.get('db');
  const { month, rows } = await c.req.json();
  if (!month || !Array.isArray(rows)) {
    return c.json({ success: false, error: 'month and rows[] required' }, 400);
  }
  const insertedIds: number[] = [];
  const skipped: any[] = [];
  for (const row of rows) {
    try {
      const id = await db.insertEvent({
        event_date: row.event_date || row.date || row['Event Date'],
        program: row.program || row.name || row['Program'] || row['Name'],
        venue: row.venue || row['Venue'],
        team: row.team || row['Team'],
        sound_requirements: row.sound_requirements || row['Sound Requirements'] || row['Sound Req'],
        call_time: row.call_time || row['Call Time'] || row['Call'],
        crew: row.crew || row['Crew'],
        requirements_updated: false,
      });
      if (id) insertedIds.push(id as number);
    } catch (err: any) {
      skipped.push({ row, error: err.message });
    }
  }
  return c.json({ success: true, data: { inserted: insertedIds, skipped } });
});

export { app as scheduleRoutes };
