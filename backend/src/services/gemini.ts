import { GEMINI_API_KEY } from '../config';
import { OrchestratorClient } from './orchestrator';
import {
  TOOLS,
  buildTaskInstructions,
  buildSystemPrompt,
  executeTool,
  handleAssignCrewMessage,
  handleDeleteShowMessage,
  extractText,
} from './claude';

const GEMINI_MODEL = 'gemini-3.1-pro-preview';
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

// Convert Anthropic tool schema → Gemini functionDeclarations
function toGeminiFunctionDeclarations() {
  return TOOLS.map(t => ({
    name: t.name,
    description: t.description,
    parameters: {
      type: t.input_schema.type,
      properties: t.input_schema.properties || {},
      ...(t.input_schema.required?.length ? { required: t.input_schema.required } : {}),
    },
  }));
}

// Convert Anthropic messages → Gemini contents array
function toGeminiContents(messages: any[]): any[] {
  const contents: any[] = [];

  for (const msg of messages) {
    const role = msg.role === 'assistant' ? 'model' : 'user';

    if (typeof msg.content === 'string') {
      contents.push({ role, parts: [{ text: msg.content }] });
      continue;
    }

    if (!Array.isArray(msg.content)) continue;

    // Tool result messages from Anthropic come as user messages with tool_result blocks
    const toolResults = msg.content.filter((b: any) => b.type === 'tool_result');
    if (toolResults.length > 0) {
      contents.push({
        role: 'user',
        parts: toolResults.map((b: any) => ({
          functionResponse: {
            name: b._toolName || 'unknown',
            response: { content: b.content },
          },
        })),
      });
      continue;
    }

    // Assistant messages: mix of text and tool_use blocks
    const parts: any[] = [];
    for (const block of msg.content) {
      if (block.type === 'text' && block.text) {
        parts.push({ text: block.text });
      } else if (block.type === 'tool_use') {
        parts.push({ functionCall: { name: block.name, args: block.input || {} } });
      }
    }
    if (parts.length > 0) contents.push({ role, parts });
  }

  return contents;
}

