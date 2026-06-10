# Kiroku — Complete Architecture Reference

---

## What You Are Building

A personal media journal where input happens exclusively through a Telegram bot and output is a public indie-style webpage at `kiroku.com/u/username` (subdomain `username.kiroku.com` after you can afford Pro).

Two surfaces. Bot writes. Page reads. They never overlap.

---

## System Overview

```
[User] ──telegram message──► [Grammy Bot]
                                   │
                              LLM NLP call
                                   │
                         structured JSON extracted
                                   │
                    ┌──────────────▼──────────────┐
                    │         Fastify API          │
                    │    POST /internal/logs        │
                    └──────────────┬──────────────┘
                                   │
                    ┌──────────────▼──────────────┐
                    │           MongoDB            │
                    │      Log document written    │
                    └──────────────┬──────────────┘
                                   │
                    ┌──────────────▼──────────────┐
                    │       BullMQ Queue           │
                    │  (backed by Upstash Redis)   │
                    └──────────┬─────┬────────────┘
                               │     │
                    ┌──────────▼─┐ ┌─▼──────────────┐
                    │ sync.worker│ │  email.worker   │
                    │ MAL/AniList│ │  Resend email   │
                    └────────────┘ └─────────────────┘

[Visitor] ──► kiroku.com/u/alice
                    │
          Next.js server component
                    │
         ┌──────────┴──────────┐
         │                     │
  GET /users/alice    GET /users/alice/logs
         │                     │
         └──────────┬──────────┘
                    │
              MongoDB reads
                    │
           page renders with
           Alice's theme/CSS
```

---

## Tech Stack

| Layer | Technology | Why |
|---|---|---|
| Bot framework | Grammy | Best TypeScript Telegram library |
| NLP | Claude / GPT-4o-mini API | Structured JSON from natural language |
| API server | Fastify + TypeScript | Typed, fast, plugin architecture |
| Database | MongoDB Atlas M0 (free) | Polymorphic media schema fits |
| Cache + Queue backend | Upstash Redis (free) | Both caching and BullMQ queue |
| Background jobs | BullMQ | Decouples slow work from request |
| Frontend | Next.js 14 App Router | SSR, middleware for subdomain routing |
| Styling | Tailwind CSS | Utility-first, works with CSS variables |
| Email | Resend (free tier) | Simple API, 3000 emails/month free |
| Image storage | Cloudflare R2 (free tier) | Zero egress fees |
| Image processing | Sharp | Resize avatars, thumbnail generation |
| Runtime | Bun | Native TypeScript, fast |
| Deployment — API | Fly.io (free tier) | Persistent processes, Docker-based |
| Deployment — Frontend | Vercel Hobby (free) | Next.js native, easy |
| CI/CD | GitHub Actions | Lint, build, deploy on push |

---

## Repository Structure

```
github.com/aryansaves/kiroku        ← Next.js frontend
github.com/aryansaves/kiroku-api    ← Fastify backend + bot + workers
```

Two repos. The bot lives inside the API repo because it shares models, DB connections, and internal route calls. It is not a separate service.

---

## kiroku-api Folder Structure

