// src/lib/metadata.ts
import { env } from "../config";
import type { FastifyInstance } from "fastify";

export interface MetadataItem {
  canonicalTitle: string;
  coverImage: string | null;
  mediaType: string;
  externalIds: {
    anilistId: number | null;
    malId: number | null;
    tmdbId: number | null;
  };
}

async function fetchFromAniList(title: string): Promise<MetadataItem[]> {
  const query = `
    query ($search: String) {
      Page(perPage: 5) {
        media(search: $search) {
          type
          title { english romaji }
          coverImage { large }
          id
          idMal
        }
      }
    }
  `;
  try {
    const response = await fetch("https://graphql.anilist.co", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables: { search: title } }),
    });
    
    if (!response.ok) return [];
    const json = await response.json() as any;
    const list = json.data?.Page?.media || [];
    
    return list.map((m: any) => ({
      canonicalTitle: m.title.english || m.title.romaji,
      coverImage: m.coverImage.large || null,
      mediaType: m.type === "ANIME" ? "anime" : "manga",
      externalIds: { anilistId: m.id, malId: m.idMal, tmdbId: null }
    }));
  } catch (err) {
    console.error("AniList fetch error:", err);
    return [];
  }
}

async function fetchFromOMDB(title: string): Promise<MetadataItem[]> {
  const url = `https://www.omdbapi.com/?apikey=${env.OMDB_API_KEY}&t=${encodeURIComponent(title)}`;

  try {
    const response = await fetch(url);
    if (!response.ok) return [];

    const data = await response.json() as any;
    if (data.Response !== "True") return [];

    return [{
      canonicalTitle: data.Title,
      coverImage: data.Poster && data.Poster !== "N/A" ? data.Poster : null,
      mediaType: data.Type === "series" ? "movie" : "movie",
      externalIds: { anilistId: null, malId: null, tmdbId: null }
    }];
  } catch (err) {
    console.error("OMDB fetch error:", err);
    return [];
  }
}

async function fetchFromTMDB(title: string): Promise<MetadataItem[]> {
  const url = `https://api.themoviedb.org/3/search/movie?query=${encodeURIComponent(title)}&api_key=${env.TMDB_API_KEY}&include_adult=false&language=en-US&page=1`;

  try {
    const response = await fetch(url, {
      headers: { accept: "application/json" }
    });
    if (!response.ok) return [];

    const json = await response.json() as any;
    const list = json.results || [];

    return list.slice(0, 5).map((r: any) => ({
      canonicalTitle: r.title || r.original_title,
      coverImage: r.poster_path ? `https://image.tmdb.org/t/p/w500${r.poster_path}` : null,
      mediaType: "movie",
      externalIds: { anilistId: null, malId: null, tmdbId: r.id }
    }));
  } catch (err) {
    console.error("TMDB fetch error:", err);
    return [];
  }
}

export async function searchMetadataPool(
  fastify: FastifyInstance,
  title: string,
  hintType: string
): Promise<MetadataItem[]> {
  const normalized = title.toLowerCase().trim().replace(/[\s\W]+/g, "-");
  const cacheKey = `search:${hintType}:${normalized}`;
  
  try {
    const cached = await fastify.redis.get(cacheKey);
    if (cached) return JSON.parse(cached);

    let results: MetadataItem[] = [];
    if (hintType === "anime" || hintType === "manga") {
      results = await fetchFromAniList(title);
    } else {
      results = await fetchFromOMDB(title);
      if (results.length === 0) {
        results = await fetchFromTMDB(title);
      }
    }

    if (results.length > 0) {
      await fastify.redis.set(cacheKey, JSON.stringify(results), "EX", 21600);
    }
    return results;
  } catch (err) {
    console.error("Metadata pool error:", err);
    return [];
  }
}
