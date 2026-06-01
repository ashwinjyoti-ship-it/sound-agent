# CLAUDE.md

## Architecture

Sound Agent — voice + chat PWA for NCPA Sound Department (shows, crew, quotes).

```
Phone (PWA) -> Render Backend (Node/Express)
               |-> Claude Sonnet 4.6 (primary AI tool-use loop)
               |-> Gemini 3.1 Pro Preview (optional fallback)
               |-> OpenAI Whisper (`POST /api/transcribe`)
               `-> Orchestrator Proxy (Cloudflare Worker)
                    `-> 3 D1 DBs: DB_SOUND, DB_CREW, QUOTE_BUILDER
```

## Key Files

**Frontend** (`/frontend`) — static HTML/JS, no build step
- `index.html` — chat UI, inline CSS, safe-area insets
- `js/app.js` — chat logic, MediaRecorder voice capture, slash tasks, structured response rendering
- `manifest.json`, `sw.js`, `icon.svg` — PWA boilerplate

**Backend** (`/backend`) — TypeScript → `dist/`
- `src/services/claude.ts` — `TOOLS`, Eddy system prompt, tool loop, deterministic handlers, quote helpers
- `src/services/gemini.ts` — fallback adapter that reuses Claude tools/prompts against Gemini
- `src/routes/transcribe.ts` — `POST /api/transcribe` audio upload -> OpenAI Whisper
- `src/services/orchestrator.ts` — HTTP client (`X-API-Token` header)
- `src/routes/chat.ts` — `POST /api/chat`, `GET /api/chat/health`, Claude->Gemini fallback
- `src/config.ts` — env vars: `CLAUDE_API_KEY`, `ORCHESTRATOR_TOKEN`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `PORT`, `FRONTEND_URL`
- `src/services/kimi.ts` — legacy stub; do not add new logic here

## Runtime env

| Variable | Required | Used by | Notes |
|----------|----------|---------|-------|
| `CLAUDE_API_KEY` | Yes | `chat.ts`, `claude.ts` | Primary Anthropic model (`claude-sonnet-4-6`). |
| `ORCHESTRATOR_TOKEN` | Yes | `orchestrator.ts` | Sent as `X-API-Token` to the Cloudflare Worker. |
| `FRONTEND_URL` | Yes in prod | `index.ts` CORS | Defaults to `https://sound-agent.pages.dev`; localhost origins are hard-coded for dev. |
| `OPENAI_API_KEY` | For voice | `transcribe.ts` | Without it, `/api/transcribe` returns 500 and typed chat still works. |
| `GEMINI_API_KEY` | Optional | `chat.ts`, `gemini.ts` | Fallback only when Claude is unavailable or returns retryable 4xx/5xx/network errors. |
| `PORT` | Optional | `index.ts` | Defaults to `3000`. |

## AI Tool-Use Loop (`claude.ts`)

1. `chat.ts` receives `{ messages, activeTask? }`, validates required env, then calls Claude.
2. `claude.ts` checks deterministic shortcuts before the LLM:
   - `Assign crew for show #...` messages from the crew picker update crew directly.
   - `Confirm delete show #...` deletes only after the UI confirmation message.
3. Build Eddy's system prompt, strip any active slash-command prefix, and call Claude with 6 tools for up to 6 loops.
4. Tool calls -> `executeTool()` -> Orchestrator -> tool result back into the model.
5. Final text intercepts:
   - `generate_quote` success → force JSON quote card
   - `get_crew_availability` success → force JSON crew card
   - `add_show` success → prepend a show JSON card from the saved arguments
6. If Claude is unavailable and `GEMINI_API_KEY` is set, `chat.ts` retries through `gemini.ts`, which shares the same tools, prompt rules, and deterministic handlers.

**Hallucination guard (loop 0):** If the AI returns no tool call and claims missing schedule data, asks for an unnecessary date, or emits a `shows` JSON card without `query_shows`, the backend injects a correction and forces a tool call. Schedule answers must come from the DB.

**Forced JSON shapes:**
```json
{ "type": "quote", "items": [...], "subtotal": 0, "gst": 0, "total": 0 }
{ "type": "shows", "shows": [{ "event_date":"","program":"","venue":"","call_time":"","foh_crew":"","stage_crew":"","sound_requirements":"" }] }
{ "type": "crew_availability", "date":"", "available":[], "assigned":[], "unavailable":[], "conflicts":[] }
```
Frontend extracts from ` ```json ``` ` blocks and renders structured cards.

## Tools

