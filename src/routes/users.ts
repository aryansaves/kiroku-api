import type { FastifyInstance } from "fastify";
import { User } from "../models/user";

export default async function userRoutes(fastify: FastifyInstance) {
  // GET /users/:username
  fastify.get("/:username", async (request, reply) => {
    const { username } = request.params as { username: string };

    try {
      // Find user matching lowercase URL parameter criteria
      const user = await User.findOne({ username: username.toLowerCase() })
        .select("-platforms.mal.accessToken -platforms.mal.refreshToken"); // Keep platform tokens strictly hidden

      if (!user) {
        return reply.status(404).send({
          error: "Not Found",
          message: `User profile '/u/${username}' does not exist.`,
        });
      }

      return reply.status(200).send(user);
    } catch (error) {
      fastify.log.error({ err: error }, "Failed to fetch user profile metadata");
      return reply.status(500).send({ error: "Internal Server Error" });
    }
  });
}