import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate } from "../middleware/authenticate";
import { User } from "../models/user";

const linkSchema = z.object({
  label: z.string().trim().min(1).max(24),
  url: z.string().trim().url().max(300),
});

const profileSchema = z.object({
  displayName: z.string().trim().min(1).max(80),
  bio: z.string().trim().max(500).default(""),
  avatarUrl: z.string().trim().url().nullable().optional(),
  links: z.array(linkSchema).max(5).default([]),
  nowPlaying: z
    .object({
      url: z.string().trim().url().nullable(),
      source: z.enum(["spotify", "soundcloud", "youtube"]).nullable(),
    })
    .optional(),
});

const colorSchema = z
  .string()
  .trim()
  .regex(/^#[0-9a-f]{6}$/i);

const themeSchema = z.object({
  colorScheme: z.object({
    background: colorSchema,
    text: colorSchema,
    accent: colorSchema,
    card: colorSchema,
  }),
  font: z.string().trim().min(1).max(80).default("Space Mono"),
  layout: z.enum(["grid", "feed", "masonry"]),
  customCss: z.string().max(4000).default(""),
  guestbookEnabled: z.boolean(),
});

function publicUserSelect() {
  return "-platforms.mal.accessToken -platforms.mal.refreshToken";
}

async function clearUserCache(fastify: FastifyInstance, username: string) {
  await fastify.redis.del(`cache:profile:${username.toLowerCase()}`);
}

function sanitizeCustomCss(css: string) {
  return css
    .replace(/@import/gi, "")
    .replace(/url\s*\(/gi, "")
    .replace(/expression\s*\(/gi, "")
    .replace(/javascript:/gi, "");
}

export default async function profileRoutes(fastify: FastifyInstance) {
  fastify.get("/me", { preHandler: authenticate }, async (request, reply) => {
    const user = await User.findById(request.userId).select(publicUserSelect());
    if (!user) return reply.status(404).send({ error: "Not Found" });

    return reply.status(200).send(user);
  });

  fastify.patch("/me/profile", { preHandler: authenticate }, async (request, reply) => {
    const parsed = profileSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "Bad Request",
        message: "Invalid profile payload.",
        details: parsed.error.format(),
      });
    }

    const user = await User.findById(request.userId);
    if (!user) return reply.status(404).send({ error: "Not Found" });

    user.displayName = parsed.data.displayName;
    user.bio = parsed.data.bio;
    user.avatarUrl = parsed.data.avatarUrl ?? null;
    user.links = parsed.data.links;

    if (parsed.data.nowPlaying) {
      user.theme.nowPlaying = parsed.data.nowPlaying;
    }

    await user.save();
    await clearUserCache(fastify, user.username);

    const updated = await User.findById(user._id).select(publicUserSelect());
    return reply.status(200).send(updated);
  });

  fastify.patch("/me/theme", { preHandler: authenticate }, async (request, reply) => {
    const parsed = themeSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "Bad Request",
        message: "Invalid theme payload.",
        details: parsed.error.format(),
      });
    }

    const user = await User.findById(request.userId);
    if (!user) return reply.status(404).send({ error: "Not Found" });

    user.theme.colorScheme = parsed.data.colorScheme;
    user.theme.font = parsed.data.font;
    user.theme.layout = parsed.data.layout;
    user.theme.customCss = sanitizeCustomCss(parsed.data.customCss);
    user.theme.guestbookEnabled = parsed.data.guestbookEnabled;

    await user.save();
    await clearUserCache(fastify, user.username);

    const updated = await User.findById(user._id).select(publicUserSelect());
    return reply.status(200).send(updated);
  });
}
