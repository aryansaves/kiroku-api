import type { FastifyInstance } from "fastify";
import { User } from "../models/user";

export default async function userRoutes(fastify: FastifyInstance) {
  fastify.get("/:username", async (request, reply) => {
    const { username } = request.params as { username: string };
    const cacheKey = `cache:profile:${username.toLowerCase()}`;
    
    try {
      const cachedProfile = await fastify.redis.get(cacheKey);
      if (cachedProfile) {
        return reply.status(200).type("application/json").send(cachedProfile);
      }
       
      const user = await User.findOne({ username: username.toLowerCase() })
        .select("-platforms.mal.accessToken -platforms.mal.refreshToken");

      if (!user) {
        return reply.status(404).send({
          error: "Not Found",
          message: `User profile '/u/${username}' does not exist.`,
        });
      }
      await fastify.redis.set(cacheKey, JSON.stringify(user), "EX", 3600);
      return reply.status(200).send(user);
    } catch (error) {
      fastify.log.error({ err: error }, "Failed to fetch user profile metadata");
      return reply.status(500).send({ error: "Internal Server Error" });
    }
  });
}