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
    // Call this on first user interaction to unlock autoplay
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
