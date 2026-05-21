import { Hono } from 'hono';
import type { Env } from '../index';
import type { NcpaDB } from '../lib/db';

type Variables = { db: NcpaDB };
const app = new Hono<{ Bindings: Env; Variables: Variables }>();

app.post('/add', async (c) => {
  const db = c.get('db');
  const body = await c.req.json();
  const {
    date_type = 'single', event_date, start_date, end_date,
    program, venue, team, sound_requirements, call_time, foh_crew, stage_crew,
  } = body;

  if (!program?.trim() || !venue?.trim()) {
    return c.json({ success: false, error: 'program and venue are required' }, 400);
  }

  const dates: string[] = [];
  if (date_type === 'range' && start_date && end_date) {
    const s = new Date(start_date + 'T00:00:00Z');
    const e = new Date(end_date + 'T00:00:00Z');
    for (const d = new Date(s); d <= e; d.setUTCDate(d.getUTCDate() + 1)) {
      dates.push(d.toISOString().split('T')[0]);
    }
  } else if (event_date) {
    dates.push(event_date);
  } else {
    return c.json({ success: false, error: 'event_date or start_date+end_date required' }, 400);
  }

  const insertedIds: number[] = [];
  const stageCrewStr = Array.isArray(stage_crew) ? stage_crew.filter(Boolean).join(', ') : stage_crew || '';
  const allCrew = [foh_crew, stageCrewStr].filter(Boolean).join(', ');

  for (const date of dates) {
    const id = await db.insertEvent({
      event_date: date, program: program.trim(), venue: venue.trim(),
      team: team || null, sound_requirements: sound_requirements || null,
      call_time: call_time || null, crew: allCrew || null,
      foh_crew: foh_crew || null, stage_crew: stageCrewStr || null,
      requirements_updated: false,
    });
    if (id) insertedIds.push(id as number);
  }
  return c.json({ success: true, data: { ids: insertedIds, count: insertedIds.length, dates } });
});

app.get('/list', async (c) => {
  const db = c.get('db');
  const from = c.req.query('from');
  const to = c.req.query('to');
  const venue = c.req.query('venue');
  const limit = c.req.query('limit') ? parseInt(c.req.query('limit')!) : 100;
  const events = await db.getEvents({ from: from || undefined, to: to || undefined, venue: venue || undefined, limit });
  return c.json({ success: true, data: events, meta: { count: events.length } });
});

app.get('/:id', async (c) => {
  const db = c.get('db');
  const id = parseInt(c.req.param('id'));
  if (isNaN(id)) return c.json({ success: false, error: 'Invalid id' }, 400);
  const event = await db.getEventById(id);
  if (!event) return c.json({ success: false, error: 'Show not found' }, 404);
  return c.json({ success: true, data: event });
});

app.patch('/:id', async (c) => {
  const db = c.get('db');
  const id = parseInt(c.req.param('id'));
  if (isNaN(id)) return c.json({ success: false, error: 'Invalid id' }, 400);
  const updates = await c.req.json();
  const allowed = ['program', 'venue', 'team', 'sound_requirements', 'call_time', 'crew', 'foh_crew', 'stage_crew'];
  const patch: Record<string, any> = {};
  for (const key of allowed) {
    if (updates[key] !== undefined) patch[key] = updates[key];
  }
  if (Object.keys(patch).length === 0) {
    return c.json({ success: false, error: 'No valid fields to update' }, 400);
  }
  if (updates.sound_requirements !== undefined || updates.call_time !== undefined) {
    patch.requirements_updated = true;
  }
  const ok = await db.updateEvent(id, patch);
  if (!ok) return c.json({ success: false, error: 'Update failed' }, 500);
  return c.json({ success: true, data: { id, updated: patch } });
});

app.delete('/:id', async (c) => {
  const db = c.get('db');
  const id = parseInt(c.req.param('id'));
  if (isNaN(id)) return c.json({ success: false, error: 'Invalid id' }, 400);
  const ok = await db.deleteEvent(id);
  return c.json({ success: ok, data: { deleted: ok ? id : null } });
});

export { app as showRoutes };
