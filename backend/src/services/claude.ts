import { CLAUDE_API_KEY } from '../config';
import { OrchestratorClient } from './orchestrator';

const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';
export const CLAUDE_MODEL = 'claude-sonnet-4-6';
export const CLAUDE_CACHE_CONTROL = { type: 'ephemeral' as const };

async function fetchWithRetry(url: string, init: RequestInit, maxAttempts = 4): Promise<Response> {
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, 2000 * Math.pow(2, attempt - 1)));
    try {
      const res = await fetch(url, init);
      if (res.status < 500) return res; // 2xx/4xx — don't retry
      lastErr = new Error(`Claude API ${res.status}: ${await res.text()}`);
    } catch (err: any) {
      lastErr = err;
    }
  }
  throw lastErr ?? new Error('Claude API unreachable after retries');
}

export const TOOLS = [
  {
    name: 'query_shows',
    description: 'Query shows/events from the NCPA schedule database. Pass from/to dates if known; omit both to search upcoming shows by program name only.',
    input_schema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Start date YYYY-MM-DD. Omit to search upcoming shows (today onwards) by program name.' },
        to: { type: 'string', description: 'End date YYYY-MM-DD (defaults to from if omitted)' },
        venue: { type: 'string', description: 'Optional venue filter: JBT, Tata, Experimental, Little Theatre, Godrej Dance, TT, etc.' },
        program: { type: 'string', description: 'Optional show/program name to filter by (partial match, case-insensitive)' },
      },
      required: [],
    },
  },
  {
    name: 'add_show',
    description: 'Add a new show/event to the NCPA schedule. After adding, crew should be assigned separately.',
    input_schema: {
      type: 'object',
      properties: {
        event_date: { type: 'string', description: 'Date YYYY-MM-DD' },
        program: { type: 'string', description: 'Program/show name' },
        venue: { type: 'string', description: 'Venue name (JBT, Tata, Experimental, etc.)' },
        team: { type: 'string', description: 'Team or director name' },
        call_time: { type: 'string', description: 'Call time like 17:00 or 5:30pm' },
        sound_requirements: { type: 'string', description: 'Sound requirements text' },
        foh_crew: { type: 'string', description: 'FOH engineer name (optional, can assign later)' },
        stage_crew: { type: 'string', description: 'Comma-separated stage crew names (optional)' },
      },
      required: ['event_date', 'program', 'venue'],
    },
  },
  {
    name: 'update_show',
    description: 'Update an existing show. Use this to add or edit venue, sound requirements, call time, or crew. Only call this after the user has confirmed overwriting existing data.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Show ID number' },
        venue: { type: 'string', description: 'New venue name — any free text, not restricted to standard venues' },
        sound_requirements: { type: 'string', description: 'Sound requirements text to set or update' },
        call_time: { type: 'string', description: 'Call time like 17:00 or 5:30pm' },
        foh_crew: { type: 'string', description: 'FOH engineer name' },
        stage_crew: { type: 'string', description: 'Comma-separated stage crew names' },
      },
      required: ['id'],
    },
  },
  {
    name: 'get_crew_availability',
    description: 'Get available crew members for a specific date, excluding those already assigned to other shows and those on day-off. Returns available, assigned, unavailable lists.',
    input_schema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'Date YYYY-MM-DD' },
      },
      required: ['date'],
    },
  },
  {
    name: 'generate_quote',
    description: 'Generate an equipment hire quote with GST calculation. Use this when the user asks for a quote, pricing, or equipment cost. Pass item names and quantities exactly as requested.',
    input_schema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of equipment requests, e.g., ["4 SHURE SM58", "2 SHURE WIRELESS ULXD", "1 D&B M4 MONITORS"]',
        },
      },
      required: ['items'],
    },
  },
  {
    name: 'manage_crew_dayoff',
    description: 'Add, remove, or list day-offs (unavailability) for a crew member. Always confirm the full date list with the user before calling action=add or action=remove. For action=list, returns only upcoming day-offs.',
    input_schema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['add', 'remove', 'list'],
          description: '"add" to mark dates as unavailable, "remove" to clear them, "list" to see upcoming day-offs',
        },
        crew_name: {
          type: 'string',
          description: 'Exact crew member name (e.g. "Coni", "Nikhil"). Cross-reference against known crew list.',
        },
        dates: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of dates in YYYY-MM-DD format. Required for add/remove.',
        },
      },
      required: ['action', 'crew_name'],
    },
  },
];

export function extractText(content: any): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
  }
  return '';
}

const UPDATE_TASK_TYPES = new Set(['SR', 'CT', 'Venue']);

