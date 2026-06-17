/**
 * /api/replay — Cloudflare Pages Function.
 *
 *  POST /api/replay
 *    body: full Replay object { meta, frames }
 *    → 201 { id: string }   — stored in D1 replays table
 *
 *  GET /api/replay?id=...
 *    → 200 { meta, frames } (or 404)
 *
 *  GET /api/replay?name=TRON&limit=20
 *    → 200 [{ id, level, score, when }]
 *
 *  Note: this endpoint is best-effort and intended as a "nice to
 *  have" feature. Replays are large (10s of KB per minute) and we
 *  don't validate their content for anti-cheat — the score is still
 *  the source of truth.
 */

interface Env {
  DB: D1Database;
}

function genId(): string {
  // Short random ID, ~9 chars, URL-safe
  const buf = new Uint8Array(8);
  crypto.getRandomValues(buf);
  return Array.from(buf).map((b) => b.toString(36).padStart(2, '0')).join('').slice(0, 12);
}

function isValidMeta(m: any): boolean {
  return m && typeof m === 'object'
    && typeof m.name === 'string' && m.name.length >= 1 && m.name.length <= 16
    && Number.isInteger(m.level) && m.level >= 1 && m.level <= 20
    && Number.isInteger(m.score) && m.score >= 0 && m.score <= 9_999_999;
}

function isValidFrames(f: any): boolean {
  return Array.isArray(f) && f.length <= 60_000 && f.every((fr) =>
    fr && typeof fr === 'object'
    && typeof fr.dt === 'number' && fr.dt >= 0 && fr.dt <= 0.5
    && Array.isArray(fr.keys)
    && fr.mouse && typeof fr.mouse.dx === 'number'
  );
}

function jsonResponse(obj: any, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status, headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
  });
}

export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  const url = new URL(ctx.request.url);
  const id = url.searchParams.get('id');
  const name = url.searchParams.get('name');

  try {
    if (id) {
      const row = await ctx.env.DB.prepare(
        'SELECT id, name, level, score, data, created_at as `when` FROM replays WHERE id = ?'
      ).bind(id).first();
      if (!row) return jsonResponse({ error: 'not_found' }, 404);
      const data = JSON.parse((row as any).data);
      return jsonResponse(data);
    }
    if (name) {
      const { results } = await ctx.env.DB.prepare(
        'SELECT id, level, score, created_at as `when` FROM replays WHERE name = ? ORDER BY created_at DESC LIMIT ?'
      ).bind(name, Math.min(50, Math.max(1, parseInt(url.searchParams.get('limit') || '20', 10)))).all();
      return jsonResponse({ replays: results });
    }
    return jsonResponse({ error: 'specify_id_or_name' }, 400);
  } catch (e: any) {
    return jsonResponse({ error: 'db_unavailable', message: e?.message || 'unknown' }, 503);
  }
};

export const onRequestPost: PagesFunction<Env> = async (ctx) => {
  let body: any;
  try { body = await ctx.request.json(); } catch {
    return jsonResponse({ error: 'invalid_json' }, 400);
  }
  if (!isValidMeta(body.meta)) return jsonResponse({ error: 'invalid_meta' }, 400);
  if (!isValidFrames(body.frames)) return jsonResponse({ error: 'invalid_frames' }, 400);

  const id = genId();
  try {
    await ctx.env.DB.prepare(
      'INSERT INTO replays (id, name, level, score, data) VALUES (?, ?, ?, ?, ?)'
    ).bind(id, body.meta.name, body.meta.level, body.meta.score, JSON.stringify(body)).run();
    return jsonResponse({ id }, 201);
  } catch (e: any) {
    return jsonResponse({ error: 'db_unavailable', message: e?.message || 'unknown' }, 503);
  }
};