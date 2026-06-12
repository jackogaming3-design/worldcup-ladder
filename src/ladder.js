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

const WCHB_LIMIT = 6; // how many undrafted teams to show in "What Could Have Been"

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
  const ownerByKey = new Map(teams.map((t) => [t.team.toLowerCase(), t.owner]));

  // All matches (now includes upcoming/scheduled fixtures, not just finished).
  const matchesRes = await query(
    `SELECT id, home_team, away_team, home_goals, away_goals,
            home_pen, away_pen, winner_team, status, round, match_date
       FROM matches
      ORDER BY match_date DESC NULLS LAST, updated_at DESC`
  );
  const allMatches = matchesRes.rows;

  // Accumulate stats for EVERY team that has played a completed match.
  const allStats = new Map(); // lower(name) -> { team, owner?, ...stats }
  // Seed drafted teams first so they always appear (even at 0) and carry owner.
  for (const t of teams) {
    allStats.set(t.team.toLowerCase(), { team: t.team, owner: t.owner, ...emptyStats() });
  }
  function bump(displayName, res, gf, ga) {
    const key = displayName.toLowerCase();
    if (!allStats.has(key)) allStats.set(key, { team: displayName, ...emptyStats() });
    applyResult(allStats.get(key), res, gf, ga);
  }

  for (const m of allMatches) {
    if (!isCompleted(m.status)) continue;
    if (m.home_goals == null || m.away_goals == null) continue;
    const res = resultFor({
      homeTeam: m.home_team,
      awayTeam: m.away_team,
      homeGoals: m.home_goals,
      awayGoals: m.away_goals,
      winnerTeam: m.winner_team,
    });
    bump(m.home_team, res.home, m.home_goals, m.away_goals);
    bump(m.away_team, res.away, m.away_goals, m.home_goals);
  }

  // Team ladder = the eight drafted teams.
  const teamLadder = [...allStats.values()]
    .filter((s) => ownedKeys.has(s.team.toLowerCase()))
    .map((s) => ({ ...s, pct: pct(s.gf, s.ga) }))
    .sort(teamSort)
    .map((s, i) => ({ rank: i + 1, ...s }));

  // Player ladder = combined total of each player's teams.
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

  // "What Could Have Been" = the undrafted teams doing best, top N.
  const whatCouldHaveBeen = [...allStats.values()]
    .filter((s) => !ownedKeys.has(s.team.toLowerCase()) && s.played > 0)
    .sort(teamSort)
    .slice(0, WCHB_LIMIT)
    .map((s, i) => ({
      rank: i + 1,
      team: s.team,
      played: s.played, won: s.won, drawn: s.drawn, lost: s.lost,
      gf: s.gf, ga: s.ga, gd: s.gd, points: s.points,
    }));

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

  // Upcoming highlight = the next fixture between two drafted teams.
  const now = Date.now();
  const draftedClashes = allMatches
    .filter((m) => !isCompleted(m.status))
    .filter((m) => m.match_date)
    .filter((m) => ownedKeys.has(m.home_team.toLowerCase()) && ownedKeys.has(m.away_team.toLowerCase()))
    .sort((a, b) => new Date(a.match_date) - new Date(b.match_date));
  // Prefer the soonest one still ahead (allow a few hours of slack for live games).
  const pick =
    draftedClashes.find((m) => new Date(m.match_date).getTime() >= now - 3 * 3600 * 1000) ||
    draftedClashes[0] ||
    null;
  const upcomingHighlight = pick
    ? {
        homeTeam: pick.home_team,
        awayTeam: pick.away_team,
        homeOwner: ownerByKey.get(pick.home_team.toLowerCase()) || null,
        awayOwner: ownerByKey.get(pick.away_team.toLowerCase()) || null,
        date: pick.match_date,
        round: pick.round,
        status: pick.status,
      }
    : null;

  return { teamLadder, playerLadder, recentMatches, whatCouldHaveBeen, upcomingHighlight };
}

module.exports = { computeLadder };
