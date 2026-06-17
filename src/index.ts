import Fastify from "fastify";
import cors from "@fastify/cors";
import { env } from "./config";
import mongodbPlugin from "./plugins/mongodb";
import authRoutes from "./routes/auth";
import userRoutes from "./routes/users";
import logRoutes from "./routes/logs";
import redisPlugin from "./plugins/redis";
import internalRoutes from "./routes/internal";
import profileRoutes from "./routes/profile";
import guestbookRoutes from "./routes/guestbook";
import chatRoutes from "./routes/chat";
import { initializeBot } from "./bot";

const fastify = Fastify({
  logger: env.NODE_ENV === "development" ? {
    transport: {
      target: "pino-pretty",
      options: { translateTime: "HH:MM:ss Z", ignore: "pid,hostname" }
    }
  } : true
});

async function bootServer() {
  try {
    await fastify.register(cors, {
      origin: env.CORS_ORIGIN.split(",").map((origin) => origin.trim()),
      credentials: false,
    });

    await fastify.register(mongodbPlugin);
    await fastify.register(redisPlugin);

    await fastify.register(import("@fastify/jwt"), {
      secret: env.JWT_SECRET,
    });

    await fastify.register(authRoutes, { prefix: "/auth" });
    await fastify.register(profileRoutes, { prefix: "/users" });
    await fastify.register(guestbookRoutes, { prefix: "/users" });
    await fastify.register(userRoutes, { prefix: "/users" });
    await fastify.register(logRoutes, { prefix: "/users" });
    await fastify.register(internalRoutes, { prefix: "/internal" });
    await fastify.register(chatRoutes, { prefix: "/chat" });
    
    await fastify.listen({ 
      port: env.PORT, 
      host: "0.0.0.0" 
    });

    (fastify as any).log.info(`🚀 Kiroku API Server up and active on port: ${env.PORT}`);
    if (env.ENABLE_BOT) {
      const bot = initializeBot(fastify);

      bot.start({
        onStart: (info) => {
          fastify.log.info(`🤖 Grammy Bot worker listening actively under handle: @${info.username}`);
        }
      });
    } else {
      fastify.log.info("Telegram bot worker disabled. Set ENABLE_BOT=true to start it.");
    }
  } catch (error) {
    (fastify as any).log.error({ err: error }, "Critical application crash during boot sequencing");
    process.exit(1);
  }
}

bootServer();
