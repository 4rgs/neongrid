/**
 * Leaderboard.ts — global best-scores client.
 *
 *  - Falls back to localStorage (top-5) if the network is unavailable
 *  - Otherwise calls the Cloudflare Pages Function at /api/scores
 *  - On game-over, POSTs the new score and re-fetches the top-10
 *
 * The backend is a Cloudflare Pages Function backed by a D1 database
 * (see `functions/api/scores.ts` and `schema.sql`).
 */

import type { HighScore } from './SaveSystem';

const LS_KEY = 'neongrid:leaderboard-cache';
const CACHE_TTL = 60_000;     // 60s
const TIMEOUT_MS = 5_000;

export type LeaderboardEntry = HighScore & {
  rank: number;
};

function localFallback(): LeaderboardEntry[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as LeaderboardEntry[];
    if (!Array.isArray(arr)) return [];
    return arr;
  } catch {
    return [];
  }
}

function writeCache(scores: LeaderboardEntry[]) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(scores));
  } catch {}
}

function readCache(): { at: number; scores: LeaderboardEntry[] } {
  try {
    const raw = localStorage.getItem(LS_KEY + ':at');
    const arr = localFallback();
    return { at: raw ? parseInt(raw, 10) : 0, scores: arr };
  } catch {
    return { at: 0, scores: [] };
  }
}

function writeCacheAt(at: number) {
  try { localStorage.setItem(LS_KEY + ':at', at.toString()); } catch {}
}

function withTimeout<T>(p: PromiseLike<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = setTimeout(() => reject(new Error('timeout')), ms);
    Promise.resolve(p).then((v) => { clearTimeout(id); resolve(v); })
     .catch((e) => { clearTimeout(id); reject(e); });
  });
}

export async function fetchTop(scores = 10): Promise<LeaderboardEntry[]> {
  const { at, scores: cached } = readCache();
  if (Date.now() - at < CACHE_TTL && cached.length > 0) return cached;

  try {
    const res = await withTimeout(
      fetch(`/api/scores?limit=${scores}`),
      TIMEOUT_MS,
    );
    if (!res.ok) throw new Error('http ' + res.status);
    const data = (await res.json()) as LeaderboardEntry[];
    writeCache(data);
    writeCacheAt(Date.now());
    return data;
  } catch {
    // Offline / API not yet deployed: serve stale cache
    return cached;
  }
}

export async function submitScore(entry: Omit<HighScore, 'when'>): Promise<LeaderboardEntry[]> {
  const body = { ...entry, when: Date.now() };
  try {
    const res = await withTimeout(
      fetch('/api/scores', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
      TIMEOUT_MS,
    );
    if (!res.ok) throw new Error('http ' + res.status);
    const data = (await res.json()) as LeaderboardEntry[];
    writeCache(data);
    writeCacheAt(Date.now());
    return data;
  } catch {
    // Network failed: still merge with the local cache so the
    // local top-5 stays useful even when offline.
    const local = ((): LeaderboardEntry[] => {
      try {
        const raw = localStorage.getItem('neongrid:high');
        if (!raw) return [];
        const list = JSON.parse(raw) as HighScore[];
        return list.map((e, i) => ({ ...e, rank: i + 1 }));
      } catch { return []; }
    })();
    const merged = [...local, { ...body, when: body.when ?? Date.now() }]
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map((e, i) => ({ ...e, rank: i + 1 }));
    writeCache(merged);
    return merged;
  }
}
