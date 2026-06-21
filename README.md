<p align="center">
  <h1 align="center">kiroku-api</h1>
  <p align="center">Backend for <b>Kiroku</b> — a personal media journal powered by a Telegram bot.</p>
</p>

---

## What is Kiroku?

Kiroku lets you log everything you watch, read, and play through a Telegram bot. Your journal is publicly viewable at `kiroku.com/u/<username>`. No app install. No password. Just message the bot.

**Input**: Telegram message → **Output**: Personal media journal page.

## Features

- **Telegram Bot** — Account creation, media logging, username management, inline editing, and history browsing — all through chat
- **Natural Language Parsing** — Send "finished Vinland Saga S2, 9/10" and the bot extracts title, media type, status, and rating via Groq LLM
- **Metadata Enrichment** — Search across AniList, OMDB, Open Library, and ComicVine for cover art and canonical titles
- **Polymorphic Media Schema** — One collection for anime, movies, series, books, manga, games, music, and podcasts
- **Telegram Login Widget** — HMAC-verified JWT auth with Redis-backed refresh token rotation
- **Google OAuth** — Web login with Google, full OAuth 2.0 flow with callback handling and user registration
- **Redis Everywhere** — Metadata cache (6h TTL), profile cache (1h TTL), log feed cache (5min TTL), rate limiting (sliding window), refresh token storage, bot conversation state
- **Customizable Public Profile** — Users can theme their journal with custom colors, fonts, layout, stickers, and embedded song player
- **Guestbook** — Visitors can leave messages on any journal page

## Tech Stack