```
kiroku-api/
├── src/
│   ├── index.ts                  ← Fastify server entry, registers plugins, starts
│   ├── config.ts                 ← Zod validates all env vars, crashes if missing
│   │
│   ├── plugins/
│   │   ├── mongodb.ts            ← Mongoose connection registered as Fastify plugin
│   │   ├── redis.ts              ← Upstash Redis client as Fastify plugin
│   │   └── auth.ts               ← @fastify/jwt setup, token signing config
│   │
│   ├── models/
│   │   ├── User.ts               ← User schema with embedded Theme
│   │   ├── Log.ts                ← Polymorphic media log schema
│   │   └── GuestbookEntry.ts     ← Guestbook messages schema
│   │
│   ├── routes/
│   │   ├── auth.ts               ← POST /auth/telegram, refresh, logout
│   │   ├── users.ts              ← GET /users/:username (public profile)
│   │   ├── logs.ts               ← GET /users/:username/logs, GET /users/me/logs/export
│   │   ├── profile.ts            ← PATCH /users/me/profile, PATCH /users/me/theme
│   │   ├── guestbook.ts          ← POST and DELETE guestbook entries
│   │   ├── platforms.ts          ← MAL and AniList OAuth callbacks
│   │   └── internal.ts           ← POST /internal/logs (bot writes here)
│   │
│   ├── bot/
│   │   ├── index.ts              ← Grammy bot setup, webhook registration
│   │   ├── handlers/
│   │   │   ├── message.ts        ← receives any text, calls NLP pipeline
│   │   │   └── commands.ts       ← /start (create account), /username, /status, /help
│   │   └── nlp.ts                ← LLM API call, returns typed LogPayload
│   │
│   ├── workers/
│   │   ├── index.ts              ← worker process entry, starts all workers
│   │   ├── sync.worker.ts        ← MAL/AniList sync jobs
│   │   └── email.worker.ts       ← Resend email jobs
│   │
│   ├── queues/
│   │   └── index.ts              ← queue definitions, job type interfaces
│   │
│   ├── middleware/
│   │   └── authenticate.ts       ← JWT verification Fastify hook
│   │
│   ├── adapters/
│   │   ├── platform.interface.ts ← PlatformAdapter interface definition
│   │   ├── mal.adapter.ts        ← MAL API implementation
│   │   └── anilist.adapter.ts    ← AniList GraphQL implementation
│   │
│   └── lib/
│       ├── llm.ts                ← LLM API wrapper, prompt template
│       ├── r2.ts                 ← Cloudflare R2 pre-signed URL generation
│       └── sanitize.ts           ← CSS sanitizer for custom theme CSS
│
├── .env
├── .env.example
├── Dockerfile
├── fly.toml
└── tsconfig.json
```

---

## kiroku (frontend) Folder Structure

```
kiroku/
├── app/
│   ├── page.tsx                  ← landing page / marketing
│   ├── login/page.tsx            ← embeds Telegram Login Widget
│   ├── settings/
│   │   ├── page.tsx              ← profile edit, bio, links, song
│   │   └── theme/page.tsx        ← colors, font, CSS, stickers
│   ├── u/
│   │   └── [username]/
│   │       └── page.tsx          ← the public journal page
│   └── layout.tsx
│
├── components/
│   ├── journal/
│   │   ├── LogCard.tsx           ← single media entry card
│   │   ├── LogGrid.tsx           ← grid/feed/masonry layout
│   │   └── TypeFilter.tsx        ← filter by anime/movie/book etc
│   ├── profile/
│   │   ├── Bio.tsx
│   │   ├── Guestbook.tsx
│   │   └── SongPlayer.tsx
│   └── stickers/
│       └── StickerLayer.tsx      ← absolutely positioned stickers
│
├── middleware.ts                 ← subdomain → /u/[username] rewrite
└── lib/
    └── api.ts                    ← typed fetch wrappers for the API
```

---

## Data Models

### User
```typescript
{
  _id: ObjectId,
  telegramId: string,         // primary identifier, set on /start, never null
  telegramUsername: string | null,  // their @handle, can change, not used as key
  username: string,           // kiroku username, set via /username command, becomes subdomain
  displayName: string,        // from Telegram first_name initially, user can change

  bio: string,
  links: Array<{ label: string, url: string }>,
  avatarUrl: string | null,   // R2 URL after upload

  platforms: {
    mal: {
      linked: boolean,
      accessToken: string,
      refreshToken: string,
      expiresAt: Date
    },
    anilist: {
      linked: boolean,
      accessToken: string
    }
  },

  theme: {
    colorScheme: {
      background: string,   // hex
      text: string,
      accent: string,
      card: string
    },
    font: string,
    layout: 'grid' | 'feed' | 'masonry',
    customCss: string,        // sanitized before storing
    stickers: Array<{
      id: string,
      src: string,            // from your hosted sticker library
      x: number,              // px from left
      y: number,              // px from top
      size: number,
      rotation: number        // degrees
    }>,
    nowPlaying: {
      url: string | null,
      source: 'spotify' | 'soundcloud' | 'youtube' | null
    },
    guestbookEnabled: boolean
  },

  createdAt: Date
}
```

