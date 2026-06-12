import type { FastifyInstance, FastifyPluginOptions } from "fastify";
import { z } from "zod";
import crypto from "crypto";
import { User } from "../models/user";
import { env } from "../config";

const telegramAuthSchema = z.object({
  id: z.number(),
  first_name: z.string(),
  username: z.string().optional(),
  auth_date: z.number(),
  hash: z.string(),
});

const refreshSchema = z.object({
  refreshToken: z.string(),
});

export default async function authRoutes(
  fastify: FastifyInstance,
  options: FastifyPluginOptions
) {
  
  // POST /auth/telegram
  fastify.post("/telegram", async (request, reply) => {
    const parseResult = telegramAuthSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: "Bad Request",
        message: "Validation failed",
        details: parseResult.error.format(),
      });
    }

    const data = parseResult.data;

    // 1. Enforce 24-hour validity constraint check
    const explicitTimeoutThreshold = 24 * 60 * 60;
    const nowUnixTimestamp = Math.floor(Date.now() / 1000);
    if (nowUnixTimestamp - data.auth_date > explicitTimeoutThreshold) {
      return reply.status(401).send({
        error: "Unauthorized",
        message: "Authentication data has expired.",
      });
    }

    // 2. Compute Telegram HMAC-SHA256 data-check-string signature
    const { hash, ...checkData } = data;
    const dataCheckString = Object.keys(checkData)
      .sort()
      .map((key) => `${key}=${(checkData as any)[key]}`)
      .join("\n");

    const secretKey = crypto
      .createHash("sha256")
      .update(env.TELEGRAM_BOT_TOKEN)
      .digest();

    const calculatedHash = crypto
      .createHmac("sha256", secretKey)
      .update(dataCheckString)
      .digest("hex");

    if (calculatedHash !== hash) {
      return reply.status(401).send({
        error: "Unauthorized",
        message: "Hash signature validation verification failed.",
      });
    }

    try {
      // 3. Locate profile by unique telegramId
      const user = await User.findOne({ telegramId: data.id.toString() });
      if (!user) {
        return reply.status(404).send({
          error: "Not Found",
          message: "Account not initialized. Use the Telegram bot /start command first.",
        });
      }

      // 4. Generate JWT sessions tokens
      const accessToken = fastify.jwt.sign(
        { userId: user._id },
        { expiresIn: "15m" }
      );

      const refreshToken = fastify.jwt.sign(
        { userId: user._id },
        { expiresIn: "30d" }
      );

      // TODO: Save refresh token reference into Upstash Redis later in Phase 4
      await fastify.redis.set(`refresh:${user._id}`,refreshToken, "EX", 2592000)
      return reply.status(200).send({
        accessToken,
        refreshToken,
        user: {
          id: user._id,
          username: user.username,
          displayName: user.displayName,
        },
      });
    } catch (error) {
      fastify.log.error({ err: error }, "Telegram login error trace execution aborted");
      return reply.status(500).send({ error: "Internal Server Error" });
    }
  });

  // POST /auth/refresh
  fastify.post("/refresh", async (request, reply) => {
    const parseResult = refreshSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({ error: "Invalid refresh payload structural constraint" });
    }

    const { refreshToken } = parseResult.data;

    try {
      const decoded = fastify.jwt.verify<{ userId: string }>(refreshToken);
      
      // TODO: Match string signature against Upstash Redis lookup storage value here in Phase 4
      const storedToken = await fastify.redis.get(`refresh:${decoded.userId}`);
      if (!storedToken || storedToken !== refreshToken) {
        return reply.status(401).send({ error: "Session revoked or compromised" });
      }

      const newAccessToken = fastify.jwt.sign(
        { userId: decoded.userId },
        { expiresIn: "15m" }
      );

      return reply.status(200).send({ accessToken: newAccessToken });
    } catch (error) {
      return reply.status(401).send({
        error: "Unauthorized",
        message: "Expired or invalid refresh token verification payload.",
      });
    }
  });

  // POST /auth/logout
  fastify.post("/logout", async (request, reply) => {
    // Session termination endpoint placeholder
    // TODO: Purge refresh token records from Redis cache matrix in Phase 4
    const { refreshToken } = request.body as { refreshToken: string };
    if (!refreshToken) return reply.status(400).send({ error: "Missing identity context" });

    try {
      const decoded = fastify.jwt.verify<{ userId: string }>(refreshToken);
      
      // Purge session key from Redis storage
      await fastify.redis.del(`refresh:${decoded.userId}`);
      return reply.status(200).send({ success: true, message: "Logged out clean." });
    } catch {
          return reply.status(200).send({ success: true, message: "Session already expired." });
        }
  });
}