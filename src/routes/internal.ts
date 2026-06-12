import { FastifyInstance } from "fastify";
import { z } from "zod";
import { User } from "../models/User";
import { Log } from "../models/Log";
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
  // POST /internal/logs
  fastify.post("/logs", async (request, reply) => {
    // 1. Authenticate using the static master bot secret header
    const botSecretHeader = request.headers["x-bot-secret"];
    if (!botSecretHeader || botSecretHeader !== env.BOT_INTERNAL_SECRET) {
      return reply.status(401).send({ error: "Unauthorized", message: "Invalid or missing bot secret header." });
    }

    // 2. Validate incoming structured log structure payload
    const parseResult = internalLogSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({ error: "Bad Request", details: parseResult.error.format() });
    }

    const logData = parseResult.data;
    const rateLimitKey = `ratelimit:${logData.telegramId}:logs`;

    try {
      // 3. Redis Sliding Window Rate Limiter (Max 10 logs per 60 seconds)
      const currentRequestCount = await fastify.redis.incr(rateLimitKey);
      
      if (currentRequestCount === 1) {
        // Set a 60-second time-to-live expiration windows on the first increment hit
        await fastify.redis.expire(rateLimitKey, 60);
      }

      if (currentRequestCount > 10) {
        return reply.status(429).send({
          error: "Too Many Requests",
          message: "Rate limit exceeded. Maximum 10 log actions per minute allowed.",
        });
      }

      // 4. Resolve the Telegram User ID to an internal Mongoose MongoDB ObjectId
      const user = await User.findOne({ telegramId: logData.telegramId });
      if (!user) {
        return reply.status(444).send({ error: "Not Found", message: "Telegram account not initialized inside database." });
      }

      // 5. Commit the polymorphic log document straight to collection storage
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

      // 6. Return response to indicate successful log persistence
      return reply.status(201).send({
        success: true,
        logId: newLog._id,
        message: `Logged entry for ${logData.title} completely.`,
      });
    } catch (error) {
      fastify.log.error({ err: error }, "Internal logging pipeline encounter failure");
      return reply.status(500).send({ error: "Internal Server Error" });
    }
  });
}