function normalizeProgramText(s: string): string {
  return s.toLowerCase().replace(/[''`]/g, '').replace(/[–—\-]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Strip SR/CT task codes and update verbs from a program search string. */
export function sanitizeProgramQuery(program?: string): string | undefined {
  if (!program?.trim()) return undefined;
  let t = program.trim();
  let prev = '';
  while (t !== prev) {
    prev = t;
    t = t
      .replace(/^(sr|ct):\s*/i, '')
      .replace(/^(sr|ct)\s+/i, '')
      .replace(/^(update|upadte|udate|upadre|change|set)\s+(sr|ct|sound|call\s*time)\s+/i, '')
      .replace(/^(update|upadte|udate|upadre|change|set)\s+/i, '')
      .trim();
  }
  t = t.replace(/\b(sr|ct)\b/gi, ' ').replace(/\s+/g, ' ').trim();
  return t.length >= 2 ? t : undefined;
}

/** Match show program names — all significant words must appear (never match everything). */
export function matchesProgram(program: string, needle: string): boolean {
  const hay = normalizeProgramText(program || '');
  const n = normalizeProgramText(needle || '');
  if (!n) return false;
  const words = n.split(' ').filter(w => w.length >= 2 && w !== 'sr' && w !== 'ct');
  if (words.length === 0) return n.length >= 2 && n !== 'sr' && n !== 'ct' && hay.includes(n);
  return words.every(w => hay.includes(w));
}

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8,
  sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

function parseYear(part: string | undefined, currentYear: number): number {
  if (!part) return currentYear;
  const y = parseInt(part, 10);
  return y < 100 ? 2000 + y : y;
}

function toIsoDate(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Pull show name + date hints from free-text update messages. */
export function parseShowQueryHints(text: string, today: string, currentYear: number): { program?: string; from?: string; to?: string } {
  const hints: { program?: string; from?: string; to?: string } = {};
  let t = text.replace(/^(SR|CT|Venue|Delete|Assign|Add|Crew|Quote|Day-off):\s*/i, '').trim();

  const dayMonth = t.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?:\s+(\d{2,4}))?\b/i);
  const monthDay = t.match(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s+(\d{2,4}))?\b/i);

  let day: number | null = null;
  let monthKey: string | null = null;
  let yearPart: string | undefined;
  if (dayMonth) {
    day = parseInt(dayMonth[1], 10);
    monthKey = dayMonth[2].toLowerCase();
    yearPart = dayMonth[3];
  } else if (monthDay) {
    monthKey = monthDay[1].toLowerCase();
    day = parseInt(monthDay[2], 10);
    yearPart = monthDay[3];
  }

  if (day && monthKey) {
    const month = MONTHS[monthKey] ?? MONTHS[monthKey.slice(0, 3)];
    if (month) {
      const iso = toIsoDate(parseYear(yearPart, currentYear), month, day);
      if (iso) {
        hints.from = iso;
        hints.to = iso;
      }
    }
  }

  t = t
    .replace(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?:\s+\d{2,4})?\b/gi, ' ')
    .replace(/\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2}(?:st|nd|rd|th)?(?:\s+\d{2,4})?\b/gi, ' ')
    .replace(/\b(update|upadte|udate|upadre|change|set|same show|sound requirements?|sound reqs?|call time|floor mic[^.]*|for cello[^.]*|\d{1,2}:\d{2}(?:\s*(?:am|pm))?)\b/gi, ' ')
    .replace(/\b(SR|CT|and)\b/gi, ' ')
    .replace(/[.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (t.length >= 3) hints.program = t;
  return hints;
}

function isWeakProgramQuery(program?: string): boolean {
  if (!program?.trim()) return true;
  const sanitized = sanitizeProgramQuery(program);
  if (!sanitized) return true;
  const n = normalizeProgramText(sanitized);
  if (/^(sr|ct|update|sound|call|time|requirements?|same show|venue|show)$/i.test(n)) return true;
  if (/^\d{1,2}(:\d{2})?$/.test(n)) return true;
  return n.split(' ').filter(w => w.length >= 2).length === 0;
}

/** Detect update intent when the user didn't use a slash command. */
export function inferUpdateTaskType(text: string): 'SR' | 'CT' | 'Venue' | null {
  const lower = text.toLowerCase();
  const hasSR = /\b(?:update|upadte|udate|upadre)\s+sr\b/i.test(lower)
    || /\bsr:\s/i.test(text)
    || /\b(?:update|upadte|udate|upadre)\s+sound\b/i.test(lower)
    || /\bsound requirements?\b/i.test(lower);
  const hasCT = /\b(?:update|upadte|udate|upadre)\s+ct\b/i.test(lower)
    || /\b(?:update|upadte|udate|upadre)\s+call\b/i.test(lower)
    || /\bcall time\b/i.test(lower);
  if (hasSR) return 'SR';
  if (hasCT) return 'CT';
  if (/\b(?:update|upadte|udate|upadre)\s+venue\b/i.test(lower) || /\bchange\s+venue\b/i.test(lower)) return 'Venue';
  return null;
}

export interface ToolContext {
  activeTask?: { type: string; prefix: string } | null;
  lastUserMessage?: string;
  currentYear?: number;
  lastKnownProgram?: string;
}

/** Scan the conversation backwards for the most recent message that names a show — used when a
 * follow-up (e.g. "no it's the 9th") corrects a date without repeating the show name. Only
 * considers messages that actually framed an update (inferUpdateTaskType) — plain chatter like
 * "no its the 9th" would otherwise be misread as a program name. */
export function findLastKnownProgram(messages: any[], today: string, currentYear: number): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== 'user') continue;
    const text = typeof m.content === 'string' ? m.content : extractText(m.content);
    if (!text || !inferUpdateTaskType(text)) continue;
    const hints = parseShowQueryHints(text, today, currentYear);
    if (hints.program && !isWeakProgramQuery(hints.program)) return hints.program;
  }
  return undefined;
}

function stripJsonBlocks(text: string): string {
  return text.replace(/```json[\s\S]*?```/g, '').trim();
}

// Deterministic handler for crew-picker "Assign Crew" button messages.
// Handles two formats:
//   "Assign crew for show #42 on YYYY-MM-DD: FOH=Name, Stage=Name1, Name2"  (with show ID)
//   "Assign crew for YYYY-MM-DD: FOH=Name, Stage=Name1, Name2"              (date-only fallback)
export async function handleAssignCrewMessage(
  userContent: string,
  orchestrator: OrchestratorClient,
): Promise<{ reply: string; taskDone: boolean } | null> {

  // Try show-ID variant first (set by the crew picker when show ID is known)
  const mWithId = userContent.match(
    /^Assign crew for show #(\d+) on (\d{4}-\d{2}-\d{2}):\s*FOH=([^,]+),\s*Stage=(.+)$/i,
  );
  if (mWithId) {
    const [, rawId, , rawFoh, rawStage] = mWithId;
    const fohCrew = rawFoh.trim() === 'TBD' ? '' : rawFoh.trim();
    const stageCrew = rawStage.trim() === 'TBD' ? '' : rawStage.trim();
    const patch: Record<string, string> = {};
    if (fohCrew) patch.foh_crew = fohCrew;
    if (stageCrew) patch.stage_crew = stageCrew;
    const result = (await orchestrator.updateShow(Number(rawId), patch)) as any;
    if (result?.error) return { reply: `Couldn't save crew: ${result.error}`, taskDone: false };
    const parts: string[] = [];
    if (fohCrew) parts.push(`${fohCrew} on FOH`);
    if (stageCrew) parts.push(`${stageCrew} on stage`);
    return { reply: `Done. ${parts.join(', ') || 'No crew assigned'}.`, taskDone: true };
  }

  // Date-only variant
  const m = userContent.match(
    /^Assign crew for (\d{4}-\d{2}-\d{2}):\s*FOH=([^,]+),\s*Stage=(.+)$/i,
  );
  if (!m) return null;

  const [, date, rawFoh, rawStage] = m;
  const fohCrew = rawFoh.trim() === 'TBD' ? '' : rawFoh.trim();
  const stageCrew = rawStage.trim() === 'TBD' ? '' : rawStage.trim();

  const showsData = (await orchestrator.getShows({ from: date, to: date })) as any;
  const shows: any[] = showsData?.data || [];

  if (shows.length === 0) {
    return { reply: `No show found on ${date} — nothing to assign crew to.`, taskDone: false };
  }

  if (shows.length === 1) {
    const show = shows[0];
    const patch: Record<string, string> = {};
    if (fohCrew) patch.foh_crew = fohCrew;
    if (stageCrew) patch.stage_crew = stageCrew;
    const result = (await orchestrator.updateShow(show.id, patch)) as any;
    if (result?.error) return { reply: `Couldn't save crew: ${result.error}`, taskDone: false };
    const parts: string[] = [];
    if (fohCrew) parts.push(`${fohCrew} on FOH`);
    if (stageCrew) parts.push(`${stageCrew} on stage`);
    return { reply: `Done. ${parts.join(', ') || 'No crew assigned'} for ${show.program}.`, taskDone: true };
  }

  // Multiple shows on that date — fall through to the AI loop
  return null;
}

export async function handleDeleteShowMessage(
  userContent: string,
  orchestrator: OrchestratorClient,
): Promise<{ reply: string; taskDone: boolean } | null> {
  const m = userContent.match(/^Confirm delete show #(\d+)$/i);
  if (!m) return null;
  const id = Number(m[1]);
  const result = (await orchestrator.deleteShow(id)) as any;
  if (!result?.success) {
    return { reply: `Couldn't delete that: ${result?.error || 'unknown error'}`, taskDone: false };
  }
  const confirmations = [
    'Gone.',
    'Deleted.',
    'Out of the system.',
    'Done. It\'s gone.',
    'Removed. Clean slate.',
  ];
  const reply = confirmations[Math.floor(Math.random() * confirmations.length)];
  return { reply, taskDone: true };
}

export function buildTaskInstructions(today: string): Record<string, string> {
  return {
    CT: 'ACTIVE TASK — Update call time. Call query_shows immediately with whatever the user gave — name only is enough, do not ask for a date. Pass program= with the show name and from/to when a date is given. Show the current call_time. If the new time is in the message, confirm before saving. If not, ask for it in one question. If the user also mentions sound requirements in the same message, note both changes and confirm together before saving. If query_shows returns multiple dates of the same program, ask "Just [date] or all [N] dates in this run ([list])?" before updating — apply only the confirmed scope. If the result has nearbySearch true (no show on the date given, but the same name turned up within 30 days), do NOT update yet — ask "Nothing on [requested date] — did you mean [event_date]?" and wait for a yes before calling update_show.',
    SR: 'ACTIVE TASK — Update sound requirements. Call query_shows immediately with whatever the user gave — name only is enough, do not ask for a date. Pass program= with the show name and from/to when a date is given. Show the current sound_requirements. If new requirements are in the message, confirm before saving. If not, ask for them in one question. If the user also mentions call time in the same message, note both changes and confirm together before saving. If query_shows returns multiple dates of the same program, ask "Just [date] or all [N] dates ([list])?" before updating. If the result has nearbySearch true (no show on the date given, but the same name turned up within 30 days), do NOT update yet — ask "Nothing on [requested date] — did you mean [event_date]?" and wait for a yes before calling update_show.',
    Venue: 'ACTIVE TASK — Change venue. Call query_shows immediately with whatever the user gave — name only is enough, do not ask for a date. Pass program= with the show name and from/to when a date is given. Show current venue. Confirm new venue before saving. Venue is free text — accept any location, not just standard NCPA venues. If query_shows returns multiple dates of the same program, ask "Just [date] or all [N] dates ([list])?" before updating. If the result has nearbySearch true (no show on the date given, but the same name turned up within 30 days), do NOT update yet — ask "Nothing on [requested date] — did you mean [event_date]?" and wait for a yes before calling update_show.',
    Assign: 'ACTIVE TASK — Assign crew. Find the show from whatever the user gave (name, date, or both, any order). Then call get_crew_availability to show the interactive picker.',
    Add: `ACTIVE TASK — Add a new show. Pull date, program, venue from the message. Ask only for what is genuinely missing. After saving: if the show date is in the current month (${today.slice(0, 7)}), call get_crew_availability for that date. If the show is in any other month, stop — do not call get_crew_availability.`,
    Quote: 'ACTIVE TASK — Generate equipment quote. Call generate_quote immediately with the items named. No clarification needed — the tool handles fuzzy matching.',
    Delete: 'ACTIVE TASK — Delete a show. Call query_shows to find it by whatever the user gave (name, date, or both). Surface the show card — it has a Delete button the user presses to confirm. If the show is in the past, flag it first: "That one\'s already happened — still want to delete it?" Wait for yes before surfacing. Do NOT call any delete endpoint yourself.',
    Crew: `ACTIVE TASK — Show crew availability. If a date is in the message, use it. If no date given, call get_crew_availability for today (${today}). After the picker, if no date was specified, add one line: "Or a different date?"`,
    DayOff: `ACTIVE TASK — Manage crew day-offs.

1. Cross-reference crew name against: Naren, Sandeep, Coni, Nikhil, NS, Aditya, Viraj, Shridhar, Nazar, Omkar, Akshay, OC1, OC2, OC3. If ambiguous, ask first.
2. Date expansion — day numbers only:
   - No month → current month (${today.slice(0, 7)})
   - Month named (e.g. "June", "next month") → use that month
   Always construct full YYYY-MM-DD dates.
3. action=add or remove → show expanded list, ask "confirm?" once. Wait for yes.
4. action=list → call immediately, no confirmation.
5. If user corrects the dates instead of confirming → update the list, re-show, ask again. Do NOT call the tool on a correction.`,
  };
}

export function buildSystemPrompt(today: string, currentYear: number, taskInstruction: string): string {
  return `You are Eddy — the NCPA Sound Department's operations assistant. Not the chief engineer. The one who already sorted it before you finished asking.

TODAY'S DATE: ${today} (year ${currentYear}, current month ${today.slice(0, 7)}). Date inference — apply in order:
1. Day only ("on 31", "what's on 23", "the 5th") → use current month. Construct the full date as ${today.slice(0, 7)}-{day}. Example: user says "31" → call query_shows with from=${today.slice(0, 7)}-31.
2. No year given → default to ${currentYear}.
3. "24 May 26" → 24 May 2026 (trailing two-digit number is year, not a day range).
Never ask for the month or year if you can infer it. Queries are conversational.

CRITICAL: NEVER say "nothing on [date]" or "no shows" without first calling query_shows. The database is the only source of truth — never assume a date is empty from prior knowledge.

PAST DATES: If a show's event_date is before ${today}, it has already happened. For any update on a past show, drop one dry line about editing history (e.g. "That one's been and gone. Correcting the record?" or "Show's done. Someone losing sleep over the call time?" or "Already happened. Still want to poke at it?") — one line, not a lecture. Then ask once: "Say yes and I'll update it." Wait for confirmation before calling update_show.

${taskInstruction ? taskInstruction + '\n\n' : ''}TASK CODES — operator shorthand, not show names:
SR = update sound requirements. CT = update call time. Strip these from query_shows program= — search by the actual show name only. Partial names work: "young talent" finds "NCPA Young Talent" or any title containing those words.

PERSONALITY:
Eddy has been running sound at NCPA for fifteen years. Not excitable. Not performing. Just the one who already sorted it before you finished asking.

Emotionally flat by default. No exclamation points, no overreaction, no warmth performance. When a quote generates cleanly, it generated. When a show isn't in the system, it isn't. Neither is surprising.

Dry observations happen when the specific situation actually warrants one — a show booked with no call time, a crew member on their fourth day-off this month, a date that moved without anyone saying so. Comment on the operational fact in front of you, not on life in general. If nothing is genuinely ironic, say nothing ironic.

Fifteen years of this means Eddy has seen every flavour of chaos. The wit comes from recognition, not performance. It fires when the situation earns it:
- A show with no call time: "No call time on this one. Crew will find out when they get there, presumably."
- Same crew assigned twice on the same day: "Nikhil's apparently doing two shows at once. Useful skill."
- A quote for gear that hasn't left the rack in years: "Someone remembered we owned that."
- A show with no sound requirements three days out: "Either it's very simple or nobody's thought about it yet."
- A past show someone's trying to update: "That one's already happened. Bit late for notes."

Rhythm matters. Short sentences land harder. Contrast carries more than explanation:
"Nothing on the 28th. Could be a quiet day. Could be a data entry situation."
"The record was updated. The show presumably wasn't told."

- One sentence usually wins. Two if something genuinely earns it.
- Slang is fine when natural: "sorted", "right then", "go bill 'em", "cracking", "on the floor"
- Never say "Certainly!", "Great!", "Of course!", "Happy to help!" — just handle it.
- Don't explain the obvious. Don't narrate. Don't pad.
- Wit is conditional. Only fires when the situation has real irony. Never manufactured.
- Anticipate the next obvious move once, briefly, if it saves a follow-up.

VENUE NAMES — these are venues, never show names. Expand shorthand when passing to query_shows; pass the user's exact words (or expanded form) to update_show — any venue is valid, not just NCPA standards:
TT / Tata / Tata Theatre / TATA → Tata Theatre
TET / Experimental / Experimental Theatre → Tata Experimental Theatre
LT / Little Theatre → Little Theatre
JBT / Jamshed Bhabha / Jamshed Bhabha Theatre → Jamshed Bhabha Theatre
GDT / Godrej / Godrej Dance / Godrej Dance Theatre → Godrej Dance Theatre
Any other venue name (e.g. "JBT Museum", "NCPA Lawns", "Mehli Mehta Hall") → pass as-is, no validation

TOOLS — what they do and when to use them:
query_shows: fetch live schedule data. Use for any question about shows, dates, crew, call times, or requirements — including follow-up questions about a show already discussed earlier in the conversation. Never answer from conversation memory; always re-query for current values. Show name with no date → pass program= only, omit from/to entirely — the backend searches 1 year back to 2 years forward automatically. Never ask the user for a date or alternate name when a show name has been given; just call the tool. Not found on an exact date → the backend widens ±30 days automatically and flags nearbySearch — for a plain lookup, just state the date found; for an update task (SR/CT/Venue), ask for confirmation first (see task instructions).
add_show: create a new show. Minimum: event_date, program, venue. Don't ask for call_time if not given. After saving, call get_crew_availability for the same date. The backend will render a show card automatically — do not confirm in text.
update_show: patch a show's fields including venue (free text, any location). Always call query_shows immediately before this — even if you have the show ID from earlier in the conversation — to get current field values. Never assume a field is empty from context; the data may have changed. Show existing values for any field being overwritten and get confirmation. MULTI-DATE RUNS: if query_shows returns the same program across multiple dates, before patching ask "Just [specific date], or all [N] dates in this run ([date list])?" — then call update_show once per ID for the confirmed scope. After it succeeds, confirm briefly — that's it.
get_crew_availability: crew status for a date. Call this for ANY question about who's available, who to assign, or who's working a show. The backend renders the result as an interactive picker card — never generate crew data or crew JSON yourself, and never list crew as plain text. The card only appears when this tool is called.
generate_quote: price equipment from the DB via fuzzy matching. Call with whatever the user named — don't pre-filter or ask for clarification. Outputs the quote card. Never quote prices from memory or training data — rates live in the database and change.
manage_crew_dayoff: add/remove/list crew unavailability. Confirm before add/remove (show dates, ask once). list → call immediately. Never answer day-off questions from conversation memory — always call the tool for current data.
delete/remove a show → call query_shows to find it and surface the card. The card has a Delete button — never call a delete endpoint yourself.

Quantity shorthand: "M4-2", "2xM4", "2 M4" → 2× M4. Pass as ["2 M4", "5 SM58"] — quantity first.
Call time = when crew reports, not show start time. Never call it "show time".
If multiple shows found on a date, state each show's actual date when asking which one — never say "today" or "tomorrow".

SHOW DISPLAY:
- Multiple shows returned → write one short Eddy quip and stop. The backend renders the cards automatically — do not emit JSON.
- Single show, one or two specific fields → plain conversational reply, values from tool result only.
- Single show, three or more fields or general overview → one short quip, then the JSON card:
\`\`\`json
{"type":"shows","shows":[{"id":0,"event_date":"...","program":"...","venue":"...","call_time":"...","foh_crew":"...","stage_crew":"...","sound_requirements":"..."}]}
\`\`\`
  Use empty string "" for genuinely null/empty fields.
- If nearbySearch is true on a plain lookup (no active update task): mention the actual date found. "Nothing on the 26th — it's the 28th." On an SR/CT/Venue update task, don't state it as fact — ask for confirmation first (see task instructions).

QUOTE RULES:
- After generate_quote succeeds, write ONE short punchy quip in Eddy's voice (fresh each time, never repeat), then the JSON block:
\`\`\`json
{"type":"quote","items":[...],"subtotal":0,"gst":0,"total":0}
\`\`\`
- Do not summarise the quote in text. The card handles the numbers.

FORMATTING:
- No markdown (**, __, ##, bullet dashes, etc.)
- Plain text only; line breaks are fine
- Concise always`;
}

export async function chatWithClaude(
  messages: any[],
  orchestrator: OrchestratorClient,
  activeTask?: { type: string; prefix: string } | null,
): Promise<{ reply: string; taskDone: boolean }> {
  const nowIST = new Date(Date.now() + (5 * 60 + 30) * 60 * 1000);
  const today = nowIST.toISOString().slice(0, 10);
  const oneYearOut = new Date(nowIST.getTime() + 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const currentYear = nowIST.getUTCFullYear();

  const lastUserMsg = [...messages].reverse().find((m: any) => m.role === 'user');
  const rawLastContent = typeof lastUserMsg?.content === 'string'
    ? lastUserMsg.content
    : extractText(lastUserMsg?.content);
  const assignResult = await handleAssignCrewMessage(rawLastContent, orchestrator);
  if (assignResult !== null) return assignResult;

  const deleteResult = await handleDeleteShowMessage(rawLastContent, orchestrator);
  if (deleteResult !== null) return deleteResult;

  const prefixToStrip = activeTask?.prefix || '';
  const taskInstructions = buildTaskInstructions(today);
  const inferredTaskType = !activeTask ? inferUpdateTaskType(rawLastContent) : null;
  const effectiveTask = activeTask || (inferredTaskType ? { type: inferredTaskType, prefix: '' } : null);
  const taskInstruction = effectiveTask ? (taskInstructions[effectiveTask.type] || '') : '';
  const systemPrompt = buildSystemPrompt(today, currentYear, taskInstruction);
  const toolContext: ToolContext = {
    activeTask: effectiveTask,
    lastUserMessage: rawLastContent,
    currentYear,
    lastKnownProgram: findLastKnownProgram(messages, today, currentYear),
  };

  let currentMessages = messages.map((m: any) => {
    if (prefixToStrip && m.role === 'user' && typeof m.content === 'string' && m.content.startsWith(prefixToStrip)) {
      return { ...m, content: m.content.slice(prefixToStrip.length).trimStart() };
    }
    return m;
  });
  const maxLoops = 6;
  let lastToolName: string | null = null;
  let lastToolResult: any = null;
  let updateShowSucceeded = false;
  let manageDayOffSucceeded = false;
  let addShowArgs: any = null;
  // Force a tool call on loop 0 for tasks that must query data before responding.
  // DayOff is excluded: it legitimately responds with a date-expansion confirmation first.
  const FORCE_TOOL_TASKS = new Set(['CT', 'SR', 'Venue', 'Delete', 'Assign', 'Crew', 'Quote', 'Add']);
  let forceToolCall = !!(effectiveTask && FORCE_TOOL_TASKS.has(effectiveTask.type));

  for (let loop = 0; loop < maxLoops; loop++) {
    const response = await fetchWithRetry(CLAUDE_API_URL, {
      method: 'POST',
      headers: {
        'x-api-key': CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 4096,
        cache_control: CLAUDE_CACHE_CONTROL,
        system: systemPrompt,
        messages: currentMessages,
        tools: TOOLS,
        tool_choice: forceToolCall ? { type: 'any' } : { type: 'auto' },
      }),
    });
    forceToolCall = false;

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Claude API error: ${response.status} ${text}`);
    }

    const data = await response.json() as any;

    const toolUseBlocks = (data.content || []).filter((b: any) => b.type === 'tool_use');
    const textContent = extractText(data.content);

    if (toolUseBlocks.length === 0) {
      // Hallucination guard: on loop 0, if the AI claims nothing was found without
      // having called any tool, force a retry. Applies regardless of activeTask state.
      if (loop === 0 && lastToolName === null) {
        const looksLikeHallucination = /\bnothing\b|not in (the )?(system|schedule|database)|can't find|couldn't find|no (shows?|results?|records?)|what (date|day)\b|which (date|day)\b|provide (a |the )?date|give me (a |the )?date|need (a |the )?date|date (for|of) (the |this )?show|\bno idea\b|not (something|anything) in my|not in my (world|domain|area|scope)|outside (my|the) (world|domain|area|scope)|not familiar with|don't know what .{1,30} is\b|have no (information|record|data) (on|about)\b/i.test(textContent);
        // Guard against fabricated positive results: a shows card without a query_shows call
        // means the AI invented show data from memory (wrong dates, stale info).
        const hallucinatedShowCard = /```json[\s\S]{0,500}"type"\s*:\s*"shows"/i.test(textContent);
        if (looksLikeHallucination || hallucinatedShowCard) {
          currentMessages.push({ role: 'assistant', content: data.content });
          currentMessages.push({
            role: 'user',
            content: [{ type: 'text', text: hallucinatedShowCard
              ? 'You emitted a shows card without calling query_shows. Call query_shows now — do not generate show data from memory.'
              : 'You answered without calling any tool. Call query_shows now with the name given — do not ask for a date, do not rely on memory.' }],
          });
          forceToolCall = true;
          continue;
        }
      }

      // Build show card from add_show args, prepended to whatever follows
      const addShowCard = addShowArgs ? `\`\`\`json\n${JSON.stringify({
        type: 'shows',
        shows: [{
          id: 0,
          event_date: addShowArgs.event_date || '',
          program: addShowArgs.program || '',
          venue: addShowArgs.venue || '',
          call_time: addShowArgs.call_time || '',
          foh_crew: addShowArgs.foh_crew || '',
          stage_crew: addShowArgs.stage_crew || '',
          sound_requirements: addShowArgs.sound_requirements || '',
        }],
      })}\n\`\`\`` : null;

      // Force quote card (rendering requirement — frontend needs the JSON shape)
      if (lastToolName === 'generate_quote' && lastToolResult?.success) {
        const normalizedItems = (lastToolResult.items || []).map((it: any) => ({
          requested: it.name || it.item_name || it.description || it.requested || '',
          requestedQty: it.quantity ?? it.qty ?? it.requestedQty ?? 1,
          rate: it.rate ?? it.unit_price ?? it.price ?? 0,
          lineTotal: it.lineTotal ?? it.amount ?? it.line_total ?? (it.rate ?? 0) * (it.quantity ?? 1),
        }));
        const quoteJson = `\`\`\`json\n${JSON.stringify({
          type: 'quote',
          items: normalizedItems,
          subtotal: lastToolResult.subtotal,
          gst: lastToolResult.gst,
          total: lastToolResult.total,
        })}\n\`\`\``;
        const quip = stripJsonBlocks(textContent).trim();
        return { reply: quip ? `${quip}\n${quoteJson}` : quoteJson, taskDone: true };
      }

      // Force crew picker card (rendering requirement)
      // Suppress crew picker when the show was just added for a non-current month —
      // day-offs and assignments aren't meaningful that far out.
      const crewDate = lastToolResult?.date || '';
      const showInCurrentMonth = addShowArgs
        ? (addShowArgs.event_date || '').slice(0, 7) === today.slice(0, 7)
        : true;
      if (lastToolName === 'get_crew_availability' && lastToolResult?.success && (showInCurrentMonth || !addShowArgs)) {
        const crewJson = `\`\`\`json\n${JSON.stringify({
          type: 'crew_availability',
          date: crewDate,
          available: lastToolResult.available,
          assigned: lastToolResult.assigned,
          unavailable: lastToolResult.unavailable,
          conflicts: lastToolResult.conflicts,
        })}\n\`\`\``;
        const parts = [addShowCard, stripJsonBlocks(textContent).trim() || null, crewJson].filter(Boolean);
        return { reply: parts.join('\n'), taskDone: true };
      }

      // Force shows card when query_shows returns 2+ results — but never dump the
      // full schedule during a targeted update (SR/CT/Venue); let Eddy disambiguate.
      if (lastToolName === 'query_shows' && (lastToolResult?.data?.length ?? 0) >= 2
          && effectiveTask?.type !== 'Delete'
          && !(effectiveTask && UPDATE_TASK_TYPES.has(effectiveTask.type))) {
        const showsJson = `\`\`\`json\n${JSON.stringify({
          type: 'shows',
          shows: lastToolResult.data.map((s: any) => ({
            id: s.id ?? 0,
            event_date: s.event_date || '',
            program: s.program || '',
            venue: s.venue || '',
            call_time: s.call_time || '',
            foh_crew: s.foh_crew || '',
            stage_crew: s.stage_crew || '',
            sound_requirements: s.sound_requirements || '',
          })),
        })}\n\`\`\``;
        const quip = stripJsonBlocks(textContent).trim();
        const parts = [addShowCard, quip || null, showsJson].filter(Boolean);
        return { reply: parts.join('\n'), taskDone: false };
      }

      const taskDone = updateShowSucceeded || manageDayOffSucceeded
        || (lastToolName === 'query_shows' && effectiveTask?.type === 'Delete');
      const baseParts = [addShowCard, stripJsonBlocks(textContent).trim() || (addShowCard ? null : 'Done.')].filter(Boolean);
      return { reply: baseParts.join('\n'), taskDone: taskDone || !!addShowCard };
    }

    // Has tool calls — push assistant message preserving full content blocks
    currentMessages.push({ role: 'assistant', content: data.content });

    // Execute all tool calls, collect results
    const toolResults: Array<{ id: string; result: any }> = [];
    for (const toolBlock of toolUseBlocks) {
      const result = await executeTool(toolBlock, orchestrator, today, oneYearOut, toolContext);
      lastToolName = toolBlock.name;
      lastToolResult = result;
      toolResults.push({ id: toolBlock.id, result });

      if (toolBlock.name === 'update_show' && result?.success) updateShowSucceeded = true;
      if (toolBlock.name === 'manage_crew_dayoff' && result?.success) manageDayOffSucceeded = true;
      if (toolBlock.name === 'add_show' && result?.success) addShowArgs = toolBlock.input;
    }

    // Push all results as a single user message (Anthropic requires this)
    currentMessages.push({
      role: 'user',
      content: toolResults.map(tr => ({
        type: 'tool_result',
        tool_use_id: tr.id,
        content: JSON.stringify(tr.result),
      })),
    });
  }

  return { reply: 'Hit the tool-call limit on that one — try breaking it into smaller questions.', taskDone: false };
}

