import {z} from "zod"
const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().default(3000),
  MONGODB_URI: z.string().url(),
  JWT_SECRET: z.string().min(32),
  TELEGRAM_BOT_TOKEN: z.string(),
  REDIS_URL: z.string().url(),
  BOT_INTERNAL_SECRET: z.string(),
  LLM_API_KEY: z.string(),
  TMDB_API_KEY: z.string().optional().default(""),
  OMDB_API_KEY: z.string(),
  COMICVINE_API_KEY: z.string().optional().default(""),
  CORS_ORIGIN: z.string().optional().default("*"),
  ENABLE_BOT: z.coerce.boolean().default(false),
  ENABLE_DEV_AUTH: z.coerce.boolean().default(false),
  // Google OAuth — optional, leave blank to disable Google login
  GOOGLE_CLIENT_ID: z.string().optional().default(""),
  GOOGLE_CLIENT_SECRET: z.string().optional().default(""),
  // The publicly-accessible frontend URL — used for OAuth redirect
  APP_URL: z.string().optional().default("http://localhost:3001"),
})
const parsed = schema.safeParse(process.env)

if (!parsed.success) {
  console.error("❌ Invalid environment configuration variables:");
  console.error(JSON.stringify(parsed.error.format(), null, 2));
  process.exit(1);
}

export const env = parsed.data
