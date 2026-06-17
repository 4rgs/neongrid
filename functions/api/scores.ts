/**
 * /api/scores — Cloudflare Pages Function.
 *
 *  GET  /api/scores?limit=10&period=all|daily|weekly&country=US&name=TRON
 *    → { scores: [{rank, name, score, level, time, avatar, country, when}] }
 *
 *  GET  /api/profile?name=TRON
 *    → { name, best, runs, totalFragments, totalTime, country,
 *        firstSeen, lastSeen, history: [{score, level, time, avatar, country, when}] }
 *
 *  POST /api/scores
 *    body: { name, score, level, time, heroName?, avatar?, country?, sign? }
 *    → 201 with the new global top-N (default 10)
 *    429 if rate-limited or temp-banned
 *
 *  Backing store: D1 (binding `DB`). To set it up:
 *    wrangler d1 create neongrid-leaderboard
 *    wrangler d1 execute neongrid-leaderboard --file=schema.sql
 *    wrangler pages secret put DB           # or via wrangler.toml with a binding
 *    wrangler pages secret put SCORE_SECRET # 32+ char string for HMAC signing
 *
 *  Anti-cheat:
 *    - Rate limit: 5 POSTs/IP/minute (in-memory; resets on cold start)
 *    - Rate limit: 30 POSTs/IP/hour
 *    - Temp ban: 5 scores in any 60s window → 1-hour ban from POSTs
 *    - Score cap = 9_999_999, level cap = 20, time 5s..7200s
 *    - HMAC signature verification (if SCORE_SECRET is set)
 *    - Banned-word filter on name + heroName
 *    - No-downgrade: same name + lower score → 409
 *    - Same-payload dedupe (within 5s) → 409
 *
 *  Country:
 *    - cf-ipcountry header (Cloudflare-injected)
 *    - Falls back to "??"
 */

interface Env {
  DB: D1Database;
  SCORE_SECRET?: string;
}

const LIMIT_DEFAULT = 10;
const LIMIT_MAX = 50;
const RATE_LIMIT_MIN = 5;
const RATE_LIMIT_HOUR = 30;
const RATE_WINDOW_MIN = 60_000;
const RATE_WINDOW_HOUR = 3_600_000;
const TEMP_BAN_DURATION = 60 * 60_000;     // 1 hour
const TEMP_BAN_THRESHOLD = 5;              // 5 scores in 60s triggers ban
const TEMP_BAN_WINDOW = 60_000;            // 60s sliding window
const DEDUPE_WINDOW = 5_000;               // same payload within 5s = rejected
const MAX_SCORE = 9_999_999;
const MAX_LEVEL = 20;
const MIN_TIME = 5;
const MAX_TIME = 7_200;
const MIN_NAME = 1;
const MAX_NAME = 16;
const MAX_LORE = 32;
const MAX_COUNTRY = 2;

const ipBucketsMin = new Map<string, number[]>();
const ipBucketsHour = new Map<string, number[]>();
const ipBanUntil = new Map<string, number>();
const ipRecentPosts = new Map<string, number[]>();
const recentPayloads = new Map<string, number>();   // hash -> first-seen-ts

const BANNED_WORDS = [
  'admin', 'root', 'system', 'null', 'undefined', 'trash', 'cheat',
  'hacker', 'fuck', 'shit', 'bitch', 'cunt', 'nigger', 'faggot',
  'porn', 'sex', 'piss', 'cum', 'dick', 'ass', 'tits', 'boob',
  'jew', 'nazi', 'hitler', 'rape', 'kkk',
];

const AVATARS_VALID = ['code', 'glitch', 'shard', 'circuit', 'kernel'];

// Region map from ISO 3166-1 alpha-2 → region code (used by the region filter)
const COUNTRY_REGION: Record<string, string> = {
  US: 'NA', CA: 'NA', MX: 'NA', GL: 'NA',
  BR: 'SA', AR: 'SA', CL: 'SA', CO: 'SA', PE: 'SA', UY: 'SA', VE: 'SA',
  GB: 'EU', FR: 'EU', DE: 'EU', ES: 'EU', IT: 'EU', NL: 'EU', PT: 'EU',
  PL: 'EU', SE: 'EU', NO: 'EU', FI: 'EU', DK: 'EU', IE: 'EU', BE: 'EU',
  AT: 'EU', CH: 'EU', CZ: 'EU', GR: 'EU', HU: 'EU', RO: 'EU', RU: 'EU',
  UA: 'EU', TR: 'EU',
  CN: 'AS', JP: 'AS', KR: 'AS', IN: 'AS', ID: 'AS', TH: 'AS', VN: 'AS',
  PH: 'AS', SG: 'AS', MY: 'AS', HK: 'AS', TW: 'AS', PK: 'AS', BD: 'AS',
  AE: 'AS', SA: 'AS', IL: 'AS',
  AU: 'OC', NZ: 'OC', FJ: 'OC',
  ZA: 'AF', EG: 'AF', NG: 'AF', KE: 'AF', MA: 'AF', ET: 'AF',
  AQ: 'AN',
};

