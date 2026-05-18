import { CLAUDE_API_KEY } from '../config';
import { OrchestratorClient } from './orchestrator';

const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';
const CLAUDE_MODEL = 'claude-haiku-4-5-20251001';

const TOOLS = [
  {
    name: 'query_shows',
    description: 'Query shows/events from the NCPA schedule database by date range and optional filters',
    input_schema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Start date YYYY-MM-DD (required)' },
        to: { type: 'string', description: 'End date YYYY-MM-DD (defaults to from if omitted)' },
        venue: { type: 'string', description: 'Optional venue filter: JBT, Tata, Experimental, Little Theatre, Godrej Dance, TT, etc.' },
        program: { type: 'string', description: 'Optional show/program name to filter by (partial match, case-insensitive)' },
      },
      required: ['from'],
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
];

function extractText(content: any): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
  }
  return '';
}

export async function chatWithClaude(messages: any[], orchestrator: OrchestratorClient): Promise<string> {
  const nowIST = new Date(Date.now() + (5 * 60 + 30) * 60 * 1000);
  const today = nowIST.toISOString().slice(0, 10);
  const currentYear = nowIST.getUTCFullYear();

  const systemPrompt = `You are Eddy — the NCPA Sound Department's operations assistant. Not the chief engineer. The calm intelligence that keeps the whole operation running when the day gets ridiculous.

TODAY'S DATE: ${today} (year ${currentYear}, current month ${today.slice(0, 7)}). Date inference — apply in order:
1. Day only ("on 31", "what's on 23", "the 5th") → use current month. Construct the full date as ${today.slice(0, 7)}-{day}. Example: user says "31" → call query_shows with from=${today.slice(0, 7)}-31.
2. No year given → default to ${currentYear}.
3. "24 May 26" → 24 May 2026 (trailing two-digit number is year, not a day range).
Never ask for the month or year if you can infer it. Queries are conversational.

CRITICAL: NEVER say "nothing on [date]" or "no shows" without first calling query_shows. The database is the only source of truth — never assume a date is empty from prior knowledge.

PERSONALITY:
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
- Crew availability → get_crew_availability
- Add a show → add_show; once add_show succeeds, immediately call get_crew_availability for the same date so the user can assign crew right away
- Assign crew to an existing show (user says "assign crew to [show]" or provides "FOH=..., Stage=...") → you MUST call query_shows first to find the show and get its ID, then call update_show with the crew. Never say "Done" or "Assigned" until update_show has been called and returned success. Do NOT list available crew as text — call get_crew_availability to show the interactive picker card.
- Update a show (sound requirements, call time, crew) → first call query_shows with the date and program name (do NOT ask for venue). If multiple shows are found, ask which one — always state each show's actual date (e.g. "18 May" or "19 May"), never just "today" or "tomorrow". If the field you are about to overwrite already has data, tell the user the current value and ask "Overwrite with X?" — wait for their reply. Once they confirm, call update_show with the show id and the new value. Never say "Done" or "Updated" unless you have actually called update_show and received a success response.
- Any pricing, quote, equipment cost → generate_quote (never quote prices from memory — the database is the source of truth)
- Quote items shorthand: "M4-2" or "2xM4" both mean 2x M4 — trailing dash-number or leading Nx are quantity markers. Pass items as ["2 M4", "5 SM58", etc.] so quantity comes first.
- Unsure of an equipment name? Ask, don't guess.

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

  let currentMessages = [...messages];
  const maxLoops = 5;
  let lastToolName: string | null = null;
  let lastToolResult: any = null;

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
      const lastUserMsg = [...messages].reverse().find((m: any) => m.role === 'user');
      const lastUserContent = typeof lastUserMsg?.content === 'string' ? lastUserMsg.content : extractText(lastUserMsg?.content);
      const lastUserLower = lastUserContent.toLowerCase();

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

      // Guard 5: AI said Done/Assigned after query_shows but without calling update_show
      if (lastToolName === 'query_shows' && loop < 4 &&
          /\b(done|updated|assigned|all set|crew.*set|set to|call time.*set)\b/i.test(replyLower)) {
        currentMessages.push({ role: 'assistant', content: textContent });
        currentMessages.push({ role: 'user', content: 'You said done but update_show was never called. Use the show ID from the query result and call update_show now to actually save the changes.' });
        continue;
      }

      // Force quote card
      if (lastToolName === 'generate_quote' && lastToolResult?.success) {
        const normalizedItems = (lastToolResult.items || []).map((it: any) => ({
          requested: it.name || it.requested || '',
          requestedQty: it.quantity ?? it.requestedQty ?? 1,
          rate: it.rate ?? it.unit_price ?? 0,
          lineTotal: it.amount ?? it.lineTotal ?? it.total ?? 0,
        }));
        return `\`\`\`json\n${JSON.stringify({
          type: 'quote',
          items: normalizedItems,
          subtotal: lastToolResult.subtotal,
          gst: lastToolResult.gst,
          total: lastToolResult.total,
        })}\n\`\`\``;
      }

      // Force crew picker card
      if (lastToolName === 'get_crew_availability' && lastToolResult?.success) {
        return `\`\`\`json\n${JSON.stringify({
          type: 'crew_availability',
          date: lastToolResult.date,
          available: lastToolResult.available,
          assigned: lastToolResult.assigned,
          unavailable: lastToolResult.unavailable,
          conflicts: lastToolResult.conflicts,
        })}\n\`\`\``;
      }

      return textContent || 'Done.';
    }

    // Has tool calls — push assistant message preserving full content blocks
    currentMessages.push({ role: 'assistant', content: data.content });

    // Execute all tool calls, collect results
    const toolResults: Array<{ id: string; result: any }> = [];
    for (const toolBlock of toolUseBlocks) {
      const result = await executeTool(toolBlock, orchestrator);
      lastToolName = toolBlock.name;
      lastToolResult = result;
      toolResults.push({ id: toolBlock.id, result });
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

  return 'Hit the tool-call limit on that one — try breaking it into smaller questions.';
}

async function executeTool(toolBlock: any, orchestrator: OrchestratorClient): Promise<any> {
  const name = toolBlock.name;
  const args = toolBlock.input || {};

  // Venue alias groups — each array lists all DB values + user shorthands for one physical venue
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
        const to = args.to || args.from;

        // If model misclassified a venue abbreviation as program (e.g. "JBT", "TET"),
        // promote it to venue and clear program so the venue filter kicks in correctly
        if (args.program && !args.venue) {
          const pk = venueKey(args.program);
          if (VENUE_GROUPS.some(g => g.includes(pk))) {
            args.venue = args.program;
            args.program = undefined;
          }
        }

        // Always fetch without venue filter — DB stores venues inconsistently
        // (both abbreviations like TT/LT/JBT and full names), so filter client-side
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
    // Extract quantity — support: "2 M4", "2xM4", "2×M4", "M4-2", "M4x2"
    const leadingQtyVal = item.match(/^(\d+)(?:\s*[xX×]\s*|\s+)/);
    const trailingQty = item.match(/[-xX×](\d+)$/);
    const qty = leadingQtyVal
      ? parseInt(leadingQtyVal[1])
      : trailingQty
        ? parseInt(trailingQty[1])
        : 1;

    const itemNorm = item
      .replace(/^\d+\s*[xX×]\s*/, '')
      .replace(/\s*[-xX×]\s*\d+$/, '')
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
      available_equipment: equipList.slice(0, 10).map((e: any) => e.name),
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