### Log (polymorphic — all 7 media types in one collection)
```typescript
{
  _id: ObjectId,
  userId: ObjectId,           // ref User

  mediaType: 'anime' | 'movie' | 'book' | 'manga' | 'game' | 'music' | 'podcast',
  title: string,
  coverImage: string | null,  // fetched from external API after logging

  status: 'watching' | 'completed' | 'dropped' | 'planned' | 'rewatching',
  rating: number | null,      // 0-10
  notes: string | null,

  progress: {
    episode: number | null,
    chapter: number | null,
    page: number | null,
    percentage: number | null
  },

  typeSpecific: {
    // anime: { studio, season }
    // movie: { director, runtime }
    // book: { author, isbn }
    // manga: { author, volumes }
    // game: { platform, developer }
    // music: { artist, album }
    // podcast: { host, episodeTitle }
  },

  // external IDs for platform sync
  externalIds: {
    malId: number | null,
    anilistId: number | null,
    tmdbId: number | null
  },

  createdAt: Date,
  updatedAt: Date
}
```

### GuestbookEntry
```typescript
{
  _id: ObjectId,
  pageOwnerId: ObjectId,      // ref User
  visitorName: string,
  message: string,
  createdAt: Date
}
```

---

## Full Route List

```
─────────────────────────────────────────────────────
AUTH
─────────────────────────────────────────────────────
POST   /auth/telegram                 verify Telegram widget data, issue JWT
POST   /auth/refresh                  swap refresh token for new access token
POST   /auth/logout                   invalidate refresh token in Redis

─────────────────────────────────────────────────────
PUBLIC (no auth required)
─────────────────────────────────────────────────────
GET    /users/:username               bio, theme, stickers, song, guestbook toggle
GET    /users/:username/logs          paginated log cards (query: type, page, limit)
POST   /users/:username/guestbook     visitor posts a message (rate limited by IP)

─────────────────────────────────────────────────────
AUTHENTICATED (JWT required)
─────────────────────────────────────────────────────
PATCH  /users/me/profile              update bio, links, song URL
PATCH  /users/me/theme                update colors, font, layout, CSS, stickers
GET    /users/me/guestbook            view all messages including hidden
DELETE /users/me/guestbook/:id        delete a guestbook entry
GET    /users/me/logs/export          CSV download of all logs

─────────────────────────────────────────────────────
PLATFORM OAUTH
─────────────────────────────────────────────────────
GET    /auth/mal/callback             MAL OAuth2 code exchange, store tokens
GET    /auth/anilist/callback         AniList OAuth2 code exchange

─────────────────────────────────────────────────────
INTERNAL (bot-secret header, not JWT)
─────────────────────────────────────────────────────
POST   /internal/logs                 bot writes a log entry for a user

─────────────────────────────────────────────────────
SYSTEM
─────────────────────────────────────────────────────
POST   /webhook/telegram              Telegram sends bot updates here
GET    /health                        returns DB + Redis connectivity status
```

---

## Authentication Flow

### Account creation — /start command
```
User sends /start to the bot
  → Grammy receives update
  → ctx.from.id is their permanent Telegram user ID
  → check MongoDB: does a user with this telegramId exist?
  → if yes → already registered, reply with their journal URL
  → if no → create User document:
      telegramId: ctx.from.id.toString()
      telegramUsername: ctx.from.username ?? null
      displayName: ctx.from.first_name
      username: ctx.from.username ?? "user_" + last 6 digits of telegramId
  → bot replies: "Your journal is live at kiroku.com/u/aryan
                  Set a custom username: /username yourname"
```

No email. No password. Account exists the moment they message the bot.

### Web login — Telegram Login Widget
```
User visits kiroku.com/login
  → page renders Telegram Login Widget (official Telegram script)
  → user clicks widget → Telegram opens on their phone → they approve
  → Telegram sends to your callback:
    {
      id: 123456789,
      first_name: "Aryan",
      username: "aryansaves",
      auth_date: 1234567890,
      hash: "hmac_signature"   ← computed with your bot token
    }

POST /auth/telegram with this payload
  → verify hash server-side (HMAC-SHA256 against bot token)
  → verify auth_date is within last 24 hours
  → find user in MongoDB by telegramId
  → if not found → they haven't used the bot yet → reply "Start the bot first"
  → if found → issue JWT access token + refresh token
  → store refresh token in Redis: SET refresh:{userId} {token} EX 2592000
  → return { accessToken, refreshToken }
```

