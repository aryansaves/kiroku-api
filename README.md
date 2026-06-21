# kiroku-api

Backend for **Kiroku** — a personal media journal logged through a Telegram bot. No app, no password — message the bot, get a public journal page.

**Live**: [kiroku-j.vercel.app](https://kiroku-j.vercel.app/u/demo)

## Features

- Telegram bot — log, edit, browse history, manage account, all through chat
- Natural language parsing — "finished Vinland Saga S2, 9/10" → structured log via Groq LLM
- Metadata enrichment — AniList, OMDB, Open Library, ComicVine for covers + canonical titles
- One polymorphic schema across anime, movies, series, books, manga, games, music, podcasts
- Telegram Login Widget (HMAC) + Google OAuth, JWT + Redis-backed refresh tokens
- Redis-backed caching, rate limiting, and bot conversation state
- Themeable public profile + guestbook

## Stack

| Layer | Tech | Why |
|---|---|---|
| Runtime | Bun | Native TS, fast cold start, built-in `.env` |
| Server | Fastify | Typed plugins, lightweight |
| Bot | Grammy | TS-first Telegram bot framework |
| DB | MongoDB Atlas | Document model fits polymorphic media schema |
| Cache | Redis (Upstash) | Metadata cache, rate limiting, tokens, bot state |
| NLP | Groq (llama-3.1-8b-instant) | Fast, cheap structured extraction |
| Auth | `@fastify/jwt` | Access tokens + Redis refresh rotation |
| Validation | Zod | Env + request schema validation |

## Architecture decisions

| Decision | Why |
|---|---|
| Bot → internal API, never writes Mongo directly | One validated write path (`/internal/logs` for bot, `/chat/log` for web) — shared rate limiting + upsert logic |
| Cover images stored at log time, not render time | Public profile reads Mongo only — no external calls, no spinners, no rate-limit risk on reads |
| Redis caches metadata lookups (6h TTL) | Same title gets logged repeatedly across users — first hit fetches, rest hit cache. Critical on free-tier API limits |
| Refresh tokens in Redis, not stateless | Instant logout (`DEL refresh:{userId}`), rotation detects token theft — stateless JWTs can't be revoked |
| Single `Log` collection, `mediaType` discriminator | One `find({ userId })` powers the whole feed instead of merging 7 collections |
| Bun over Node | Zero-config TS, built-in `.env`, faster startup — no ecosystem blockers for this stack |
| Low-confidence NLP → clarify, don't write | Bad data is worse than no data — a false positive needs manual cleanup |
| Bot state machine lives in Redis | Multi-turn flows (disambiguate → note → rating) with TTL, zero DB writes until commit |
| Rate limiting via Redis `INCR` | Atomic, sub-ms, no library — `KEYS ratelimit:*` shows live state |

## Structure

```
src/
├── index.ts        — Fastify entry, plugin registration
├── config.ts       — Zod env validation
├── plugins/         — mongodb.ts, redis.ts
├── models/           — user.ts, log.ts, guestbook-entry.ts
├── routes/           — auth, users, logs, internal, profile, guestbook, chat
├── middleware/       — authenticate.ts (JWT)
├── bot/               — index.ts, nlp.ts, handlers/
└── lib/metadata.ts     — multi-source metadata search + caching
```

## API

```
POST   /auth/telegram            Telegram Login Widget HMAC
GET    /auth/google               Google OAuth start / callback
POST   /auth/register             Google onboarding
POST   /auth/refresh              Rotate access token
POST   /auth/logout               Invalidate refresh token

GET    /users/:username           Public profile
PATCH  /users/me/profile          Update profile / theme

GET    /users/:username/logs      Paginated feed
GET    /users/:username/guestbook
POST   /users/:username/guestbook

POST   /internal/logs             Bot write (internal secret)
POST   /chat/parse                NLP message parsing
POST   /chat/log                  Authenticated log creation
```

## Run locally

```bash
git clone https://github.com/aryansaves/kiroku-api
cd kiroku-api
bun install
cp .env.example .env   # fill in values
docker compose up -d   # local Redis
bun dev
```

Requires: MongoDB Atlas URI, Redis URL, Telegram bot token, Groq API key, Google OAuth credentials. Full list in `.env.example`.

## Deployment

API on Railway, Redis on Upstash, MongoDB on Atlas, frontend on Vercel.

## License

MIT