# 🏆 2026 World Cup Live Ladder

A public live-ladder web app for a completed 4-player World Cup snake draft. Each
player owns two teams; the app pulls **real 2026 World Cup results**, recalculates
the ladder, and shows it off — automatically, every morning, with no manual updates.

> **The draft is locked.** This is a *live ladder* app with admin-editable
> ownership — not a draft tool.

| Player | Team 1 | Team 2 |
| ------ | ------ | ------ |
| Jacko | 🇫🇷 France | 🇩🇪 Germany |
| CAVS | 🇪🇸 Spain | 🇳🇴 Norway |
| Bayley | 🏴 England | 🇦🇷 Argentina |
| Bobby | 🇵🇹 Portugal | 🇧🇷 Brazil |

## Data source: ESPN (free, no key)

Results come from **ESPN's free public World Cup feed** — no API key, no signup,
no cost. It already carries the full 2026 tournament with all eight drafted teams.
There's nothing to configure for data.

> It's an unofficial feed (no SLA), which is fine for a friends' ladder. If ESPN
> ever changes it, only `src/sync.js` needs updating. The original API-Football
> route is impractical here because its free plan blocks the 2026 season.

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

- **Goals**: GF / GA come from the score after normal/extra time. GD = GF − GA.
- **Penalty shootouts**: the team that **advances wins (3 / 0)**. ESPN's winner
  flag already reflects the shootout, and the shootout score is shown under the
  result ("won on penalties").
- **Sorting**: Points → Goal difference → Goals for → Name (A→Z).

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
  sync.js          fetch ESPN World Cup fixtures + upsert
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

## Deploy (Render + GitHub)

### 1. Push this repo to GitHub
```bash
git push -u origin main
```

### 2. Create the app on Render
1. In [Render](https://render.com): **New → Blueprint**, connect the repo.
2. Render reads `render.yaml` and creates a **web service** + **Postgres database**.
3. When prompted, set the one secret:
   - `ADMIN_PASSWORD` — a password you choose for the commissioner login.
   - (`CRON_SECRET` and `SESSION_SECRET` are generated automatically. There is **no
     data API key** — results come from ESPN's free feed.)
4. **Apply.** On first boot the app creates the tables and seeds the draft.

Your ladder is now live at `https://<your-service>.onrender.com` 🎉

### 3. Turn on the daily sync (free)
The repo ships a GitHub Action that pings the sync endpoint every morning. In your
GitHub repo → **Settings → Secrets and variables → Actions**, add:

| Secret | Value |
| ------ | ----- |
| `APP_URL` | your Render URL, e.g. `https://worldcup-ladder.onrender.com` |
| `CRON_SECRET` | the same value Render generated (Dashboard → service → Environment) |

It runs at **22:30 UTC = 8:00am Adelaide** (`.github/workflows/sync.yml`). You can
also trigger it any time from the **Actions** tab, or the in-app
**Sync Latest Results** button.

---

## Environment variables

| Variable | Required | Notes |
| -------- | :------: | ----- |
| `DATABASE_URL` | ✅ | Postgres connection string. Auto-injected by `render.yaml`. |
| `ADMIN_PASSWORD` | ✅ | Commissioner login password. |
| `CRON_SECRET` | ✅ | Bearer token the scheduled sync uses. Auto-generated on Render. |
| `SESSION_SECRET` | ➖ | Signs the admin cookie. Falls back to `CRON_SECRET`/`ADMIN_PASSWORD`. |
| `WORLD_CUP_SEASON` | ➖ | Default `2026`. |
| `WC_WINDOW_START` / `WC_WINDOW_END` | ➖ | `YYYYMMDD` window scanned each sync. Defaults to 1 Jun – 1 Aug of the season. |
| `ESPN_BASE_URL` | ➖ | Override the ESPN feed base URL. |
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
  connection string into `DATABASE_URL` on the web service, and delete the
  `databases:` block + the `fromDatabase` wiring from `render.yaml`. Supabase's
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
      - key: WORLD_CUP_SEASON
        value: "2026"
  ```

- **Free-tier behaviour**: Render's free web service sleeps after inactivity, so
  the first visit after a quiet spell may take ~30s to wake. Render's free Postgres
  expires after about 30 days — upgrade the database or switch to Supabase to keep
  data long-term.

---

## Local development (optional)

Needs Node 18+ and a Postgres database (not installed in this build).

```bash
cp .env.example .env        # then fill in DATABASE_URL and ADMIN_PASSWORD
npm install
npm run migrate             # create tables + seed the draft
npm start                   # http://localhost:3000
npm run sync                # pull results once from the ESPN feed
```

---

Built for the 2026 World Cup Draft · *Better Support SA · NeueStudio · Taylor*