export async function chatWithGemini(
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
  const taskInstruction = activeTask ? (taskInstructions[activeTask.type] || '') : '';
  const systemPrompt = buildSystemPrompt(today, currentYear, taskInstruction);

  const strippedMessages = messages.map((m: any) => {
    if (prefixToStrip && m.role === 'user' && typeof m.content === 'string' && m.content.startsWith(prefixToStrip)) {
      return { ...m, content: m.content.slice(prefixToStrip.length).trimStart() };
    }
    return m;
  });

  const FORCE_TOOL_TASKS = new Set(['CT', 'SR', 'Venue', 'Delete', 'Assign', 'Crew', 'Quote', 'Add']);
  let forceToolCall = !!(activeTask && FORCE_TOOL_TASKS.has(activeTask.type));
  const maxLoops = 6;

  // Gemini tracks messages with tool names so we can map responses back
  // We maintain a parallel array that tags tool_result blocks with the tool name
  let currentMessages = strippedMessages.map(m => ({ ...m }));

  let lastToolName: string | null = null;
  let lastToolResult: any = null;
  let updateShowSucceeded = false;
  let manageDayOffSucceeded = false;
  let addShowArgs: any = null;

  for (let loop = 0; loop < maxLoops; loop++) {
    const contents = toGeminiContents(currentMessages);

    const body: any = {
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents,
      tools: [{ functionDeclarations: toGeminiFunctionDeclarations() }],
      generationConfig: { maxOutputTokens: 4096 },
      toolConfig: { functionCallingConfig: { mode: forceToolCall ? 'ANY' : 'AUTO' } },
    };
    forceToolCall = false;

    const res = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Gemini API error: ${res.status} ${text}`);
    }

    const data = await res.json() as any;
    const candidate = data.candidates?.[0];
    if (!candidate) throw new Error('Gemini returned no candidates');

    const parts: any[] = candidate.content?.parts || [];
    const textContent = parts.filter((p: any) => p.text).map((p: any) => p.text).join('');
    const functionCalls = parts.filter((p: any) => p.functionCall);

    if (functionCalls.length === 0) {
      // Hallucination guard — same patterns as Claude
      if (loop === 0 && lastToolName === null) {
        const looksLikeHallucination = /\bnothing\b|not in (the )?(system|schedule|database)|can't find|couldn't find|no (shows?|results?|records?)|what (date|day)\b|which (date|day)\b|provide (a |the )?date|give me (a |the )?date|need (a |the )?date|date (for|of) (the |this )?show|\bno idea\b|not (something|anything) in my|not in my (world|domain|area|scope)|outside (my|the) (world|domain|area|scope)|not familiar with|don't know what .{1,30} is\b|have no (information|record|data) (on|about)\b/i.test(textContent);
        if (looksLikeHallucination) {
          currentMessages.push({
            role: 'assistant',
            content: parts.map((p: any) => p.text ? { type: 'text', text: p.text } : { type: 'text', text: '' }),
          });
          currentMessages.push({
            role: 'user',
            content: [{ type: 'text', text: 'You answered without calling any tool. Call query_shows now with the name given — do not ask for a date, do not rely on memory.' }],
          });
          forceToolCall = true;
          continue;
        }
      }

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

      if (lastToolName === 'generate_quote' && lastToolResult?.success) {
        const normalizedItems = (lastToolResult.items || []).map((it: any) => ({
          requested: it.item_name || it.name || it.description || it.requested || '',
          requestedQty: it.quantity ?? it.qty ?? it.requestedQty ?? it.count ?? 1,
          rate: it.rate ?? it.unit_price ?? it.price ?? it.unit_rate ?? 0,
          lineTotal: it.amount ?? it.line_total ?? it.lineTotal ?? it.total ?? (it.rate ?? it.unit_price ?? 0) * (it.quantity ?? it.qty ?? 1),
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

      if (lastToolName === 'get_crew_availability' && lastToolResult?.success) {
        const crewJson = `\`\`\`json\n${JSON.stringify({
          type: 'crew_availability',
          date: lastToolResult.date,
          available: lastToolResult.available,
          assigned: lastToolResult.assigned,
          unavailable: lastToolResult.unavailable,
          conflicts: lastToolResult.conflicts,
        })}\n\`\`\``;
        const resultParts = [addShowCard, textContent.trim() || null, crewJson].filter(Boolean);
        return { reply: resultParts.join('\n'), taskDone: true };
      }

      const taskDone = updateShowSucceeded || manageDayOffSucceeded
        || (lastToolName === 'query_shows' && activeTask?.type === 'Delete');
      const baseParts = [addShowCard, textContent || (addShowCard ? null : 'Done.')].filter(Boolean);
      return { reply: baseParts.join('\n'), taskDone: taskDone || !!addShowCard };
    }

    // Push assistant turn (Gemini format → Anthropic-like for our tracking)
    currentMessages.push({
      role: 'assistant',
      content: parts.map((p: any) =>
        p.functionCall
          ? { type: 'tool_use', id: `fc-${loop}-${p.functionCall.name}`, name: p.functionCall.name, input: p.functionCall.args }
          : { type: 'text', text: p.text || '' }
      ),
    });

    // Execute all tool calls
    const toolResults: Array<{ name: string; result: any }> = [];
    for (const fc of functionCalls) {
      const toolBlock = { name: fc.functionCall.name, input: fc.functionCall.args };
      const result = await executeTool(toolBlock, orchestrator, today, oneYearOut);
      lastToolName = toolBlock.name;
      lastToolResult = result;
      toolResults.push({ name: toolBlock.name, result });

      if (toolBlock.name === 'update_show' && result?.success) updateShowSucceeded = true;
      if (toolBlock.name === 'manage_crew_dayoff' && result?.success) manageDayOffSucceeded = true;
      if (toolBlock.name === 'add_show' && result?.success) addShowArgs = toolBlock.input;
    }

    // Push tool results — tag with tool name so toGeminiContents can map them
    currentMessages.push({
      role: 'user',
      content: toolResults.map(tr => ({
        type: 'tool_result',
        _toolName: tr.name,
        content: JSON.stringify(tr.result),
      })),
    });
  }

  return { reply: 'Hit the tool-call limit on that one — try breaking it into smaller questions.', taskDone: false };
}
