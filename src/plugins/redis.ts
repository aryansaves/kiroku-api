import fp from "fastify-plugin";
import { Redis } from "ioredis";
import { env } from "../config";

export default fp(async (fastify) => {
  // Initialize connection to local instance or production Upstash string
  const redis = new Redis(env.REDIS_URL);

  redis.on("connect", () => {
    fastify.log.info("💾 Redis datastore client connected cleanly");
  });

  redis.on("error", (err) => {
    fastify.log.error({ err }, "Redis datastore connection encountered a critical failure");
  });

  // Decorate the framework instance so we can access it via fastify.redis
  fastify.decorate("redis", redis);

  // Clean disconnect hook on application teardown
  fastify.addHook("onClose", async (instance) => {
    await instance.redis.quit();
  });
});

declare module "fastify" {
  interface FastifyInstance {
    redis: Redis;
  }
}