| Layer | Technology | Why |
|--- |--- |--- |
| Runtime | [Bun](https://bun.sh) | Native TypeScript, fast startup, built-in `.env` loading |
| Server | [Fastify](https://fastify.dev) | Typed plugin architecture, lightweight, fast |
| Bot | [Grammy](https://grammy.dev) | Best TypeScript Telegram bot library |
| Database | MongoDB (Atlas M0) | Polymorphic media schema fits document model; free tier |
| Cache | Redis (Upstash) | Metadata caching, profile caching, rate limiting, token storage |
| NLP | Groq (llama-3.1-8b-instant) | Fast, cheap JSON extraction from natural language |
| Validation | [Zod](https://zod.dev) | Schema validation for env vars and request bodies |
| Auth | `@fastify/jwt` | JWT access tokens + Redis-backed refresh tokens |
| Metadata | AniList GraphQL, OMDB, Open Library, ComicVine | Cover art + canonical titles per media type |

## Architecture Decisions

### Bot calls internal API instead of writing to MongoDB directly

The bot handler receives a Telegram message, calls the NLP service, enriches metadata from external APIs, then calls `POST /internal/logs` with the merged payload. This route — secured by a shared `BOT_INTERNAL_SECRET` header — handles validation, rate limiting (10 requests per 60s per user), and upsert logic (existing logs for the same title are updated rather than duplicated). The bot handler stays thin — it orchestrates, it doesn't persist.

This also means the same write path is available to the web frontend via `POST /chat/log` (authenticated with JWT), so a user can log media from either surface through the same validation layer.

### Cover images stored at log time, not fetched at render time

When a user logs media, the bot calls AniList/OMDB/Open Library/ComicVine immediately and stores the resulting `coverImage` URL directly in the MongoDB Log document. The public journal page reads this URL — it makes zero external API calls. No loading spinners on the page. No rate limit anxiety. The downside: a cover image can become stale if the external service changes it. The upside: the page renders instantly, works offline, and the API never becomes a dependency of the read path.

### Redis for metadata caching — amortize external API calls

The same title ("Vinland Saga") will be logged by many users. Without caching, every log triggers an AniList API call. With Redis: the first user's log fetches from AniList and caches the result under `cache:anilist:vinland-saga` with a 6-hour TTL. Every subsequent user who logs the same title hits Redis instead. This is critical for a free-tier product where external API rate limits are the bottleneck, not your own compute.

### Refresh tokens in Redis — revocation, not stateless verification

JWT access tokens are short-lived and stateless. Refresh tokens are stored in Redis as `refresh:{userId}` with a 30-day TTL. This means:

- **Logout is instant**: `DEL refresh:{userId}` — all sessions using that token die immediately. Stateless refresh tokens cannot be revoked.
- **Token rotation**: On refresh, the old token is deleted and a new one is issued. If a refresh token is stolen and used, the legitimate user's next refresh attempt will fail (token mismatch), alerting them to the compromise.
- **Stolen access tokens are still valid** until they expire (short TTL minimizes the window), but the attacker cannot get a new one.

### Single Log collection with `mediaType` discriminator

Seven media types (anime, movie, series, book, manga, game, music, podcast) share one MongoDB collection. Common fields — `title`, `status`, `rating`, `coverImage`, `notes`, `progress` — are on every document. Type-specific metadata (`studio`, `author`, `runtime`, `episodes`) is nullable and only populated for relevant types. Alternative designs (seven collections, discriminators with Mongoose refs) add query complexity — a journal feed is a single `find({ userId, ... })` with optional `mediaType` filtering.

### Bun over Node.js

Zero-config TypeScript execution (no `ts-node`, no `tsx`), built-in `.env` loading (no `dotenv`), native SQLite and Redis clients when needed, and faster startup. The `--hot` flag gives instant reloads without a process manager. The tradeoff: Bun is newer and some Node.js ecosystem packages have edge-case incompatibilities. For this stack — Fastify, Grammy, Mongoose, ioredis — everything works.

### NLP confidence gating — low-confidence = no write

The LLM returns a `confidence` field (`high` | `low`) alongside the structured log data. If confidence is `low` or `title` is `null`, the bot asks the user for clarification instead of writing a potentially incorrect log. This prevents garbage data from entering the database — a false positive in NLP is worse than a false negative, because a bad log entry requires manual cleanup.

### Bot conversation state in Redis

The bot maintains a per-user state machine (`DISAMBIGUATE → POST_SELECT → AWAIT_NOTE → AWAIT_RATING → RELOG_DECISION`) stored in Redis under `bot:state:{telegramId}`. This allows multi-turn conversations (e.g., "Which one did you mean?" → user picks → "Add a note?" → user types note) without any database writes until the final commit. Redis TTLs auto-expire stale conversations.

### Rate limiting is Redis INCR with sliding windows

Rather than a heavy rate-limiting library, the internal routes use `INCR` on a Redis key with a 60s TTL. If the count exceeds the limit, the request is rejected. This is atomic, single-digit-millisecond latency, and transparent — `KEYS ratelimit:*` shows all currently rate-limited users. Guestbook endpoints use the same pattern keyed by IP.

## Project Structure

```
src/
├── index.ts              — Fastify server entry, plugin registration
├── config.ts             — Zod-validated env vars, crashes on missing
├── plugins/
│   ├── mongodb.ts        — Mongoose connection as Fastify plugin
│   └── redis.ts          — ioredis client as Fastify plugin
├── models/
│   ├── user.ts           — User with Telegram/Google auth + theme
│   ├── log.ts            — Polymorphic media log schema
│   └── guestbook-entry.ts
├── routes/
│   ├── auth.ts           — Telegram HMAC auth, Google OAuth, JWT refresh
│   ├── users.ts          — Public profile endpoint
│   ├── logs.ts           — Paginated log feed
│   ├── internal.ts       — Bot-secret auth'd upsert endpoint
│   ├── profile.ts        — Profile and theme editing
│   ├── guestbook.ts      — Guestbook read/write
│   └── chat.ts           — NLP parsing + authenticated log creation
├── middleware/
│   └── authenticate.ts   — JWT Bearer token verification
├── bot/
│   ├── index.ts          — Grammy bot initialization
│   ├── nlp.ts            — Groq LLM call for message parsing
│   └── handlers/
│       ├── command.ts    — /start, /username, /help, /delete, /log, /history
│       └── messages.ts   — Message handler with state machine + metadata search
├── lib/
│   └── metadata.ts       — Multi-source metadata search with Redis caching
└── types/
    └── fastify.d.ts      — FastifyInstance type augmentation
```

## Getting Started

### Prerequisites

- [Bun](https://bun.sh) >= 1.0
- MongoDB Atlas
- Redis (Upstash)
- Telegram Bot Token (from [@BotFather](https://t.me/BotFather))
- Groq API Key (for NLP)
- Google Cloud Console project (for OAuth)

### Setup

```bash
# Clone
git clone https://github.com/aryansaves/kiroku-api
cd kiroku-api

# Install
bun install

# Configure
cp .env.example .env
# Fill in your .env values (see .env.example for details)

# Start Redis (if running locally)
docker compose up -d

# Run
bun dev        # Development with hot reload
bun start      # Production
```

### Environment Variables

See [`.env.example`](.env.example) for all variables and descriptions.

Required: `MONGODB_URI`, `REDIS_URL`, `JWT_SECRET`, `TELEGRAM_BOT_TOKEN`, `BOT_INTERNAL_SECRET`, `LLM_API_KEY`, `OMDB_API_KEY`

## API Routes

```
POST   /auth/telegram          — Telegram Login Widget HMAC verification
GET    /auth/google             — Google OAuth start
GET    /auth/google/callback    — Google OAuth callback
POST   /auth/register           — Google onboarding
GET    /auth/check-username     — Username availability
POST   /auth/dev                — Dev auth bypass
POST   /auth/refresh            — Rotate access token
POST   /auth/logout             — Invalidate refresh token

GET    /users/:username         — Public profile
GET    /users/me                — Own profile
PATCH  /users/me/profile        — Update profile
PATCH  /users/me/theme          — Update theme

GET    /users/:username/logs    — Paginated log feed
GET    /users/:username/guestbook — Guestbook entries
POST   /users/:username/guestbook — Post guestbook entry

POST   /internal/logs           — Bot writes a log entry
POST   /chat/parse              — NLP message parsing
POST   /chat/search             — Metadata title search
POST   /chat/log                — Authenticated log creation
```

## Deployment

Deployed on [Railway](https://railway.app) at `kiroku-api-production.up.railway.app`. Redis runs on [Upstash](https://upstash.com), MongoDB on Atlas. The `docker-compose.yml` runs Redis locally for development only.

## License

MIT
