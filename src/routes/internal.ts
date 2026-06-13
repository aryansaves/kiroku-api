import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { User } from "../models/user";
import { Log } from "../models/log";
import { env } from "../config";

const internalLogSchema = z.object({
  telegramId: z.string(),
  mediaType: z.enum(["anime", "movie", "book", "manga", "game", "music", "podcast"]),
  status: z.enum(["watching", "completed", "dropped", "planned", "rewatching"]),
  title: z.string(),
  coverImage: z.string().nullable(),
  rating: z.number().min(0).max(10).nullable(),
  notes: z.string().nullable(),
  progress: z.object({
    episode: z.number().nullable(),
    chapter: z.number().nullable(),
    page: z.number().nullable(),
    percentage: z.number().nullable(),
  }),
  externalIds: z.object({
    anilistId: z.number().nullable(),
    malId: z.number().nullable(),
    tmdbId: z.number().nullable(),
  }),
});

export default async function internalRoutes(fastify: FastifyInstance) {
  fastify.post("/logs", async (request, reply) => {
    // 1. Authenticate via your master header secret
    const botSecretHeader = request.headers["x-bot-secret"];
    if (!botSecretHeader || botSecretHeader !== env.BOT_INTERNAL_SECRET) {
      return reply.status(401).send({ error: "Unauthorized" });
    }

    // 2. Parse incoming payload variables
    const parseResult = internalLogSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({ error: "Bad Request", details: parseResult.error.format() });
    }

    const logData = parseResult.data;

    // 3. Rate limiting check
    const rateLimitKey = `ratelimit:${logData.telegramId}:logs`;
    const currentRequestCount = await fastify.redis.incr(rateLimitKey);
    if (currentRequestCount === 1) await fastify.redis.expire(rateLimitKey, 60);
    if (currentRequestCount > 10) return reply.status(429).send({ error: "Too Many Requests" });

    try {
      // 4. Resolve the user from database
      const user = await User.findOne({ telegramId: logData.telegramId });
      if (!user) return reply.status(444).send({ error: "User profile not found." });

      // ==========================================
      // CRITICAL UPDATE LOGIC ENTERS HERE
      // ==========================================
      
      // Look up if this user has already logged this specific canonical title before
      const existingLog = await Log.findOne({ 
        userId: user._id, 
        title: logData.title 
      });

      if (existingLog) {
        // If an entry exists, mutate the fields in place instead of creating a duplicate document
        if (logData.rating !== null) existingLog.rating = logData.rating;
        if (logData.notes !== null) existingLog.notes = logData.notes;
        
        // Only update progress parameters if the update provides explicit progress increments
        if (logData.progress.episode || logData.progress.chapter || logData.progress.page) {
          existingLog.progress = logData.progress;
        }

        // Save our changes back down to the existing document slot in Atlas
        await existingLog.save();

        return reply.status(200).send({
          success: true,
          logId: existingLog._id,
          message: `Updated existing log entry for ${logData.title} successfully.`,
        });
      }

      // ==========================================
      // FALLBACK: NO EXISTING ENTRY FOUND (CREATE NEW)
      // ==========================================
      const newLog = await Log.create({
        userId: user._id,
        mediaType: logData.mediaType,
        status: logData.status,
        title: logData.title,
        coverImage: logData.coverImage,
        rating: logData.rating,
        notes: logData.notes,
        progress: logData.progress,
        externalIds: logData.externalIds,
      });

      return reply.status(201).send({
        success: true,
        logId: newLog._id,
        message: `Created brand new log entry for ${logData.title}.`,
      });

    } catch (error) {
      fastify.log.error({ err: error }, "Logging engine encountered an internal execution failure.");
      return reply.status(500).send({ error: "Internal Server Error" });
    }
  });
}