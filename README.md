# Sound Agent

Voice + chat interface for NCPA Sound Department. Built for your phone. Add shows, assign crew, update sound requirements, generate quotes — all by talking or typing.

## URL
- **Frontend:** `sound-agent.pages.dev` (Cloudflare Pages)
- **Backend:** `sound-agent-api.onrender.com` (Render)

## Architecture
```
Phone (PWA) -> Render API (Claude + optional Gemini fallback)
             -> Orchestrator proxy -> Your 3 D1 databases

Voice input records audio in the browser and sends it to Render's
`POST /api/transcribe` route, which uses OpenAI Whisper.
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
   - `ORCHESTRATOR_TOKEN` = token accepted by the NCPA orchestrator worker
   - `FRONTEND_URL` = `https://sound-agent.pages.dev`
   - `OPENAI_API_KEY` = optional, required for voice transcription
   - `GEMINI_API_KEY` = optional, enables chat fallback when Claude is unavailable
   - Legacy `KIMI_API_KEY` is ignored by the current backend
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
| Crew day-offs | "/day-off" then "Coni off 12 and 13 June" |

Slash shortcuts in the input bar start guided workflows:
`/add-show`, `/crew`, `/crew-assign`, `/update-CT`, `/update-sound`,
`/update-venue`, `/quote`, `/day-off`, `/delete-show`, and `/clear`.

## Crew Rules
- Monthly bulk assignment stays in Crew-Assignment-Automation app
- This assistant handles **added shows only**
- Shows available crew pool (not assigned + not day-off)
- You pick FOH (radio) and Stage (checkbox)
- Same logic as Add-show app

## Notes
- Voice input uses MediaRecorder in the browser plus `/api/transcribe` on the backend; typed chat works without `OPENAI_API_KEY`
- No auth for v1 (just you + 2IC)
- iPhone + Android both supported
- Quotes are copy-paste (no direct Outlook send due to org auth)

