import fp from "fastify-plugin";
import { Redis } from "ioredis";
import { env } from "../config";

export default fp(async (fastify) => {
  const redis = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    commandTimeout: 5000,
    enableReadyCheck: true,
  });

  redis.on("connect", () => {
    fastify.log.info("💾 Redis datastore client connected cleanly");
  });

  redis.on("error", (err) => {
    fastify.log.error({ err }, "Redis datastore connection encountered a critical failure");
  });

  fastify.decorate("redis", redis);

  fastify.addHook("onClose", async (instance) => {
    await instance.redis.quit();
  });
});

declare module "fastify" {
  interface FastifyInstance {
    redis: Redis;
  }
}