| Tool | Params | Notes |
|------|--------|-------|
| `query_shows` | `from`, `to?`, `venue?`, `program?` | Program-only searches a broad window; exact-date misses widen ±7 days |
| `add_show` | `event_date`, `program`, `venue`, + optionals | |
| `update_show` | `id` (required), patch fields | Must `query_shows` first; confirm before overwriting |
| `get_crew_availability` | `date` | Merges crew DB + unavailability + shows |
| `generate_quote` | `items[]` | Fuzzy-matches QUOTE_BUILDER DB |
| `manage_crew_dayoff` | `action`, `crew_name`, `dates?` | Add/remove/list crew unavailability; confirm before add/remove |

### Tool behavior notes

- `query_shows` with a program and no date searches from 6 months back to 1 year ahead, then filters program names locally.
- Venue filters accept aliases (`TT`, `Tata`, `TET`, `JBT`, `GDT`, etc.) and local matching normalizes venue names.
- If a specific dated program search misses, the backend widens ±7 days and marks `nearbySearch`.
- `generate_quote` normalizes quote item fields for the frontend (`requested`, `requestedQty`, `rate`, `lineTotal`) and surfaces unmatched items through the generated card data.
- `add_show` only triggers a crew picker after save when the show is in the current month.

## Ask Eddy guided workflows

The frontend exposes slash commands in `frontend/js/app.js`. Selecting one sets:

```json
{ "activeTask": { "type": "Quote", "prefix": "Quote — Items: " } }
```

The backend strips `activeTask.prefix`, injects task-specific instructions from `buildTaskInstructions()`, and forces an initial tool call for `CT`, `SR`, `Venue`, `Delete`, `Assign`, `Crew`, `Quote`, and `Add`. `DayOff` is not force-called because it often needs to expand dates and ask for confirmation first.

`POST /api/chat` returns `{ reply, taskDone }`. When `taskDone` is false, the frontend restores the prefix so the next user reply stays inside the same guided workflow.

Supported slash commands:

| Command | Task type | Backend behavior |
|---------|-----------|------------------|
| `/add-show` | `Add` | Adds a show, then optionally asks crew availability for current-month shows. |
| `/crew` | `Crew` | Gets crew availability for a date, defaulting to today if omitted. |
| `/crew-assign` | `Assign` | Finds the show and renders the crew picker. |
| `/update-CT` | `CT` | Queries current call time, asks for/confirm new value, then updates. |
| `/update-sound` | `SR` | Queries current sound requirements, confirms overwrite, then updates. |
| `/update-venue` | `Venue` | Queries current venue, accepts free-text venue updates after confirmation. |
| `/quote` | `Quote` | Calls quote generation immediately with fuzzy equipment matching. |
| `/day-off` | `DayOff` | Adds/removes/lists crew unavailability with date expansion and confirmation. |
| `/delete-show` | `Delete` | Queries and renders a show card; actual delete uses `Confirm delete show #N`. |

## AI Personality / Prompt Rules

- Sharp backstage colleague; concise, dry humour; no "Certainly!"
- No markdown; plain text only
- Update flow: search → show existing data → confirm before overwriting
- Quote: always emit JSON card, never text summary
- Show query: plain text for 1-2 fields (read all queried fields from tool result); JSON card (incl. `sound_requirements`) for ≥3 fields or general overview
- Nearby search: widen ±7 days automatically if show not found — don't ask
- **Never answer "nothing on [date]" without calling `query_shows` first** — backend enforces this with a hallucination guard

## Frontend Rendering (`app.js`)

- `tryParseStructured()` — extracts JSON from ` ```json ``` ` blocks
- `fmtDate(YYYY-MM-DD)` → `dd/mm/yy`; `fmtTime24(t)` → 24hr normalisation (IST display)
- `renderQuote()` — quote table + **Copy Quote** (rich HTML + plain-text clipboard)
  - `copyStore{}` keyed by `q-<timestamp>` avoids onclick quoting bugs
- `renderShowList()` — stacked card, date as `dd/mm/yy`, call_time normalised to 24hr
- `renderCrewPicker()` — FOH single-select + stage multi-select pills; assigns via chat message
- Voice: hold-to-talk MediaRecorder, 10 s timeout, uploads audio to `/api/transcribe`, then fills the input bar with Whisper text

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

# Health
curl http://localhost:3000/health
curl http://localhost:3000/api/chat/health
```

## Deployment

- **Frontend**: Cloudflare Pages, auto-deploy on `main`
- **Backend**: Render; root=`backend/`, build=`npm install && npm run build`, start=`npm start`

## Adding a Tool

1. Add to `TOOLS` in `claude.ts`
2. Add case in `executeTool()` switch
3. Call Orchestrator via `orchestrator` client
4. If result needs a forced card, add intercept in the "no tool calls" branch
