// src/lib/metadata.ts
import { env } from "../config";
import type { FastifyInstance } from "fastify";

export interface MetadataItem {
  canonicalTitle: string;
  coverImage: string | null;
  mediaType: string;
  year: number | null;
  externalIds: {
    anilistId: number | null;
    malId: number | null;
    tmdbId: number | null;
  };
}

const FETCH_TIMEOUT_MS = 8000;

async function fetchWithTimeout(url: string, options?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
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
          startDate { year }
        }
      }
    }
  `;
  try {
    const response = await fetchWithTimeout("https://graphql.anilist.co", {
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
      year: m.startDate?.year || null,
      externalIds: { anilistId: m.id, malId: m.idMal, tmdbId: null }
    }));
  } catch (err) {
    console.error("AniList fetch error:", err);
    return [];
  }
}

async function fetchFromOMDBSearch(title: string): Promise<MetadataItem[]> {
  const url = `https://www.omdbapi.com/?apikey=${env.OMDB_API_KEY}&s=${encodeURIComponent(title)}`;
  try {
    const response = await fetchWithTimeout(url);
    if (!response.ok) return [];
    const data = await response.json() as any;
    if (data.Response !== "True") return [];
    const items = data.Search || [];
    return items.slice(0, 5).map((r: any) => ({
      canonicalTitle: r.Title,
      coverImage: r.Poster && r.Poster !== "N/A" ? r.Poster : null,
      mediaType: r.Type === "series" ? "series" : "movie",
      year: r.Year ? parseInt(r.Year) || null : null,
      externalIds: { anilistId: null, malId: null, tmdbId: null }
    }));
  } catch (err) {
    console.error("OMDB search error:", err);
    return [];
  }
}

async function fetchFromOpenLibrary(title: string): Promise<MetadataItem[]> {
  const url = `https://openlibrary.org/search.json?q=${encodeURIComponent(title)}&limit=5`;
  try {
    const response = await fetchWithTimeout(url);
    if (!response.ok) return [];
    const data = await response.json() as any;
    const docs = data.docs || [];
    return docs.slice(0, 5).map((d: any) => ({
      canonicalTitle: d.title,
      coverImage: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg` : null,
      mediaType: "book",
      year: d.first_publish_year || null,
      externalIds: { anilistId: null, malId: null, tmdbId: null }
    }));
  } catch (err) {
    console.error("OpenLibrary fetch error:", err);
    return [];
  }
}

async function fetchFromComicVine(title: string): Promise<MetadataItem[]> {
  if (!env.COMICVINE_API_KEY) return [];
  const url = `https://comicvine.gamespot.com/api/search/?api_key=${env.COMICVINE_API_KEY}&format=json&query=${encodeURIComponent(title)}&resources=volume&limit=5`;
  try {
    const response = await fetchWithTimeout(url, {
      headers: { "User-Agent": "KirokuBot/1.0" }
    });
    if (!response.ok) return [];
    const data = await response.json() as any;
    const results = data.results || [];
    return results.slice(0, 5).map((r: any) => ({
      canonicalTitle: r.name,
      coverImage: r.image?.medium_url || r.image?.original_url || null,
      mediaType: "comic",
      year: r.start_year ? parseInt(r.start_year) || null : null,
      externalIds: { anilistId: null, malId: null, tmdbId: null }
    }));
  } catch (err) {
    console.error("ComicVine fetch error:", err);
    return [];
  }
}

export async function searchMetadataPool(
  fastify: FastifyInstance,
  title: string,
  hintType: string
): Promise<MetadataItem[]> {
  const normalized = title.toLowerCase().trim().replace(/[\s\W]+/g, "-");
  const cacheKey = `search:all:${normalized}`;

  try {
    const cached = await fastify.redis.get(cacheKey);
    if (cached) return JSON.parse(cached);

    // Always search ALL APIs in parallel for cross-media results
    const all = await Promise.all([
      fetchFromOMDBSearch(title),
      fetchFromAniList(title),
      fetchFromOpenLibrary(title),
      fetchFromComicVine(title),
    ]);

    // Merge, deduplicate by title (case-insensitive), and sort
    const seen = new Set<string>();
    const merged: MetadataItem[] = [];

    for (const batch of all) {
      for (const item of batch) {
        const key = item.canonicalTitle.toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          merged.push(item);
        }
      }
    }

    // Sort: matching hintType first, then by year desc (newer first)
    merged.sort((a, b) => {
      const aMatch = a.mediaType === hintType ? 0 : 1;
      const bMatch = b.mediaType === hintType ? 0 : 1;
      if (aMatch !== bMatch) return aMatch - bMatch;
      return (b.year || 0) - (a.year || 0);
    });

    const results = merged.slice(0, 15);
    if (results.length > 0) {
      await fastify.redis.set(cacheKey, JSON.stringify(results), "EX", 21600);
    }
    return results;
  } catch (err) {
    console.error("Metadata pool error:", err);
    return [];
  }
}