### JWT middleware (protected routes)
```
Request hits protected route
  → Fastify preHandler hook runs
  → extracts Bearer token from Authorization header
  → jwt.verify(token, JWT_SECRET)
  → if expired or invalid → 401
  → attaches decoded userId to request object
  → route handler receives req.userId
```

### Refresh
```
POST /auth/refresh { refreshToken }
  → jwt.verify(refreshToken, JWT_REFRESH_SECRET)
  → GET refresh:{userId} from Redis — must match exactly
  → issue new access token
  → return { accessToken }
```

### /username command
```
User sends /username aryan
  → validate: lowercase, [a-z0-9-] only, 3-32 chars
  → check not in RESERVED set
  → check not already taken in MongoDB
  → update user.username
  → bot replies: "Done. Your journal: kiroku.com/u/aryan"
```

---

## Bot → Log Pipeline (core loop)

```
1. User sends message to bot: "finished Vinland Saga S2, 9/10, absolutely brutal ending"

2. Grammy webhook handler receives update
   → extracts message.text and message.from.id (Telegram user ID)
   → looks up User in MongoDB by telegramId
   → if not found → bot replies "link your account first: kiroku.com/link"
   → if found → proceeds

3. nlp.ts calls LLM API with prompt:
   ┌──────────────────────────────────────────────────────────┐
   │ Extract media log data. Return ONLY valid JSON.          │
   │ Schema: {                                                │
   │   mediaType: anime|movie|book|manga|game|music|podcast,  │
   │   title: string | null,                                  │
   │   action: log|update|query,                              │
   │   status: watching|completed|dropped|planned|rewatching, │
   │   progress: { episode, chapter, page, percentage },      │
   │   rating: number (0-10) | null,                          │
   │   notes: string | null,                                  │
   │   confidence: high|low                                   │
   │ }                                                        │
   │ Message: "finished Vinland Saga S2, 9/10..."             │
   └──────────────────────────────────────────────────────────┘

4. LLM returns:
   {
     mediaType: "anime",
     title: "Vinland Saga",
     action: "log",
     status: "completed",
     progress: { episode: null },
     rating: 9,
     notes: "absolutely brutal ending",
     confidence: "high"
   }

5. if confidence === "low" OR title === null:
   → bot replies asking for clarification
   → stops here, nothing written to DB

6. POST /internal/logs with extracted payload
   → Fastify internal route verifies bot secret header
   → writes Log document to MongoDB
   → returns 201 with logId

7. BullMQ enqueues two jobs:
   → sync job: { logId, userId, platforms: ['mal', 'anilist'] }
   → search job: { logId } (Meilisearch index update, skip initially)

8. Bot replies: "Logged ✓ Vinland Saga — completed — 9/10"

9. Workers process asynchronously:
   sync.worker: checks user's linked platforms
     → if MAL linked and mediaType is anime → call MAL API to update list
     → if AniList linked → call AniList GraphQL mutation
     → if platform API fails → retry with exponential backoff (BullMQ handles this)
```

---

## BullMQ — Queue Architecture

```typescript
// queues/index.ts

// Two queues
const syncQueue = new Queue('platform-sync', { connection: redis })
const emailQueue = new Queue('email', { connection: redis })

// Job type interfaces
interface SyncJobData {
  logId: string
  userId: string
}

interface EmailJobData {
  to: string
  type: 'welcome' | 'streak-milestone'
  payload: Record<string, unknown>
}

// Enqueue from routes or bot handler
await syncQueue.add('sync-log', { logId, userId }, {
  attempts: 3,
  backoff: { type: 'exponential', delay: 2000 }
})
```

