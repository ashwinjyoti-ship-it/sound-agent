# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Architecture Overview

Sound Agent is a voice + chat interface for NCPA Sound Department operations. Users interact via a PWA (Progressive Web App) to add shows, assign crew, update sound requirements, and generate equipment quotes using natural language.

```
Phone (PWA)
    ↓
Render Backend (Node/Express)
    ├→ Kimi K2.6 (Claude-like AI via Kimi API)
    └→ Orchestrator Proxy (Cloudflare Workers)
         ↓
    3 Cloudflare D1 Databases
    (DB_SOUND, DB_CREW, QUOTE_BUILDER)
```

### Frontend (`/frontend`)
- **Type**: Vanilla HTML/JS PWA (no framework)
- **Key files**:
  - `index.html` — Single page with chat UI, inline CSS, safe-area insets for mobile
  - `js/app.js` — Chat logic, Web Speech API integration, message history
  - `manifest.json` — PWA metadata (standalone mode, theme color)
  - `sw.js` — Service worker (caching strategy)
  - `icon.svg` — App icon
- **Communication**: Fetches to `https://sound-agent-api.onrender.com/api/chat` with `{ messages: [...] }` JSON
- **Web Speech**: Uses native browser speech recognition (en-IN locale), free, no API key
- **Output rendering**: Parses AI response for structured data (crew lists, quotes) and renders tables or plain text

### Backend (`/backend`)
- **Runtime**: Node.js + Express on Render
- **Language**: TypeScript (compiled to `dist/` on build)
- **Key files**:
  - `src/index.ts` — Express app, CORS config (allows frontend URL + localhost:3000/5173), routes
  - `src/config.ts` — Environment variables: `KIMI_API_KEY`, `ORCHESTRATOR_TOKEN`, `PORT`, `FRONTEND_URL`
  - `src/routes/chat.ts` — `POST /api/chat` handler; reads message history from request, calls Kimi, returns reply
  - `src/services/kimi.ts` — Kimi API integration with tool definitions (query_shows, add_show, update_show, get_crew_availability, generate_quote)
  - `src/services/orchestrator.ts` — HTTP client for Orchestrator proxy (handles auth token, base URL)

### AI Tool Calling
The backend implements a **tool-use loop** with Kimi K2.6:
1. Frontend sends message history to `/api/chat`
2. Backend prepends system message: "Use tools for quotes, crew, shows"
3. Calls Kimi API with 5 tools defined (schema in `kimi.ts:TOOLS`)
4. If Kimi returns tool calls, backend executes them via Orchestrator proxy
5. Adds tool results back into message history
6. Repeats (max 5 loops) until Kimi returns text content only
7. Returns final text reply to frontend

**Tool schemas** are in `src/services/kimi.ts` (lines 4–92). Each tool maps to an Orchestrator endpoint.

### Orchestrator Integration
The Orchestrator proxy (`https://ncpa-orchestrator.ashwinjyoti.workers.dev`) is a Cloudflare Workers service that routes to 3 D1 databases:
- `DB_SOUND` — Shows/events (query, add, update)
- `DB_CREW` — Crew roster and availability
- `QUOTE_BUILDER` — Equipment hire pricing

The `OrchestratorClient` in `src/services/orchestrator.ts` wraps HTTP calls with auth header `X-API-Token: ${ORCHESTRATOR_TOKEN}`.

### Crew Availability Logic
In `src/services/kimi.ts:getMergedCrewAvailability()`:
1. Fetches all crew from DB_CREW
2. Fetches unavailability records (day-off, etc.) for the date
3. Fetches shows for that date and parses already-assigned crew
4. Returns three lists: `available`, `assigned`, `unavailable`
5. Only considers 14 hardcoded crew names (Naren, Sandeep, etc.); ignores others in DB

### Quote Generation Logic
In `src/services/kimi.ts:generateEquipmentQuote()`:
1. Parses user's item list ("4 D&B speakers", "2 subs")
2. Extracts quantity and fuzzy-matches against quote-builder equipment DB
3. Passes matched items to Orchestrator `/api/quotes/generate`
4. Returns formatted quote with GST calculation and plain-text for copy-paste

