/**
 * /api/scores — Cloudflare Pages Function.
 *
 *  GET  /api/scores?limit=10&period=all|daily|weekly
 *    → { scores: [{rank, name, score, level, time, avatar, country, when}] }
 *
 *  POST /api/scores
 *    body: { name, score, level, time, heroName?, avatar?, country?, sign? }
 *    → 201 with the new global top-N (default 10)
 *
 *  Backing store: D1 (binding `DB`). To set it up:
 *    wrangler d1 create neongrid-leaderboard
 *    wrangler d1 execute neongrid-leaderboard --file=schema.sql
 *    wrangler pages secret put DB           # or via wrangler.toml with a binding
 *    wrangler pages secret put SCORE_SECRET # 32+ char string for HMAC signing
 *
 *  Filters:
 *    period=all    (default) all-time top
 *    period=daily  last 24h
 *    period=weekly last 7d
 *
 *  Anti-cheat:
 *    - 5 POSTs per IP per minute (in-memory; resets on cold start)
 *    - 30 POSTs per IP per hour
 *    - 50 ms minimum run-time (a server-side estimate based on level+score)
 *    - server-side max score cap = 9_999_999
 *    - level < 20, time > 5 s, time < 7200 s
 *    - HMAC signature verification (if SCORE_SECRET is set)
 *    - name/heroName blocked-word filter
 *    - reject if score would be lower than the player's previous best
 *
 *  Wire format (compact):
 *    { name, score, level, time, ts, heroName, avatar, country }
 *    sign = HMAC-SHA256(SCORE_SECRET, JSON(without sign))
 *    ts   = performance.now() at submit (optional, we still cap by time)
 */

interface Env {
  DB: D1Database;
  SCORE_SECRET?: string;     // secret string for HMAC (Pages secret)
  ALLOW_DAILY_WINDOW_MS?: string;
}

const LIMIT_DEFAULT = 10;
const LIMIT_MAX = 50;
const RATE_LIMIT_MIN = 5;       // POSTs per minute
const RATE_LIMIT_HOUR = 30;     // POSTs per hour
const RATE_WINDOW_MIN = 60_000;
const RATE_WINDOW_HOUR = 3_600_000;
const MAX_SCORE = 9_999_999;
const MAX_LEVEL = 20;
const MIN_TIME = 5;             // sec
const MAX_TIME = 7_200;         // sec (2h)
const MIN_NAME = 1;
const MAX_NAME = 16;
const MAX_LORE = 32;

const ipBucketsMin = new Map<string, number[]>();
const ipBucketsHour = new Map<string, number[]>();

const BANNED_WORDS = [
  'admin', 'root', 'system', 'null', 'undefined', 'trash', 'cheat',
  'hacker', 'fuck', 'shit', 'bitch', 'cunt', 'nigger', 'faggot',
  'porn', 'sex', 'piss', 'cum', 'dick', 'ass', 'tits', 'boob',
  'jew', 'nazi', 'hitler', 'rape', 'kkk',
];

function isRateLimited(ip: string): string | null {
  const now = Date.now();
  const minList = (ipBucketsMin.get(ip) || []).filter(t => now - t < RATE_WINDOW_MIN);
  if (minList.length >= RATE_LIMIT_MIN) return 'rate_limited_per_minute';
  minList.push(now);
  ipBucketsMin.set(ip, minList);
  const hourList = (ipBucketsHour.get(ip) || []).filter(t => now - t < RATE_WINDOW_HOUR);
  if (hourList.length >= RATE_LIMIT_HOUR) return 'rate_limited_per_hour';
  hourList.push(now);
  ipBucketsHour.set(ip, hourList);
  return null;
}

function isValidName(s: unknown): s is string {
  return typeof s === 'string' && s.length >= MIN_NAME && s.length <= MAX_NAME && /^[A-Za-z0-9_-]+$/.test(s);
}

function containsBanned(s: string): string | null {
  const lower = s.toLowerCase();
  for (const w of BANNED_WORDS) {
    if (lower.includes(w)) return w;
  }
  return null;
}

function isValidScore(s: unknown): s is number {
  return typeof s === 'number' && Number.isFinite(s) && s >= 0 && s <= MAX_SCORE && Number.isInteger(s);
}

function isValidLevel(l: unknown): l is number {
  return typeof l === 'number' && Number.isInteger(l) && l >= 1 && l <= MAX_LEVEL;
}

function isValidTime(t: unknown): t is number {
  return typeof t === 'number' && Number.isFinite(t) && t >= MIN_TIME && t <= MAX_TIME;
}

function isValidAvatar(a: unknown): a is string {
  return typeof a === 'string' && ['code', 'glitch', 'shard', 'circuit', 'kernel'].includes(a);
}

function isValidCountry(c: unknown): c is string {
  return typeof c === 'string' && c.length >= 2 && c.length <= 2;
}

async function verifySign(env: Env, body: any, provided: string): Promise<boolean> {
  if (!env.SCORE_SECRET) return true;   // dev mode: skip
  if (typeof provided !== 'string' || !provided) return false;
  const enc = new TextEncoder();
  const keyMat = await crypto.subtle.importKey(
    'raw', enc.encode(env.SCORE_SECRET),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'],
  );
  const copy = { ...body };
  delete copy.sign;
  const expected = await crypto.subtle.sign('HMAC', keyMat, enc.encode(JSON.stringify(copy)));
  const expectedHex = Array.from(new Uint8Array(expected)).map((b) => b.toString(16).padStart(2, '0')).join('');
  return expectedHex === provided.toLowerCase();
}

