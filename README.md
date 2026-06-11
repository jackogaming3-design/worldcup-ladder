# 🏆 2026 World Cup Live Ladder

A public live-ladder web app for a completed 4-player World Cup snake draft. Each
player owns two teams; the app pulls **real 2026 World Cup results** from
API-Football, recalculates the ladder, and shows it off — automatically, every
morning, with no manual updates.

> **The draft is locked.** This is a *live ladder* app with admin-editable
> ownership — not a draft tool.

| Player | Team 1 | Team 2 |
| ------ | ------ | ------ |
| Jacko | 🇫🇷 France | 🇩🇪 Germany |
| CAVS | 🇪🇸 Spain | 🇳🇴 Norway |
| Bayley | 🏴 England | 🇦🇷 Argentina |
| Bobby | 🇵🇹 Portugal | 🇧🇷 Brazil |

---

## What it does

- **Player leaderboard** — big cards ranking the four players by combined points.
- **Team ladder** — all eight drafted teams, ranked, each showing its owner.
- **Player breakdown** — every player's two teams with full P/W/D/L/GF/GA/GD/Pts.
- **Recent results** — completed matches involving a drafted team.
- **Automatic morning sync** + a manual **Sync Latest Results** button.
- **Commissioner page** — log in to edit team ownership, sync, or reset results.
- **Redeploy-safe** — picks and scores live in Postgres and are never wiped on deploy.

## Scoring

| Outcome | Points |
| ------- | -----: |
| Win | 3 |
| Draw | 1 |
| Loss | 0 |

- **Goals**: GF / GA are taken from the score after normal/extra time. GD = GF − GA.
- **Penalty shootouts**: the team that **advances wins (3 / 0)**. API-Football's
  winner flags already account for the shootout, so a knockout that's level after
  extra time is scored as a win for whoever went through. The shootout score is
  shown under the result ("won on penalties").
- **Sorting**: Points → Goal difference → Goals for → Name (A→Z). Percentage
  (GF/GA×100) is shown but never used for sorting; with 0 conceded it shows `∞`.

---

## Architecture

One Node/Express app serves both the JSON API and the static frontend. Postgres
stores players, teams, matches, and sync logs. **Team and player stats are always
derived from the `matches` table**, so the ladder can't drift and "reset results"
is just deleting matches.

```
src/
  server.js        boot: migrate + seed, then listen
  app.js           express app (routes + static)
  config.js        env config
  db.js            pg pool + transaction helper
  schema.sql       idempotent DDL
  migrate.js       runs schema.sql
  seed.js          non-destructive seed of the draft
  scoring.js       win/draw/loss + penalty rule
  ladder.js        derive team & player ladders from matches
  sync.js          fetch API-Football fixtures + upsert
  auth.js          signed-cookie admin session + CRON_SECRET
  routes/
    public.js      GET /api/ladder | /api/players | /api/matches
    admin.js       POST /api/admin/login | sync-results | assign-teams | reset-results
public/            vanilla JS frontend (no build step)
scripts/
  sync-cli.js      `npm run sync` — used by the scheduled job
  migrate-cli.js   `npm run migrate`
render.yaml        Render Blueprint (web + Postgres)
.github/workflows/sync.yml   free daily sync via GitHub Actions
```

---

## Deploy (Render + GitHub) — the no-fuss path

### 1. Get an API-Football key

Sign up at **[api-football.com](https://www.api-football.com)** (the free plan is
enough for one daily sync). Copy your API key. The 2026 World Cup is
`league = 1`, `season = 2026`.

### 2. Push this repo to GitHub

```bash
git init && git add -A && git commit -m "2026 World Cup Live Ladder"
gh repo create worldcup-ladder --public --source=. --push   # or use github.com + git push
```

### 3. Create the app on Render

