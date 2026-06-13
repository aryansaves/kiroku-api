import { env } from "../config";

export interface LogPayload {
  mediaType: "anime" | "movie" | "series" | "book" | "manga" | "comic";
  title: string | null;
  action: "log" | "update" | "query";
  status: "watching" | "completed" | "dropped" | "planned" | "rewatching";
  progress: {
    episode: number | null;
    chapter: number | null;
    page: number | null;
    percentage: number | null;
  };
  rating: number | null;
  notes: string | null;
  confidence: "high" | "low";
}

const SYSTEM_PROMPT = `You are an expert media journal logging assistant. Extract structured logging data from the user's message and return ONLY a valid JSON object.

Rules:
1. Deduce mediaType from context: "read" → book/manga/comic, "watched/finished" → anime/movie/series, "played" → game.
2. If the user mentions volume/chapter → manga, comic, or book. If episodes → anime or series.
3. mediaType must be one of: anime, movie, series, book, manga, comic.
4. status must be one of: watching, completed, dropped, planned, rewatching.
5. If the user explicitly provides a rating (e.g. "4/5", "8/10", "9 out of 10"), extract it scaled to 0-10. If no rating is mentioned, set rating to null.
6. If title is unclear or ambiguous, set confidence "low" and title null.
7. Correct obvious spelling mistakes of well-known media (e.g. "Incepton" → "Inception"). Do not guess obscure titles.

Return a JSON object with exactly this shape:
{
  "mediaType": "movie",
  "title": "Movie Title",
  "action": "log",
  "status": "completed",
  "progress": { "episode": null, "chapter": null, "page": null, "percentage": null },
  "rating": null,
  "notes": "optional notes here",
  "confidence": "high"
}`;

const GROQ_MODEL = "llama-3.1-8b-instant";

export async function parseUserMessage(messageText: string): Promise<LogPayload> {
  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${env.LLM_API_KEY}`,
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: messageText },
        ],
        response_format: { type: "json_object" },
        temperature: 0.1,
      }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      throw new Error(`Groq API returned ${response.status}: ${errText}`);
    }

    const data = await response.json() as any;
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error("Empty response from Groq API");

    return JSON.parse(content) as LogPayload;
  } catch (error) {
    console.error("NLP Pipeline Extraction Error:", error);
    return {
      mediaType: "anime",
      title: null,
      action: "log",
      status: "watching",
      progress: { episode: null, chapter: null, page: null, percentage: null },
      rating: null,
      notes: null,
      confidence: "low",
    };
  }
}