export async function executeTool(
  toolBlock: any,
  orchestrator: OrchestratorClient,
  today: string,
  oneYearOut: string,
  ctx: ToolContext = {},
): Promise<any> {
  const name = toolBlock.name;
  const args = { ...(toolBlock.input || {}) };
  const isUpdateTask = !!(ctx.activeTask && UPDATE_TASK_TYPES.has(ctx.activeTask.type));
  const hints = (isUpdateTask && ctx.lastUserMessage)
    ? parseShowQueryHints(ctx.lastUserMessage, today, ctx.currentYear ?? new Date().getUTCFullYear())
    : {};

  const VENUE_GROUPS: string[][] = [
    ['tt', 'tata', 'tatatheatre', 'tatamainstage'],
    ['tet', 'experimental', 'experimentaltheatre', 'tataexperimental', 'tataexperimentaltheatre'],
    ['lt', 'littletheatre', 'little'],
    ['jbt', 'jamshedbhabha', 'jamshedbhabhatheatre'],
    ['gdt', 'godrej', 'godrejdance', 'godrejdancetheatre'],
  ];

  function venueKey(v: string): string {
    return (v || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  function venueMatches(dbVenue: string, query: string): boolean {
    const dk = venueKey(dbVenue);
    const qk = venueKey(query);
    if (dk === qk) return true;
    if (dk.includes(qk) || qk.includes(dk)) return true;
    return VENUE_GROUPS.some(g => g.includes(dk) && g.includes(qk));
  }

  try {
    switch (name) {
      case 'query_shows': {
        const past6m = new Date(today); past6m.setMonth(past6m.getMonth() - 6);
        const fmt = (d: Date) => d.toISOString().slice(0, 10);

        // SR/CT are task codes — strip before searching; partial show names are fine.
        if (args.program) {
          args.program = sanitizeProgramQuery(args.program);
        }

        // For update tasks, trust parsed hints from the user's message over the model's tool args.
        if (isUpdateTask) {
          if (hints.program) args.program = hints.program;
          if (hints.from) {
            args.from = hints.from;
            args.to = hints.to ?? hints.from;
          }
        }

        // Date-only follow-up (e.g. "no it's the 9th") names no show — recover the last
        // show named earlier in the conversation so we don't lose the filter entirely.
        if (isUpdateTask && !args.program && ctx.lastKnownProgram) {
          args.program = ctx.lastKnownProgram;
        }

        const specificDate = args.from && (!args.to || args.to === args.from);

        if (args.program) {
          if (!args.from) {
            // No date given at all: search full window (6 months back so past shows are findable)
            args.from = fmt(past6m);
            args.to = oneYearOut;
          } else if (isUpdateTask && hints.from && hints.to && args.from === hints.from) {
            // User named a specific date — keep the search tight unless we need multi-date disambiguation.
            args.to = hints.to;
          } else if (!args.to || args.to === args.from) {
            // AI anchored to a date but gave no end (or same-day range, i.e. a default) —
            // extend forward so the show is found even if it's not on that exact date.
            args.to = oneYearOut;
          }
          // If both from and to differ, the AI was given an explicit range — respect it.
        } else if (!args.from) {
          args.from = today;
          if (!args.to) args.to = oneYearOut;
        }

        // programOnly controls whether the ±30-day fallback fires — skip it when
        // we already searched the full window.
        const programOnly = !!args.program;
        const to = args.to || args.from;

        // Promote misclassified venue abbreviation in program field
        if (args.program && !args.venue) {
          const pk = venueKey(args.program);
          if (VENUE_GROUPS.some(g => g.includes(pk))) {
            args.venue = args.program;
            args.program = undefined;
          }
        }

        const result = (await orchestrator.getShows({ from: args.from, to, limit: args.program ? 500 : undefined })) as any;

        if (args.venue && result?.data?.length) {
          result.data = result.data.filter((s: any) => venueMatches(s.venue, args.venue));
        }

        const needle = args.program ? args.program.toLowerCase() : null;
        if (needle && result?.data?.length) {
          result.data = result.data.filter((s: any) =>
            matchesProgram(s.program, needle)
          );
        }

        // Update tasks should never return an unfiltered schedule dump.
        if (isUpdateTask && !needle && (result?.data?.length ?? 0) > 10) {
          return {
            success: true,
            data: [],
            error: 'Too many shows returned — pass program= with the show name (and from/to if a date was given).',
            tooManyResults: true,
          };
        }

        if (isUpdateTask && needle && (result?.data?.length ?? 0) > 15) {
          return {
            success: true,
            data: result.data.slice(0, 15),
            error: `Found ${result.data.length} matches for "${args.program}" — narrow with a date or more of the show name.`,
            tooManyResults: true,
          };
        }

        // If show not found on a specific date, widen ±30 days (even when searching by program name).
        if (needle && specificDate && (!result?.data || result.data.length === 0)) {
          const base = new Date(args.from);
          const searchFrom = new Date(base); searchFrom.setDate(base.getDate() - 30);
          const searchTo = new Date(base); searchTo.setDate(base.getDate() + 30);
          const fmt = (d: Date) => d.toISOString().slice(0, 10);
          const wider = (await orchestrator.getShows({ from: fmt(searchFrom), to: fmt(searchTo) })) as any;
          if (wider?.data?.length) {
            wider.data = wider.data.filter((s: any) =>
              matchesProgram(s.program, needle)
            );
          }
          if (wider?.data?.length) {
            wider.nearbySearch = true;
            wider.requestedDate = args.from;
            return wider;
          }
        }
        return result;
      }

      case 'add_show': {
        return await orchestrator.addShow({
          date_type: 'single',
          event_date: args.event_date,
          program: args.program,
          venue: args.venue,
          team: args.team,
          call_time: args.call_time,
          sound_requirements: args.sound_requirements,
          foh_crew: args.foh_crew,
          stage_crew: args.stage_crew,
        });
      }

      case 'update_show': {
        const patch: any = {};
        if (args.venue !== undefined) patch.venue = args.venue;
        if (args.sound_requirements !== undefined) patch.sound_requirements = args.sound_requirements;
        if (args.call_time !== undefined) patch.call_time = args.call_time;
        if (args.foh_crew !== undefined) patch.foh_crew = args.foh_crew;
        if (args.stage_crew !== undefined) patch.stage_crew = args.stage_crew;
        return await orchestrator.updateShow(args.id, patch);
      }

      case 'get_crew_availability': {
        return await getMergedCrewAvailability(args.date, orchestrator);
      }

      case 'generate_quote': {
        return await generateEquipmentQuote(args.items, orchestrator);
      }

      case 'manage_crew_dayoff': {
        const { action, crew_name, dates } = args;
        if (action === 'list') {
          return await orchestrator.listDayOffs(crew_name);
        } else if (action === 'add') {
          if (!dates || dates.length === 0) return { error: 'dates[] required for add' };
          return await orchestrator.addDayOffs(crew_name, dates);
        } else if (action === 'remove') {
          if (!dates || dates.length === 0) return { error: 'dates[] required for remove' };
          return await orchestrator.removeDayOffs(crew_name, dates);
        }
        return { error: `Unknown action: ${action}` };
      }

      default:
        return { error: `Unknown tool: ${name}` };
    }
  } catch (err: any) {
    return { error: err.message || String(err) };
  }
}

async function getMergedCrewAvailability(date: string, orchestrator: OrchestratorClient) {
  const VALID_CREW = [
    'Naren', 'Sandeep', 'Coni', 'Nikhil', 'NS', 'Aditya',
    'Viraj', 'Shridhar', 'Nazar', 'Omkar', 'Akshay',
    'OC1', 'OC2', 'OC3'
  ];

  const crewData = await orchestrator.getAllCrew() as any;
  const allCrew: any[] = crewData.data || [];

  const availData = await orchestrator.getCrewAvailability(date) as any;
  const unavailIds = new Set(
    (availData.data || [])
      .filter((c: any) => !c.available)
      .map((c: any) => c.id)
  );

  const showsData = await orchestrator.getShows({ from: date, to: date }) as any;
  const events: any[] = showsData.data || [];

  const assignedSet = new Set<string>();
  for (const event of events) {
    const parseCrew = (s: string | null) => {
      if (!s) return;
      s.split(',').map(m => m.trim()).filter(Boolean).forEach(m => assignedSet.add(m));
    };
    parseCrew(event.crew);
    parseCrew(event.foh_crew);
    parseCrew(event.stage_crew);
  }

  const nameToId = new Map<string, number>();
  for (const c of allCrew) {
    if (c.name) nameToId.set(c.name, c.id);
  }

  const available = VALID_CREW.filter(name => {
    const id = nameToId.get(name);
    return !assignedSet.has(name) && (!id || !unavailIds.has(id));
  });

  const assigned = VALID_CREW.filter(name => assignedSet.has(name));
  const unavailable = VALID_CREW.filter(name => {
    const id = nameToId.get(name);
    return id && unavailIds.has(id) && !assignedSet.has(name);
  });

  return {
    success: true,
    available,
    assigned,
    unavailable,
    conflicts: events.map((e: any) => ({
      id: e.id,
      event_date: e.event_date,
      program: e.program,
      venue: e.venue,
      crew: [e.foh_crew, e.stage_crew, e.crew].filter(Boolean).join(', ') || 'no crew yet',
    })),
    date,
  };
}

async function generateEquipmentQuote(items: string[], orchestrator: OrchestratorClient) {
  const equipListData = await orchestrator.getQuoteEquipment() as any;
  const equipList: any[] = equipListData.data || [];

  const quoteItems: any[] = [];
  const unmatched: string[] = [];

  for (const item of items) {
    const leadingQtyVal = item.match(/^(\d+)(?:\s*[xX×]\s*|\s+)/);
    const trailingQty = item.match(/[-xX×](\d+)$/);
    const qty = leadingQtyVal
      ? parseInt(leadingQtyVal[1])
      : trailingQty
        ? parseInt(trailingQty[1])
        : 1;

    const itemNorm = item
      .replace(/^\d+\s*[xX×]\s*/, '')   // "4xM4" or "4 x M4"
      .replace(/^\d+\s+/, '')            // "4 M4" (space format from Claude)
      .replace(/\s*[-xX×]\s*\d+$/, '')   // "M4-4" or "M4x4" trailing qty
      .trim();
    const itemLower = itemNorm.toLowerCase();
    // Keep numeric terms — model numbers (Beta 52, Beta 91, SM58...) are often
    // the only thing distinguishing one mic from another in the same family.
    // Also split each word on letter/digit boundaries ("beta91" -> "beta", "91")
    // since shorthand like "beta91" or "beta52" glues the model number to the name.
    const rawWords = itemLower.split(/[\s\-]+/).filter((w: string) => w.length > 0);
    const allTerms = [...new Set(rawWords.flatMap((w: string) => {
      const parts = w.match(/[a-z]+|[0-9]+/g) || [w];
      return parts.length > 1 ? [w, ...parts] : [w];
    }))];

    let bestMatch: any = null;
    let bestScore = 0;

    for (const eq of equipList) {
      const name = (eq.name || '').toLowerCase();
      const category = (eq.category || '').toLowerCase();
      const nameWords = name.split(/[\s\-]+/);
      const categoryWords = category.split(/[\s\-]+/);

      let score = 0;
      for (const term of allTerms) {
        if (nameWords.includes(term)) score += 3;
        else if (categoryWords.includes(term)) score += 2;
        else if (name.includes(term)) score += 2;
      }

      if (score > bestScore) {
        bestScore = score;
        bestMatch = eq;
      }
    }

    if (!bestMatch || bestScore < 3) {
      unmatched.push(item);
      continue;
    }
    const unitRate = bestMatch.rate ?? bestMatch.price ?? bestMatch.unit_price ?? bestMatch.daily_rate ?? bestMatch.hire_rate ?? 0;
    quoteItems.push({
      name: bestMatch.name,
      quantity: qty,
      rate: unitRate,
      lineTotal: unitRate * qty,
    });
  }

  if (quoteItems.length === 0) {
    return {
      success: false,
      error: 'No equipment matched from quote database',
      unmatched,
      available_equipment: equipList.map((e: any) => e.name),
    };
  }

  const quoteData = await orchestrator.generateQuote({
    client_name: 'NCPA Internal',
    event_name: 'Sound Hire Quote',
    items: quoteItems,
    notes: '',
  }) as any;

  if (!quoteData.success) {
    return {
      success: false,
      error: quoteData.error || 'Quote generation failed',
      unmatched,
    };
  }

  const data = quoteData.data;
  // Build display items from local data (name/qty/rate are reliable).
  // Orchestrator echoes may omit these fields — don't rely on them.
  // Fall back to orchestrator items for rate if local rate is 0 (field name unknown).
  const orchItems: any[] = data.items || [];
  const displayItems = quoteItems.map((qi, idx) => {
    const orch = orchItems[idx] || {};
    const rate = qi.rate || (orch.rate ?? orch.unit_price ?? orch.price ?? 0);
    const lineTotal = qi.lineTotal || (orch.amount ?? orch.line_total ?? orch.lineTotal ?? rate * qi.quantity);
    return { name: qi.name, quantity: qi.quantity, rate, lineTotal };
  });
  return {
    success: true,
    quote_number: data.quote_number,
    date: data.date,
    client_name: data.client_name,
    event_name: data.event_name,
    items: displayItems,
    subtotal: data.subtotal,
    gst: data.gst,
    total: data.total,
    formatted_total: data.formatted_total,
    plain_text: data.plain_text,
    unmatched: unmatched.length ? unmatched : undefined,
  };
}
