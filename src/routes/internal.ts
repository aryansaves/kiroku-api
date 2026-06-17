import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { User } from "../models/user";
import { Log } from "../models/log";
import { env } from "../config";

const internalLogSchema = z.object({
  telegramId: z.string(),
  mediaType: z.enum(["anime", "movie", "series", "book", "manga", "comic"]),
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
  forceNew: z.boolean().optional(),
});

export default async function internalRoutes(fastify: FastifyInstance) {
  fastify.post("/logs", async (request, reply) => {
    const botSecretHeader = request.headers["x-bot-secret"];
    if (!botSecretHeader || botSecretHeader !== env.BOT_INTERNAL_SECRET) {
      return reply.status(401).send({ error: "Unauthorized" });
    }

    const parseResult = internalLogSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({ error: "Bad Request", details: parseResult.error.format() });
    }

    const logData = parseResult.data;

    const rateLimitKey = `ratelimit:${logData.telegramId}:logs`;
    const currentRequestCount = await fastify.redis.incr(rateLimitKey);
    if (currentRequestCount === 1) await fastify.redis.expire(rateLimitKey, 60);
    if (currentRequestCount > 10) return reply.status(429).send({ error: "Too Many Requests" });

    try {
      const user = await User.findOne({ telegramId: logData.telegramId });
      if (!user) return reply.status(444).send({ error: "User profile not found." });

      if (!logData.forceNew) {
        const existingLog = await Log.findOne({
          userId: user._id,
          title: logData.title
        });

        if (existingLog) {
          if (logData.rating !== null) existingLog.rating = logData.rating;
          if (logData.notes !== null) existingLog.notes = logData.notes;

          if (logData.progress.episode || logData.progress.chapter || logData.progress.page) {
            existingLog.progress = logData.progress;
          }

          await existingLog.save();

          return reply.status(200).send({
            success: true,
            logId: existingLog._id,
            message: `Updated existing log entry for ${logData.title} successfully.`,
          });
        }
      }

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