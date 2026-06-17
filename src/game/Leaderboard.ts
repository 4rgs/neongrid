/**
 * Leaderboard.ts — global best-scores client.
 *
 *  - Falls back to localStorage (top-5) if the network is unavailable
 *  - Otherwise calls the Cloudflare Pages Function at /api/scores
 *  - On game-over, POSTs the new score and re-fetches the top-10
 *  - Supports period filters: all (default), daily, weekly
 *  - Sends a signed payload (HMAC-SHA256) if a secret was bundled
 *  - Avatar + country are attached when available
 *
 * The backend is a Cloudflare Pages Function backed by a D1 database
 * (see `functions/api/scores.ts` and `schema.sql`).
 */

import type { HighScore } from './SaveSystem';

const LS_KEY = 'neongrid:leaderboard-cache';
const CACHE_TTL = 60_000;     // 60s
const TIMEOUT_MS = 5_000;

export type Avatar = 'code' | 'glitch' | 'shard' | 'circuit' | 'kernel';
export const AVATARS: Avatar[] = ['code', 'glitch', 'shard', 'circuit', 'kernel'];

export type Period = 'all' | 'daily' | 'weekly';

export type LeaderboardEntry = {
  rank: number;
  name: string;
  score: number;
  level: number;
  time: number;       // seconds
  when: number;       // epoch ms
  avatar?: Avatar;
  country?: string;
  heroName?: string;
};

export type SubmitEntry = {
  name: string;
  score: number;
  level: number;
  time: number;
  when?: number;
  heroName?: string;
  avatar?: Avatar;
  country?: string;
  sign?: string;
};

const SIGN_KEY = 'neongrid:score-sign-v1';   // local demo key (server uses SCORE_SECRET)

function localFallback(period: Period): LeaderboardEntry[] {
  try {
    const raw = localStorage.getItem(LS_KEY + ':' + period);
    if (!raw) return [];
    const arr = JSON.parse(raw) as LeaderboardEntry[];
    if (!Array.isArray(arr)) return [];
    return arr;
  } catch {
    return [];
  }
}

function writeCache(period: Period, scores: LeaderboardEntry[]) {
  try {
    localStorage.setItem(LS_KEY + ':' + period, JSON.stringify(scores));
    localStorage.setItem(LS_KEY + ':' + period + ':at', Date.now().toString());
  } catch {}
}

function readCache(period: Period): { at: number; scores: LeaderboardEntry[] } {
  try {
    const at = parseInt(localStorage.getItem(LS_KEY + ':' + period + ':at') || '0', 10);
    return { at, scores: localFallback(period) };
  } catch {
    return { at: 0, scores: [] };
  }
}

function withTimeout<T>(p: PromiseLike<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = setTimeout(() => reject(new Error('timeout')), ms);
    Promise.resolve(p).then((v) => { clearTimeout(id); resolve(v); })
     .catch((e) => { clearTimeout(id); reject(e); });
  });
}

async function sha256Hex(input: string): Promise<string> {
  const enc = new TextEncoder();
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(input));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function asyncHmacHex(secret: string, payload: string): Promise<string> {
  const enc = new TextEncoder();
  const keyMat = await crypto.subtle.importKey(
    'raw', enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', keyMat, enc.encode(payload));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Sign a payload with the bundled local key. The server will
 *  re-sign and compare (or skip if SCORE_SECRET is not set, in which
 *  case the signature is informational only). */
export async function signPayload(entry: SubmitEntry): Promise<string | undefined> {
  try {
    const { sign, ...rest } = entry;
    return await asyncHmacHex(SIGN_KEY, JSON.stringify(rest));
  } catch {
    return undefined;
  }
}

/** Hash a string (used for cache keys, country flags, etc). */
export async function shortHash(s: string): Promise<string> {
  return (await sha256Hex(s)).slice(0, 8);
}

export async function fetchTop(scores = 10, period: Period = 'all', extra: { country?: string; region?: string } = {}): Promise<LeaderboardEntry[]> {
  const { at, scores: cached } = readCache(period);
  if (Date.now() - at < CACHE_TTL && cached.length > 0) return cached;

  const params = new URLSearchParams({
    limit: String(scores),
    period,
    ...(extra.country ? { country: extra.country } : {}),
    ...(extra.region ? { region: extra.region } : {}),
  });

  try {
    const res = await withTimeout(
      fetch('/api/scores?' + params.toString()),
      TIMEOUT_MS,
    );
    if (!res.ok) throw new Error('http ' + res.status);
    const data = (await res.json()) as { scores: LeaderboardEntry[]; period: Period };
    writeCache(period, data.scores || []);
    return data.scores || [];
  } catch {
    return cached;
  }
}

export type ProfileEntry = {
  name: string;
  best: number;
  runs: number;
  totalTime: number;
  country: string;
  firstSeen: number;
  lastSeen: number;
  history: { score: number; level: number; time: number; avatar?: string; country?: string; when: number }[];
};

export async function fetchProfile(name: string): Promise<ProfileEntry | null> {
  try {
    const res = await withTimeout(
      fetch('/api/profile?name=' + encodeURIComponent(name)),
      TIMEOUT_MS,
    );
    if (!res.ok) return null;
    return (await res.json()) as ProfileEntry;
  } catch {
    return null;
  }
}

export async function submitScore(entry: SubmitEntry): Promise<LeaderboardEntry[]> {
  // Add avatar + country if missing
  if (!entry.avatar) entry.avatar = 'code';
  if (!entry.country) entry.country = '??';
  // Sign payload (server will verify or skip)
  if (!entry.sign) {
    const sig = await signPayload(entry);
    if (sig) entry.sign = sig;
  }

  try {
    const res = await withTimeout(
      fetch('/api/scores', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(entry),
      }),
      TIMEOUT_MS,
    );
    if (!res.ok) throw new Error('http ' + res.status);
    const data = (await res.json()) as { scores: LeaderboardEntry[] };
    writeCache('all', data.scores || []);
    return data.scores || [];
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
    const merged: LeaderboardEntry[] = [...local, { ...entry, when: entry.when || Date.now() }]
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map((e, i) => ({ ...e, rank: i + 1 }));
    writeCache('all', merged);
    return merged;
  }
}