```typescript
// workers/sync.worker.ts — separate process entry
const worker = new Worker('platform-sync', async (job) => {
  const { logId, userId } = job.data
  const log = await Log.findById(logId)
  const user = await User.findById(userId)

  const adapters = getPlatformAdapters(user)   // returns linked adapters only
  for (const adapter of adapters) {
    if (adapter.supportsMediaType(log.mediaType)) {
      await adapter.logEntry(userId, log)       // each adapter handles its own API
    }
  }
}, { connection: redis })
```

Workers run as a separate process. In Fly.io, this is a second VM or a second process inside the same VM using `bun run src/workers/index.ts`.

---

## Platform Adapter Pattern

```typescript
// adapters/platform.interface.ts
interface PlatformAdapter {
  name: string
  supportsMediaType(type: MediaType): boolean
  logEntry(userId: string, entry: LogDocument): Promise<void>
  isLinked(userId: string): Promise<boolean>
}

// adapters/mal.adapter.ts
class MALAdapter implements PlatformAdapter {
  name = 'mal'

  supportsMediaType(type: MediaType) {
    return ['anime', 'manga'].includes(type)
  }

  async logEntry(userId: string, entry: LogDocument) {
    const user = await User.findById(userId)
    const token = user.platforms.mal.accessToken
    // PUT https://api.myanimelist.net/v2/anime/{id}/my_list_status
    // with status, score, num_watched_episodes
  }
}
```

Same pattern for AniList. Adding a new platform in the future means writing one new adapter class — nothing else changes.

---

## Redis — Four Usage Patterns

```
1. REFRESH TOKEN STORAGE
   Key: refresh:{userId}
   Value: refresh token string
   TTL: 30 days
   Operation: SET on login, GET on refresh, DEL on logout

2. API RESPONSE CACHE
   Key: cache:anilist:{title}
   Value: JSON stringified API response
   TTL: 6 hours
   Operation: GET before API call, SET after API call if miss

3. RATE LIMITING (guestbook POST, export endpoint)
   Key: ratelimit:{ip}:{endpoint}
   Value: request count (integer)
   TTL: sliding window (60 seconds)
   Operation: INCR on each request, check against limit

4. BULLMQ QUEUE BACKEND
   BullMQ manages its own Redis keys internally
   You don't touch these directly
   Just pass the Redis connection to Queue and Worker constructors
```

---

## Frontend — Public Journal Page

### Data fetching (server component)
```typescript
// app/u/[username]/page.tsx
export default async function UserPage({ params }) {
  const { username } = params

  // parallel fetch — don't await sequentially
  const [profile, logs] = await Promise.all([
    fetch(`${API_URL}/users/${username}`).then(r => r.json()),
    fetch(`${API_URL}/users/${username}/logs?limit=20`).then(r => r.json())
  ])

  // inject theme as CSS custom properties at root
  const themeStyle = buildThemeCSS(profile.theme)

  return (
    <div style={themeStyle}>
      <Bio profile={profile} />
      <LogGrid logs={logs} />
      {profile.theme.guestbookEnabled && <Guestbook username={username} />}
      <StickerLayer stickers={profile.theme.stickers} />
      <SongPlayer nowPlaying={profile.theme.nowPlaying} />
    </div>
  )
}
```

### Theme as CSS variables
```typescript
function buildThemeCSS(theme: Theme): CSSProperties {
  return {
    '--color-bg': theme.colorScheme.background,
    '--color-text': theme.colorScheme.text,
    '--color-accent': theme.colorScheme.accent,
    '--color-card': theme.colorScheme.card,
    '--font-body': theme.font,
  } as CSSProperties
}
```

Custom CSS from the user is injected via a `<style>` tag in the page head, scoped to the user's container class. Sanitized before storage using a CSS parser that strips `url()`, `@import`, `position: fixed`, and `z-index` above 100.

### Subdomain routing (middleware.ts)
```typescript
const ROOT_DOMAIN = 'kiroku.com'
const RESERVED = new Set(['www', 'api', 'admin', 'auth', 'static', 'cdn', 'assets', 'mail', 'docs', 'support', 'status', 'app', 'kiroku'])

export function middleware(request: NextRequest) {
  const host = request.headers.get('host') ?? ''
  const subdomain = host.replace(`.${ROOT_DOMAIN}`, '')

  if (!subdomain || subdomain === host || RESERVED.has(subdomain)) {
    return NextResponse.next()
  }

  const url = request.nextUrl.clone()
  url.pathname = `/u/${subdomain}${url.pathname}`
  return NextResponse.rewrite(url)
}
```

