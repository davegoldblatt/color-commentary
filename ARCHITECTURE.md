# Color Commentary — Full Architecture & Code Reference

## What This Is
Real-time sports broadcast overlay that points a webcam at hackathon judges and generates ESPN-style AI commentary on their reactions using the Gemini Live API.

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ BROWSER (Next.js Client)                                    │
│                                                             │
│  ┌──────────┐   ┌───────────────┐   ┌──────────────────┐   │
│  │ Webcam   │──▶│ Canvas (768x  │──▶│ GeminiLiveClient │   │
│  │ <video>  │   │ 576) JPEG @   │   │ (WebSocket)      │   │
│  │          │   │ 1 FPS         │   │                  │   │
│  └──────────┘   └───────────────┘   └────────┬─────────┘   │
│                                              │              │
│                                              │ sends base64 │
│                                              │ JPEG frames  │
│                                              ▼              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ Gemini Live API (WebSocket)                          │   │
│  │ wss://generativelanguage.googleapis.com/ws/...       │   │
│  │                                                      │   │
│  │ Model: gemini-2.0-flash-live-001                     │   │
│  │ Mode: TEXT only (no audio response)                  │   │
│  │ Temp: 0.9 (creative commentary)                     │   │
│  │                                                      │   │
│  │ Returns: streamed JSON chunks per turn               │   │
│  └────────────────────┬─────────────────────────────────┘   │
│                       │                                     │
│                       │ serverContent.modelTurn.parts[].text│
│                       │ (accumulated until turnComplete)    │
│                       ▼                                     │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ UI Layer                                             │   │
│  │ ┌─────────────────┐ ┌────────────┐ ┌─────────────┐  │   │
│  │ │ Commentary      │ │ Stats      │ │ Play-by-Play│  │   │
│  │ │ Overlay         │ │ Panel      │ │ Log         │  │   │
│  │ │ (typewriter)    │ │ (animated) │ │ (scrolling) │  │   │
│  │ └─────────────────┘ └────────────┘ └─────────────┘  │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ Sound Manager                                        │   │
│  │ Plays cheer/gasp/organ/buzzer on Gemini's cue        │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ NEXT.JS SERVER                                              │
│                                                             │
│  POST /api/token                                            │
│  - Reads GEMINI_API_KEY from env                            │
│  - Creates ephemeral token via @google/genai SDK            │
│  - Returns { token: string } to client                      │
│  - Token is single-use, 5 min expiry                        │
│                                                             │
│  WHY: API key never touches the browser. Ephemeral token    │
│  is short-lived and scoped to one WebSocket session.        │
└─────────────────────────────────────────────────────────────┘
```

## Data Flow (step by step)

1. User clicks "START BROADCAST" (this also unlocks browser audio autoplay)
2. Browser requests webcam permission, starts video stream
3. Browser POSTs to `/api/token` → server creates ephemeral Gemini token
4. Browser opens WebSocket to Gemini Live API using ephemeral token
5. Browser sends setup message (model, system prompt, TEXT mode)
6. Gemini responds with `setupComplete`
7. 3-2-1 countdown animation plays
8. Frame capture loop starts (1 FPS):
   - Draw video frame to hidden canvas (768x576)
   - Convert canvas to JPEG base64
   - Send as `realtimeInput.video` over WebSocket
9. Nudge loop starts (every 8 seconds):
   - Sends `clientContent` text message asking for new commentary
   - This interrupts any in-progress generation and forces a fresh response
10. Gemini streams text back in chunks via `serverContent.modelTurn.parts[].text`
11. On `turnComplete`, accumulated text is parsed as JSON
12. UI updates: commentary overlay (typewriter), stat bars (CSS transition), play-by-play log
13. If JSON includes a `sound` field, the corresponding audio clip plays

## Why Key Decisions Were Made

**Ephemeral tokens vs API key in client:**
The Gemini Live API requires a WebSocket from the browser — can't proxy through Next.js API routes (no native WebSocket support in serverless). Ephemeral tokens are Google's recommended pattern: server mints a short-lived token, browser uses it. API key stays server-side.

**1 FPS frame rate:**
Gemini Live processes video at 1 FPS regardless of send rate. Sending faster wastes bandwidth and tokens. 768x576 is a good balance of detail vs payload size.

**Nudge every 8 seconds:**
The Live API doesn't automatically generate text for each video frame — it waits for a prompt. The nudge sends a `clientContent` message that interrupts any stale generation and requests fresh commentary. Without this, the model might go silent between frames.

**`clientContent` vs `realtimeInput` for nudges:**
`realtimeInput.text` does NOT interrupt current generation. `clientContent` DOES. We want interruption so stale commentary gets replaced with fresh observations.

**Temperature 0.9:**
Higher temperature = more creative, varied commentary. At 0.7 the model gets repetitive. At 1.0 it occasionally generates broken JSON. 0.9 is the sweet spot.

**JSON response format with regex fallback:**
We ask Gemini for raw JSON but it sometimes wraps it in markdown code blocks. The parser uses `raw.match(/\{[\s\S]*\}/)` to extract JSON from any wrapping. If parsing fails entirely, we treat the raw text as commentary with default stats.

**Single Broadcast component with state machine:**
idle → connecting → countdown → live → error. Each state renders a different view. This avoids conditional spaghetti and makes each state's UI self-contained.

---

## File-by-File Code

### `/lib/gemini-live.ts` — WebSocket Client

Purpose: Manages the WebSocket connection to Gemini Live API. Handles setup handshake, frame sending, text accumulation, JSON parsing, and auto-reconnection.

```typescript
export interface CommentaryUpdate {
  commentary: string;
  engagement: number;
  skepticism: number;
  momentum: "rising" | "falling" | "steady";
  event: { type: "positive" | "negative" | "neutral"; text: string } | null;
  sound: "cheer" | "gasp" | "organ" | "buzzer" | null;
}

