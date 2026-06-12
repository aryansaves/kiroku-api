import Fastify from "fastify";
import { env } from "./config";
import mongodbPlugin from "./plugins/mongodb";
import authRoutes from "./routes/auth";
import userRoutes from "./routes/users";
import logRoutes from "./routes/logs";
import redisPlugin from "./plugins/redis"

// 1. Initialize the core Fastify engine instance
const fastify = Fastify({
  logger: env.NODE_ENV === "development" ? {
    transport: {
      target: "pino-pretty",
      options: { translateTime: "HH:MM:ss Z", ignore: "pid,hostname" }
    }
  } : true // Raw JSON performance logging when running in production
});

async function bootServer() {
  try {
    // 2. Register the global database connection plugin first
    // Fastify waits for this to connect before processing downstream routes
    await fastify.register(mongodbPlugin);
    await fastify.register(redisPlugin);

    // 3. Register Ecosystem Tools (e.g., JWT Engine Setup)
    await fastify.register(import("@fastify/jwt"), {
      secret: env.JWT_SECRET,
    });

    // 4. Mount Route Modules with Explicit URI Prefixes
    await fastify.register(authRoutes, { prefix: "/auth" });
    await fastify.register(userRoutes, { prefix: "/users" }); // Mounts GET /users/:username
    await fastify.register(logRoutes, { prefix: "/users" });  // Mounts GET /users/:username/logs

    // 5. Start the Network Network Listener Loop
    // Fly.io demands 0.0.0.0 as the host string to bind correctly inside Docker containers
    await fastify.listen({ 
      port: env.PORT, 
      host: "0.0.0.0" 
    });

    // Typecast log statement safely
    (fastify as any).log.info(`🚀 Kiroku API Server up and active on port: ${env.PORT}`);
  } catch (error) {
    (fastify as any).log.error({ err: error }, "Critical application crash during boot sequencing");
    process.exit(1);
  }
}

// Fire execution
bootServer();