In development: use `localhost:3000/u/alice` directly. Middleware only activates in production.

---

## Deployment Architecture

```
GitHub push to main
       │
       ▼
GitHub Actions CI
  → bun lint
  → bun typecheck
  → bun test
       │
  ┌────┴────────────────────────┐
  │                             │
  ▼                             ▼
Vercel (auto-deploy)      flyctl deploy
kiroku frontend           kiroku-api
                          (reads Dockerfile)
                               │
                    ┌──────────┼──────────┐
                    │          │          │
              Fastify API   Bot worker   BullMQ workers
              (port 3000)  (webhook)    (separate process)

External services (always on, not deployed by you):
  MongoDB Atlas M0    ← database
  Upstash Redis       ← cache + queue
  Cloudflare R2       ← image storage
  Resend              ← email
```

### Fly.io setup
```toml
# fly.toml
app = "kiroku-api"
primary_region = "bom"   # Mumbai

[http_service]
  internal_port = 3000
  force_https = true
  auto_stop_machines = true
  auto_start_machines = true

[[vm]]
  memory = "256mb"
  cpu_kind = "shared"
  cpus = 1
```

```dockerfile
# Dockerfile
FROM oven/bun:1 AS base
WORKDIR /app
COPY package.json bun.lockb ./
RUN bun install --frozen-lockfile
COPY . .
CMD ["bun", "run", "src/index.ts"]
```

---

## Environment Variables

```bash
# kiroku-api .env.example

PORT=3000
NODE_ENV=development

# Database
MONGODB_URI=mongodb+srv://...

# Redis (Upstash)
REDIS_URL=rediss://...
REDIS_TOKEN=...

# Auth
JWT_SECRET=minimum-32-char-secret-here
JWT_REFRESH_SECRET=different-minimum-32-char-secret
# No email/password — auth is Telegram-only via widget + bot

# Telegram
TELEGRAM_BOT_TOKEN=...
TELEGRAM_WEBHOOK_SECRET=...   # validates webhook requests are from Telegram

# LLM
LLM_API_KEY=...
LLM_MODEL=claude-3-haiku-20240307   # cheap, fast, sufficient for extraction

# Cloudflare R2
R2_ACCOUNT_ID=...
R2_ACCESS_KEY=...
R2_SECRET_KEY=...
R2_BUCKET=kiroku-media

# Resend
RESEND_API_KEY=...

# Internal bot auth
BOT_INTERNAL_SECRET=random-string-bot-uses-to-call-internal-routes
```

---

## Build Sequence — Exact Order

Do not move to the next step until the current step works and you can demonstrate it with curl or a real Telegram message.

