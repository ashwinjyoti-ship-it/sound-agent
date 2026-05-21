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

// Task-specific system prompt injections keyed by activeTask.type
const TASK_INSTRUCTIONS: Record<string, string> = {
  CT: 'ACTIVE TASK — Update call time: The user wants to update a call time. Call query_shows to find the show (if only a name was given, search without a date). Show the existing call_time and ask "Overwrite with [new time]?" before calling update_show. After update_show succeeds, call query_shows to verify the saved call_time, then confirm with the actual saved value.',
  SR: 'ACTIVE TASK — Update sound requirements: The user wants to update sound requirements. Call query_shows to find the show (if only a name was given, search without a date). Always state the current sound_requirements value explicitly (e.g. "Sound requirements currently: DPA 4099 on violin. Overwrite with X?") before calling update_show. After update_show succeeds, call query_shows to verify, then confirm.',
  Assign: 'ACTIVE TASK — Assign crew: The user wants to assign crew to a show. If a date was given, call get_crew_availability. If a show name was given, call query_shows first to find the date, then get_crew_availability.',
  Add: 'ACTIVE TASK — Add a new show: The user wants to add a show. Collect event_date, program, venue (required) from what they typed. If anything required is missing, ask. Once you have the minimum, call add_show, then immediately call get_crew_availability for the same date.',
  Quote: 'ACTIVE TASK — Generate equipment hire quote: Call generate_quote immediately with the item names and quantities from the user\'s message. Do not ask for clarification on item names — the tool handles fuzzy matching and will report anything it cannot match.',
  DayOff: `ACTIVE TASK — Manage crew day-offs: The user wants to add, remove, or list day-offs for a crew member.

Day-off rules (follow exactly):
1. Cross-reference the crew name against this known list: Naren, Sandeep, Coni, Nikhil, NS, Aditya, Viraj, Shridhar, Nazar, Omkar, Akshay, OC1, OC2, OC3. If the name is ambiguous or not found, ask the user to clarify before proceeding.
2. Date expansion — if the user gives day numbers only (e.g. "1,4,6,9,12"):
   - No month mentioned → use the current month to expand. Example: "Coni: 1,4,6" in May 2026 → 2026-05-01, 2026-05-04, 2026-05-06.
   - Month explicitly mentioned (e.g. "June", "Jul", "next month") → use that month. Example: "Coni off 1,4,6 June" in May 2026 → 2026-06-01, 2026-06-04, 2026-06-06.
   - "Next month" → use the month after the current one. Always construct full YYYY-MM-DD dates.
3. Confirm before adding — show the expanded list in a readable format and ask "Adding day-offs for [Name]: [1 May, 4 May …] — confirm?" Wait for the user's yes before calling manage_crew_dayoff with action=add.
4. Confirm before removing — same pattern: list the dates and ask "Removing day-offs for [Name]: [dates] — confirm?" Wait for yes.
5. For action=list — call manage_crew_dayoff immediately without confirmation.
6. After a successful add/remove, summarise what was done: "Done. Added X day-offs for [Name]." or "Removed [dates] for [Name]."
7. Correction handling — if the user replies with a change rather than a plain yes/confirm (e.g. "actually make it 1, 4, 7" or "remove the 4th"), this is a CORRECTION, not a confirmation. Do NOT call manage_crew_dayoff. Update the list with the correction, show the revised dates, and ask for confirmation again. Only call the tool when the user explicitly confirms the final list.`,
};