function regionFor(country: string): string {
  return COUNTRY_REGION[country.toUpperCase()] || 'XX';
}

function isTempBanned(ip: string, now: number): number {
  const until = ipBanUntil.get(ip) || 0;
  if (until > now) return until;
  if (until) ipBanUntil.delete(ip);
  return 0;
}

function trackPost(ip: string, now: number): { banned: boolean; reason?: string } {
  const until = isTempBanned(ip, now);
  if (until) return { banned: true, reason: `temp_banned_until_${until}` };

  const list = (ipRecentPosts.get(ip) || []).filter(t => now - t < TEMP_BAN_WINDOW);
  list.push(now);
  ipRecentPosts.set(ip, list);
  if (list.length >= TEMP_BAN_THRESHOLD) {
    ipBanUntil.set(ip, now + TEMP_BAN_DURATION);
    return { banned: true, reason: `temp_banned_for_${TEMP_BAN_DURATION}ms` };
  }

  const minList = (ipBucketsMin.get(ip) || []).filter(t => now - t < RATE_WINDOW_MIN);
  if (minList.length >= RATE_LIMIT_MIN) return { banned: true, reason: 'rate_limited_per_minute' };
  minList.push(now);
  ipBucketsMin.set(ip, minList);

  const hourList = (ipBucketsHour.get(ip) || []).filter(t => now - t < RATE_WINDOW_HOUR);
  if (hourList.length >= RATE_LIMIT_HOUR) return { banned: true, reason: 'rate_limited_per_hour' };
  hourList.push(now);
  ipBucketsHour.set(ip, hourList);

  return { banned: false };
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
  return typeof a === 'string' && AVATARS_VALID.includes(a);
}

function isValidCountry(c: unknown): c is string {
  return typeof c === 'string' && c.length === 2;
}

function countryFromRequest(req: Request, body: any): string {
  const header = req.headers.get('cf-ipcountry');
  if (header && /^[A-Z]{2}$/.test(header)) return header;
  if (isValidCountry(body.country)) return (body.country as string).toUpperCase();
  return '??';
}

async function verifySign(env: Env, body: any, provided: string): Promise<boolean> {
  if (!env.SCORE_SECRET) return true;
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

function periodFilter(period: string, since?: number): string {
  if (period === 'daily') {
    const s = since ?? (Date.now() - 24 * 60 * 60 * 1000);
    return ` AND created_at >= ${s}`;
  }
  if (period === 'weekly') {
    const s = since ?? (Date.now() - 7 * 24 * 60 * 60 * 1000);
    return ` AND created_at >= ${s}`;
  }
  return '';
}

function payloadHash(name: string, score: number, level: number, time: number): string {
  return `${name}|${score}|${level}|${time}`;
}

function jsonResponse(obj: any, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status, headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
  });
}

export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  const url = new URL(ctx.request.url);

  // /api/profile endpoint
  if (url.pathname.endsWith('/profile') || url.searchParams.has('profile')) {
    const name = url.searchParams.get('name') || '';
    if (!isValidName(name)) return jsonResponse({ error: 'invalid_name' }, 400);
    try {
      const profile = await ctx.env.DB.prepare(
        'SELECT name, MAX(score) as best, COUNT(*) as runs, SUM(time) as totalTime, ' +
        'MIN(created_at) as firstSeen, MAX(created_at) as lastSeen ' +
        'FROM scores WHERE name = ?'
      ).bind(name).first();
      if (!profile || !(profile as any).runs) {
        return jsonResponse({ error: 'not_found' }, 404);
      }
      const history = await ctx.env.DB.prepare(
        'SELECT score, level, time, avatar, country, created_at as `when` FROM scores ' +
        'WHERE name = ? ORDER BY created_at DESC LIMIT 50'
      ).bind(name).all();
      return jsonResponse({
        name: (profile as any).name,
        best: (profile as any).best,
        runs: (profile as any).runs,
        totalTime: Math.round((profile as any).totalTime || 0),
        country: (history.results[0] as any)?.country || '??',
        firstSeen: (profile as any).firstSeen,
        lastSeen: (profile as any).lastSeen,
        history: history.results,
      });
    } catch (e: any) {
      return jsonResponse({ error: 'db_unavailable', message: e?.message || 'unknown' }, 503);
    }
  }

  // /api/scores endpoint
  const limit = Math.min(LIMIT_MAX, Math.max(1, parseInt(url.searchParams.get('limit') || `${LIMIT_DEFAULT}`, 10)));
  const period = (url.searchParams.get('period') || 'all').toLowerCase();
  const country = (url.searchParams.get('country') || '').toUpperCase();
  const region = (url.searchParams.get('region') || '').toUpperCase();
  const name = (url.searchParams.get('name') || '').trim();

  let where = '';
  if (country && country.length === 2 && country !== '??') {
    where += ` AND country = '${country.replace(/'/g, '')}'`;
  }
  if (region && /^(NA|SA|EU|AS|OC|AF|AN)$/.test(region)) {
    const countries = Object.entries(COUNTRY_REGION).filter(([, r]) => r === region).map(([c]) => `'${c}'`).join(',');
    if (countries) where += ` AND country IN (${countries})`;
  }
  if (name && isValidName(name)) {
    where += ` AND name = '${name.replace(/'/g, '')}'`;
  }
  where += periodFilter(period);

  try {
    const { results } = await ctx.env.DB.prepare(
      'SELECT name, score, level, time, hero_name as heroName, avatar, country, region, ' +
      'created_at as `when` FROM scores WHERE 1=1' + where +
      ' ORDER BY score DESC, created_at ASC LIMIT ?'
    ).bind(limit).all();
    return jsonResponse({ scores: rankEntries(results as any[]), period, country, region });
  } catch (e: any) {
    return jsonResponse({ error: 'db_unavailable', message: e?.message || 'unknown' }, 503);
  }
};

