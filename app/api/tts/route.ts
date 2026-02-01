import { NextRequest } from "next/server";
import { getVoiceId, type PersonalityId } from "@/lib/personalities";

const ELEVENLABS_API_URL = "https://api.elevenlabs.io/v1/text-to-speech";
const MODEL_ID = "eleven_flash_v2_5";

export async function POST(request: NextRequest) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    return new Response(null, { status: 204 });
  }

  try {
    const { text, personality } = await request.json();

    if (!text || typeof text !== "string" || text.trim().length === 0) {
      return new Response(null, { status: 204 });
    }

    const voiceId = getVoiceId(personality as PersonalityId);
    if (!voiceId) {
      return new Response(null, { status: 204 });
    }

    const response = await fetch(
      `${ELEVENLABS_API_URL}/${voiceId}/stream?output_format=mp3_44100_128&optimize_streaming_latency=3`,
      {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text,
          model_id: MODEL_ID,
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
            style: 0.5,
            speed: 1.1,
          },
        }),
      }
    );

    if (!response.ok) {
      const err = await response.text();
      console.error("[TTS] ElevenLabs error:", response.status, err);
      return new Response(null, { status: 204 });
    }

    return new Response(response.body, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-cache",
      },
    });
  } catch (error) {
    console.error("[TTS] Error:", error);
    return new Response(null, { status: 204 });
  }
}
