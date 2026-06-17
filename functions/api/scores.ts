/**
 * /api/scores — Cloudflare Pages Function.
 *
 *  GET  /api/scores?limit=10
 *    → { scores: [{rank, name, score, level, time, when}] }
 *
 *  POST /api/scores
 *    body: { name, score, level, time, heroName? }
 *    → 201 with the new global top-N (default 10)
 *
 *  Backing store: D1 (binding `DB`). To set it up:
 *    wrangler d1 create neongrid-leaderboard
 *    wrangler d1 execute neongrid-leaderboard --file=schema.sql
 *    wrangler pages secret put DB  # or via wrangler.toml with a binding
 *
 *  Rate-limit: 5 POSTs per IP per minute (in-memory; resets on cold start).
 */

interface Env {
  DB: D1Database;
}

const LIMIT_DEFAULT = 10;
const RATE_LIMIT = 5;       // POSTs
const RATE_WINDOW = 60_000; // ms

const ipBuckets = new Map<string, number[]>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const list = (ipBuckets.get(ip) || []).filter(t => now - t < RATE_WINDOW);
  if (list.length >= RATE_LIMIT) return true;
  list.push(now);
  ipBuckets.set(ip, list);
  return false;
}

function isValidName(s: unknown): s is string {
  return typeof s === 'string' && s.length >= 1 && s.length <= 16 && /^[A-Za-z0-9_-]+$/.test(s);
}

function isValidScore(s: unknown): s is number {
  return typeof s === 'number' && Number.isFinite(s) && s >= 0 && s <= 9_999_999 && Number.isInteger(s);
}

function isValidLevel(l: unknown): l is number {
  return typeof l === 'number' && Number.isInteger(l) && l >= 1 && l <= 999;
}

function isValidTime(t: unknown): t is number {
  return typeof t === 'number' && Number.isFinite(t) && t >= 0 && t <= 24 * 3600;
}

function rankEntries<T extends { score: number }>(arr: T[]): (T & { rank: number })[] {
  return arr.map((e, i) => ({ ...e, rank: i + 1 }));
}

export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  const url = new URL(ctx.request.url);
  const limit = Math.min(50, Math.max(1, parseInt(url.searchParams.get('limit') || `${LIMIT_DEFAULT}`, 10)));

  try {
    const { results } = await ctx.env.DB.prepare(
      'SELECT name, score, level, time, hero_name as heroName, created_at as `when` ' +
      'FROM scores ORDER BY score DESC, created_at ASC LIMIT ?'
    ).bind(limit).all();
    return Response.json({ scores: rankEntries(results as any[]) });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: 'db_unavailable', message: e?.message || 'unknown' }), {
      status: 503,
      headers: { 'content-type': 'application/json' },
    });
  }
};

export const onRequestPost: PagesFunction<Env> = async (ctx) => {
  const ip = ctx.request.headers.get('cf-connecting-ip') || 'unknown';
  if (isRateLimited(ip)) {
    return new Response(JSON.stringify({ error: 'rate_limited' }), {
      status: 429,
      headers: { 'content-type': 'application/json' },
    });
  }

  let body: any;
  try {
    body = await ctx.request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'invalid_json' }), {
      status: 400, headers: { 'content-type': 'application/json' },
    });
  }

  if (!isValidName(body.name) || !isValidScore(body.score) || !isValidLevel(body.level) || !isValidTime(body.time)) {
    return new Response(JSON.stringify({ error: 'invalid_payload' }), {
      status: 400, headers: { 'content-type': 'application/json' },
    });
  }
  const heroName = isValidName(body.heroName) ? body.heroName : 'PROGRAMMER';

  try {
    await ctx.env.DB.prepare(
      'INSERT INTO scores (name, score, level, time, hero_name) VALUES (?, ?, ?, ?, ?)'
    ).bind(body.name, body.score, body.level, body.time, heroName).run();

    const { results } = await ctx.env.DB.prepare(
      'SELECT name, score, level, time, hero_name as heroName, created_at as `when` ' +
      'FROM scores ORDER BY score DESC, created_at ASC LIMIT ?'
    ).bind(LIMIT_DEFAULT).all();
    return new Response(JSON.stringify({ scores: rankEntries(results as any[]) }), {
      status: 201, headers: { 'content-type': 'application/json' },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: 'db_unavailable', message: e?.message || 'unknown' }), {
      status: 503, headers: { 'content-type': 'application/json' },
    });
  }
};