export async function chatWithClaude(
  messages: any[],
  orchestrator: OrchestratorClient,
  activeTask?: { type: string; prefix: string } | null,
): Promise<{ reply: string; taskDone: boolean }> {
  const nowIST = new Date(Date.now() + (5 * 60 + 30) * 60 * 1000);
  const today = nowIST.toISOString().slice(0, 10);
  const oneYearOut = new Date(nowIST.getTime() + 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const currentYear = nowIST.getUTCFullYear();

  // Short-circuit structured crew-assignment messages from the picker button
  const lastUserMsg = [...messages].reverse().find((m: any) => m.role === 'user');
  const rawLastContent = typeof lastUserMsg?.content === 'string'
    ? lastUserMsg.content
    : extractText(lastUserMsg?.content);
  const assignResult = await handleAssignCrewMessage(rawLastContent, orchestrator);
  if (assignResult !== null) return assignResult;

  // Strip task prefix so Claude sees "yes" not "SR: yes" — prevents re-interpreting
  // a confirmation as a new task request (e.g. "SR: yes" → "yes").
  const prefixToStrip = activeTask?.prefix || '';
  const lastUserContent = prefixToStrip && rawLastContent.startsWith(prefixToStrip)
    ? rawLastContent.slice(prefixToStrip.length).trimStart()
    : rawLastContent;

  const taskInstruction = activeTask ? (TASK_INSTRUCTIONS[activeTask.type] || '') : '';

  const systemPrompt = `You are Eddy — the NCPA Sound Department's operations assistant. Not the chief engineer. The calm intelligence that keeps the whole operation running when the day gets ridiculous.

TODAY'S DATE: ${today} (year ${currentYear}, current month ${today.slice(0, 7)}). Date inference — apply in order:
1. Day only ("on 31", "what's on 23", "the 5th") → use current month. Construct the full date as ${today.slice(0, 7)}-{day}. Example: user says "31" → call query_shows with from=${today.slice(0, 7)}-31.
2. No year given → default to ${currentYear}.
3. "24 May 26" → 24 May 2026 (trailing two-digit number is year, not a day range).
Never ask for the month or year if you can infer it. Queries are conversational.

CRITICAL: NEVER say "nothing on [date]" or "no shows" without first calling query_shows. The database is the only source of truth — never assume a date is empty from prior knowledge.

PAST DATES: If a show's event_date is before ${today}, it has already happened. For any update on a past show, flag it first: "That show is in the past — still want to update it?" Wait for confirmation before calling update_show.

${taskInstruction ? taskInstruction + '\n\n' : ''}PERSONALITY:
You are a highly capable operations coordinator — calm under pressure, organised without being rigid, technically aware, socially intuitive. You've seen chaos before. You expect problems and quietly solve them early. The vibe is: "I already handled it."

- Warm but efficient. Smart without showing off.
- Occasionally witty — dry, operational humour grounded in real backstage life. Never forced.
  Good: "The backup cable has now become the primary cable through destiny."
  Bad: "Your request has been successfully processed."
- Keep replies short and readable. Short paragraphs. One sentence is often plenty.
- Anticipate the next step and mention it if useful — reduce friction, not add to it.
- Never say "Certainly!", "Great question!", "Of course!", or anything that sounds like a help-desk script. Just answer.
- Never create panic. Never overload with theory. Stay composed.
- Use natural contractions. No corporate jargon. No motivational language.

Default response flow: direct answer → practical recommendation → optional insight or caution → light personality if it fits naturally.

VENUE NAMES — these words are venues, NEVER show/program names. When the user mentions any of these, pass it as the venue parameter (never as program):
TT, Tata, Tata Theatre, TATA — all mean Tata Theatre (main stage)
TET, Experimental, Experimental Theatre — all mean Tata Experimental Theatre
LT, Little Theatre — Little Theatre
JBT, Jamshed Bhabha, Jamshed Bhabha Theatre — Jamshed Bhabha Theatre
GDT, Godrej, Godrej Dance, Godrej Dance Theatre — Godrej Dance Theatre
Pass the user's shorthand as-is in the venue parameter; the backend resolves aliases.

TOOLS — use them every time, no exceptions:
- Schedule / shows → query_shows
- If user gives only a show name with no date → call query_shows without from/to (backend searches upcoming shows automatically)
- Crew availability → get_crew_availability
- Add a show → add_show with whatever fields the user provides (date, program, venue are enough — call_time is optional, do NOT ask for it); once add_show succeeds, immediately call get_crew_availability for the same date so the user can assign crew right away
- Assign crew to an existing show (user says "assign crew to [show]" or provides "FOH=..., Stage=...") → you MUST call query_shows first to find the show and get its ID, then call update_show with the crew. Never say "Done" or "Assigned" until update_show has been called and returned success. Do NOT list available crew as text — call get_crew_availability to show the interactive picker card.
- Update a show (sound requirements, call time, crew) → first call query_shows with the date and program name (do NOT ask for venue). If multiple shows are found, ask which one — always state each show's actual date (e.g. "18 May" or "19 May"), never just "today" or "tomorrow". If the field you are about to overwrite already has data, tell the user the current value and ask "Overwrite with X?" — wait for their reply. Once they confirm, call update_show with the show id and the new value. After update_show succeeds, call query_shows to verify the field was actually saved, then confirm with the verified value. Never say "Done" or "Updated" unless you have called update_show AND verified with query_shows.
- Any pricing, quote, equipment cost → generate_quote (never quote prices from memory — the database is the source of truth)
- Crew day-offs / unavailability (add, remove, list) → manage_crew_dayoff
  - Day numbers only, no month → expand using current month (${today.slice(0, 7)})
  - Day numbers with explicit month (e.g. "June", "Jul", "next month") → expand using that month, not the current one
  - Always confirm the expanded list before action=add or action=remove
  - action=list → call immediately, no confirmation needed
  - Cross-reference crew name against: Naren, Sandeep, Coni, Nikhil, NS, Aditya, Viraj, Shridhar, Nazar, Omkar, Akshay, OC1, OC2, OC3
  - CORRECTION FLOW: if the user modifies any dates or name instead of simply confirming, do NOT call manage_crew_dayoff — update the list, re-show it, and ask "confirm?" again. Call the tool ONLY on an explicit yes/confirm to a confirmation question.
- Quote items: always call generate_quote with whatever the user names — the tool handles fuzzy matching and returns unmatched items if something doesn't exist. Never pre-filter or refuse to call the tool because you don't recognise a name.
- Quantity shorthand: "M4-2" or "2xM4" or "2 M4" all mean 2× M4. Pass as ["2 M4", "5 SM58", etc.] — quantity first, then item name.

CALL TIME — important distinction:
Call time is when the sound crew reports in, not the show's performance start time. These are different. When displaying or discussing call time, never describe it as "show time" or "performance time". If someone asks "when do we report?" or "what's the call?" — that's call time.

SHOW QUERY RULES:
- When the user mentions a show name, ALWAYS pass it as the program parameter to query_shows.
- When the user mentions a venue name (see VENUE NAMES above), ALWAYS pass it as the venue parameter, never as program.
- If the show is not found on the exact date, immediately widen the search by passing from= 7 days before to= 7 days after — do NOT ask the user whether to search. Just search and report.
- One or two specific fields asked → plain conversational reply using ONLY values from the tool result. Read every requested field from the result and report it accurately. Never say "not listed" or "none" without confirming the actual field value in the result.
  Examples: "Crew is Nikhil and OC1." / "Sound requirements: DPA 4099 on violin, 2× SM58."
- Three or more fields, or a general overview → output ONLY this JSON block, no other text:
\`\`\`json
{"type":"shows","shows":[{"event_date":"...","program":"...","venue":"...","call_time":"...","foh_crew":"...","stage_crew":"...","sound_requirements":"..."}]}
\`\`\`
  Populate foh_crew and stage_crew from the tool result's foh_crew/stage_crew fields. Use empty string "" for fields that are genuinely null/empty.
- If nearbySearch is true in the tool result, say what date the show is actually on: "Nothing on 26 May — found it on 28 May, crew is Nikhil."

QUOTE RULES:
- After generate_quote succeeds, output ONLY this JSON block, nothing else:
\`\`\`json
{"type":"quote","items":[...],"subtotal":0,"gst":0,"total":0}
\`\`\`
- Do not summarise the quote in text. The card handles it.

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

  // Verification state — track whether update_show ran and if we've re-queried to confirm
  let updateShowSucceeded = false;
  let queryShowsCalledAfterUpdate = false;
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

    // No tool calls — apply guards or return
    if (toolUseBlocks.length === 0) {
      const replyLower = textContent.toLowerCase();
      const lastUserLower = lastUserContent.toLowerCase();

      // Verification guard: update_show ran but we haven't re-queried to confirm the save
      if (updateShowSucceeded && !queryShowsCalledAfterUpdate && loop < maxLoops - 1) {
        currentMessages.push({ role: 'assistant', content: textContent });
        currentMessages.push({ role: 'user', content: 'Before confirming done, call query_shows for the same show/date to verify the update was actually saved to the database.' });
        continue;
      }

      // Guard 4: user confirmed an overwrite but AI responded without calling update_show (loop 0 only)
      if (loop === 0 && lastToolName === null) {
        const isConfirmation = /^(yes|yeah|yep|yup|ok|okay|sure|go ahead|do it|confirm|correct|right|proceed|absolutely|sounds good)\b/i.test(lastUserContent.trim());
        const prevAssistant = [...currentMessages].reverse().find((m: any) => m.role === 'assistant');
        const prevText = extractText(prevAssistant?.content);
        if (isConfirmation && /overwrite|set to|update.*to|change.*to|properly instead/i.test(prevText)) {
          currentMessages.push({ role: 'assistant', content: textContent });
          currentMessages.push({ role: 'user', content: 'The user confirmed. First call query_shows to find the show and get its ID, then call update_show with the confirmed field values. Do not say Done until update_show returns success.' });
          continue;
        }
      }

      // Guard 5: AI said Done/Updated without ever calling update_show
      if (lastToolName !== 'update_show' && loop < maxLoops - 1 &&
          /\b(done|updated|assigned|all set|crew.*set|set to|call time.*set|saved)\b/i.test(replyLower) &&
          /update|set|change|save|assign/i.test(lastUserLower)) {
        currentMessages.push({ role: 'assistant', content: textContent });
        currentMessages.push({ role: 'user', content: 'update_show was never called. First call query_shows to find the show ID, then call update_show to actually save the changes. Do not say Done until update_show returns success.' });
        continue;
      }

      // Guard: quote requested but AI responded with text instead of calling generate_quote
      if (lastToolName !== 'generate_quote' && loop < maxLoops - 1 &&
          /quote.*items|items.*quote|quote.*equipment|price.*for|cost.*for|rate.*for/i.test(lastUserContent) &&
          /clarif|which.*item|what.*item|can.*you.*specify|don.*t.*have|not.*recogni|not.*find|can.*t.*find/i.test(replyLower)) {
        currentMessages.push({ role: 'assistant', content: textContent });
        currentMessages.push({ role: 'user', content: 'Call generate_quote with the item names exactly as the user stated them. The tool does fuzzy matching — do not ask for clarification before calling it.' });
        continue;
      }

      // Guard 6: AI said day-offs were added/removed without calling manage_crew_dayoff
      if (lastToolName !== 'manage_crew_dayoff' && loop < maxLoops - 1 &&
          /\b(done|added|removed|set|day.?off.*saved|saved.*day.?off)\b/i.test(replyLower)) {
        const prevAssistant = [...currentMessages].reverse().find((m: any) => m.role === 'assistant');
        const prevText = extractText(prevAssistant?.content);
        const dayOffConfirmPending = /confirm\?|day.?off.*confirm|adding day|removing day/i.test(prevText);
        const isConfirmation = /^(yes|yeah|yep|yup|ok|okay|sure|go ahead|do it|confirm|correct|right|proceed|absolutely|sounds good)\b/i.test(lastUserContent.trim());
        if (dayOffConfirmPending && isConfirmation) {
          currentMessages.push({ role: 'assistant', content: textContent });
          currentMessages.push({ role: 'user', content: 'The user confirmed the day-offs. Call manage_crew_dayoff with the confirmed action and dates from the confirmation question above. Do not say Done until the tool returns success.' });
          continue;
        }
      }

      // Guard 7: day-off confirm was pending, user made a correction, but AI tried to call the tool without re-confirming
      // (handled in the tool-call branch below — see correction intercept)

      // Force quote card
      if (lastToolName === 'generate_quote' && lastToolResult?.success) {
        const normalizedItems = (lastToolResult.items || []).map((it: any) => ({
          requested: it.name || it.requested || '',
          requestedQty: it.quantity ?? it.requestedQty ?? 1,
          rate: it.rate ?? it.unit_price ?? 0,
          lineTotal: it.amount ?? it.lineTotal ?? it.total ?? 0,
        }));
        return {
          reply: `\`\`\`json\n${JSON.stringify({
            type: 'quote',
            items: normalizedItems,
            subtotal: lastToolResult.subtotal,
            gst: lastToolResult.gst,
            total: lastToolResult.total,
          })}\n\`\`\``,
          taskDone: true,
        };
      }

      // Force crew picker card
      if (lastToolName === 'get_crew_availability' && lastToolResult?.success) {
        return {
          reply: `\`\`\`json\n${JSON.stringify({
            type: 'crew_availability',
            date: lastToolResult.date,
            available: lastToolResult.available,
            assigned: lastToolResult.assigned,
            unavailable: lastToolResult.unavailable,
            conflicts: lastToolResult.conflicts,
          })}\n\`\`\``,
          taskDone: true,
        };
      }

      // Verified update complete
      const taskDone = (updateShowSucceeded && queryShowsCalledAfterUpdate) || manageDayOffSucceeded;
      return { reply: textContent || 'Done.', taskDone };
    }

    // Guard 7: day-off confirm was pending, user sent a correction (not a plain yes), but AI
    // is about to call manage_crew_dayoff — intercept and force a re-confirmation instead.
    if (loop === 0 && toolUseBlocks.some((b: any) => b.name === 'manage_crew_dayoff' && b.input?.action !== 'list')) {
      const prevAssistant = [...currentMessages].reverse().find((m: any) => m.role === 'assistant');
      const prevText = extractText(prevAssistant?.content);
      const dayOffConfirmPending = /confirm\?|day.?off.*confirm|adding day|removing day/i.test(prevText);
      const isPlainConfirmation = /^(yes|yeah|yep|yup|ok|okay|sure|go ahead|do it|confirm|correct|right|proceed|absolutely|sounds good)[.!]?\s*$/i.test(lastUserContent.trim());
      if (dayOffConfirmPending && !isPlainConfirmation) {
        // User made a correction, not a confirmation — stop the tool call, ask AI to revise and re-confirm
        currentMessages.push({ role: 'user', content: "The user made a correction to the dates, not a confirmation. Do NOT call manage_crew_dayoff yet. Update the date list based on their correction, show the revised list, and ask 'confirm?' again." });
        continue;
      }
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

      // Track verification state
      if (toolBlock.name === 'update_show' && result?.success) {
        updateShowSucceeded = true;
        queryShowsCalledAfterUpdate = false;
      }
      if (toolBlock.name === 'query_shows' && updateShowSucceeded) {
        queryShowsCalledAfterUpdate = true;
      }
      if (toolBlock.name === 'manage_crew_dayoff' && result?.success) {
        manageDayOffSucceeded = true;
      }
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
