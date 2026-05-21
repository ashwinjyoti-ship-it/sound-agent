import type { Env } from '../index';

export interface ShowRecord {
  id?: number;
  event_date: string;
  program: string;
  venue: string;
  team?: string | null;
  sound_requirements?: string | null;
  call_time?: string | null;
  crew?: string | null;
  foh_crew?: string | null;
  stage_crew?: string | null;
  requirements_updated?: boolean | number;
}

export class NcpaDB {
  constructor(private env: Env) {}

  // ─── Events (DB_SOUND) ───

  async getEvents(opts: { from?: string; to?: string; venue?: string; limit?: number } = {}) {
    let sql = 'SELECT * FROM events WHERE 1=1';
    const params: any[] = [];
    if (opts.from) { sql += ' AND event_date >= ?'; params.push(opts.from); }
    if (opts.to)   { sql += ' AND event_date <= ?'; params.push(opts.to); }
    if (opts.venue){ sql += ' AND venue = ?';       params.push(opts.venue); }
    sql += ' ORDER BY event_date, program';
    if (opts.limit){ sql += ' LIMIT ?';             params.push(opts.limit); }
    const { results } = await this.env.DB_SOUND.prepare(sql).bind(...params).all();
    return results as ShowRecord[];
  }

  async getEventById(id: number) {
    const { results } = await this.env.DB_SOUND.prepare('SELECT * FROM events WHERE id = ?').bind(id).all();
    return results[0] as ShowRecord | undefined;
  }

  async getEventsByMonth(month: string) {
    const { results } = await this.env.DB_SOUND.prepare(
      'SELECT * FROM events WHERE event_date LIKE ? ORDER BY event_date, program'
    ).bind(`${month}%`).all();
    return results as ShowRecord[];
  }

