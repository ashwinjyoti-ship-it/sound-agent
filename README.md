# Sound Agent

Voice + chat interface for NCPA Sound Department. Built for your phone. Add shows, assign crew, update sound requirements, generate quotes — all by talking or typing.

## URL
- **Frontend:** `sound-agent.pages.dev` (Cloudflare Pages)
- **Backend:** `sound-agent-api.onrender.com` (Render)

## Architecture
```
Phone (PWA) → Render API (Claude primary, Gemini fallback + Orchestrator proxy) → Your 3 D1 databases
```

## What You Can Say
- "Add show 31 May JBT quartet"
- "Who is free on 17 May?"
- "Add sound requirements to 24 May TATA: 4 D&B speakers, 2 subs"
- "Quote me 4 speakers and 6 wireless mics"
- "What's on next week in JBT?"

## Setup (One-Time)

### 1. Create GitHub repo
- Name: `sound-agent`
- Empty repo, no README

### 2. Push this code
```bash
git remote add origin https://github.com/ashwinjyoti-ship-it/sound-agent.git
git push -u origin main
```

### 3. GitHub Secrets (for Pages auto-deploy)
Go to repo → Settings → Secrets and variables → Actions → New repository secret:
- `CLOUDFLARE_API_TOKEN` = your Cloudflare API token
- `CLOUDFLARE_ACCOUNT_ID` = `cf39f049784caf415803b1a54fea336c`

### 4. Render (backend)
1. Go to [render.com](https://render.com) → New Web Service
2. Connect `sound-agent` repo
3. Root directory: `backend`
4. Build: `npm install && npm run build`
5. Start: `npm start`
6. **Environment variables:**
   - `CLAUDE_API_KEY` = Anthropic API key for the primary chat model
   - `GEMINI_API_KEY` = optional Gemini fallback for Claude outages
   - `OPENAI_API_KEY` = optional Whisper transcription for voice input
   - `ORCHESTRATOR_TOKEN` = `ncpa-orchestrator-2025-secure-token-ashwin`
   - `FRONTEND_URL` = `https://sound-agent.pages.dev`
7. Deploy

Auto-deploy happens on every push to `main`.

## Features
| Feature | How |
|---|---|
| Add show | "Add show 31 May JBT quartet, call time 5:30" |
| Crew availability | "Who is free on 31 May?" → radio (FOH) + checkbox (Stage) |
| Update show | "Add sound requirements to 24 May TATA: ..." |
| Query schedule | "What's on 17 May JBT?" |
| Generate quote | "Quote 4 speakers and 6 wireless" |

## Structured cards

The backend owns structured card output for high-risk workflows so the UI can
render consistent controls:

- Quote and crew-availability tools always produce fenced JSON cards.
- `add_show` success prepends a show card before the final reply.
- Claude-backed show queries with two or more results get backend-appended
  `shows` JSON; Claude supplies only a short quip. The frontend renders the last
  fenced JSON block it finds.
- Single-show overviews can still be emitted by the model when the prompt asks
  for a card with three or more fields.

The Gemini fallback can answer chat/tool flows but does not currently mirror the
backend-forced multi-show card path.

## Crew Rules
- Monthly bulk assignment stays in Crew-Assignment-Automation app
- This assistant handles **added shows only**
- Shows available crew pool (not assigned + not day-off)
- You pick FOH (radio) and Stage (checkbox)
- Same logic as Add-show app

## Notes
- Voice input records in the browser and uploads to `/api/transcribe`, which uses
  OpenAI Whisper (`OPENAI_API_KEY`)
- No auth for v1 (just you + 2IC)
- iPhone + Android both supported
- Quotes are copy-paste (no direct Outlook send due to org auth)

