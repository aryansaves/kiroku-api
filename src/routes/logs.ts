import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { User } from "../models/user";
import { Log } from "../models/log";

const logsQuerySchema = z.object({
  type: z.enum(["anime", "movie", "book", "manga", "game", "music", "podcast"]).optional(),
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
});

export default async function logRoutes(fastify: FastifyInstance) {
  // GET /users/:username/logs
  fastify.get("/:username/logs", async (request, reply) => {
    const { username } = request.params as { username: string };

    // Validate incoming query parameters safely
    const parsedQuery = logsQuerySchema.safeParse(request.query);
    if (!parsedQuery.success) {
      return reply.status(400).send({
        error: "Bad Request",
        message: "Invalid query parameters provided.",
        details: parsedQuery.error.format(),
      });
    }

    const { type, page, limit } = parsedQuery.data;

    try {
      // 1. Resolve username to find the parent owner's unique database ID
      const user = await User.findOne({ username: username.toLowerCase() });
      if (!user) {
        return reply.status(404).send({
          error: "Not Found",
          message: `Cannot retrieve logs; profile '/u/${username}' does not exist.`,
        });
      }

      // 2. Build the query payload matching filters
      const queryFilter: Record<string, unknown> = { userId: user._id };
      if (type) {
        queryFilter.mediaType = type;
      }

      // 3. Execute query with skip/limit pagination mechanics using our compound index structure
      const skipAmount = (page - 1) * limit;

      const [logs, totalCount] = await Promise.all([
        Log.find(queryFilter)
          .sort({ createdAt: -1 }) // Show latest entries first
          .skip(skipAmount)
          .limit(limit)
          .lean(), // Bypasses heavy Mongoose internal hydration tracking for pure read speed optimization
        Log.countDocuments(queryFilter),
      ]);

      return reply.status(200).send({
        logs,
        pagination: {
          total: totalCount,
          page,
          limit,
          totalPages: Math.ceil(totalCount / limit),
        },
      });
    } catch (error) {
      fastify.log.error({ err: error }, "Failed to fetch user activity timeline stream");
      return reply.status(500).send({ error: "Internal Server Error" });
    }
  });
}