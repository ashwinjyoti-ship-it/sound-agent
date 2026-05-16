import { KIMI_API_KEY, KIMI_API_URL } from '../config';
import { OrchestratorClient } from './orchestrator';

const TOOLS = [
  {
    type: 'function' as const,
    function: {
      name: 'query_shows',
      description: 'Query shows/events from the NCPA schedule database by date range and optional venue filter',
      parameters: {
        type: 'object',
        properties: {
          from: { type: 'string', description: 'Start date YYYY-MM-DD (required)' },
          to: { type: 'string', description: 'End date YYYY-MM-DD (defaults to from if omitted)' },
          venue: { type: 'string', description: 'Optional venue filter: JBT, Tata, Experimental, Little Theatre, Godrej Dance, TT, etc.' },
        },
        required: ['from'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'add_show',
      description: 'Add a new show/event to the NCPA schedule. After adding, crew should be assigned separately.',
      parameters: {
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
  },
  {
    type: 'function' as const,
    function: {
      name: 'update_show',
      description: 'Update an existing show. Use this to add or edit sound requirements, call time, or crew.',
      parameters: {
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
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_crew_availability',
      description: 'Get available crew members for a specific date, excluding those already assigned to other shows and those on day-off. Returns available, assigned, unavailable lists.',
      parameters: {
        type: 'object',
        properties: {
          date: { type: 'string', description: 'Date YYYY-MM-DD' },
        },
        required: ['date'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'generate_quote',
      description: 'Generate an equipment quote by matching requested items against the NCPA inventory database.',
      parameters: {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            items: { type: 'string' },
            description: 'List of equipment requests, e.g., ["4 speakers", "6 wireless mics", "2 subwoofers"]',
          },
        },
        required: ['items'],
      },
    },
  },
];

export async function chatWithKimi(messages: any[], orchestrator: OrchestratorClient): Promise<string> {
  let currentMessages = [...messages];
  const maxLoops = 5;

  for (let loop = 0; loop < maxLoops; loop++) {
    const response = await fetch(KIMI_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${KIMI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'kimi-k2.6',
        messages: currentMessages,
        tools: TOOLS,
        tool_choice: 'auto',
        temperature: 0.3,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Kimi API error: ${response.status} ${text}`);
    }

    const data = await response.json() as any;
    const message = data.choices?.[0]?.message;

    if (!message) {
      throw new Error('No message from Kimi');
    }

    // No tool calls — return content
    if (!message.tool_calls || message.tool_calls.length === 0) {
      return message.content || 'Done.';
    }

    // Add assistant message with tool_calls
    currentMessages.push({
      role: 'assistant',
      content: message.content || '',
      tool_calls: message.tool_calls,
    });

    // Execute each tool call
    for (const toolCall of message.tool_calls) {
      const result = await executeTool(toolCall, orchestrator);
      currentMessages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: JSON.stringify(result),
      });
    }
  }

  return 'I made several tool calls but hit the limit. Please narrow your request.';
}

async function executeTool(toolCall: any, orchestrator: OrchestratorClient): Promise<any> {
  const name = toolCall.function?.name;
  let args: any = {};
  try {
    args = JSON.parse(toolCall.function?.arguments || '{}');
  } catch {
    return { error: 'Invalid arguments JSON' };
  }

  try {
    switch (name) {
      case 'query_shows': {
        const to = args.to || args.from;
        return await orchestrator.getShows({
          from: args.from,
          to: to,
          venue: args.venue,
        });
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

  // 1. Get all crew + availability from DB_CREW
  const crewData = await orchestrator.getAllCrew() as any;
  const allCrew: any[] = crewData.data || [];

  const availData = await orchestrator.getCrewAvailability(date) as any;
  const unavailIds = new Set(
    (availData.data || [])
      .filter((c: any) => !c.available)
      .map((c: any) => c.id)
  );

  // 2. Get events from DB_SOUND for this date
  const showsData = await orchestrator.getShows({ from: date, to: date }) as any;
  const events: any[] = showsData.data || [];

  // 3. Parse assigned crew
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

  // 4. Build name-based lookup
  const nameToId = new Map<string, number>();
  for (const c of allCrew) {
    if (c.name) nameToId.set(c.name, c.id);
  }

  // 5. Categorize against known roster
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
  const inventoryData = await orchestrator.getInventory() as any;
  const inventory: any[] = inventoryData.data || [];

  const results: any[] = [];

  for (const item of items) {
    const itemLower = item.toLowerCase();
    const words = itemLower.split(/\s+/).filter(w => w.length > 2);

    // Try to extract quantity
    const qtyMatch = item.match(/(\d+)/);
    const requestedQty = qtyMatch ? parseInt(qtyMatch[1]) : 1;

    // Find best matches
    const matches = inventory.filter((eq: any) => {
      const name = (eq.name || '').toLowerCase();
      const category = (eq.category || '').toLowerCase();
      const desc = (eq.description || '').toLowerCase();
      return words.some((word: string) =>
        name.includes(word) || category.includes(word) || desc.includes(word)
      );
    });

    results.push({
      requested: item,
      requestedQty,
      matches: matches.slice(0, 5).map((m: any) => ({
        name: m.name,
        category: m.category,
        description: m.description,
        price: m.rental_price || m.price || null,
        available: m.status === 'available',
      })),
    });
  }

  return { success: true, items: results };
}