## Development Commands

### Backend
```bash
cd backend

# Install dependencies
npm install

# Development (watch + auto-reload)
npm run dev

# Compile TypeScript
npm run build

# Run compiled code
npm start

# Run a single file during development
npx ts-node src/services/kimi.ts
```

### Frontend
The frontend is static HTML/JS. No build step required.
- **Local dev**: Open `frontend/index.html` in a browser
- **Localhost API testing**: Set `API_BASE = 'http://localhost:3000'` in `frontend/js/app.js`, run backend on port 3000

### Full Stack
- **Backend**: `npm run dev` in `backend/` (default port 3000, or set `PORT` env var)
- **Frontend**: Serve from `frontend/` directory via a simple HTTP server
  ```bash
  cd frontend
  python3 -m http.server 5173
  # or: npx http-server -p 5173
  ```

### Environment Variables (Backend)
Set in Render dashboard or `.env` file for local dev:
- `KIMI_API_KEY` — Kimi K2.6 API key (required for chat)
- `ORCHESTRATOR_TOKEN` — Auth token for Orchestrator proxy (required for tool execution)
- `PORT` — Server port (default 3000)
- `FRONTEND_URL` — CORS origin (default `https://sound-agent.pages.dev`)

## Key Patterns

### Message Flow
1. User speaks or types → frontend adds to `messages` array
2. Frontend POSTs to `/api/chat` with entire message history
3. Backend keeps state in memory (chat context expires when process restarts)
4. AI response is added to frontend's message history for next request

### Tool Execution
- Tools always go through Orchestrator proxy
- If a tool fails, error is returned in the `tool` message role
- Kimi retries or continues based on error context
- Max 5 tool-use loops per request (line 101 in `kimi.ts`)

### Error Handling
- Frontend displays errors in chat: `⚠ Error: ${message}`
- Backend logs to stdout (visible in Render logs)
- Missing env vars are warned at startup but don't crash

### Mobile / PWA
- Safe area insets used for notch/home indicator (CSS variables `--safe-top`, `--safe-bottom`)
- Standalone mode enabled (manifest.json `"display": "standalone"`)
- Service worker handles offline caching (basic strategy in `sw.js`)
- Web Speech API polyfill not needed; feature gracefully hides mic button if unavailable

## Deployment

### Frontend
- Hosted on Cloudflare Pages
- Auto-deploys on push to `main` (see `.github/workflows/` if present)
- Uses GitHub Actions and `CLOUDFLARE_API_TOKEN` secret

### Backend
- Hosted on Render
- Root directory set to `backend/`
- Build command: `npm install && npm run build`
- Start command: `npm start`
- Auto-deploys on push to `main`
- Environment variables configured in Render dashboard

## Common Workflows

### Adding a New Tool
1. Define function signature in `src/services/kimi.ts:TOOLS` array
2. Implement handler in `executeTool()` switch statement
3. Call corresponding Orchestrator endpoint via `orchestrator` client
4. Return structured result (success flag, data, or error)
5. Test with frontend chat

### Debugging Tool Calls
- Backend logs to stdout (see Render logs for production, terminal for local `npm run dev`)
- Add `console.log()` in `executeTool()` to trace tool args
- Check Orchestrator response with `console.error()` on catch
- Frontend shows raw error text in chat if tool fails

### Testing the Chat Loop
1. Run `npm run dev` in backend
2. In a new terminal, curl to test:
   ```bash
   curl -X POST http://localhost:3000/api/chat \
     -H 'Content-Type: application/json' \
     -d '{"messages": [{"role": "user", "content": "Hi"}]}'
   ```
3. Or open frontend locally, set `API_BASE = 'http://localhost:3000'`, and chat

### Local Development with Mock Orchestrator
If Orchestrator is down or you want to test offline:
1. Mock the `OrchestratorClient` methods in tests
2. Or create a local stub server that responds with fixtures
3. Set `ORCHESTRATOR_URL` in config to point to stub
