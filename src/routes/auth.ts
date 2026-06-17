import type { FastifyInstance, FastifyPluginOptions } from "fastify";
import { z } from "zod";
import crypto from "crypto";
import { User } from "../models/user";
import { env } from "../config";

const telegramAuthSchema = z.object({
  id: z.coerce.number(),
  first_name: z.string(),
  username: z.string().optional(),
  auth_date: z.coerce.number(),
  hash: z.string(),
});

const refreshSchema = z.object({
  refreshToken: z.string(),
});

const devAuthSchema = z.object({
  username: z.string().trim().min(1),
});

const registerSchema = z.object({
  username: z
    .string()
    .trim()
    .min(2)
    .max(32)
    .regex(/^[a-z0-9-]+$/, "Username may only contain lowercase letters, numbers, and hyphens"),
  displayName: z.string().trim().min(1).max(80),
  avatarUrl: z.string().url().nullable().optional(),
  // A short-lived token issued after Google callback, exchanged here for a full session
  googlePendingToken: z.string(),
});

async function issueSession(fastify: FastifyInstance, user: any) {
  const accessToken = fastify.jwt.sign(
    { userId: user._id },
    { expiresIn: "15m" }
  );

  const refreshToken = fastify.jwt.sign(
    { userId: user._id },
    { expiresIn: "30d" }
  );

  await fastify.redis.set(`refresh:${user._id}`, refreshToken, "EX", 2592000);

  return {
    accessToken,
    refreshToken,
    user: {
      id: user._id,
      username: user.username,
      displayName: user.displayName,
    },
  };
}

/** Exchange a Google authorization code for an id_token + profile */
async function exchangeGoogleCode(code: string, redirectUri: string) {
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });

  if (!tokenRes.ok) {
    const text = await tokenRes.text().catch(() => "");
    throw new Error(`Google token exchange failed: ${tokenRes.status} ${text}`);
  }

  const tokens = (await tokenRes.json()) as {
    access_token: string;
    id_token: string;
  };

  // Fetch user profile using the access token
  const profileRes = await fetch(
    "https://www.googleapis.com/oauth2/v2/userinfo",
    {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    }
  );

  if (!profileRes.ok) {
    throw new Error(`Google userinfo fetch failed: ${profileRes.status}`);
  }

  const profile = (await profileRes.json()) as {
    id: string;
    email: string;
    name: string;
    picture: string | null;
  };

  return { tokens, profile };
}

/** Derive a Kiroku username suggestion from a Google email address */
function deriveUsername(email: string): string {
  const local = email.split("@")[0] ?? "user";
  // Strip non-alphanumeric/hyphen chars, collapse runs, lowercase, trim hyphens
  return local
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 32) || "user";
}

