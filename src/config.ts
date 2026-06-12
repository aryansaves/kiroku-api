import {z} from "zod"
const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().default(3000),
  MONGODB_URI: z.string().url(),
  JWT_SECRET: z.string().min(32),
  TELEGRAM_BOT_TOKEN: z.string(),
  REDIS_URL:z.string().url()
})
const parsed = schema.safeParse(process.env)

if (!parsed.success) {
  console.error("❌ Invalid environment configuration variables:");
  console.error(JSON.stringify(parsed.error.format(), null, 2));
  process.exit(1);
}

export const env = parsed.data