-- 2026 World Cup Live Ladder schema. Every statement is idempotent so it can
-- run safely on every boot without ever destroying existing data.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS players (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS teams (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL UNIQUE,
  player_id  UUID REFERENCES players(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS matches (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  api_fixture_id TEXT NOT NULL UNIQUE,
  home_team      TEXT NOT NULL,
  away_team      TEXT NOT NULL,
  home_goals     INTEGER,
  away_goals     INTEGER,
  home_pen       INTEGER,
  away_pen       INTEGER,
  winner_team    TEXT,
  status         TEXT,
  round          TEXT,
  match_date     TIMESTAMPTZ,
  raw_json       JSONB,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_matches_home ON matches (lower(home_team));
CREATE INDEX IF NOT EXISTS idx_matches_away ON matches (lower(away_team));
CREATE INDEX IF NOT EXISTS idx_matches_date ON matches (match_date DESC);

CREATE TABLE IF NOT EXISTS sync_logs (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at        TIMESTAMPTZ,
  status             TEXT NOT NULL DEFAULT 'running',
  trigger            TEXT,
  message            TEXT,
  fixtures_processed INTEGER NOT NULL DEFAULT 0
);

-- Golden Boot: goalscorers per fixture (scraped from match summaries), plus a
-- marker of which fixtures we've already scraped so syncs stay incremental.
CREATE TABLE IF NOT EXISTS scorers (
  fixture_id   TEXT NOT NULL,
  athlete_id   TEXT NOT NULL,
  athlete_name TEXT NOT NULL,
  team         TEXT NOT NULL,
  goals        INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (fixture_id, athlete_id)
);
CREATE INDEX IF NOT EXISTS idx_scorers_team ON scorers (lower(team));

CREATE TABLE IF NOT EXISTS scraped_fixtures (
  fixture_id TEXT PRIMARY KEY,
  scraped_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