  async insertEvent(ev: ShowRecord) {
    const result = await this.env.DB_SOUND.prepare(`
      INSERT INTO events (event_date, program, venue, team, sound_requirements, call_time, crew, foh_crew, stage_crew, requirements_updated, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).bind(
      ev.event_date, ev.program, ev.venue ?? null, ev.team ?? null,
      ev.sound_requirements ?? null, ev.call_time ?? null, ev.crew ?? null,
      ev.foh_crew ?? null, ev.stage_crew ?? null, ev.requirements_updated ?? 0,
    ).run();
    return result.meta.last_row_id;
  }

  async updateEvent(id: number, updates: Partial<ShowRecord & { requirements_updated: boolean }>) {
    const fields: string[] = [];
    const params: any[] = [];
    const map: Record<string, string> = {
      program: 'program = ?', venue: 'venue = ?', team: 'team = ?',
      sound_requirements: 'sound_requirements = ?', call_time: 'call_time = ?',
      crew: 'crew = ?', foh_crew: 'foh_crew = ?', stage_crew: 'stage_crew = ?',
    };
    for (const [key, clause] of Object.entries(map)) {
      if ((updates as any)[key] !== undefined) { fields.push(clause); params.push((updates as any)[key]); }
    }
    if (updates.requirements_updated !== undefined) {
      fields.push('requirements_updated = ?');
      params.push(updates.requirements_updated ? 1 : 0);
    }
    if (fields.length === 0) return false;
    fields.push('updated_at = CURRENT_TIMESTAMP');
    params.push(id);
    const result = await this.env.DB_SOUND.prepare(
      `UPDATE events SET ${fields.join(', ')} WHERE id = ?`
    ).bind(...params).run();
    return result.success;
  }

  async deleteEvent(id: number) {
    const result = await this.env.DB_SOUND.prepare('DELETE FROM events WHERE id = ?').bind(id).run();
    return result.success;
  }

  // ─── Crew (DB_CREW) ───

  async getAllCrew() {
    const { results } = await this.env.DB_CREW.prepare('SELECT * FROM crew ORDER BY level, name').all();
    return results;
  }

  async getCrewAvailabilityOnDate(date: string) {
    const all = await this.getAllCrew() as any[];
    const unavail = await this.getCrewUnavailability([date]);
    const unavailIds = new Set(unavail.map((u: any) => u.crew_id));
    const events = await this.getEvents({ from: date, to: date });
    const busyCrewNames = new Set<string>();
    for (const ev of events) {
      for (const field of [ev.crew, ev.foh_crew, ev.stage_crew].filter(Boolean) as string[]) {
        field.split(/[,\/]/).map(n => n.trim()).filter(n => n).forEach(n => busyCrewNames.add(n));
      }
    }
    const busyCrewIds = new Set<number>();
    for (const crew of all) {
      if (busyCrewNames.has(crew.name)) busyCrewIds.add(crew.id);
    }
    return all.map(c => ({
      ...c,
      available: !unavailIds.has(c.id) && !busyCrewIds.has(c.id),
    }));
  }

  async getCrewUnavailability(dates: string[]) {
    if (dates.length === 0) return [];
    const ph = dates.map(() => '?').join(',');
    const { results } = await this.env.DB_CREW.prepare(
      `SELECT cu.*, c.name as crew_name FROM crew_unavailability cu JOIN crew c ON c.id = cu.crew_id WHERE cu.unavailable_date IN (${ph})`
    ).bind(...dates).all();
    return results;
  }

  async getAssignmentsForMonth(month: string) {
    const { results: events } = await this.env.DB_SOUND.prepare(
      'SELECT id, event_date, program as event_name, venue FROM events WHERE event_date LIKE ? ORDER BY event_date'
    ).bind(`${month}%`).all() as { results: any[] };
    if (!events?.length) return [];
    const eventMap = new Map(events.map(e => [e.id, e]));
    const eventIds = Array.from(eventMap.keys());
    const CHUNK = 50;
    const allAssignments: any[] = [];
    for (let i = 0; i < eventIds.length; i += CHUNK) {
      const chunk = eventIds.slice(i, i + CHUNK);
      const ph = chunk.map(() => '?').join(',');
      const { results } = await this.env.DB_CREW.prepare(
        `SELECT a.*, c.name as crew_name FROM assignments a JOIN crew c ON c.id = a.crew_id WHERE a.event_id IN (${ph})`
      ).bind(...chunk).all();
      if (results) allAssignments.push(...results);
    }
    return allAssignments.map(a => {
      const ev = eventMap.get(a.event_id);
      return ev ? { ...a, event_name: ev.event_name, event_date: ev.event_date, venue: ev.venue } : null;
    }).filter(Boolean);
  }

  async insertAssignment(event_id: number, crew_id: number, role: string, was_engine_suggestion = true) {
    const result = await this.env.DB_CREW.prepare(
      'INSERT INTO assignments (event_id, crew_id, role, was_engine_suggestion, was_manually_overridden, created_at) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)'
    ).bind(event_id, crew_id, role, was_engine_suggestion ? 1 : 0, 0).run();
    return result.meta.last_row_id;
  }

  async clearAssignmentsForEvents(eventIds: number[]) {
    if (!eventIds.length) return;
    const ph = eventIds.map(() => '?').join(',');
    await this.env.DB_CREW.prepare(`DELETE FROM assignments WHERE event_id IN (${ph})`).bind(...eventIds).run();
  }

  // ─── Inventory (DB_INVENTORY) ───

  async getEquipmentTypes() {
    const { results } = await this.env.DB_INVENTORY.prepare('SELECT * FROM equipment ORDER BY category, name').all();
    return results;
  }

  async getVenues() {
    const { results } = await this.env.DB_INVENTORY.prepare('SELECT * FROM venues ORDER BY name').all();
    return results;
  }

  async getItemsAtVenue(venueId: number) {
    const { results } = await this.env.DB_INVENTORY.prepare(`
      SELECT i.*, e.name as equipment_name, e.category
      FROM items i JOIN equipment e ON e.id = i.equipment_id
      WHERE i.current_venue_id = ? AND i.status = 'available'
      ORDER BY e.category, e.name
    `).bind(venueId).all();
    return results;
  }

  async getMovementsForItem(itemId: number) {
    const { results } = await this.env.DB_INVENTORY.prepare(`
      SELECT m.*, c.name as crew_name, v_from.name as from_venue, v_to.name as to_venue
      FROM movements m
      JOIN crew_members c ON c.id = m.crew_member_id
      JOIN venues v_from ON v_from.id = m.from_venue_id
      JOIN venues v_to ON v_to.id = m.to_venue_id
      WHERE m.item_id = ? ORDER BY m.logged_at DESC
    `).bind(itemId).all();
    return results;
  }
}
