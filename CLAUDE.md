# CLAUDE.md

## Architecture

Sound Agent — voice + chat PWA for NCPA Sound Department (shows, crew, quotes).

```
Phone (PWA)  →  Render Backend (Node/Express)
                  ├→ Kimi K2.6 (AI, tool-use loop)
                  └→ Orchestrator Proxy (Cloudflare Workers)
                       └→ 3 D1 DBs: DB_SOUND, DB_CREW, QUOTE_BUILDER
```

## Key Files

**Frontend** (`/frontend`) — static HTML/JS, no build step
- `index.html` — chat UI, inline CSS, safe-area insets, `box-sizing:border-box` global
- `js/app.js` — chat logic, Web Speech API (en-IN), structured response rendering
- `manifest.json`, `sw.js`, `icon.svg` — PWA boilerplate

**Backend** (`/backend`) — TypeScript, compiled to `dist/`
- `src/services/kimi.ts` — tool definitions (TOOLS array), tool-use loop, `executeTool()`, `generateEquipmentQuote()`, `getMergedCrewAvailability()`
- `src/services/orchestrator.ts` — HTTP client for Orchestrator (`X-API-Token` header)
- `src/routes/chat.ts` — `POST /api/chat`
- `src/config.ts` — env vars: `KIMI_API_KEY`, `ORCHESTRATOR_TOKEN`, `PORT`, `FRONTEND_URL`

## AI Tool-Use Loop (`kimi.ts`)

1. Prepend system message (personality + tool rules)
2. Call Kimi with 5 tools; max 5 loops
3. On tool calls → `executeTool()` → Orchestrator → result back into messages
4. On final text:
   - `generate_quote` success → **force** structured JSON card (backend intercepts)
   - `get_crew_availability` success → **force** structured JSON card
   - `query_shows` → Kimi decides (plain text for single field, JSON card for ≥2 fields)
   - Everything else → Kimi's natural response

**Forced JSON shapes:**
```json
{ "type": "quote", "items": [...], "subtotal": 0, "gst": 0, "total": 0 }
{ "type": "shows", "shows": [{ "event_date":"","program":"","venue":"","call_time":"","crew":"" }] }
{ "type": "crew_availability", "date":"", "available":[], "assigned":[], "unavailable":[], "conflicts":[] }
```
Frontend parses these from ` ```json ``` ` blocks and renders structured cards.

## Tools

| Tool | Params | Notes |
|------|--------|-------|
| `query_shows` | `from`, `to?`, `venue?`, `program?` | If `program` set + 0 results → auto ±7 day search |
| `add_show` | `event_date`, `program`, `venue`, + optionals | |
| `update_show` | `id` (required), patch fields | Must `query_shows` first to get id; confirm if field already has data |
| `get_crew_availability` | `date` | Merges crew DB + unavailability + assigned from shows |
| `generate_quote` | `items[]` | Fuzzy-matches against QUOTE_BUILDER DB, calls Orchestrator |

## AI Personality / Prompt Rules (kimi.ts system message)

- Tone: sharp backstage colleague, concise, dry humour, no "Certainly!"
- No markdown in responses
- Update flow: search first (no venue question), show existing data, confirm before overwriting
- Quote: always emit JSON card, never summarise in text
- Show query: plain text for single field; JSON card for ≥2 fields
- Nearby search: if named show not found on date, widen ±7 days automatically — don't ask

## Frontend Rendering (`app.js`)

- `tryParseStructured()` — extracts JSON from ` ```json ``` ` blocks
- `renderQuote()` — quote table card + **Copy Quote** button
  - Copy uses `copyStore{}` keyed by `q-<timestamp>` (avoids onclick attribute quoting bugs)
  - `copyQuoteRichText()` uses `ClipboardItem` with `text/html` + `text/plain` for rich paste in email; falls back to `writeText()`
- `renderShowList()` — stacked card layout (no table), date + program on one line
- `renderCrewPicker()` — FOH single-select + stage multi-select pills; assigns via chat message
- Voice: hold-to-talk mic, 10 s timeout, per-error messages (`not-allowed`, `network`, `audio-capture`, etc.)

## Layout / Mobile Notes

- `.page` padding uses `max(16px, env(safe-area-inset-*))` — handles Comet/Chrome/Safari
- `.page` and `.card-in-msg` both have `overflow-x:hidden` to prevent horizontal scroll on iOS
- State is per-browser-tab (`messages[]` array); backend is stateless. Two phones = independent conversations sharing the same DB.

## Dev Commands

```bash
# Backend
cd backend && npm install
npm run dev        # watch mode
npm run build      # tsc → dist/
npm start

# Frontend — no build, just serve
cd frontend && python3 -m http.server 5173
# For local API: set API_BASE = 'http://localhost:3000' in app.js

# Test chat
curl -X POST http://localhost:3000/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"messages":[{"role":"user","content":"Hi"}]}'
```

## Deployment

- **Frontend**: Cloudflare Pages, auto-deploy on push to `main`
- **Backend**: Render, root=`backend/`, build=`npm install && npm run build`, start=`npm start`

## Adding a Tool

1. Add to `TOOLS` array in `kimi.ts`
2. Add case in `executeTool()` switch
3. Call Orchestrator via `orchestrator` client
4. If result needs a forced card, add intercept in the "no tool calls" branch