```
PHASE 1 — Core API (backend only, no bot, no frontend)
─────────────────────────────────────────────────────
Step 1   config.ts — Zod env validation, process.exit if missing
Step 2   plugins/mongodb.ts — Mongoose connect, Fastify plugin
Step 3   models/User.ts — Telegram-only schema (no email, no passwordHash)
Step 4   routes/auth.ts — POST /auth/telegram (verify hash, find-or-error, issue JWT)
Step 5   middleware/authenticate.ts — JWT hook, test with curl
Step 6   models/Log.ts — polymorphic schema
Step 7   routes/users.ts — GET /users/:username
Step 8   routes/logs.ts — GET /users/:username/logs
         ↓
         Verify: curl /auth/telegram with test payload → get JWT → curl /users/:username

PHASE 2 — Bot + NLP pipeline
─────────────────────────────────────────────────────
Step 9   routes/internal.ts — POST /internal/logs with bot secret auth
Step 10  bot/nlp.ts — LLM call, test in isolation with bun run
Step 11  bot/handlers/commands.ts — /start creates account, /username sets handle
Step 12  bot/handlers/message.ts — receive text, call nlp.ts, call /internal/logs
Step 13  bot/index.ts — Grammy setup, webhook registration
         ↓
         Verify: /start → account in MongoDB → send log message → Log document created

PHASE 3 — Frontend
─────────────────────────────────────────────────────
Step 14  Next.js project init, middleware.ts for subdomain routing
Step 15  Static design of /u/[username] with hardcoded data (get the look right first)
Step 16  Wire to real API — parallel fetch profile + logs
Step 17  Theme system — CSS custom properties, buildThemeCSS()
Step 18  Login page — embed Telegram Login Widget, call POST /auth/telegram
Step 19  Settings pages — profile edit, theme edit
         ↓
         Verify: /start bot → send log → visit /u/username → see the log

PHASE 4 — Background jobs
─────────────────────────────────────────────────────
Step 20  queues/index.ts — queue definitions
Step 21  workers/email.worker.ts — welcome email via Resend
Step 22  workers/sync.worker.ts — skeleton, logs job receipt
Step 23  adapters/mal.adapter.ts — MAL OAuth + list update
Step 24  adapters/anilist.adapter.ts — AniList GraphQL
         ↓
         Verify: log anime → MAL list updates automatically

PHASE 5 — Deployment
─────────────────────────────────────────────────────
Step 25  Dockerfile for kiroku-api
Step 26  fly.toml, flyctl deploy
Step 27  Vercel deploy for frontend
Step 28  GitHub Actions CI pipeline
         ↓
         Verify: push to main → auto-deploys → production URL works

PHASE 6 — Customization layer
─────────────────────────────────────────────────────
Step 29  Custom CSS — sanitize.ts, inject via <style> tag
Step 30  Sticker system — hosted library, drag-drop picker in settings
Step 31  Guestbook — POST endpoint, display component, rate limiting
Step 32  Song player — URL parsing, embed selection by source
Step 33  CSV export — GET /users/me/logs/export
Step 34  Wildcard subdomains — after upgrading to Vercel Pro or moving to VPS
```

---

## What You Will Be Able to Explain After Building This

- Why the bot calls an internal route instead of writing to MongoDB directly — separation of concerns, the route handles validation and queuing, the bot handler stays thin
- Why BullMQ jobs are retried with exponential backoff — transient failures in external APIs should not permanently fail a sync
- Why Telegram auth uses HMAC verification instead of a password — Telegram signs the user data with your bot token as the secret; only Telegram knows the bot token, so a valid signature proves the data came from Telegram
- Why refresh tokens are stored in Redis and not JWT-verified statelessly — revocation. You cannot un-issue a JWT, but you can delete a Redis key. If a user logs out or a token is compromised, DELETE refresh:{userId} and all sessions using that token are immediately dead.
- Why the Log schema has a `typeSpecific` subdocument — seven media types have different fields, one collection with a discriminator avoids seven separate collections with duplicated common fields
- Why avatar upload goes directly to R2 via pre-signed URL instead of through Fastify — your server never handles binary data, R2 handles transfer, you only handle metadata
- Why the Next.js page is server-rendered and not client-fetched — theme must be applied before the user sees anything, no flash of unstyled content, SEO for public profiles

Every one of these is a real interview question for backend roles.

---

## Constraints and Known Tradeoffs

| Constraint | Impact | Resolution |
|---|---|---|
| Vercel free tier — no wildcard subdomains | Path routing only initially | Upgrade to Pro or migrate to VPS when ready |
| Upstash 10k requests/day | BullMQ is Redis-heavy | Fine for early users, watch the dashboard |
| Fly.io 256MB RAM | Sharp may OOM under load | Test early, move image processing to a separate lightweight worker if needed |
| MongoDB Atlas M0 — 512MB storage | ~200k average log documents | Fine for months, upgrade when needed |
| No Letterboxd write API | Cannot sync to Letterboxd | Be upfront in the product — Kiroku is the canonical log |
| LLM API costs money | Every bot message costs ~$0.001 | Use Gemini Flash, cheapest option that handles JSON extraction reliably |
| Telegram Login Widget requires HTTPS | Widget won't work on localhost | Test auth flow only on deployed URL, use hardcoded test user locally |
| telegramUsername can be null or change | Cannot use as primary key | telegramId is the permanent key, username is separately managed |