export default async function authRoutes(
  fastify: FastifyInstance,
  options: FastifyPluginOptions
) {
  const googleEnabled =
    !!env.GOOGLE_CLIENT_ID && !!env.GOOGLE_CLIENT_SECRET;

  function getApiRedirectUri(request: any) {
    const protocol = request.headers['x-forwarded-proto'] || request.protocol || 'http';
    const host = request.headers['x-forwarded-host'] || request.hostname;
    return `${protocol}://${host}/auth/google/callback`;
  }

  // ──────────────────────────────────────────────
  // TELEGRAM
  // ──────────────────────────────────────────────
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

    const explicitTimeoutThreshold = 24 * 60 * 60;
    const nowUnixTimestamp = Math.floor(Date.now() / 1000);
    if (nowUnixTimestamp - data.auth_date > explicitTimeoutThreshold) {
      return reply.status(401).send({
        error: "Unauthorized",
        message: "Authentication data has expired.",
      });
    }

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
      const user = await User.findOne({ telegramId: data.id.toString() });
      if (!user) {
        return reply.status(404).send({
          error: "Not Found",
          message: "Account not initialized. Use the Telegram bot /start command first.",
        });
      }

      return reply.status(200).send(await issueSession(fastify, user));
    } catch (error) {
      fastify.log.error({ err: error }, "Telegram login error trace execution aborted");
      return reply.status(500).send({ error: "Internal Server Error" });
    }
  });

  // ──────────────────────────────────────────────
  // GOOGLE — initiate OAuth flow
  // ──────────────────────────────────────────────
  fastify.get("/google", async (request, reply) => {
    if (!googleEnabled) {
      return reply.status(503).send({ error: "Google OAuth is not configured on this server." });
    }

    const params = new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      redirect_uri: getApiRedirectUri(request),
      response_type: "code",
      scope: "openid email profile",
      access_type: "offline",
      prompt: "select_account",
    });

    return reply.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
  });

  // ──────────────────────────────────────────────
  // GOOGLE — OAuth callback
  // ──────────────────────────────────────────────
  fastify.get("/google/callback", async (request, reply) => {
    if (!googleEnabled) {
      return reply.redirect(`${env.APP_URL}/login?error=google_not_configured`);
    }

    const { code, error: oauthError } = request.query as {
      code?: string;
      error?: string;
    };

    if (oauthError || !code) {
      return reply.redirect(`${env.APP_URL}/login?error=oauth_denied`);
    }

    try {
      const { profile } = await exchangeGoogleCode(code, getApiRedirectUri(request));

      // ── Returning user ──
      const existingUser = await User.findOne({ googleId: profile.id });
      if (existingUser) {
        const session = await issueSession(fastify, existingUser);
        const params = new URLSearchParams({
          access: session.accessToken,
          refresh: session.refreshToken,
          username: session.user.username,
          displayName: session.user.displayName,
          id: String(session.user.id),
        });
        return reply.redirect(`${env.APP_URL}/auth/callback?${params.toString()}`);
      }

      // ── New user — issue a short-lived "pending" token carrying their Google data ──
      // This lets the frontend show the username-picker without storing anything yet.
      const pendingToken = fastify.jwt.sign(
        {
          type: "google_pending",
          googleId: profile.id,
          email: profile.email,
          name: profile.name,
          picture: profile.picture ?? null,
          suggestedUsername: deriveUsername(profile.email),
        },
        { expiresIn: "10m" }
      );

      const params = new URLSearchParams({
        pending: pendingToken,
        suggested: deriveUsername(profile.email),
        name: profile.name,
        avatar: profile.picture ?? "",
      });
      return reply.redirect(`${env.APP_URL}/onboarding?${params.toString()}`);
    } catch (error) {
      fastify.log.error({ err: error }, "Google OAuth callback error");
      return reply.redirect(`${env.APP_URL}/login?error=oauth_failed`);
    }
  });

  // ──────────────────────────────────────────────
  // REGISTER — complete Google onboarding
  // ──────────────────────────────────────────────
  fastify.post("/register", async (request, reply) => {
    const parsed = registerSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "Bad Request",
        message: "Invalid registration payload.",
        details: parsed.error.format(),
      });
    }

    const { username, displayName, avatarUrl, googlePendingToken } = parsed.data;

    // Verify the pending token
    let pendingPayload: {
      type: string;
      googleId: string;
      email: string;
      name: string;
      picture: string | null;
    };
    try {
      pendingPayload = fastify.jwt.verify<typeof pendingPayload>(googlePendingToken);
    } catch {
      return reply.status(401).send({
        error: "Unauthorized",
        message: "Pending token is invalid or has expired. Please sign in with Google again.",
      });
    }

    if (pendingPayload.type !== "google_pending") {
      return reply.status(401).send({ error: "Unauthorized", message: "Invalid token type." });
    }

    // Check username availability
    const existingUsername = await User.findOne({ username: username.toLowerCase() });
    if (existingUsername) {
      return reply.status(409).send({
        error: "Conflict",
        message: "That username is already taken. Please choose another.",
      });
    }

    // Make sure this Google account isn't already registered
    const existingGoogle = await User.findOne({ googleId: pendingPayload.googleId });
    if (existingGoogle) {
      // Race condition / double-submit — just issue a session
      return reply.status(200).send(await issueSession(fastify, existingGoogle));
    }

    try {
      const newUser = await User.create({
        googleId: pendingPayload.googleId,
        authProviders: ["google"],
        username: username.toLowerCase(),
        displayName,
        avatarUrl: avatarUrl ?? pendingPayload.picture ?? null,
      });

      return reply.status(201).send(await issueSession(fastify, newUser));
    } catch (error: any) {
      if (error?.code === 11000) {
        return reply.status(409).send({
          error: "Conflict",
          message: "Username taken. Please choose another.",
        });
      }
      fastify.log.error({ err: error }, "User registration error");
      return reply.status(500).send({ error: "Internal Server Error" });
    }
  });

  // ──────────────────────────────────────────────
  // CHECK USERNAME — real-time availability
  // ──────────────────────────────────────────────
  fastify.get("/check-username", async (request, reply) => {
    const { username } = request.query as { username?: string };
    if (!username || username.length < 2) {
      return reply.status(400).send({ available: false });
    }
    const exists = await User.exists({ username: username.toLowerCase() });
    return reply.status(200).send({ available: !exists });
  });

  // ──────────────────────────────────────────────
  // DEV AUTH (development only)
  // ──────────────────────────────────────────────
  fastify.post("/dev", async (request, reply) => {
    if (env.NODE_ENV === "production" || !env.ENABLE_DEV_AUTH) {
      return reply.status(404).send({ error: "Not Found" });
    }

    const parseResult = devAuthSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: "Bad Request",
        message: "Invalid dev login payload.",
        details: parseResult.error.format(),
      });
    }

    const user = await User.findOne({
      username: parseResult.data.username.toLowerCase(),
    });

    if (!user) {
      return reply.status(404).send({
        error: "Not Found",
        message: "No local user exists with that username.",
      });
    }

    return reply.status(200).send(await issueSession(fastify, user));
  });

  // ──────────────────────────────────────────────
  // REFRESH
  // ──────────────────────────────────────────────
  fastify.post("/refresh", async (request, reply) => {
    const parseResult = refreshSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({ error: "Invalid refresh payload structural constraint" });
    }

    const { refreshToken } = parseResult.data;

    try {
      const decoded = fastify.jwt.verify<{ userId: string }>(refreshToken);
      
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

  // ──────────────────────────────────────────────
  // LOGOUT
  // ──────────────────────────────────────────────
  fastify.post("/logout", async (request, reply) => {
    const { refreshToken } = request.body as { refreshToken: string };
    if (!refreshToken) return reply.status(400).send({ error: "Missing identity context" });

    try {
      const decoded = fastify.jwt.verify<{ userId: string }>(refreshToken);
      
      await fastify.redis.del(`refresh:${decoded.userId}`);
      return reply.status(200).send({ success: true, message: "Logged out clean." });
    } catch {
          return reply.status(200).send({ success: true, message: "Session already expired." });
        }
  });
}
