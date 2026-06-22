'use strict';

const { query } = require('./db');
const { config } = require('./config');
const { predict, titleRace } = require('./predict');
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

const AWARD_TIERS = ['gold', 'silver', 'bronze'];

// Build a tiered award from per-athlete stat rows ({athlete_id, name, team,
// stat, photo_url}). Tiers are the top-3 distinct stat counts; EVERY athlete at
// a count shares that tier's bonus, so ties all count. Returns { tiers, bonusByOwner }.
function buildAward(rows, bonuses, ownerByKey) {
  const sorted = rows
    .slice()
    .sort((a, b) => b.stat - a.stat || String(a.name).localeCompare(String(b.name)));
  const counts = [...new Set(sorted.map((r) => r.stat))].sort((a, b) => b - a).slice(0, 3);
  const tierOf = new Map(counts.map((c, i) => [c, i]));
  const tiers = counts.map((c, i) => ({
    place: i + 1, medal: AWARD_TIERS[i], count: c, bonus: bonuses[i] || 0, players: [],
  }));
  for (const r of sorted) {
    const ti = tierOf.get(r.stat);
    if (ti === undefined) continue; // outside the top-3 counts
    const owner = ownerByKey.get(String(r.team).toLowerCase()) || null;
    tiers[ti].players.push({
      athleteId: r.athlete_id, name: r.name, team: r.team, owner,
      count: r.stat, photoUrl: r.photo_url || null,
    });
  }
  // An owner earns each tier's bonus ONCE if they have at least one player there
  // — not per player. So a player on 1st plus a player on 3rd is 5 + 1, however
  // many players they have tied at each spot.
  const bonusByOwner = new Map();
  tiers.forEach((tier, ti) => {
    const b = bonuses[ti] || 0;
    if (!b) return;
    const owners = new Set(tier.players.map((p) => p.owner).filter(Boolean));
    for (const owner of owners) bonusByOwner.set(owner, (bonusByOwner.get(owner) || 0) + b);
  });
  return { tiers, bonusByOwner };
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

  // Awards among the drafted teams' players: Safe Pulse Golden Boot (goals,
  // 5/2/1) and the Bailey Playmaker (assists, 3/2/1). Each award's tiers are the
  // top-3 distinct counts, and EVERY player at a count shares that tier's bonus —
  // so a third player tied on 2 goals still scores, and everyone on the next
  // count still gets third place. Both bonuses are added to the owner below.
  const ownedArr = [...ownedKeys];
  const scRes = await query(
    `SELECT s.athlete_id, MAX(s.athlete_name) AS name, MAX(s.team) AS team,
            SUM(s.goals)::int AS stat, MAX(ap.photo_url) AS photo_url
       FROM scorers s
       LEFT JOIN athlete_photos ap ON ap.athlete_id = s.athlete_id
      WHERE lower(s.team) = ANY($1::text[])
      GROUP BY s.athlete_id
      HAVING SUM(s.goals) > 0`,
    [ownedArr]
  );
  const asRes = await query(
    `SELECT a.athlete_id, MAX(a.athlete_name) AS name, MAX(a.team) AS team,
            SUM(a.assists)::int AS stat, MAX(ap.photo_url) AS photo_url
       FROM assists a
       LEFT JOIN athlete_photos ap ON ap.athlete_id = a.athlete_id
      WHERE lower(a.team) = ANY($1::text[])
      GROUP BY a.athlete_id
      HAVING SUM(a.assists) > 0`,
    [ownedArr]
  );
  const goalsAward = buildAward(scRes.rows, [5, 2, 1], ownerByKey);
  const assistsAward = buildAward(asRes.rows, [3, 2, 1], ownerByKey);
  const goldenBoot = { tiers: goalsAward.tiers };
  const playmaker = { tiers: assistsAward.tiers };
  const bonusByOwner = new Map();
  for (const m of [goalsAward.bonusByOwner, assistsAward.bonusByOwner]) {
    for (const [owner, v] of m) bonusByOwner.set(owner, (bonusByOwner.get(owner) || 0) + v);
  }

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
    .map((p) => {
      const awardBonus = bonusByOwner.get(p.player) || 0;
      return {
        ...p,
        teams: p.teams.slice().sort(),
        pct: pct(p.gf, p.ga),
        teamPoints: p.points, // points from teams only
        awardBonus, // Golden Boot + Playmaker bonus added on top
        points: p.points + awardBonus, // total used for ranking
      };
    })
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

  // Each player's next upcoming match (soonest fixture involving either of
  // their two teams) — so everyone can see who's got who, and when.
  const nextByPlayer = new Map();
  const cutoff = now - 3 * 3600 * 1000; // a few hours of slack for live games
  for (const m of allMatches) {
    if (isCompleted(m.status)) continue;
    if (!m.match_date) continue;
    const t = new Date(m.match_date).getTime();
    if (!Number.isFinite(t) || t < cutoff) continue;
    const homeOwner = ownerByKey.get(m.home_team.toLowerCase());
    const awayOwner = ownerByKey.get(m.away_team.toLowerCase());
    const consider = (player, team, opponent, opponentOwner) => {
      const cur = nextByPlayer.get(player);
      if (!cur || t < cur._t) {
        nextByPlayer.set(player, {
          team, opponent, opponentOwner: opponentOwner || null,
          date: m.match_date, round: m.round, status: m.status, _t: t,
        });
      }
    };
    if (homeOwner) consider(homeOwner, m.home_team, m.away_team, awayOwner);
    if (awayOwner) consider(awayOwner, m.away_team, m.home_team, homeOwner);
  }
  const playerNextMatches = playerLadder
    .map((p) => {
      const n = nextByPlayer.get(p.player);
      if (!n) return { player: p.player, match: null, _t: Infinity };
      const { _t, ...match } = n;
      return { player: p.player, match, _t };
    })
    .sort((a, b) => a._t - b._t) // soonest match first
    .map(({ _t, ...row }) => row);

  // --- Socceroos Spotlight (sponsored by NeueStudio) ---
  const spotlightKey = config.spotlightTeam.toLowerCase();
  const auMatches = allMatches.filter(
    (m) => m.home_team.toLowerCase() === spotlightKey || m.away_team.toLowerCase() === spotlightKey
  );
  const auRec = emptyStats();
  const auRecent = [];
  for (const m of auMatches) {
    if (!isCompleted(m.status) || m.home_goals == null || m.away_goals == null) continue;
    const isHome = m.home_team.toLowerCase() === spotlightKey;
    const tg = isHome ? m.home_goals : m.away_goals;
    const og = isHome ? m.away_goals : m.home_goals;
    const res = resultFor({
      homeTeam: m.home_team, awayTeam: m.away_team,
      homeGoals: m.home_goals, awayGoals: m.away_goals, winnerTeam: m.winner_team,
    });
    const r = isHome ? res.home : res.away;
    applyResult(auRec, r, tg, og);
    auRecent.push({
      date: m.match_date, round: m.round,
      opponent: isHome ? m.away_team : m.home_team,
      teamGoals: tg, oppGoals: og, result: r, status: m.status,
    });
  }
  const auScorersRes = await query(
    `SELECT s.athlete_id, MAX(s.athlete_name) AS name, SUM(s.goals)::int AS goals,
            MAX(ap.photo_url) AS photo_url
       FROM scorers s
       LEFT JOIN athlete_photos ap ON ap.athlete_id = s.athlete_id
      WHERE lower(s.team) = $1
      GROUP BY s.athlete_id
      ORDER BY SUM(s.goals) DESC, MAX(s.athlete_name) ASC
      LIMIT 6`,
    [spotlightKey]
  );
  const auNext = auMatches
    .filter((m) => !isCompleted(m.status) && m.match_date && new Date(m.match_date).getTime() >= now - 3 * 3600 * 1000)
    .sort((a, b) => new Date(a.match_date) - new Date(b.match_date))[0];
  // Crystal-ball odds: simulate the spotlight team's group from real
  // results + remaining fixtures, then an Elo-based knockout run.
  const spGroup = allMatches.filter(
    (m) => /group/i.test(m.round || '') &&
      (m.home_team.toLowerCase() === spotlightKey || m.away_team.toLowerCase() === spotlightKey)
  );
  const groupKeys = new Set();
  for (const m of spGroup) {
    groupKeys.add(m.home_team.toLowerCase());
    groupKeys.add(m.away_team.toLowerCase());
  }
  const groupAll = allMatches.filter(
    (m) => /group/i.test(m.round || '') &&
      groupKeys.has(m.home_team.toLowerCase()) && groupKeys.has(m.away_team.toLowerCase())
  );
  const groupTeams = [...new Set(groupAll.flatMap((m) => [m.home_team, m.away_team]))];
  const groupPlayed = groupAll
    .filter((m) => isCompleted(m.status) && m.home_goals != null && m.away_goals != null)
    .map((m) => ({ home: m.home_team, away: m.away_team, hg: m.home_goals, ag: m.away_goals }));
  const groupRemaining = groupAll
    .filter((m) => !isCompleted(m.status))
    .map((m) => ({ home: m.home_team, away: m.away_team }));
  let predictions = null;
  try {
    const target = groupTeams.find((t) => t.toLowerCase() === spotlightKey) || config.spotlightTeam;
    predictions = predict({ teams: groupTeams, played: groupPlayed, remaining: groupRemaining, target });
  } catch (_) {
    predictions = null;
  }

  const socceroos = {
    team: config.spotlightTeam,
    played: auRec.played, won: auRec.won, drawn: auRec.drawn, lost: auRec.lost,
    gf: auRec.gf, ga: auRec.ga, gd: auRec.gd, points: auRec.points,
    recentResults: auRecent.slice(0, 4),
    scorers: auScorersRes.rows.map((r) => ({ name: r.name, goals: r.goals, photoUrl: r.photo_url || null })),
    nextMatch: auNext
      ? {
          opponent: auNext.home_team.toLowerCase() === spotlightKey ? auNext.away_team : auNext.home_team,
          date: auNext.match_date, round: auNext.round,
        }
      : null,
    predictions,
  };

  // --- Box Seat: live title-race simulation across all drafted teams ---
  const groupByTeam = new Map();
  for (const m of allMatches) {
    if (!/group/i.test(m.round || '')) continue;
    const hk = m.home_team.toLowerCase();
    const ak = m.away_team.toLowerCase();
    if (ownedKeys.has(hk)) {
      if (!groupByTeam.has(hk)) groupByTeam.set(hk, new Set([hk]));
      groupByTeam.get(hk).add(ak);
    }
    if (ownedKeys.has(ak)) {
      if (!groupByTeam.has(ak)) groupByTeam.set(ak, new Set([ak]));
      groupByTeam.get(ak).add(hk);
    }
  }
  const seenGroup = new Set();
  const simGroups = [];
  for (const set of groupByTeam.values()) {
    const teamsKeys = [...set].sort();
    const gid = teamsKeys.join('|');
    if (seenGroup.has(gid)) continue;
    seenGroup.add(gid);
    const tset = new Set(teamsKeys);
    const gms = allMatches.filter(
      (m) => /group/i.test(m.round || '') &&
        tset.has(m.home_team.toLowerCase()) && tset.has(m.away_team.toLowerCase())
    );
    simGroups.push({
      teams: teamsKeys,
      played: gms
        .filter((m) => isCompleted(m.status) && m.home_goals != null && m.away_goals != null)
        .map((m) => ({ h: m.home_team.toLowerCase(), a: m.away_team.toLowerCase(), hg: m.home_goals, ag: m.away_goals })),
      remaining: gms
        .filter((m) => !isCompleted(m.status))
        .map((m) => ({ h: m.home_team.toLowerCase(), a: m.away_team.toLowerCase() })),
    });
  }
  const ownersObj = {};
  for (const [k, v] of ownerByKey) ownersObj[k] = v;
  const bonusObj = {};
  for (const [k, v] of bonusByOwner) bonusObj[k] = v;
  let boxSeat = null;
  try {
    boxSeat = titleRace({ drafted: ownedKeys, owners: ownersObj, groups: simGroups, bonus: bonusObj });
  } catch (_) {
    boxSeat = null;
  }

  return {
    teamLadder, playerLadder, recentMatches, whatCouldHaveBeen,
    upcomingHighlight, playerNextMatches, goldenBoot, playmaker, socceroos, boxSeat,
  };
}

module.exports = { computeLadder };
