type TTSState = "idle" | "loading" | "playing";

class TTSManager {
  private currentAudio: HTMLAudioElement | null = null;
  private currentObjectUrl: string | null = null;
  private abortController: AbortController | null = null;
  private _enabled = false;
  private _state: TTSState = "idle";
  private onStateChange: ((state: TTSState) => void) | null = null;

  get enabled(): boolean {
    return this._enabled;
  }

  get state(): TTSState {
    return this._state;
  }

  setEnabled(enabled: boolean) {
    this._enabled = enabled;
    if (!enabled) {
      this.stop();
    }
  }

  setOnStateChange(cb: ((state: TTSState) => void) | null) {
    this.onStateChange = cb;
  }

  private setState(state: TTSState) {
    this._state = state;
    this.onStateChange?.(state);
  }

  stop() {
    this.abortController?.abort();
    this.abortController = null;

    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio.removeAttribute("src");
      this.currentAudio = null;
    }

    if (this.currentObjectUrl) {
      URL.revokeObjectURL(this.currentObjectUrl);
      this.currentObjectUrl = null;
    }

    this.setState("idle");
  }

  async speak(text: string, personality: string) {
    if (!this._enabled || !text) return;

    this.stop();

    const controller = new AbortController();
    this.abortController = controller;
    this.setState("loading");

    try {
      const response = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, personality }),
        signal: controller.signal,
      });

      if (response.status === 204 || !response.ok) {
        this.setState("idle");
        return;
      }

      const blob = await response.blob();
      if (controller.signal.aborted) return;

      const url = URL.createObjectURL(blob);
      this.currentObjectUrl = url;

      const audio = new Audio(url);
      audio.volume = 0.8;
      this.currentAudio = audio;

      audio.onended = () => {
        this.cleanup();
        this.setState("idle");
      };

      audio.onerror = () => {
        this.cleanup();
        this.setState("idle");
      };

      this.setState("playing");
      await audio.play();
    } catch (e: unknown) {
      if (e instanceof Error && e.name === "AbortError") return;
      console.warn("[TTS] Playback error:", e);
      this.setState("idle");
    }
  }

  private cleanup() {
    if (this.currentObjectUrl) {
      URL.revokeObjectURL(this.currentObjectUrl);
      this.currentObjectUrl = null;
    }
    this.currentAudio = null;
  }
}

export const ttsManager = new TTSManager();