const SYSTEM_PROMPT = `You are an elite ESPN sports commentator providing LIVE color commentary. But instead of athletes, you're commentating on hackathon judges evaluating a presentation.

Treat every moment like Game 7 of the Finals. Every eyebrow raise is momentum. Every lean-forward is engagement. Every phone glance is a turnover.

RULES:
- Generate exactly ONE commentary update per frame
- Keep commentary to 1-2 sentences MAX
- Never repeat the same observation twice in a row
- Vary energy levels — not everything is a big moment
- If nothing notable: comment on tension, anticipation, or atmosphere
- Be funny but never mean-spirited
- Use sports metaphors liberally
- Build narrative arcs across updates

RESPOND IN THIS EXACT JSON FORMAT (no markdown, no backticks, raw JSON only):
{"commentary":"Your 1-2 sentence play-by-play","engagement":72,"skepticism":25,"momentum":"rising","event":null,"sound":null}

engagement: 0-100 based on body language (leaning in, nodding, eye contact = high)
skepticism: 0-100 (crossed arms, furrowed brows, leaning back = high)
momentum: "rising" | "falling" | "steady"
event: null OR {"type":"positive"|"negative"|"neutral","text":"Brief event description"}
  Only include event for genuinely notable moments, not every frame.
sound: null OR "cheer"|"gasp"|"organ"|"buzzer"
  cheer = positive moment, gasp = surprising reaction, organ = dramatic moment, buzzer = foul (phone check, yawn)
  Use sounds SPARINGLY — max 1 every 3-4 updates.`;

type ConnectionState = "disconnected" | "connecting" | "setup" | "ready";

export class GeminiLiveClient {
  private ws: WebSocket | null = null;
  private state: ConnectionState = "disconnected";
  private accumulatedText = "";
  private onCommentary: ((update: CommentaryUpdate) => void) | null = null;
  private onStateChange: ((state: ConnectionState) => void) | null = null;
  private onError: ((error: string) => void) | null = null;
  private reconnectAttempts = 0;
  private maxReconnects = 3;
  private token: string = "";

  setOnCommentary(cb: (update: CommentaryUpdate) => void) {
    this.onCommentary = cb;
  }