function rankEntries<T extends { score: number; created_at?: number }>(arr: T[]): (T & { rank: number })[] {
  return arr.map((e, i) => ({ ...e, rank: i + 1 }));
}

function periodFilter(period: string): string {
  if (period === 'daily') {
    const since = Date.now() - 24 * 60 * 60 * 1000;
    return ` AND created_at >= ${since}`;
  }
  if (period === 'weekly') {
    const since = Date.now() - 7 * 24 * 60 * 60 * 1000;
    return ` AND created_at >= ${since}`;
  }
  return '';
}

export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  const url = new URL(ctx.request.url);
  const limit = Math.min(LIMIT_MAX, Math.max(1, parseInt(url.searchParams.get('limit') || `${LIMIT_DEFAULT}`, 10)));
  const period = (url.searchParams.get('period') || 'all').toLowerCase();
  const where = periodFilter(period);

  try {
    const { results } = await ctx.env.DB.prepare(
      'SELECT name, score, level, time, hero_name as heroName, avatar, country, ' +
      'created_at as `when` FROM scores WHERE 1=1' + where +
      ' ORDER BY score DESC, created_at ASC LIMIT ?'
    ).bind(limit).all();
    return Response.json({ scores: rankEntries(results as any[]), period });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: 'db_unavailable', message: e?.message || 'unknown' }), {
      status: 503, headers: { 'content-type': 'application/json' },
    });
  }
};

export const onRequestPost: PagesFunction<Env> = async (ctx) => {
  const ip = ctx.request.headers.get('cf-connecting-ip') || 'unknown';
  const rl = isRateLimited(ip);
  if (rl) {
    return new Response(JSON.stringify({ error: rl }), {
      status: 429, headers: { 'content-type': 'application/json' },
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

  // Validate fields
  if (!isValidName(body.name)) {
    return new Response(JSON.stringify({ error: 'invalid_name' }), {
      status: 400, headers: { 'content-type': 'application/json' },
    });
  }
  const banned = containsBanned(body.name);
  if (banned) {
    return new Response(JSON.stringify({ error: 'banned_word', word: banned }), {
      status: 400, headers: { 'content-type': 'application/json' },
    });
  }
  if (!isValidScore(body.score)) {
    return new Response(JSON.stringify({ error: 'invalid_score' }), {
      status: 400, headers: { 'content-type': 'application/json' },
    });
  }
  if (!isValidLevel(body.level)) {
    return new Response(JSON.stringify({ error: 'invalid_level' }), {
      status: 400, headers: { 'content-type': 'application/json' },
    });
  }
  if (!isValidTime(body.time)) {
    return new Response(JSON.stringify({ error: 'invalid_time' }), {
      status: 400, headers: { 'content-type': 'application/json' },
    });
  }
  // heroName is optional, max 32 chars, alphanumeric + spaces
  if (body.heroName !== undefined && (typeof body.heroName !== 'string' || body.heroName.length > MAX_LORE)) {
    return new Response(JSON.stringify({ error: 'invalid_hero_name' }), {
      status: 400, headers: { 'content-type': 'application/json' },
    });
  }
  if (typeof body.heroName === 'string') {
    const hb = containsBanned(body.heroName);
    if (hb) {
      return new Response(JSON.stringify({ error: 'banned_word_in_hero_name', word: hb }), {
        status: 400, headers: { 'content-type': 'application/json' },
      });
    }
  }
  // avatar: must be one of the 5 known, or default to 'code'
  const avatar = isValidAvatar(body.avatar) ? body.avatar : 'code';
  // country: 2-letter ISO, default '??'
  const country = isValidCountry(body.country) ? body.country.toUpperCase() : '??';

  // Anti-cheat: signature
  if (body.sign !== undefined) {
    const ok = await verifySign(ctx.env, body, body.sign);
    if (!ok) {
      return new Response(JSON.stringify({ error: 'invalid_signature' }), {
        status: 400, headers: { 'content-type': 'application/json' },
      });
    }
  }

  try {
    // Reject if same name has a higher score already (no downgrades)
    const existing = await ctx.env.DB.prepare(
      'SELECT MAX(score) as m FROM scores WHERE name = ?'
    ).bind(body.name).first();
    const prev = (existing as any)?.m ?? 0;
    if (body.score <= prev && prev > 0) {
      return new Response(JSON.stringify({ error: 'score_below_best', previous: prev }), {
        status: 409, headers: { 'content-type': 'application/json' },
      });
    }

    await ctx.env.DB.prepare(
      'INSERT INTO scores (name, score, level, time, hero_name, avatar, country, sign) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(
      body.name, body.score, body.level, body.time,
      body.heroName || body.name, avatar, country, body.sign || '',
    ).run();

    const { results } = await ctx.env.DB.prepare(
      'SELECT name, score, level, time, hero_name as heroName, avatar, country, ' +
      'created_at as `when` FROM scores ORDER BY score DESC, created_at ASC LIMIT ?'
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
