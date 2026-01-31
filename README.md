# Color Commentary

Real-time AI sports broadcast that treats everyday moments like Game 7 of the Finals. Point a webcam at anyone and get live ESPN-style commentary, engagement meters, and play-by-play logging — powered by Gemini.

**Built at the Gemini 3 Super Hack (January 2026)**

## How It Works

1. Click **START BROADCAST** to activate your webcam
2. Frames are captured and sent to Gemini 2.0 Flash every 3 seconds
3. The AI analyzes what it sees and generates sports-style commentary
4. Commentary types out over the video feed with a broadcast overlay
5. Engagement/skepticism meters and play-by-play log update in real time

## Architecture

```
Browser                     Next.js Server              Gemini API
──────                     ──────────────              ──────────

Webcam → Canvas (JPEG) ──POST /api/analyze──▶ Proxy to Gemini 2.0 Flash
                                               (systemInstruction + image)
UI ◀── JSON response ◀──────────────────────── Structured JSON output
  • Commentary overlay                           (responseMimeType)
  • Engagement meter
  • Skepticism meter
  • Momentum indicator
  • Play-by-play log
```

- **Polling architecture** — simple, reliable, no WebSocket complexity
- **Server-side proxy** — API key stays on the server, never exposed to the browser
- **`responseMimeType: "application/json"`** — forces structured output from Gemini

## Stack

- **Next.js 15** (App Router) on Vercel
- **Gemini 2.0 Flash** via REST API (`generateContent`)
- **Tailwind CSS** for broadcast-style UI
- **TypeScript** throughout

## Running Locally

```bash
npm install
```

Create `.env.local`:
```
GEMINI_API_KEY=your_api_key_here
```

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Project Structure

```
app/
  page.tsx                  # Server component shell
  api/
    analyze/route.ts        # Gemini proxy endpoint
    token/route.ts          # API key endpoint (unused, legacy)
  components/
    Broadcast.tsx           # Main client component (state machine)
    CommentaryOverlay.tsx   # Typewriter text overlay on video
    StatsPanel.tsx          # Engagement/skepticism/momentum meters
    PlayByPlay.tsx          # Scrolling event log
    LiveBadge.tsx           # Pulsing LIVE indicator + timer
lib/
  gemini-live.ts            # WebSocket client (unused, legacy)
  sounds.ts                 # Audio cue manager
```

## Deploy

Push to `main` — Vercel auto-deploys. Set `GEMINI_API_KEY` in Vercel Environment Variables.

## Authors

[Dave Goldblatt](https://github.com/davegoldblatt) & [Siddharth Kandan](https://github.com/siddharthkandan) — Gemini 3 Super Hack, January 2026
