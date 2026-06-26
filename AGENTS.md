# AGENTS.md

For architecture, tools, AI prompt rules, and standard dev/deploy commands, see `CLAUDE.md` and `README.md`. This file adds cloud-agent operating notes only.

## Cursor Cloud specific instructions

Sound Agent has three independently-run services. Dependencies (`npm install` in `backend/` and `orchestrator/`) are refreshed by the startup update script; the notes below are for running/testing them.

### Services & how to run

| Service | Dir | Run (dev) | Port | Notes |
|---|---|---|---|---|
| Backend API | `backend/` | `npm run dev` (ts-node) | 3000 | `npm run build` = `tsc` → `dist/`. No lint/test configured. |
| Orchestrator | `orchestrator/` | `npm run dev` (`wrangler dev`) | 8787 | Cloudflare Worker, run locally via Miniflare. |
| Frontend | `frontend/` | `python3 -m http.server 5173` | 5173 | Static PWA, no build step. |

### Non-obvious caveats

- **Active AI provider is Claude, not Kimi.** Despite `CLAUDE.md`, the live code path is `backend/src/services/claude.ts` (model `claude-sonnet-4-6`) with a Gemini fallback. Config reads `CLAUDE_API_KEY`, `GEMINI_API_KEY`, `OPENAI_API_KEY` (transcribe only), `ORCHESTRATOR_TOKEN`.
- **Backend boots without keys but chat is gated.** Missing keys only log warnings; `/health` and `/api/chat/health` still work. `POST /api/chat` returns `{"error":"Server not configured: missing API keys"}` until both `CLAUDE_API_KEY` and `ORCHESTRATOR_TOKEN` are set. These secrets are NOT present in the cloud env, so full chat round-trips cannot be exercised here without them.
- **Hardcoded upstream URLs block a fully-local chat round-trip.** `ORCHESTRATOR_URL` in `backend/src/config.ts` and `API_BASE` in `frontend/js/app.js` point at the production worker / Render API and are not env-configurable. Pointing backend→local-orchestrator or frontend→local-backend requires editing those constants.
- **Orchestrator local D1 starts EMPTY.** `wrangler dev` simulates `DB_SOUND`/`DB_CREW`/`DB_INVENTORY` locally; there are no migrations in the repo, so create the tables you need before querying, e.g. `npx wrangler d1 execute ncpa-sound --local --command="CREATE TABLE IF NOT EXISTS events (...)"`. The real data lives in remote D1 — add `--remote` (needs Cloudflare auth; `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACC_ID` are available as secrets) to read/write it.
- **Orchestrator auth.** Every `/api/*` route requires header `X-API-Token` matching the worker's `API_TOKEN`. Locally, set it in `orchestrator/.dev.vars` (gitignored). `/health` needs no auth.
- **`backend/test-quote.ts` is a manual script, not an automated test.** It needs a valid `ORCHESTRATOR_TOKEN` and reaches the live orchestrator; run with `npx ts-node test-quote.ts` from `backend/`.