  setOnStateChange(cb: (state: ConnectionState) => void) {
    this.onStateChange = cb;
  }

  setOnError(cb: (error: string) => void) {
    this.onError = cb;
  }

  private setState(s: ConnectionState) {
    this.state = s;
    this.onStateChange?.(s);
  }

  async connect(token: string): Promise<void> {
    this.token = token;
    this.setState("connecting");

    return new Promise((resolve, reject) => {
      const url =
        `wss://generativelanguage.googleapis.com/ws/` +
        `google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent` +
        `?access_token=${token}`;

      this.ws = new WebSocket(url);

      this.ws.onopen = () => {
        this.setState("setup");
        const setupMsg = {
          setup: {
            model: "models/gemini-2.0-flash-live-001",
            systemInstruction: {
              parts: [{ text: SYSTEM_PROMPT }],
            },
            generationConfig: {
              responseModalities: ["TEXT"],
              temperature: 0.9,
            },
          },
        };
        this.ws!.send(JSON.stringify(setupMsg));
      };

      this.ws.onmessage = (event) => {
        const data = JSON.parse(event.data);

        // Setup complete acknowledgment — resolve the connect() promise
        if (data.setupComplete !== undefined) {
          this.setState("ready");
          this.reconnectAttempts = 0;
          resolve();
          return;
        }

        // Model response content
        if (data.serverContent) {
          const sc = data.serverContent;

          // Accumulate streamed text chunks
          if (sc.modelTurn?.parts) {
            for (const part of sc.modelTurn.parts) {
              if (part.text) {
                this.accumulatedText += part.text;
              }
            }
          }

          // Turn complete — parse accumulated text as JSON
          if (sc.turnComplete) {
            this.parseTurn();
          }
        }
      };

      this.ws.onerror = () => {
        this.onError?.("WebSocket connection error");
        reject(new Error("WebSocket error"));
      };

      this.ws.onclose = (event) => {
        const wasReady = this.state === "ready";
        this.setState("disconnected");

        // Auto-reconnect if we were in a live session
        if (wasReady && this.reconnectAttempts < this.maxReconnects) {
          this.reconnectAttempts++;
          setTimeout(() => this.connect(this.token), 1000 * this.reconnectAttempts);
        }
      };
    });
  }

