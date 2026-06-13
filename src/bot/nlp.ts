import { GoogleGenAI, Type } from "@google/genai";
import { env } from "../config";

// Initialize the Gemini client using the environment key
const ai = new GoogleGenAI({ apiKey: env.LLM_API_KEY });

export interface LogPayload {
  mediaType: "anime" | "movie" | "book" | "manga" | "game" | "music" | "podcast";
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

const systemInstruction = `
You are an expert media journal logging assistant. Your job is to extract structured logging data from human messages.
Analyze the user input text and map it to the requested JSON schema.

Rules:
1. Deduce the mediaType correctly based on context (e.g., "read" -> book/manga, "watched/finished" -> anime/movie, "played" -> game).
2. If the user mentions a volume or chapter, it's 'manga' or 'book'. If episodes, it's 'anime'.
3. Map status exactly to: watching, completed, dropped, planned, rewatching.
4. Ratings must be scaled out of 10. If a user writes "4/5", normalize it to 8.
5. If you cannot determine the title or the context is highly ambiguous, set confidence to "low" and title to null.
`;

export async function parseUserMessage(messageText: string): Promise<LogPayload> {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3.1-flash-lite",
      contents: messageText,
      config: {
        systemInstruction,
        // Enforce strict JSON output matching our exact TypeScript shape
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            mediaType: {
              type: Type.STRING,
              enum: ["anime", "movie", "book", "manga", "game", "music", "podcast"],
            },
            title: { type: Type.STRING, nullable: true },
            action: { type: Type.STRING, enum: ["log", "update", "query"] },
            status: {
              type: Type.STRING,
              enum: ["watching", "completed", "dropped", "planned", "rewatching"],
            },
            progress: {
              type: Type.OBJECT,
              properties: {
                episode: { type: Type.INTEGER, nullable: true },
                chapter: { type: Type.INTEGER, nullable: true },
                page: { type: Type.INTEGER, nullable: true },
                percentage: { type: Type.INTEGER, nullable: true },
              },
              required: ["episode", "chapter", "page", "percentage"],
            },
            rating: { type: Type.INTEGER, nullable: true },
            notes: { type: Type.STRING, nullable: true },
            confidence: { type: Type.STRING, enum: ["high", "low"] },
          },
          required: [
            "mediaType",
            "title",
            "action",
            "status",
            "progress",
            "rating",
            "notes",
            "confidence",
          ],
        },
      },
    });

    const responseText = response.text;
    if (!responseText) {
      throw new Error("Empty response received from Gemini API");
    }

    return JSON.parse(responseText) as LogPayload;
  } catch (error) {
    console.error("NLP Pipeline Extraction Error:", error);
    // Fallback safe payload structure if the API crashes or fails to compile
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