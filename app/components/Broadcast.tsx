"use client";

import { useEffect, useRef, useState } from "react";
import { soundManager } from "@/lib/sounds";
import { personalities, type PersonalityId } from "@/lib/personalities";
import { LiveBadge } from "./LiveBadge";
import { CommentaryOverlay } from "./CommentaryOverlay";
import { StatsPanel } from "./StatsPanel";
import { PlayByPlay, type PlayEvent } from "./PlayByPlay";

type AppState = "idle" | "connecting" | "countdown" | "live" | "error";

interface CommentaryUpdate {
  commentary: string;
  engagement: number;
  skepticism: number;
  momentum: "rising" | "falling" | "steady";
  event: { type: "positive" | "negative" | "neutral"; text: string } | null;
  sound: "cheer" | "gasp" | "organ" | "buzzer" | null;
  detectedNames: string[] | null;
  peopleCount: number | null;
}

export function Broadcast() {
  const [appState, setAppState] = useState<AppState>("idle");
  const [selectedPersonality, setSelectedPersonality] = useState<PersonalityId>("default");
  const [people, setPeople] = useState<string[]>([]);
  const [commentary, setCommentary] = useState("");
  const [engagement, setEngagement] = useState(50);
  const [skepticism, setSkepticism] = useState(50);
  const [momentum, setMomentum] = useState<"rising" | "falling" | "steady">("steady");
  const [events, setEvents] = useState<PlayEvent[]>([]);
  const [startTime, setStartTime] = useState<number | null>(null);
  const [countdownNum, setCountdownNum] = useState(3);
  const [errorMsg, setErrorMsg] = useState("");
  const [debugLog, setDebugLog] = useState<string[]>(["Waiting to start..."]);

  const videoRef = useRef<HTMLVideoElement>(null);
  const startTimeRef = useRef<number>(0);
  const runningRef = useRef(false);
  const prevCommentaryRef = useRef("");
  const personalityRef = useRef<PersonalityId>("default");
  const peopleRef = useRef<string[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const pollNowRef = useRef<(() => void) | null>(null);

  const addDebug = (msg: string) => {
    setDebugLog((prev) => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...prev.slice(0, 9)]);
  };

  const applyUpdate = (update: CommentaryUpdate) => {
    addDebug(`UPDATE: "${update.commentary?.slice(0, 50)}"`);
    setCommentary(update.commentary || "");
    setEngagement(Math.max(0, Math.min(100, update.engagement ?? 50)));
    setSkepticism(Math.max(0, Math.min(100, update.skepticism ?? 50)));
    setMomentum(
      ["rising", "falling", "steady"].includes(update.momentum) ? update.momentum : "steady"
    );

    if (update.event) {
      const diff = Math.floor((Date.now() - startTimeRef.current) / 1000);
      const mins = Math.floor(diff / 60).toString().padStart(2, "0");
      const secs = (diff % 60).toString().padStart(2, "0");
      setEvents((prev) => [
        { time: `${mins}:${secs}`, text: update.event!.text, type: update.event!.type },
        ...prev.slice(0, 5),
      ]);
    }

    // Auto-populate names from detected name tags
    if (update.detectedNames && update.detectedNames.length > 0) {
      let validNames = update.detectedNames.filter(n => n && typeof n === "string" && n.trim());
      // Limit names to actual people count if provided
      if (update.peopleCount && update.peopleCount > 0 && validNames.length > update.peopleCount) {
        validNames = validNames.slice(0, update.peopleCount);
      }
      if (validNames.length > 0) {
        addDebug(`Detected ${update.peopleCount || "?"} people, names: ${validNames.join(", ")}`);
        // Only update if we detect new names that differ from current
        const currentNames = peopleRef.current.join(",");
        const newNames = validNames.join(",");
        if (currentNames !== newNames) {
          setPeople(validNames);
          peopleRef.current = validNames;
        }
      }
    } else if (update.peopleCount !== null && update.peopleCount >= 0) {
      // If we have a people count but no names, trim the list if needed
      if (peopleRef.current.length > update.peopleCount) {
        const trimmedPeople = peopleRef.current.slice(0, update.peopleCount);
        setPeople(trimmedPeople);
        peopleRef.current = trimmedPeople;
        addDebug(`Trimmed to ${update.peopleCount} visible people`);
      }
    }

    soundManager.play(update.sound);
    prevCommentaryRef.current = update.commentary || "";
  };

  const analyzeFrame = async (canvas: HTMLCanvasElement) => {
    const dataUrl = canvas.toDataURL("image/jpeg", 0.7);
    const base64Data = dataUrl.split(",")[1];

    addDebug(`Sending frame: ${Math.round(base64Data.length / 1024)}KB`);
    console.log("[Analyze] Sending frame, size:", Math.round(base64Data.length / 1024), "KB");

    // Abort any previous in-flight request
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const response = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image: base64Data,
        previousCommentary: prevCommentaryRef.current,
        personality: personalityRef.current,
        people: peopleRef.current.filter(p => p.trim() !== ""),
      }),
      signal: controller.signal,
    });

    addDebug(`Response: ${response.status}`);

    if (!response.ok) {
      const errText = await response.text();
      addDebug(`ERROR: ${errText.slice(0, 80)}`);
      return null;
    }

    const text = await response.text();
    addDebug(`Raw: ${text.slice(0, 80)}`);
    try {
      const data = JSON.parse(text);
      return data as CommentaryUpdate;
    } catch (e) {
      addDebug(`JSON PARSE FAIL: ${e}`);
      return null;
    }
  };

  const startBroadcast = async () => {
    addDebug("Starting broadcast...");
    personalityRef.current = selectedPersonality;
    peopleRef.current = people;
    setAppState("connecting");
    soundManager.init();
    soundManager.unlock();

    try {
      // Get webcam
      console.log("[Broadcast] Requesting webcam...");
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      console.log("[Broadcast] Got webcam stream");

      // Countdown
      setAppState("countdown");
      for (let i = 3; i >= 1; i--) {
        setCountdownNum(i);
        await new Promise((r) => setTimeout(r, 800));
      }

      // Go live
      const now = Date.now();
      setStartTime(now);
      startTimeRef.current = now;
      setAppState("live");

      // Set up capture video (programmatic, not in DOM)
      const captureVideo = document.createElement("video");
      captureVideo.srcObject = stream;
      captureVideo.muted = true;
      captureVideo.playsInline = true;
      await captureVideo.play();
      console.log("[Broadcast] Capture video playing:", !captureVideo.paused, "size:", captureVideo.videoWidth, "x", captureVideo.videoHeight);

      // Set up display video via ref (will be set by useEffect)
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play().catch(() => {});
      }

      // Set up canvas
      const canvas = document.createElement("canvas");
      canvas.width = 768;
      canvas.height = 576;
      const ctx = canvas.getContext("2d")!;

      // Start poll loop
      runningRef.current = true;
      addDebug("Starting poll loop...");

      const poll = async () => {
        let frameCount = 0;
        while (runningRef.current) {
          frameCount++;
          addDebug(`Frame #${frameCount}`);
          try {
            ctx.drawImage(captureVideo, 0, 0, 768, 576);
            const update = await analyzeFrame(canvas);
            if (update) {
              applyUpdate(update);
            }
          } catch (e: unknown) {
            if (e instanceof Error && e.name === "AbortError") {
              addDebug("Request aborted — switching personality");
              continue; // Skip the wait, immediately send new frame
            }
            addDebug(`POLL ERROR: ${e}`);
          }
          // Wait 3 seconds, but allow interruption
          await new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, 3000);
            pollNowRef.current = () => {
              clearTimeout(timer);
              resolve();
            };
          });
          pollNowRef.current = null;
        }
      };

      // Start polling — don't await, let it run in background
      poll();
    } catch (err) {
      console.error("[Broadcast] Error:", err);
      setErrorMsg(err instanceof Error ? err.message : "Connection failed");
      setAppState("error");
    }
  };

  // Re-attach stream when video element appears
  useEffect(() => {
    if (appState === "live" && videoRef.current) {
      // The stream might already be set, but try to play anyway
      videoRef.current.play().catch(() => {});
    }
  }, [appState]);

  // Cleanup
  useEffect(() => {
    return () => {
      runningRef.current = false;
    };
  }, []);

  return (
    <div className="min-h-screen bg-[#0a0a0a] flex flex-col">
      {/* IDLE */}
      {appState === "idle" && (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <h1 className="text-6xl font-black text-white mb-2 tracking-tight">
              COLOR <span className="text-[#00d4ff]">COMMENTARY</span>
            </h1>
            <p className="text-white/40 text-lg mb-8">Real-time AI sports broadcast</p>

            {/* Personality Selector */}
            <div className="mb-8">
              <p className="text-white/60 text-sm mb-3 uppercase tracking-widest">Select Commentator</p>
              <div className="flex flex-wrap justify-center gap-2">
                {personalities.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => setSelectedPersonality(p.id)}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-all cursor-pointer ${
                      selectedPersonality === p.id
                        ? "bg-[#00d4ff] text-black"
                        : "bg-white/10 text-white/70 hover:bg-white/20 hover:text-white"
                    }`}
                  >
                    {p.name}
                  </button>
                ))}
              </div>
              <p className="text-white/30 text-xs mt-2">
                {personalities.find(p => p.id === selectedPersonality)?.description}
              </p>
            </div>

            <button
              onClick={startBroadcast}
              className="bg-red-600 hover:bg-red-500 text-white text-xl font-bold px-12 py-4 rounded-lg transition-colors cursor-pointer tracking-wider"
            >
              START BROADCAST
            </button>
          </div>
        </div>
      )}

      {/* CONNECTING */}
      {appState === "connecting" && (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="w-12 h-12 border-4 border-[#00d4ff] border-t-transparent rounded-full animate-spin mx-auto mb-6" />
            <p className="text-white/60 text-lg">Connecting to broadcast...</p>
          </div>
        </div>
      )}

      {/* COUNTDOWN */}
      {appState === "countdown" && (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="text-[120px] font-black text-[#00d4ff]">
              {countdownNum}
            </div>
            <p className="text-white/40 text-lg tracking-widest">GOING LIVE</p>
          </div>
        </div>
      )}

      {/* ERROR */}
      {appState === "error" && (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <p className="text-red-400 text-xl mb-4">{errorMsg}</p>
            <button
              onClick={() => { setAppState("idle"); setErrorMsg(""); }}
              className="bg-white/10 hover:bg-white/20 text-white px-8 py-3 rounded-lg transition-colors cursor-pointer"
            >
              Try Again
            </button>
          </div>
        </div>
      )}

      {/* LIVE */}
      {appState === "live" && (
        <>
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-3 bg-black/50 border-b border-white/10">
            <LiveBadge startTime={startTime} />

            {/* Live Personality Switcher */}
            <div className="flex items-center gap-1">
              {personalities.map((p) => (
                <button
                  key={p.id}
                  onClick={() => {
                    setSelectedPersonality(p.id);
                    personalityRef.current = p.id;
                    // Abort in-flight request and skip wait
                    abortRef.current?.abort();
                    pollNowRef.current?.();
                  }}
                  className={`px-2 py-1 rounded text-xs font-medium transition-all cursor-pointer ${
                    selectedPersonality === p.id
                      ? "bg-[#00d4ff] text-black"
                      : "bg-white/10 text-white/50 hover:bg-white/20 hover:text-white"
                  }`}
                  title={p.description}
                >
                  {p.name}
                </button>
              ))}
            </div>
          </div>

          {/* Players Panel (always visible) */}
          <div className="px-6 py-2 bg-black/30 border-b border-white/10">
            <div className="flex items-center gap-3 flex-wrap max-w-6xl mx-auto">
              <span className="text-white/50 text-xs uppercase tracking-wider">Players:</span>
              {people.length === 0 ? (
                <span className="text-white/30 text-xs italic">Scanning for name tags...</span>
              ) : (
                people.map((name, idx) => (
                  <div key={idx} className="flex items-center gap-1">
                    <span className="text-white/30 text-xs">#{idx + 1}</span>
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => {
                        const newPeople = [...people];
                        newPeople[idx] = e.target.value;
                        setPeople(newPeople);
                        peopleRef.current = newPeople;
                      }}
                      className="bg-white/10 text-white px-2 py-1 rounded text-xs w-24 border border-white/10 focus:border-[#00d4ff] focus:outline-none"
                    />
                    <button
                      onClick={() => {
                        const newPeople = people.filter((_, i) => i !== idx);
                        setPeople(newPeople);
                        peopleRef.current = newPeople;
                      }}
                      className="text-white/30 hover:text-red-400 text-xs cursor-pointer"
                    >
                      ×
                    </button>
                  </div>
                ))
              )}
              <button
                onClick={() => {
                  const newPeople = [...people, `Person ${people.length + 1}`];
                  setPeople(newPeople);
                  peopleRef.current = newPeople;
                }}
                className="text-[#00d4ff]/70 hover:text-[#00d4ff] text-xs cursor-pointer"
              >
                + Add
              </button>
            </div>
          </div>

          {/* Video Feed */}
          <div className="flex-1 flex flex-col px-6 py-4 gap-4 max-w-6xl mx-auto w-full">
            <div className="relative rounded-lg overflow-hidden bg-black aspect-video scanlines">
              <video
                ref={videoRef}
                className="w-full h-full object-cover absolute inset-0"
                playsInline
                muted
                autoPlay
              />
              <CommentaryOverlay text={commentary} />
            </div>

            {/* Stats */}
            <StatsPanel engagement={engagement} skepticism={skepticism} momentum={momentum} />

            {/* Play-by-Play */}
            <PlayByPlay events={events} />

          </div>
        </>
      )}
    </div>
  );
}