  private parseTurn() {
    const raw = this.accumulatedText.trim();
    this.accumulatedText = "";

    if (!raw) return;

    try {
      // Extract JSON even if wrapped in markdown code blocks
      let jsonStr = raw;
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        jsonStr = jsonMatch[0];
      }

      const parsed = JSON.parse(jsonStr) as CommentaryUpdate;

      // Clamp numeric values to valid range
      parsed.engagement = Math.max(0, Math.min(100, parsed.engagement ?? 50));
      parsed.skepticism = Math.max(0, Math.min(100, parsed.skepticism ?? 50));
      if (!["rising", "falling", "steady"].includes(parsed.momentum)) {
        parsed.momentum = "steady";
      }

      this.onCommentary?.(parsed);
    } catch {
      // If JSON parse fails, use raw text as commentary with defaults
      this.onCommentary?.({
        commentary: raw.slice(0, 200),
        engagement: 50,
        skepticism: 50,
        momentum: "steady",
        event: null,
        sound: null,
      });
    }
  }

  sendVideoFrame(canvas: HTMLCanvasElement) {
    if (this.state !== "ready" || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const dataUrl = canvas.toDataURL("image/jpeg", 0.7);
    const base64Data = dataUrl.split(",")[1];

    const msg = {
      realtimeInput: {
        video: {
          mimeType: "image/jpeg",
          data: base64Data,
        },
      },
    };
    this.ws.send(JSON.stringify(msg));
  }

  // Force a new commentary generation (interrupts current turn)
  nudge() {
    if (this.state !== "ready" || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const msg = {
      clientContent: {
        turns: [
          {
            role: "user",
            parts: [{ text: "Generate new commentary on what you see now. Respond with JSON only." }],
          },
        ],
        turnComplete: true,
      },
    };
    this.ws.send(JSON.stringify(msg));
  }

  disconnect() {
    this.maxReconnects = 0;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.setState("disconnected");
  }
}
```

Key design choices:
- `accumulatedText` buffer: Gemini streams text in small chunks across multiple WebSocket messages. We buffer until `turnComplete` then parse once.
- `parseTurn()` regex fallback: `raw.match(/\{[\s\S]*\}/)` handles Gemini wrapping JSON in ```json blocks.
- Clamping: Gemini occasionally returns values outside 0-100. We clamp silently rather than erroring.
- Auto-reconnect with backoff: If the WebSocket drops during a live session, we retry up to 3 times with increasing delay.

---

### `/lib/sounds.ts` — Audio Manager

Purpose: Preloads 4 audio clips, handles browser autoplay restrictions. The `unlock()` call must happen inside a user interaction event handler (click).

```typescript
type SoundCue = "cheer" | "gasp" | "organ" | "buzzer";

const SOUND_FILES: Record<SoundCue, string> = {
  cheer: "/sounds/crowd-cheer.mp3",
  gasp: "/sounds/crowd-gasp.mp3",
  organ: "/sounds/organ-hit.mp3",
  buzzer: "/sounds/buzzer.mp3",
};

class SoundManager {
  private sounds: Map<string, HTMLAudioElement> = new Map();
  private unlocked = false;

  init() {
    for (const [key, path] of Object.entries(SOUND_FILES)) {
      const audio = new Audio(path);
      audio.volume = 0.3;
      audio.preload = "auto";
      this.sounds.set(key, audio);
    }
  }

  unlock() {
    // Must be called from a user gesture (click handler)
    // Plays and immediately pauses each audio to unlock autoplay
    this.sounds.forEach((audio) => {
      audio.play().then(() => audio.pause()).catch(() => {});
      audio.currentTime = 0;
    });
    this.unlocked = true;
  }

  play(cue: SoundCue | null) {
    if (!cue || !this.unlocked) return;
    const audio = this.sounds.get(cue);
    if (audio) {
      audio.currentTime = 0;
      audio.play().catch(() => {});
    }
  }
}

export const soundManager = new SoundManager();
```

Key design choice:
- Singleton export: All components share one instance. Audio elements are created once and reused.
- `unlock()` plays-and-pauses: This is the standard trick to satisfy browser autoplay policies. Chrome/Safari require a user gesture before any audio can play.

---

### `/app/api/token/route.ts` — Ephemeral Token Endpoint

Purpose: Server-side only. Creates a short-lived Gemini API token so the browser can connect to the Live API WebSocket without exposing the real API key.

```typescript
import { GoogleGenAI } from "@google/genai";
import { NextResponse } from "next/server";

export async function POST() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "GEMINI_API_KEY not set" }, { status: 500 });
  }

  try {
    const client = new GoogleGenAI({ apiKey });

    const expireTime = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    const newSessionExpireTime = new Date(Date.now() + 2 * 60 * 1000).toISOString();

    const token = await client.authTokens.create({
      config: {
        uses: 1,                    // single use — one WebSocket session
        expireTime,                 // token expires in 5 min
        newSessionExpireTime,       // must start session within 2 min
      },
    });

    return NextResponse.json({ token: token.name });
  } catch (error) {
    console.error("Token creation failed:", error);
    return NextResponse.json(
      { error: "Failed to create token" },
      { status: 500 }
    );
  }
}
```

Key design choice:
- Single-use token: Each "START BROADCAST" click gets a fresh token. If the session drops, a new token is fetched on reconnect.
- `token.name` is the token string: The `@google/genai` SDK returns an object; `.name` is the actual token value.

---

### `/app/components/Broadcast.tsx` — Main Component (State Machine)

Purpose: Orchestrates everything. Manages app state, webcam, Gemini connection, frame capture loop, nudge loop, and renders the appropriate UI for each state.

```typescript
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { GeminiLiveClient, type CommentaryUpdate } from "@/lib/gemini-live";
import { soundManager } from "@/lib/sounds";
import { LiveBadge } from "./LiveBadge";
import { CommentaryOverlay } from "./CommentaryOverlay";
import { StatsPanel } from "./StatsPanel";
import { PlayByPlay, type PlayEvent } from "./PlayByPlay";

type AppState = "idle" | "connecting" | "countdown" | "live" | "error";

export function Broadcast() {
  const [appState, setAppState] = useState<AppState>("idle");
  const [commentary, setCommentary] = useState("");
  const [engagement, setEngagement] = useState(50);
  const [skepticism, setSkepticism] = useState(50);
  const [momentum, setMomentum] = useState<"rising" | "falling" | "steady">("steady");
  const [events, setEvents] = useState<PlayEvent[]>([]);
  const [startTime, setStartTime] = useState<number | null>(null);
  const [countdownNum, setCountdownNum] = useState(3);
  const [errorMsg, setErrorMsg] = useState("");

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const clientRef = useRef<GeminiLiveClient | null>(null);
  const frameIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const nudgeIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);

  // Callback for when Gemini returns a commentary update
  const handleCommentary = useCallback((update: CommentaryUpdate) => {
    setCommentary(update.commentary);
    setEngagement(update.engagement);
    setSkepticism(update.skepticism);
    setMomentum(update.momentum);

    // Add notable events to the play-by-play log
    if (update.event) {
      const diff = Math.floor((Date.now() - startTimeRef.current) / 1000);
      const mins = Math.floor(diff / 60).toString().padStart(2, "0");
      const secs = (diff % 60).toString().padStart(2, "0");
      setEvents((prev) => [
        { time: `${mins}:${secs}`, text: update.event!.text, type: update.event!.type },
        ...prev.slice(0, 5),
      ]);
    }

    // Play audio cue if specified
    soundManager.play(update.sound);
  }, []);

  const startBroadcast = async () => {
    setAppState("connecting");
    soundManager.init();
    soundManager.unlock(); // Unlock audio on user gesture (this click)

    try {
      // 1. Get webcam
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      // 2. Get ephemeral token from our server
      const res = await fetch("/api/token", { method: "POST" });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Token fetch failed");
      }
      const { token } = await res.json();

      // 3. Connect to Gemini Live API
      const client = new GeminiLiveClient();
      client.setOnCommentary(handleCommentary);
      client.setOnError((err) => {
        setErrorMsg(err);
        setAppState("error");
      });
      clientRef.current = client;

      await client.connect(token);

      // 4. Countdown
      setAppState("countdown");
      for (let i = 3; i >= 1; i--) {
        setCountdownNum(i);
        await new Promise((r) => setTimeout(r, 800));
      }

      // 5. Go live
      const now = Date.now();
      setStartTime(now);
      startTimeRef.current = now;
      setAppState("live");

      // 6. Start frame capture at 1 FPS
      frameIntervalRef.current = setInterval(() => {
        if (videoRef.current && canvasRef.current) {
          const ctx = canvasRef.current.getContext("2d");
          if (ctx) {
            canvasRef.current.width = 768;
            canvasRef.current.height = 576;
            ctx.drawImage(videoRef.current, 0, 0, 768, 576);
            client.sendVideoFrame(canvasRef.current);
          }
        }
      }, 1000);

      // 7. Nudge every 8 seconds to keep commentary flowing
      nudgeIntervalRef.current = setInterval(() => {
        client.nudge();
      }, 8000);

      // 8. Initial nudge after 2 seconds
      setTimeout(() => client.nudge(), 2000);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Connection failed");
      setAppState("error");
    }
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (frameIntervalRef.current) clearInterval(frameIntervalRef.current);
      if (nudgeIntervalRef.current) clearInterval(nudgeIntervalRef.current);
      clientRef.current?.disconnect();
    };
  }, []);

  // --- RENDER BASED ON STATE ---

  // IDLE: Landing screen with start button
  if (appState === "idle") {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-6xl font-black text-white mb-2 tracking-tight">
            COLOR <span className="text-[#00d4ff]">COMMENTARY</span>
          </h1>
          <p className="text-white/40 text-lg mb-12">Real-time AI sports broadcast</p>
          <button
            onClick={startBroadcast}
            className="bg-red-600 hover:bg-red-500 text-white text-xl font-bold px-12 py-4 rounded-lg transition-colors cursor-pointer tracking-wider"
          >
            START BROADCAST
          </button>
        </div>
      </div>
    );
  }

  // CONNECTING: Spinner while getting webcam + token + WebSocket
  if (appState === "connecting") {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-[#00d4ff] border-t-transparent rounded-full animate-spin mx-auto mb-6" />
          <p className="text-white/60 text-lg">Connecting to broadcast...</p>
        </div>
        <video ref={videoRef} className="hidden" playsInline muted />
      </div>
    );
  }

  // COUNTDOWN: 3... 2... 1...
  if (appState === "countdown") {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
        <div className="text-center">
          <div className="text-[120px] font-black text-[#00d4ff]">
            {countdownNum}
          </div>
          <p className="text-white/40 text-lg tracking-widest">GOING LIVE</p>
        </div>
        <video ref={videoRef} className="hidden" playsInline muted />
      </div>
    );
  }

  // ERROR: Show message + retry button
  if (appState === "error") {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-400 text-xl mb-4">{errorMsg}</p>
          <button
            onClick={() => { setAppState("idle"); setErrorMsg(""); }}
            className="bg-white/10 hover:bg-white/20 text-white px-8 py-3 rounded-lg transition-colors cursor-pointer"
          >
            Try Again
          </button>
        </div>
        <video ref={videoRef} className="hidden" playsInline muted />
      </div>
    );
  }

  // LIVE: Full broadcast UI
  return (
    <div className="min-h-screen bg-[#0a0a0a] flex flex-col">
      {/* Header bar */}
      <div className="flex items-center justify-between px-6 py-3 bg-black/50 border-b border-white/10">
        <LiveBadge startTime={startTime} />
        <h1 className="text-sm font-bold tracking-[0.3em] text-white/50 uppercase">
          Color Commentary — Gemini Super Hack
        </h1>
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col px-6 py-4 gap-4 max-w-6xl mx-auto w-full">
        {/* Video feed with commentary overlay */}
        <div className="relative rounded-lg overflow-hidden bg-black aspect-video scanlines">
          <video ref={videoRef} className="w-full h-full object-cover" playsInline muted />
          <CommentaryOverlay text={commentary} />
        </div>

        {/* Stats panel */}
        <StatsPanel engagement={engagement} skepticism={skepticism} momentum={momentum} />

        {/* Play-by-play log */}
        <PlayByPlay events={events} />
      </div>

      {/* Hidden canvas used for frame capture */}
      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
}
```

Key design choices:
- `startTimeRef` (ref) vs `startTime` (state): The ref is used inside the `handleCommentary` callback to avoid stale closure issues. The state is used for the LiveBadge UI.
- Video element exists in ALL states (hidden when not live): This avoids re-requesting camera permission when transitioning states.
- `soundManager.unlock()` inside `startBroadcast`: The button click is the user gesture that satisfies browser autoplay policy.

---

### `/app/components/CommentaryOverlay.tsx`

Purpose: Renders the current commentary text over the video feed with a typewriter animation.

```typescript
"use client";

import { useEffect, useState } from "react";

export function CommentaryOverlay({ text }: { text: string }) {
  const [displayed, setDisplayed] = useState("");
  const [targetText, setTargetText] = useState("");

  useEffect(() => {
    if (text === targetText) return;
    setTargetText(text);
    setDisplayed("");

    let i = 0;
    const interval = setInterval(() => {
      if (i < text.length) {
        setDisplayed(text.slice(0, i + 1));
        i++;
      } else {
        clearInterval(interval);
      }
    }, 25); // 25ms per character = ~40 chars/sec

    return () => clearInterval(interval);
  }, [text, targetText]);

  if (!text) return null;

  return (
    <div className="absolute bottom-0 left-0 right-0 bg-black/80 backdrop-blur-sm border-l-4 border-[#00d4ff] p-4">
      <p className="text-white text-lg font-medium leading-relaxed">
        {displayed}
        <span className="inline-block w-0.5 h-5 bg-[#00d4ff] ml-1 animate-pulse align-middle" />
      </p>
    </div>
  );
}
```

Key design choice:
- `targetText` tracking prevents re-triggering the typewriter when React re-renders without new text.
- 25ms per character: Fast enough to not feel slow, slow enough to read as it appears.

---

### `/app/components/StatsPanel.tsx`

Purpose: Three stat cards showing engagement (0-100), skepticism (0-100), and momentum direction.

```typescript
"use client";

function StatBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="bg-white/5 rounded-lg p-4 flex-1 min-w-[160px]">
      <div className="flex justify-between items-baseline mb-2">
        <span className="text-xs font-bold tracking-widest text-white/50 uppercase">{label}</span>
        <span className="text-2xl font-bold font-mono" style={{ color }}>
          {value}
        </span>
      </div>
      <div className="h-2 bg-white/10 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-700 ease-out"
          style={{ width: `${value}%`, background: color }}
        />
      </div>
    </div>
  );
}

export function StatsPanel({
  engagement,
  skepticism,
  momentum,
}: {
  engagement: number;
  skepticism: number;
  momentum: "rising" | "falling" | "steady";
}) {
  const momentumConfig = {
    rising: { label: "RISING", icon: "▲", color: "#00ff88" },
    falling: { label: "FALLING", icon: "▼", color: "#ff4444" },
    steady: { label: "STEADY", icon: "▶", color: "#ffaa00" },
  };

  const m = momentumConfig[momentum];

  return (
    <div className="flex gap-3 flex-wrap">
      <StatBar label="Engagement" value={engagement} color="#00d4ff" />
      <StatBar label="Skepticism" value={skepticism} color="#ff0080" />
      <div className="bg-white/5 rounded-lg p-4 flex-1 min-w-[160px]">
        <div className="text-xs font-bold tracking-widest text-white/50 uppercase mb-2">
          Momentum
        </div>
        <div className="flex items-center gap-2">
          <span className="text-3xl" style={{ color: m.color }}>{m.icon}</span>
          <span className="text-xl font-bold font-mono" style={{ color: m.color }}>{m.label}</span>
        </div>
      </div>
    </div>
  );
}
```

Key design choice:
- `transition-all duration-700 ease-out` on the bar fill: CSS handles the smooth animation between values. No JS animation needed.

---

### `/app/components/PlayByPlay.tsx`

Purpose: Scrolling log of notable events with timestamps and color coding.

```typescript
"use client";

export interface PlayEvent {
  time: string;
  text: string;
  type: "positive" | "negative" | "neutral";
}

const typeColors = {
  positive: "text-green-400",
  negative: "text-red-400",
  neutral: "text-white/60",
};

const typeDots = {
  positive: "bg-green-400",
  negative: "bg-red-400",
  neutral: "bg-white/40",
};

export function PlayByPlay({ events }: { events: PlayEvent[] }) {
  if (events.length === 0) {
    return (
      <div className="bg-white/5 rounded-lg p-4">
        <div className="text-xs font-bold tracking-widest text-white/50 uppercase mb-3">
          Play-by-Play
        </div>
        <p className="text-white/30 text-sm italic">Waiting for notable moments...</p>
      </div>
    );
  }

  return (
    <div className="bg-white/5 rounded-lg p-4">
      <div className="text-xs font-bold tracking-widest text-white/50 uppercase mb-3">
        Play-by-Play
      </div>
      <div className="space-y-2 max-h-[180px] overflow-y-auto">
        {events.map((event, i) => (
          <div key={i} className="flex items-start gap-3 text-sm">
            <span className="text-white/40 font-mono text-xs mt-0.5 shrink-0">{event.time}</span>
            <span className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${typeDots[event.type]}`} />
            <span className={typeColors[event.type]}>{event.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
```

---

### `/app/components/LiveBadge.tsx`

Purpose: Pulsing red "LIVE" indicator with elapsed time counter.

```typescript
"use client";

import { useEffect, useState } from "react";

export function LiveBadge({ startTime }: { startTime: number | null }) {
  const [elapsed, setElapsed] = useState("00:00");

  useEffect(() => {
    if (!startTime) return;
    const interval = setInterval(() => {
      const diff = Math.floor((Date.now() - startTime) / 1000);
      const mins = Math.floor(diff / 60).toString().padStart(2, "0");
      const secs = (diff % 60).toString().padStart(2, "0");
      setElapsed(`${mins}:${secs}`);
    }, 1000);
    return () => clearInterval(interval);
  }, [startTime]);

  return (
    <div className="flex items-center gap-4">
      <div className="flex items-center gap-2 bg-red-600 px-3 py-1 rounded text-sm font-bold tracking-wider">
        <span className="w-2 h-2 bg-white rounded-full animate-pulse" />
        LIVE
      </div>
      <span className="text-white/60 font-mono text-sm">{elapsed}</span>
    </div>
  );
}
```

---

### `/app/page.tsx` — Page Shell

```typescript
import { Broadcast } from "./components/Broadcast";

export default function Home() {
  return <Broadcast />;
}
```

---

### `/app/globals.css` — Global Styles

```css
@import "tailwindcss";

:root {
  --background: #0a0a0a;
  --foreground: #ededed;
}

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --font-sans: var(--font-geist-sans);
  --font-mono: var(--font-geist-mono);
}

