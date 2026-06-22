# CLAUDE.md

## Architecture

Sound Agent — voice + chat PWA for NCPA Sound Department (shows, crew, quotes).

```
Phone (PWA) → Render Backend (Node/Express)
               ├→ Claude Sonnet 4.6 (primary AI tool-use loop)
               ├→ Gemini fallback for Claude API/network failures
               └→ Orchestrator Proxy (Cloudflare Workers)
                    └→ 3 D1 DBs: DB_SOUND, DB_CREW, QUOTE_BUILDER
```

## Key Files

**Frontend** (`/frontend`) — static HTML/JS, no build step
- `index.html` — chat UI, inline CSS, safe-area insets
- `js/app.js` — chat logic, MediaRecorder voice upload, structured response rendering
- `manifest.json`, `sw.js`, `icon.svg` — PWA boilerplate

**Backend** (`/backend`) — TypeScript → `dist/`
- `src/services/claude.ts` — primary TOOLS array, tool-use loop, `executeTool()`, forced cards
- `src/services/gemini.ts` — fallback chat/tool loop with partial card parity
- `src/services/orchestrator.ts` — HTTP client (`X-API-Token` header)
- `src/routes/chat.ts` — `POST /api/chat`
- `src/routes/transcribe.ts` — `POST /api/transcribe` via OpenAI Whisper
- `src/config.ts` — env vars: `CLAUDE_API_KEY`, `GEMINI_API_KEY`, `OPENAI_API_KEY`, `ORCHESTRATOR_TOKEN`, `PORT`, `FRONTEND_URL`

## AI Tool-Use Loop (`claude.ts`)

1. Prepend system message → call Claude with 6 tools, max 6 loops
2. Tool calls → `executeTool()` → Orchestrator → result back into messages
3. Final text intercepts:
   - `generate_quote` success → force JSON quote card
   - `get_crew_availability` success → force JSON crew card
   - `add_show` success → prepend JSON show card
   - `query_shows` with 2+ results → backend appends JSON show cards; Claude supplies only a short quip
   - single-show overviews → Claude may emit a show card when 3+ fields or a general overview is requested

`src/routes/chat.ts` falls back to `chatWithGemini()` only for Claude 4xx/5xx or network/unreachable errors and only when `GEMINI_API_KEY` is configured. The Gemini fallback does not currently mirror the backend-forced multi-show card path.

**Hallucination guard (loop 0):** If the AI returns no tool call on the first iteration and the response matches "nothing on / no shows / can't find / check either side" patterns, or fabricates a `shows` JSON block without `query_shows`, the backend injects a correction message and retries — forcing a `query_shows` call before any answer is returned.

**Forced JSON shapes:**
```json
{ "type": "quote", "items": [...], "subtotal": 0, "gst": 0, "total": 0 }
{ "type": "shows", "shows": [{ "event_date":"","program":"","venue":"","call_time":"","foh_crew":"","stage_crew":"","sound_requirements":"" }] }
{ "type": "crew_availability", "date":"", "available":[], "assigned":[], "unavailable":[], "conflicts":[] }
```
Frontend extracts from ` ```json ``` ` blocks and renders structured cards.
When a structured block is present, the UI renders the card; any leading quip
text remains in the stored reply but is not separately displayed.

## Tools

| Tool | Params | Notes |
|------|--------|-------|
| `query_shows` | `from`, `to?`, `venue?`, `program?` | 0 results + program → auto ±7 day search |
| `add_show` | `event_date`, `program`, `venue`, + optionals | |
| `update_show` | `id` (required), patch fields | Must `query_shows` first; confirm before overwriting |
| `get_crew_availability` | `date` | Merges crew DB + unavailability + shows |
| `generate_quote` | `items[]` | Fuzzy-matches QUOTE_BUILDER DB |
| `manage_crew_dayoff` | `action`, `crew_name`, `dates?` | Add, remove, or list upcoming crew day-offs |

## AI Personality / Prompt Rules

- Sharp backstage colleague; concise, dry humour; no "Certainly!"
- No markdown; plain text only
- Update flow: search → show existing data → confirm before overwriting
- Quote: always emit JSON card, never text summary
- Show query with 2+ results: Claude should give one short quip and no JSON; backend appends `shows` JSON
- Single-show query: plain text for 1-2 fields; JSON card (incl. `sound_requirements`) for ≥3 fields or general overview
- Program-only search without a date searches roughly 6 months back through 1 year forward; exact-date misses widen ±7 days automatically
- **Never answer "nothing on [date]" without calling `query_shows` first** — backend enforces this with a hallucination guard

## Frontend Rendering (`app.js`)

- `tryParseStructured()` — extracts the last JSON block from ` ```json ``` ` fences
- `fmtDate(YYYY-MM-DD)` → `dd/mm/yy`; `fmtTime24(t)` → 24hr normalisation (IST display)
- `renderQuote()` — quote table + **Copy Quote** (rich HTML + plain-text clipboard)
  - `copyStore{}` keyed by `q-<timestamp>` avoids onclick quoting bugs
- `renderShowList()` — stacked card, date as `dd/mm/yy`, call_time normalised to 24hr
- `renderCrewPicker()` — FOH single-select + stage multi-select pills; assigns via chat message
- Voice: hold-to-record in the browser, upload audio to `/api/transcribe`, Whisper model `whisper-1`, insert transcript into the input

## Layout / Mobile Notes

- `.page` padding: `max(16px, env(safe-area-inset-*))` — Comet/Chrome/Safari
- `.page` and `.card-in-msg` have `overflow-x:hidden` — prevents iOS horizontal scroll
- State: per-browser-tab `messages[]`; backend stateless. Two phones = independent sessions, shared DB.

## Timezone & Formats

- Backend `today` uses IST (UTC+5:30) via `Date.now() + 330*60*1000`
- Display dates: `dd/mm/yy` via `fmtDate()`
- Display times: 24hr via `fmtTime24()` (handles "5:30pm" → "17:30")

## Dev Commands

```bash
# Backend
cd backend && npm install
npm run dev        # watch mode
npm run build      # tsc → dist/
npm start

# Frontend — no build
cd frontend && python3 -m http.server 5173
# Local API: set API_BASE = 'http://localhost:3000' in app.js

# Test
curl -X POST http://localhost:3000/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"messages":[{"role":"user","content":"Hi"}]}'
```

## Deployment

- **Frontend**: Cloudflare Pages, auto-deploy on `main`
- **Backend**: Render; root=`backend/`, build=`npm install && npm run build`, start=`npm start`

## Adding a Tool

1. Add to `TOOLS` in `claude.ts`
2. Add case in `executeTool()` switch
3. Call Orchestrator via `orchestrator` client
4. If result needs a forced card, add intercept in the "no tool calls" branch
5. Add or intentionally omit fallback parity in `gemini.ts`, and document the difference
