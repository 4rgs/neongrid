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
  avatar      TEXT    NOT NULL DEFAULT 'code',
  country     TEXT    NOT NULL DEFAULT '??',
  region      TEXT    NOT NULL DEFAULT 'XX',  -- NA / SA / EU / AS / OC / AF / AN / XX
  sign        TEXT    NOT NULL DEFAULT '',        -- HMAC signature
  replay_id   TEXT    DEFAULT NULL,              -- optional reference to a replay blob
  created_at  INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
);

CREATE INDEX IF NOT EXISTS idx_scores_score_desc    ON scores(score DESC, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_scores_created_desc  ON scores(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_scores_level_score   ON scores(level DESC, score DESC);
CREATE INDEX IF NOT EXISTS idx_scores_country       ON scores(country, score DESC);
CREATE INDEX IF NOT EXISTS idx_scores_region        ON scores(region, score DESC);
CREATE INDEX IF NOT EXISTS idx_scores_name          ON scores(name, created_at DESC);

CREATE TABLE IF NOT EXISTS replays (
  id          TEXT    PRIMARY KEY,
  name        TEXT    NOT NULL,
  level       INTEGER NOT NULL,
  score       INTEGER NOT NULL,
  data        TEXT    NOT NULL,        -- JSON-compressed input log
  created_at  INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
);

CREATE INDEX IF NOT EXISTS idx_replays_name ON replays(name, created_at DESC);
