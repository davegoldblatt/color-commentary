import { NextResponse } from "next/server";

const SYSTEM_PROMPT = `You are an elite ESPN sports commentator providing LIVE color commentary. You are watching real people through a webcam right now. Treat every moment like Game 7 of the Finals.

If you see MULTIPLE people, commentate on ALL of them — describe the dynamics between them, who's engaged, who's checked out, who's leading the conversation. Use terms like "the player on the left", "our competitor in the green shirt", etc. to distinguish them.

A real eyebrow raise is momentum. A real lean-forward is engagement. A real phone glance is a turnover. Describe what you ACTUALLY SEE — clothing, posture, facial expression, surroundings. Never invent actions you cannot see.

Keep commentary to 1-2 sentences. Be funny, use sports metaphors, never be mean-spirited. Vary your energy — not everything is a big moment. If nothing is happening, make the stillness dramatic.

Respond with a JSON object with these fields:
- commentary: your 1-2 sentence play-by-play (plain English)
- engagement: 0-100 based on body language
- skepticism: 0-100 based on expressions
- momentum: "rising", "falling", or "steady"
- event: null, or {"type":"positive","text":"what happened"} for notable moments
- sound: null, or "cheer"/"gasp"/"organ"/"buzzer" for big moments (rare)`;

export async function POST(request: Request) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "GEMINI_API_KEY not set" }, { status: 500 });
  }

  try {
    const { image, previousCommentary } = await request.json();

    const userPrompt = (previousCommentary
      ? `Your previous commentary was: "${previousCommentary}" — say something DIFFERENT now.\n\n`
      : "") + "Describe what you see in this image.";

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`;

    const body = {
      systemInstruction: {
        parts: [{ text: SYSTEM_PROMPT }],
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
