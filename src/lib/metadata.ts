import { env } from "../config";
import type { FastifyInstance } from "fastify";

interface MetadataResult {
  canonicalTitle: string;
  coverImage: string | null;
  externalIds: {
    anilistId: number | null;
    malId: number | null;
    tmdbId: number | null;
  };
}

// Simple internal helper to normalize title strings into clean Redis keys
function normalizeTitle(title: string): string {
  return title.toLowerCase().trim().replace(/[\s\W]+/g, "-");
}

/**
 * Hits the public AniList GraphQL API to fetch anime/manga details
 */
async function fetchFromAniList(title: string, mediaType: "anime" | "manga"): Promise<MetadataResult | null> {
  const query = `
    query ($search: String, $type: MediaType) {
      Media (search: $search, type: $type) {
        title { romaji english }
        coverImage { large }
        id
        idMal
      }
    }
  `;

  try {
    const response = await fetch("https://graphql.anilist.co", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({
        query,
        variables: {
          search: title,
          type: mediaType === "anime" ? "ANIME" : "MANGA",
        },
      }),
    });

    if (!response.ok) return null;
    const json = await response.json() as any;
    const media = json.data?.Media;
    if (!media) return null;

    return {
      canonicalTitle: media.title.english || media.title.romaji,
      coverImage: media.coverImage.large || null,
      externalIds: {
        anilistId: media.id || null,
        malId: media.idMal || null,
        tmdbId: null,
      },
    };
  } catch {
    return null;
  }
}

/**
 * Hits the TMDB REST API to fetch live-action movie/series details
 */
async function fetchFromTMDB(title: string, mediaType: "movie" | "podcast"): Promise<MetadataResult | null> {
  // If the mediaType maps to "movie", search movies; otherwise default to TV series lookups
  const endpoint = mediaType === "movie" ? "search/movie" : "search/tv";
  const url = `https://api.themoviedb.org/3/${endpoint}?query=${encodeURIComponent(title)}&api_key=${env.TMDB_API_KEY}`;

  try {
    const response = await fetch(url);
    if (!response.ok) return null;

    const json = await response.json() as any;
    const result = json.results?.[0];
    if (!result) return null;

    return {
      canonicalTitle: result.title || result.name,
      coverImage: result.poster_path ? `https://image.tmdb.org/t/p/w500${result.poster_path}` : null,
      externalIds: {
        anilistId: null,
        malId: null,
        tmdbId: result.id || null,
      },
    };
  } catch {
    return null;
  }
}

/**
 * Master controller orchestrating lookups, caching, and fail-safes
 */
export async function fetchMetadata(
  fastify: FastifyInstance,
  title: string,
  mediaType: "anime" | "movie" | "book" | "manga" | "game" | "music" | "podcast"
): Promise<MetadataResult> {
  const normalized = normalizeTitle(title);
  const cacheKey = `cache:${mediaType}:${normalized}`;

  // Fallback structural definition defaults
  const fallbackResult: MetadataResult = {
    canonicalTitle: title,
    coverImage: null,
    externalIds: { anilistId: null, malId: null, tmdbId: null },
  };

  try {
    // 1. Check Redis memory cache first
    const cachedData = await fastify.redis.get(cacheKey);
    if (cachedData) {
      return JSON.parse(cachedData) as MetadataResult;
    }

    let enrichment: MetadataResult | null = null;

    // 2. Delegate queries dynamically based on category types
    if (mediaType === "anime" || mediaType === "manga") {
      enrichment = await fetchFromAniList(title, mediaType);
    } else if (mediaType === "movie" || mediaType === "podcast") {
      enrichment = await fetchFromTMDB(title, mediaType);
    }

    // 3. Handle a successful lookup hit
    if (enrichment) {
      // Save data back to Redis with a 6-hour TTL expiration window
      await fastify.redis.set(cacheKey, JSON.stringify(enrichment), "EX", 21600);
      return enrichment;
    }

    // 4. Cache Miss + Remote failure: return un-enriched fallback parameters safely
    return fallbackResult;
  } catch (error) {
    fastify.log.error({ err: error }, `Metadata enrichment pipeline encountered errors for: ${title}`);
    return fallbackResult;
  }
}