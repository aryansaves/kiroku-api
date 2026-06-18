import type { FastifyInstance, FastifyPluginOptions } from "fastify";
import { z } from "zod";
import { parseUserMessage } from "../bot/nlp";
import { searchMetadataPool } from "../lib/metadata";
import { User } from "../models/user";
import { Log } from "../models/log";
import { authenticate } from "../middleware/authenticate";

const parseSchema = z.object({
  message: z.string().min(1).max(500),
});

const searchSchema = z.object({
  title: z.string().min(1).max(200),
  mediaType: z.enum(["anime", "movie", "series", "book", "manga", "comic"]),
});

const logSchema = z.object({
  mediaType: z.enum(["anime", "movie", "series", "book", "manga", "comic"]),
  status: z.enum(["watching", "completed", "dropped", "planned", "rewatching"]),
  title: z.string().min(1).max(300),
  coverImage: z.string().nullable(),
  rating: z.number().min(0).max(10).nullable(),
  notes: z.string().max(2000).nullable(),
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

export default async function chatRoutes(
  fastify: FastifyInstance,
  _options: FastifyPluginOptions
) {
  fastify.post("/parse", { preHandler: [authenticate] }, async (request, reply) => {
    const parsed = parseSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", details: parsed.error.format() });
    }

    try {
      const result = await parseUserMessage(parsed.data.message);
      return reply.status(200).send(result);
    } catch (error) {
      fastify.log.error({ err: error }, "NLP parse error");
      return reply.status(500).send({ error: "Failed to parse message" });
    }
  });

  fastify.post("/search", { preHandler: [authenticate] }, async (request, reply) => {
    const parsed = searchSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", details: parsed.error.format() });
    }

    try {
      const results = await searchMetadataPool(
        fastify,
        parsed.data.title,
        parsed.data.mediaType
      );
      return reply.status(200).send({ results });
    } catch (error) {
      fastify.log.error({ err: error }, "Metadata search error");
      return reply.status(500).send({ error: "Failed to search metadata" });
    }
  });

  fastify.post("/log", { preHandler: [authenticate] }, async (request, reply) => {
    const parsed = logSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", details: parsed.error.format() });
    }

    const logData = parsed.data;
    const userId = request.userId;

    try {
      const user = await User.findById(userId);
      if (!user) {
        return reply.status(404).send({ error: "User not found" });
      }

      // Rate limit — gracefully degrades if Redis is unavailable
      try {
        const rateLimitKey = `ratelimit:user:${userId}:chatlogs`;
        const currentCount = await fastify.redis.incr(rateLimitKey);
        if (currentCount === 1) await fastify.redis.expire(rateLimitKey, 60);
        if (currentCount > 10) {
          return reply.status(429).send({ error: "Too many requests. Please wait a moment." });
        }
      } catch (redisErr) {
        fastify.log.warn({ err: redisErr }, "Redis rate-limit unavailable — skipping");
      }

      if (!logData.forceNew) {
        const existingLog = await Log.findOne({
          userId: user._id,
          title: logData.title,
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
            updated: true,
            title: logData.title,
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
        updated: false,
        title: logData.title,
      });
    } catch (error) {
      fastify.log.error({ err: error }, "Chat log creation error");
      return reply.status(500).send({ error: "Internal Server Error" });
    }
  });
}
