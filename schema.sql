-- Cloudflare D1 schema for the NEONGRID global leaderboard.
--
-- One-time setup:
--   wrangler d1 create neongrid-leaderboard
--   wrangler d1 execute neongrid-leaderboard --file=schema.sql

CREATE TABLE IF NOT EXISTS scores (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL,
  score       INTEGER NOT NULL,
  level       INTEGER NOT NULL,
  time        REAL    NOT NULL,         -- seconds
  hero_name   TEXT    NOT NULL,
  created_at  INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
);

CREATE INDEX IF NOT EXISTS idx_scores_score_desc ON scores(score DESC);
CREATE INDEX IF NOT EXISTS idx_scores_created_desc ON scores(created_at DESC);