1. In [Render](https://render.com): **New → Blueprint**, connect the repo.
2. Render reads `render.yaml` and creates a **web service** + **Postgres database**.
3. When prompted, set the two secrets:
   - `API_FOOTBALL_KEY` — your key from step 1.
   - `ADMIN_PASSWORD` — a password you choose for the commissioner login.
   - (`CRON_SECRET` and `SESSION_SECRET` are generated automatically.)
4. **Apply.** On first boot the app creates the tables and seeds the draft.

Your ladder is now live at `https://<your-service>.onrender.com` 🎉

### 4. Turn on the daily sync (free)

The repo ships a GitHub Action that pings the sync endpoint every morning. In your
GitHub repo → **Settings → Secrets and variables → Actions**, add:

| Secret | Value |
| ------ | ----- |
| `APP_URL` | your Render URL, e.g. `https://worldcup-ladder.onrender.com` |
| `CRON_SECRET` | the same value Render generated (Dashboard → service → Environment) |

It runs at **22:30 UTC = 8:00am Adelaide** (`.github/workflows/sync.yml`). You can
also trigger it any time from the **Actions** tab, or from the in-app
**Sync Latest Results** button.

---

## Environment variables

| Variable | Required | Notes |
| -------- | :------: | ----- |
| `DATABASE_URL` | ✅ | Postgres connection string. Auto-injected by `render.yaml`. |
| `API_FOOTBALL_KEY` | ✅ | Your API-Football key. Server-side only — never exposed to the browser. |
| `ADMIN_PASSWORD` | ✅ | Commissioner login password. |
| `CRON_SECRET` | ✅ | Bearer token the scheduled sync uses. Auto-generated on Render. |
| `SESSION_SECRET` | ➖ | Signs the admin cookie. Falls back to `CRON_SECRET`/`ADMIN_PASSWORD`. |
| `API_FOOTBALL_BASE_URL` | ➖ | Default `https://v3.football.api-sports.io`. |
| `API_FOOTBALL_KEY_HEADER` | ➖ | `x-apisports-key` (direct) or `x-rapidapi-key` (RapidAPI). |
| `WORLD_CUP_LEAGUE_ID` | ➖ | Default `1`. |
| `WORLD_CUP_SEASON` | ➖ | Default `2026`. |
| `PORT` | ➖ | Default `3000`. Render sets this automatically. |
| `PGSSL` | ➖ | `true`/`false` to force DB SSL. Auto-detected otherwise. |

---

## Commissioner controls

Visit `/admin` and log in with `ADMIN_PASSWORD`. You can:

- **Edit assignments** — change a team's country or its owner. Match history is
  kept and the ladder recalculates instantly. Picks are **never** wiped by a sync
  or a redeploy.
- **Sync Latest Results** — pull the newest results on demand.
- **Reset results** — clear all stored matches (players/ownership untouched).
  Requires typing `RESET` to confirm.

---

## API reference

**Public**

- `GET /api/ladder` — player ladder, team ladder, recent matches, last-updated time.
- `GET /api/players` — all players and their teams.
- `GET /api/matches` — completed matches involving a drafted team.

**Admin** (cookie session, or `Authorization: Bearer <CRON_SECRET>`)

- `POST /api/admin/login` `{ password }`
- `POST /api/admin/sync-results`
- `POST /api/admin/assign-teams` `{ assignments: [{ player, teams: [a, b] }] }`
- `POST /api/admin/reset-results`

---

## Alternatives & notes

- **Supabase instead of Render Postgres**: create a Supabase project, copy its
  connection string into the `DATABASE_URL` env var on the web service, and delete
  the `databases:` block + the `fromDatabase` wiring from `render.yaml`. Supabase's
  free tier doesn't expire like Render's does.
- **Render Cron Job (paid) instead of GitHub Actions**: add this to `render.yaml`
  and give it the same env vars as the web service — it talks straight to the DB:

  ```yaml
  - type: cron
    name: worldcup-ladder-sync
    runtime: node
    schedule: "30 22 * * *"
    buildCommand: npm install
    startCommand: node scripts/sync-cli.js
    envVars:
      - key: DATABASE_URL
        fromDatabase: { name: worldcup-ladder-db, property: connectionString }
      - key: API_FOOTBALL_KEY
        sync: false
      # ...plus the same API_FOOTBALL_* vars as the web service
  ```

- **Free-tier behaviour**: Render's free web service sleeps after inactivity, so
  the first visit after a quiet spell may take ~30s to wake. Render's free Postgres
  expires after about 30 days — upgrade the database or switch to Supabase to keep
  data long-term.
- **Team names** must match API-Football's country names (they do for all eight
  drafted teams). Matching is case-insensitive.

---

## Local development (optional)

Needs Node 18+ and a Postgres database (not installed in this build).

```bash
cp .env.example .env        # then fill in DATABASE_URL, API_FOOTBALL_KEY, ADMIN_PASSWORD
npm install
npm run migrate             # create tables + seed the draft
npm start                   # http://localhost:3000
npm run sync                # pull results once from API-Football
```

---

Built for the 2026 World Cup Draft · *Better Support SA · NeueStudio · Taylor*