body {
  background: var(--background);
  color: var(--foreground);
  font-family: var(--font-sans), Arial, Helvetica, sans-serif;
  overflow: hidden;
}

/* Broadcast scan lines — subtle CRT/TV effect over the video */
.scanlines::after {
  content: "";
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: repeating-linear-gradient(
    0deg,
    rgba(0, 0, 0, 0.08),
    rgba(0, 0, 0, 0.08) 1px,
    transparent 1px,
    transparent 3px
  );
  pointer-events: none;
  z-index: 10;
}
```

---

### `/app/layout.tsx` — Root Layout

```typescript
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Color Commentary",
  description: "Real-time AI sports broadcast powered by Gemini",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        {children}
      </body>
    </html>
  );
}
```

---

## Gemini Live API Protocol Reference (for debugging)

### WebSocket URL
```
wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?access_token=TOKEN
```

### Message sequence

**Client → Server: Setup (must be first message)**
```json
{
  "setup": {
    "model": "models/gemini-2.0-flash-live-001",
    "systemInstruction": { "parts": [{ "text": "..." }] },
    "generationConfig": { "responseModalities": ["TEXT"], "temperature": 0.9 }
  }
}
```

**Server → Client: Setup acknowledgment**
```json
{ "setupComplete": {} }
```

**Client → Server: Video frame (does NOT interrupt generation)**
```json
{
  "realtimeInput": {
    "video": { "mimeType": "image/jpeg", "data": "base64..." }
  }
}
```

**Client → Server: Text nudge (DOES interrupt generation)**
```json
{
  "clientContent": {
    "turns": [{ "role": "user", "parts": [{ "text": "..." }] }],
    "turnComplete": true
  }
}
```

**Server → Client: Streamed text (multiple messages)**
```json
{
  "serverContent": {
    "modelTurn": { "parts": [{ "text": "partial text..." }] },
    "turnComplete": false
  }
}
```

**Server → Client: Turn complete**
```json
{ "serverContent": { "turnComplete": true } }
```

## Known Risks / Things That Could Break

1. **Ephemeral token API might not be available on all Gemini plans** — If it fails, fallback: pass API key directly via `?key=` param on the v1beta endpoint (less secure but works)
2. **Gemini might not return valid JSON** — Handled by regex extraction + raw text fallback
3. **WebSocket drops after ~15-30 min** — Auto-reconnect handles this, but will need a fresh token
4. **Audio files missing** — App works fine without them, just no sound effects
5. **Webcam permission denied** — Shows error state with retry button
