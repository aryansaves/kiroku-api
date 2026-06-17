import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { User } from "../models/user";
import { GuestbookEntry } from "../models/guestbook-entry";

const createEntrySchema = z.object({
  visitorName: z.string().trim().min(1).max(48),
  message: z.string().trim().min(1).max(280),
});

const querySchema = z.object({
  limit: z.coerce.number().min(1).max(20).default(8),
});

export default async function guestbookRoutes(fastify: FastifyInstance) {
  fastify.get("/:username/guestbook", async (request, reply) => {
    const { username } = request.params as { username: string };
    const parsedQuery = querySchema.safeParse(request.query);
    if (!parsedQuery.success) {
      return reply.status(400).send({
        error: "Bad Request",
        message: "Invalid query parameters provided.",
        details: parsedQuery.error.format(),
      });
    }

    const cacheKey = `cache:guestbook:${username.toLowerCase()}:${parsedQuery.data.limit}`;

    try {
      const cachedEntries = await fastify.redis.get(cacheKey);
      if (cachedEntries) {
        return reply.status(200).type("application/json").send(cachedEntries);
      }

      const user = await User.findOne({ username: username.toLowerCase() });
      if (!user) {
        return reply.status(404).send({
          error: "Not Found",
          message: `User profile '/u/${username}' does not exist.`,
        });
      }

      const entries = await GuestbookEntry.find({ userId: user._id })
        .sort({ createdAt: -1 })
        .limit(parsedQuery.data.limit)
        .lean();

      await fastify.redis.set(cacheKey, JSON.stringify({ entries }), "EX", 120);
      return reply.status(200).send({ entries });
    } catch (error) {
      fastify.log.error({ err: error }, "Failed to fetch guestbook entries");
      return reply.status(500).send({ error: "Internal Server Error" });
    }
  });

  fastify.post("/:username/guestbook", async (request, reply) => {
    const { username } = request.params as { username: string };
    const parsedBody = createEntrySchema.safeParse(request.body);
    if (!parsedBody.success) {
      return reply.status(400).send({
        error: "Bad Request",
        message: "Invalid guestbook entry.",
        details: parsedBody.error.format(),
      });
    }

    try {
      const user = await User.findOne({ username: username.toLowerCase() });
      if (!user) {
        return reply.status(404).send({
          error: "Not Found",
          message: `User profile '/u/${username}' does not exist.`,
        });
      }

      if (!user.theme.guestbookEnabled) {
        return reply.status(403).send({
          error: "Forbidden",
          message: "Guestbook is disabled for this profile.",
        });
      }

      const entry = await GuestbookEntry.create({
        userId: user._id,
        visitorName: parsedBody.data.visitorName,
        message: parsedBody.data.message,
      });

      const keys = await fastify.redis.keys(`cache:guestbook:${username.toLowerCase()}:*`);
      if (keys.length) await fastify.redis.del(...keys);

      return reply.status(201).send(entry);
    } catch (error) {
      fastify.log.error({ err: error }, "Failed to create guestbook entry");
      return reply.status(500).send({ error: "Internal Server Error" });
    }
  });
}
