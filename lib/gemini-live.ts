export interface CommentaryUpdate {
  commentary: string;
  engagement: number;
  skepticism: number;
  momentum: "rising" | "falling" | "steady";
  event: { type: "positive" | "negative" | "neutral"; text: string } | null;
  sound: "cheer" | "gasp" | "organ" | "buzzer" | null;
}

export class GeminiLiveClient {
  private onCommentary: ((update: CommentaryUpdate) => void) | null = null;
  private onError: ((error: string) => void) | null = null;
  private abortController: AbortController | null = null;
  private previousCommentary: string = "";
  private ready = false;

  setOnCommentary(cb: (update: CommentaryUpdate) => void) {
    this.onCommentary = cb;
  }

  setOnError(cb: (error: string) => void) {
    this.onError = cb;
  }

  // No real connection needed — just mark as ready
  async connect(_apiKey: string): Promise<void> {
    this.abortController = new AbortController();
    this.ready = true;
    console.log("[Gemini] Ready (polling via /api/analyze)");
  }

  async sendVideoFrame(canvas: HTMLCanvasElement) {
    if (!this.ready) return;

    const dataUrl = canvas.toDataURL("image/jpeg", 0.7);
    const base64Data = dataUrl.split(",")[1];

    try {
      console.log("[Gemini] Sending frame to /api/analyze...");
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image: base64Data,
          previousCommentary: this.previousCommentary,
        }),
        signal: this.abortController?.signal,
      });

      if (!response.ok) {
        console.error("[Gemini] Server error:", response.status);
        return;
      }

      const update = await response.json() as CommentaryUpdate;
      console.log("[Gemini] Got commentary:", update.commentary?.slice(0, 80));

      // Clamp values
      update.engagement = Math.max(0, Math.min(100, update.engagement ?? 50));
      update.skepticism = Math.max(0, Math.min(100, update.skepticism ?? 50));
      if (!["rising", "falling", "steady"].includes(update.momentum)) {
        update.momentum = "steady";
      }

      this.previousCommentary = update.commentary;
      this.onCommentary?.(update);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      console.error("[Gemini] Request failed:", err);
    }
  }

  nudge() {}

  disconnect() {
    this.abortController?.abort();
    this.ready = false;
  }
}