export const onRequestPost: PagesFunction<Env> = async (ctx) => {
  const ip = ctx.request.headers.get('cf-connecting-ip') || 'unknown';
  const now = Date.now();

  const ban = trackPost(ip, now);
  if (ban.banned) {
    return jsonResponse({ error: ban.reason || 'banned' }, 429);
  }

  let body: any;
  try {
    body = await ctx.request.json();
  } catch {
    return jsonResponse({ error: 'invalid_json' }, 400);
  }

  if (!isValidName(body.name)) return jsonResponse({ error: 'invalid_name' }, 400);
  const banned = containsBanned(body.name);
  if (banned) return jsonResponse({ error: 'banned_word', word: banned }, 400);
  if (!isValidScore(body.score)) return jsonResponse({ error: 'invalid_score' }, 400);
  if (!isValidLevel(body.level)) return jsonResponse({ error: 'invalid_level' }, 400);
  if (!isValidTime(body.time)) return jsonResponse({ error: 'invalid_time' }, 400);

  if (body.heroName !== undefined && (typeof body.heroName !== 'string' || body.heroName.length > MAX_LORE)) {
    return jsonResponse({ error: 'invalid_hero_name' }, 400);
  }
  if (typeof body.heroName === 'string') {
    const hb = containsBanned(body.heroName);
    if (hb) return jsonResponse({ error: 'banned_word_in_hero_name', word: hb }, 400);
  }

  const avatar = isValidAvatar(body.avatar) ? body.avatar : 'code';
  const country = countryFromRequest(ctx.request, body);
  const region = regionFor(country);

  if (body.sign !== undefined) {
    const ok = await verifySign(ctx.env, body, body.sign);
    if (!ok) return jsonResponse({ error: 'invalid_signature' }, 400);
  }

  // Dedup same payload within DEDUPE_WINDOW
  const hash = payloadHash(body.name, body.score, body.level, body.time);
  const seen = recentPayloads.get(hash) || 0;
  if (now - seen < DEDUPE_WINDOW) {
    return jsonResponse({ error: 'duplicate_payload' }, 409);
  }
  recentPayloads.set(hash, now);
  // GC stale entries
  for (const [k, t] of recentPayloads) if (now - t > DEDUPE_WINDOW * 2) recentPayloads.delete(k);

  try {
    const existing = await ctx.env.DB.prepare(
      'SELECT MAX(score) as m FROM scores WHERE name = ?'
    ).bind(body.name).first();
    const prev = (existing as any)?.m ?? 0;
    if (body.score <= prev && prev > 0) {
      return jsonResponse({ error: 'score_below_best', previous: prev }, 409);
    }

    await ctx.env.DB.prepare(
      'INSERT INTO scores (name, score, level, time, hero_name, avatar, country, region, sign) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(
      body.name, body.score, body.level, body.time,
      body.heroName || body.name, avatar, country, region, body.sign || '',
    ).run();

    const { results } = await ctx.env.DB.prepare(
      'SELECT name, score, level, time, hero_name as heroName, avatar, country, region, ' +
      'created_at as `when` FROM scores ORDER BY score DESC, created_at ASC LIMIT ?'
    ).bind(LIMIT_DEFAULT).all();
    return jsonResponse({ scores: rankEntries(results as any[]) }, 201);
  } catch (e: any) {
    return jsonResponse({ error: 'db_unavailable', message: e?.message || 'unknown' }, 503);
  }
};

// Handle CORS preflight
export const onRequestOptions: PagesFunction<Env> = async () => {
  return new Response(null, {
    status: 204,
    headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-allow-headers': 'content-type',
    },
  });
};
