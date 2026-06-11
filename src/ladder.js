'use strict';

const { query } = require('./db');
const { POINTS, isCompleted, resultFor } = require('./scoring');

// Stats are ALWAYS derived from the matches table — never stored — so the
// ladder can never drift out of sync with results, and "reset results" is
// simply deleting matches.

function emptyStats() {
  return { played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, gd: 0, points: 0 };
}

function applyResult(stats, res, gf, ga) {
  stats.played += 1;
  stats.gf += gf;
  stats.ga += ga;
  if (res === 'W') stats.won += 1;
  else if (res === 'D') stats.drawn += 1;
  else stats.lost += 1;
  stats.points += POINTS[res];
  stats.gd = stats.gf - stats.ga;
}

// Percentage = GF / GA * 100 (one decimal). null when no goals conceded — the
// frontend renders that as ∞. Never used for sorting.
function pct(gf, ga) {
  if (ga === 0) return null;
  return Math.round((gf / ga) * 1000) / 10;
}

// Sort: points, then goal difference, then goals for, then name (A→Z).
function teamSort(a, b) {
  return b.points - a.points || b.gd - a.gd || b.gf - a.gf || a.team.localeCompare(b.team);
}
function playerSort(a, b) {
  return b.points - a.points || b.gd - a.gd || b.gf - a.gf || a.player.localeCompare(b.player);
}

async function computeLadder() {
  // Owned teams + their player.
  const teamsRes = await query(
    `SELECT t.name AS team, p.name AS owner
       FROM teams t
       JOIN players p ON p.id = t.player_id
      ORDER BY t.name`
  );
  const teams = teamsRes.rows;
  const ownedKeys = new Set(teams.map((t) => t.team.toLowerCase()));

  // All completed matches (filtered to drafted teams in JS).
  const matchesRes = await query(
    `SELECT id, home_team, away_team, home_goals, away_goals,
            home_pen, away_pen, winner_team, status, round, match_date
       FROM matches
      ORDER BY match_date DESC NULLS LAST, updated_at DESC`
  );
  const allMatches = matchesRes.rows;

  const statsByTeam = new Map();
  for (const t of teams) {
    statsByTeam.set(t.team.toLowerCase(), { team: t.team, owner: t.owner, ...emptyStats() });
  }

  for (const m of allMatches) {
    if (!isCompleted(m.status)) continue;
    if (m.home_goals == null || m.away_goals == null) continue;

    const homeKey = m.home_team.toLowerCase();
    const awayKey = m.away_team.toLowerCase();
    const homeOwned = ownedKeys.has(homeKey);
    const awayOwned = ownedKeys.has(awayKey);
    if (!homeOwned && !awayOwned) continue;

    const res = resultFor({
      homeTeam: m.home_team,
      awayTeam: m.away_team,
      homeGoals: m.home_goals,
      awayGoals: m.away_goals,
      winnerTeam: m.winner_team,
    });

    if (homeOwned) applyResult(statsByTeam.get(homeKey), res.home, m.home_goals, m.away_goals);
    if (awayOwned) applyResult(statsByTeam.get(awayKey), res.away, m.away_goals, m.home_goals);
  }

  const teamLadder = [...statsByTeam.values()]
    .map((s) => ({ ...s, pct: pct(s.gf, s.ga) }))
    .sort(teamSort)
    .map((s, i) => ({ rank: i + 1, ...s }));

  // Player ladder = combined total of their teams.
  const byPlayer = new Map();
  for (const s of teamLadder) {
    if (!byPlayer.has(s.owner)) {
      byPlayer.set(s.owner, { player: s.owner, teams: [], ...emptyStats() });
    }
    const p = byPlayer.get(s.owner);
    p.teams.push(s.team);
    p.played += s.played;
    p.won += s.won;
    p.drawn += s.drawn;
    p.lost += s.lost;
    p.gf += s.gf;
    p.ga += s.ga;
    p.points += s.points;
    p.gd = p.gf - p.ga;
  }
  const playerLadder = [...byPlayer.values()]
    .map((p) => ({ ...p, teams: p.teams.slice().sort(), pct: pct(p.gf, p.ga) }))
    .sort(playerSort)
    .map((p, i) => ({ rank: i + 1, ...p }));

  // Recent results involving a drafted team (newest first).
  const recentMatches = allMatches
    .filter((m) => isCompleted(m.status) && m.home_goals != null && m.away_goals != null)
    .filter((m) => ownedKeys.has(m.home_team.toLowerCase()) || ownedKeys.has(m.away_team.toLowerCase()))
    .slice(0, 15)
    .map((m) => ({
      id: m.id,
      date: m.match_date,
      round: m.round,
      homeTeam: m.home_team,
      awayTeam: m.away_team,
      homeGoals: m.home_goals,
      awayGoals: m.away_goals,
      status: m.status,
      winner: m.winner_team,
      penalties:
        m.home_pen != null && m.away_pen != null ? { home: m.home_pen, away: m.away_pen } : null,
      involved: [m.home_team, m.away_team].filter((n) => ownedKeys.has(n.toLowerCase())),
    }));

  return { teamLadder, playerLadder, recentMatches };
}

module.exports = { computeLadder };
