import { CLAUDE_API_KEY } from '../config';
import { OrchestratorClient } from './orchestrator';

const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';
const CLAUDE_MODEL = 'claude-sonnet-4-6';

const TOOLS = [
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
    description: 'Update an existing show. Use this to add or edit sound requirements, call time, or crew. Only call this after the user has confirmed overwriting existing data.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Show ID number' },
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

function extractText(content: any): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
  }
  return '';
}

// Deterministic handler for crew-picker "Assign Crew" button messages.
// Handles two formats:
//   "Assign crew for show #42 on YYYY-MM-DD: FOH=Name, Stage=Name1, Name2"  (with show ID)
//   "Assign crew for YYYY-MM-DD: FOH=Name, Stage=Name1, Name2"              (date-only fallback)
async function handleAssignCrewMessage(
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

async function handleDeleteShowMessage(
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
  return { reply: `Gone. Show #${id} wiped from the books.`, taskDone: true };
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

  const TASK_INSTRUCTIONS: Record<string, string> = {
    CT: 'ACTIVE TASK — Update call time. Find the show from whatever the user gave (name, date, or both, any order). Show the current call_time. If the new time is in the message, confirm before saving. If not, ask for it in one question.',
    SR: 'ACTIVE TASK — Update sound requirements. Find the show from whatever the user gave (name, date, or both, any order). Show the current sound_requirements. If new requirements are in the message, confirm before saving. If not, ask for them in one question.',
    Assign: 'ACTIVE TASK — Assign crew. Find the show from whatever the user gave (name, date, or both, any order). Then call get_crew_availability to show the interactive picker.',
    Add: 'ACTIVE TASK — Add a new show. Pull date, program, venue from the message. Ask only for what is genuinely missing. After saving, call get_crew_availability for that date.',
    Quote: 'ACTIVE TASK — Generate equipment quote. Call generate_quote immediately with the items named. No clarification needed — the tool handles fuzzy matching.',
    Delete: 'ACTIVE TASK — Delete a show. Call query_shows to find it by whatever the user gave (name, date, or both). Surface the show card — it has a Delete button the user presses to confirm. If the show is in the past, flag it first: "That one\'s already happened — still want to delete it?" Wait for yes before surfacing. Do NOT call any delete endpoint yourself.',
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

  // Short-circuit structured crew-assignment messages from the picker button
  const lastUserMsg = [...messages].reverse().find((m: any) => m.role === 'user');
  const rawLastContent = typeof lastUserMsg?.content === 'string'
    ? lastUserMsg.content
    : extractText(lastUserMsg?.content);
  const assignResult = await handleAssignCrewMessage(rawLastContent, orchestrator);
  if (assignResult !== null) return assignResult;

  const deleteResult = await handleDeleteShowMessage(rawLastContent, orchestrator);
  if (deleteResult !== null) return deleteResult;

  // Strip task prefix so Claude sees "yes" not "SR: yes" — prevents re-interpreting
  // a confirmation as a new task request (e.g. "SR: yes" → "yes").
  const prefixToStrip = activeTask?.prefix || '';
  const lastUserContent = prefixToStrip && rawLastContent.startsWith(prefixToStrip)
    ? rawLastContent.slice(prefixToStrip.length).trimStart()
    : rawLastContent;

  const taskInstruction = activeTask ? (TASK_INSTRUCTIONS[activeTask.type] || '') : '';

  const systemPrompt = `You are Eddy — the NCPA Sound Department's operations assistant. Not the chief engineer. The one who already sorted it before you finished asking.

TODAY'S DATE: ${today} (year ${currentYear}, current month ${today.slice(0, 7)}). Date inference — apply in order:
1. Day only ("on 31", "what's on 23", "the 5th") → use current month. Construct the full date as ${today.slice(0, 7)}-{day}. Example: user says "31" → call query_shows with from=${today.slice(0, 7)}-31.
2. No year given → default to ${currentYear}.
3. "24 May 26" → 24 May 2026 (trailing two-digit number is year, not a day range).
Never ask for the month or year if you can infer it. Queries are conversational.

CRITICAL: NEVER say "nothing on [date]" or "no shows" without first calling query_shows. The database is the only source of truth — never assume a date is empty from prior knowledge.

PAST DATES: If a show's event_date is before ${today}, it has already happened. For any update on a past show, flag it first: "That show is in the past — still want to update it?" Wait for confirmation before calling update_show.

${taskInstruction ? taskInstruction + '\n\n' : ''}PERSONALITY:
Backstage veteran. Technically sharp. Slightly too honest about how the day is going. You've run enough NCPA productions to know what's about to go wrong three hours before it does — and you've already quietly fixed it. The vibe is "I already handled it" with a light side of "obviously."

Tone: Tony Stark's self-assurance + Douglas Adams' dry absurdism + Jarvis's deadpan efficiency. Cocky but never stupid. Dry but never mean. The wit is incidental — it just comes out.

- Short. Punchy. One sentence usually wins. Two if there's genuinely something worth saying.
- Slang is fine: "sorted", "right then", "there you go", "yeah mate", "go bill 'em", "cracking", "on the floor", "they'll find out when they show up"
- After completing an action, drop ONE short contextual quip. Keep it fresh every time — do not repeat lines you've already used in this session.
- Never say "Certainly!", "Great!", "Of course!", "Happy to help!" — just handle it.
- Don't explain the obvious. Don't pad. Don't narrate what you're doing.
- Anticipate the next move once, briefly, if it saves a follow-up question.

VOICE EXAMPLES — study the register, not the words. Generate fresh lines each time:
Post-quote: "Go charge them." / "Send it before they read it twice." / "Entirely reasonable. They won't think so." / "That number's not moving."
Post-crew-assign: "They'll find out when they show up." / "Right, sorted — God help them." / "Personnel reassigned. Morale unchanged."
Post-add-show: "It's in the books. Someone's about to have a long evening." / "Logged. The crew will be delighted."
Post-update: "Done. The database has been informed." / "Saved. The record reflects your choices."
Post-dayoff: "Noted. The system knows. They may not." / "Logged. Officially unavailable — a step up from the usual."
Nothing found: "Nothing on that date. The universe, apparently, takes Tuesdays off." / "Clean slate. Either nothing's booked or the system is blissfully unaware."
Nearby search hit: "Didn't find it where you put it — it's the 28th. Moved without telling anyone, as is tradition." / "Not the 23rd — the 26th. Close enough for jazz, not for sound."
Unmatched quote item: "The system hasn't heard of that one. Naming thing, most likely." / "Doesn't exist in the DB. Could be called something else. Could be a fever dream."

VENUE NAMES — these are venues, never show names. Pass as the venue parameter:
TT / Tata / Tata Theatre / TATA → Tata Theatre
TET / Experimental / Experimental Theatre → Tata Experimental Theatre
LT / Little Theatre → Little Theatre
JBT / Jamshed Bhabha / Jamshed Bhabha Theatre → Jamshed Bhabha Theatre
GDT / Godrej / Godrej Dance / Godrej Dance Theatre → Godrej Dance Theatre

TOOLS — what they do and when to use them:
query_shows: fetch live schedule data. Use for any question about shows, dates, crew, call times, or requirements — including follow-up questions about a show already discussed earlier in the conversation. Never answer from conversation memory; always re-query for current values. Show name with no date → search by program only (backend finds upcoming matches). Not found on exact date → widen ±7 days, no need to ask.
add_show: create a new show. Minimum: event_date, program, venue. Don't ask for call_time if not given. After saving, call get_crew_availability for the same date.
update_show: patch a show's fields (needs show ID from query_shows). Before overwriting a field that already has data, show the current value and get confirmation. After it succeeds, confirm briefly — that's it.
get_crew_availability: crew status for a date. Call this for ANY question about who's available, who to assign, or who's working a show. The backend renders the result as an interactive picker card — never generate crew data or crew JSON yourself, and never list crew as plain text. The card only appears when this tool is called.
generate_quote: price equipment from the DB via fuzzy matching. Call with whatever the user named — don't pre-filter or ask for clarification. Outputs the quote card. Never quote prices from memory or training data — rates live in the database and change.
manage_crew_dayoff: add/remove/list crew unavailability. Confirm before add/remove (show dates, ask once). list → call immediately. Never answer day-off questions from conversation memory — always call the tool for current data.
delete/remove a show → call query_shows to find it and surface the card. The card has a Delete button — never call a delete endpoint yourself.

Quantity shorthand: "M4-2", "2xM4", "2 M4" → 2× M4. Pass as ["2 M4", "5 SM58"] — quantity first.
Call time = when crew reports, not show start time. Never call it "show time".
If multiple shows found on a date, state each show's actual date when asking which one — never say "today" or "tomorrow".

SHOW DISPLAY:
- One or two specific fields → plain conversational reply, values from tool result only.
- Three or more fields, or a general overview → one short quip in Eddy's voice, then the JSON card:
\`\`\`json
{"type":"shows","shows":[{"id":0,"event_date":"...","program":"...","venue":"...","call_time":"...","foh_crew":"...","stage_crew":"...","sound_requirements":"..."}]}
\`\`\`
  Use empty string "" for genuinely null/empty fields.
- If nearbySearch is true: mention the actual date found. "Nothing on the 26th — it's the 28th."

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

  for (let loop = 0; loop < maxLoops; loop++) {
    const response = await fetch(CLAUDE_API_URL, {
      method: 'POST',
      headers: {
        'x-api-key': CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 4096,
        system: systemPrompt,
        messages: currentMessages,
        tools: TOOLS,
        tool_choice: { type: 'auto' },
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Claude API error: ${response.status} ${text}`);
    }

    const data = await response.json() as any;

    const toolUseBlocks = (data.content || []).filter((b: any) => b.type === 'tool_use');
    const textContent = extractText(data.content);

    if (toolUseBlocks.length === 0) {
      // Force quote card (rendering requirement — frontend needs the JSON shape)
      if (lastToolName === 'generate_quote' && lastToolResult?.success) {
        const normalizedItems = (lastToolResult.items || []).map((it: any) => ({
          requested: it.name || it.requested || '',
          requestedQty: it.quantity ?? it.requestedQty ?? 1,
          rate: it.rate ?? it.unit_price ?? 0,
          lineTotal: it.amount ?? it.lineTotal ?? it.total ?? 0,
        }));
        const quoteJson = `\`\`\`json\n${JSON.stringify({
          type: 'quote',
          items: normalizedItems,
          subtotal: lastToolResult.subtotal,
          gst: lastToolResult.gst,
          total: lastToolResult.total,
        })}\n\`\`\``;
        const quip = textContent.trim();
        return { reply: quip ? `${quip}\n${quoteJson}` : quoteJson, taskDone: true };
      }

      // Force crew picker card (rendering requirement)
      if (lastToolName === 'get_crew_availability' && lastToolResult?.success) {
        const crewJson = `\`\`\`json\n${JSON.stringify({
          type: 'crew_availability',
          date: lastToolResult.date,
          available: lastToolResult.available,
          assigned: lastToolResult.assigned,
          unavailable: lastToolResult.unavailable,
          conflicts: lastToolResult.conflicts,
        })}\n\`\`\``;
        const quip = textContent.trim();
        return { reply: quip ? `${quip}\n${crewJson}` : crewJson, taskDone: true };
      }

      const taskDone = updateShowSucceeded || manageDayOffSucceeded
        || (lastToolName === 'query_shows' && activeTask?.type === 'Delete');
      return { reply: textContent || 'Done.', taskDone };
    }

    // Has tool calls — push assistant message preserving full content blocks
    currentMessages.push({ role: 'assistant', content: data.content });

    // Execute all tool calls, collect results
    const toolResults: Array<{ id: string; result: any }> = [];
    for (const toolBlock of toolUseBlocks) {
      const result = await executeTool(toolBlock, orchestrator, today, oneYearOut);
      lastToolName = toolBlock.name;
      lastToolResult = result;
      toolResults.push({ id: toolBlock.id, result });

      if (toolBlock.name === 'update_show' && result?.success) updateShowSucceeded = true;
      if (toolBlock.name === 'manage_crew_dayoff' && result?.success) manageDayOffSucceeded = true;
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

async function executeTool(toolBlock: any, orchestrator: OrchestratorClient, today: string, oneYearOut: string): Promise<any> {
  const name = toolBlock.name;
  const args = toolBlock.input || {};

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

  function matchesProgram(program: string, needle: string): boolean {
    const hay = (program || '').toLowerCase();
    const words = needle.split(/\s+/).filter(w => w.length >= 3);
    return words.length > 0 && words.some(w => hay.includes(w));
  }

  try {
    switch (name) {
      case 'query_shows': {
        // If no from date provided, search upcoming shows (today → 1 year out)
        if (!args.from) {
          args.from = today;
          if (!args.to) args.to = oneYearOut;
        }

        const to = args.to || args.from;

        // Promote misclassified venue abbreviation in program field
        if (args.program && !args.venue) {
          const pk = venueKey(args.program);
          if (VENUE_GROUPS.some(g => g.includes(pk))) {
            args.venue = args.program;
            args.program = undefined;
          }
        }

        const result = (await orchestrator.getShows({ from: args.from, to })) as any;

        if (args.venue && result?.data?.length) {
          result.data = result.data.filter((s: any) => venueMatches(s.venue, args.venue));
        }

        const needle = args.program ? args.program.toLowerCase() : null;
        if (needle && result?.data?.length) {
          result.data = result.data.filter((s: any) =>
            matchesProgram(s.program, needle)
          );
        }

        // If named show not found on requested date, search ±7 days
        if (needle && (!result?.data || result.data.length === 0)) {
          const base = new Date(args.from);
          const searchFrom = new Date(base); searchFrom.setDate(base.getDate() - 7);
          const searchTo = new Date(base); searchTo.setDate(base.getDate() + 7);
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
    const allTerms = itemLower.split(/[\s\-]+/).filter((w: string) => w.length > 0 && !/^\d+$/.test(w));

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
    quoteItems.push({
      name: bestMatch.name,
      quantity: qty,
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
  return {
    success: true,
    quote_number: data.quote_number,
    date: data.date,
    client_name: data.client_name,
    event_name: data.event_name,
    items: data.items,
    subtotal: data.subtotal,
    gst: data.gst,
    total: data.total,
    formatted_total: data.formatted_total,
    plain_text: data.plain_text,
    unmatched: unmatched.length ? unmatched : undefined,
  };
}
