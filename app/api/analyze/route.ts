import { NextResponse } from "next/server";
import { getPersonality, type PersonalityId } from "@/lib/personalities";

export async function POST(request: Request) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "GEMINI_API_KEY not set" }, { status: 500 });
  }

  try {
    const { image, previousCommentary, personality: personalityId } = await request.json();
    const personality = getPersonality(personalityId as PersonalityId || 'default');

    const userPrompt = (previousCommentary
      ? `Your previous commentary was: "${previousCommentary}" — say something DIFFERENT now.\n\n`
      : "") + "Describe what you see in this image.";

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`;

    const body = {
      systemInstruction: {
        parts: [{ text: personality.prompt }],
      },
      contents: [
        {
          parts: [
            { text: userPrompt },
            {
              inlineData: {
                mimeType: "image/jpeg",
                data: image,
              },
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.9,
        maxOutputTokens: 2000,
        responseMimeType: "application/json",
      },
    };

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const err = await response.json();
      console.error("[Analyze] Gemini API error:", err);
      return NextResponse.json({ error: "Gemini API error", detail: JSON.stringify(err) }, { status: 500 });
    }

    const data = await response.json();
    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!rawText) {
      return NextResponse.json({ error: "No response text" }, { status: 500 });
    }

    console.log("[Analyze] Raw:", rawText.slice(0, 300));

    try {
      let parsed = JSON.parse(rawText);

      // Handle double-nesting: if commentary is itself a JSON string, unwrap it
      if (typeof parsed.commentary === "string" && parsed.commentary.trim().startsWith("{")) {
        try {
          const inner = JSON.parse(parsed.commentary);
          if (inner.commentary) {
            parsed = inner;
          }
        } catch {
          // not valid JSON inside, that's fine
        }
      }

      const result = {
        commentary: String(parsed.commentary || ""),
        engagement: Math.max(0, Math.min(100, Number(parsed.engagement) || 50)),
        skepticism: Math.max(0, Math.min(100, Number(parsed.skepticism) || 50)),
        momentum: ["rising", "falling", "steady"].includes(parsed.momentum) ? parsed.momentum : "steady",
        event: parsed.event && parsed.event.type ? parsed.event : null,
        sound: parsed.sound && parsed.sound !== "none" ? parsed.sound : null,
      };

      return NextResponse.json(result);
    } catch {
      return NextResponse.json({
        commentary: rawText.slice(0, 200),
        engagement: 50,
        skepticism: 50,
        momentum: "steady",
        event: null,
        sound: null,
      });
    }
  } catch (error) {
    console.error("[Analyze] Error:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
