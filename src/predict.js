'use strict';

// A lightweight, self-contained prediction model for the spotlight team's odds.
// It is a MODEL (a crystal ball), not bookmaker odds: it Monte-Carlos the team's
// group from real results + remaining fixtures, then estimates a knockout run
// from rough Elo-style strengths. Numbers update live as results come in.

// Rough strength ratings. Unknown teams default to 1600.
const ELO = {
  argentina: 1955, france: 1945, spain: 1925, england: 1910, brazil: 1900,
  germany: 1885, portugal: 1875, netherlands: 1850, italy: 1840, belgium: 1820,
  uruguay: 1805, croatia: 1795, colombia: 1790, morocco: 1790, norway: 1760,
  denmark: 1745, switzerland: 1745, 'united states': 1740, usa: 1740, japan: 1740,
  mexico: 1730, senegal: 1730, ecuador: 1720, nigeria: 1720, austria: 1715,
  türkiye: 1705, turkey: 1705, serbia: 1705, 'south korea': 1700, sweden: 1700,
  egypt: 1700, poland: 1690, australia: 1690, 'ivory coast': 1690, chile: 1690,
  algeria: 1690, peru: 1660, paraguay: 1660, qatar: 1620, 'south africa': 1610,
};
const KNOCKOUT_AVG = 1760; // typical strength of a knockout opponent
const BEST_THIRD = 0.55; // approx chance a third-placed team is among the 8 that advance

function elo(name) {
  return ELO[String(name || '').toLowerCase()] || 1600;
}

// Expected goals for each side from the Elo gap.
function lambdas(eHome, eAway) {
  const d = (eHome - eAway) / 100;
  return [Math.max(0.2, 1.35 + 0.42 * d), Math.max(0.2, 1.35 - 0.42 * d)];
}

function poisson(lambda) {
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k += 1;
    p *= Math.random();
  } while (p > L);
  return k - 1;
}

// Probability the target finishes top-2 / third in its group (Monte Carlo).
function groupProbs(teams, played, remaining, target, runs) {
  let top2 = 0;
  let third = 0;
  for (let s = 0; s < runs; s += 1) {
    const pts = {};
    const gd = {};
    const gf = {};
    for (const t of teams) { pts[t] = 0; gd[t] = 0; gf[t] = 0; }
    const apply = (h, a, hg, ag) => {
      gf[h] += hg; gf[a] += ag; gd[h] += hg - ag; gd[a] += ag - hg;
      if (hg > ag) pts[h] += 3;
      else if (ag > hg) pts[a] += 3;
      else { pts[h] += 1; pts[a] += 1; }
    };
    for (const m of played) apply(m.home, m.away, m.hg, m.ag);
    for (const m of remaining) {
      const [lh, la] = lambdas(elo(m.home), elo(m.away));
      apply(m.home, m.away, poisson(lh), poisson(la));
    }
    const ranked = teams.slice().sort(
      (x, y) => pts[y] - pts[x] || gd[y] - gd[x] || gf[y] - gf[x] || (Math.random() < 0.5 ? -1 : 1)
    );
    const pos = ranked.indexOf(target);
    if (pos < 2) top2 += 1;
    else if (pos === 2) third += 1;
  }
  return { top2: top2 / runs, third: third / runs };
}

// Probability of advancing one knockout round (extra time + penalties folded in).
function knockoutRoundProb(eTeam, eOpp) {
  return 1 / (1 + 10 ** ((eOpp - eTeam) / 400));
}

let cache = { key: '', value: null };

// Returns { advance, win } as probabilities in [0, 1], or null.
function predict({ teams, played, remaining, target }, runs = 5000) {
  if (!teams || teams.length < 3 || !target) return null;
  const key = JSON.stringify({ played, remaining, target });
  if (cache.key === key && cache.value) return cache.value;

  const g = groupProbs(teams, played, remaining, target, runs);
  const advance = Math.min(0.999, g.top2 + g.third * BEST_THIRD);
  const pRound = knockoutRoundProb(elo(target), KNOCKOUT_AVG);
  const win = advance * pRound ** 5; // five knockout rounds (R32 → Final)

  const value = { advance, win };
  cache = { key, value };
  return value;
}

// --- Box Seat: live title-race sim over the REAL knockout bracket ---
// Opponent strength ramps up toward the final, indexed by rounds-left (1 = final).
// Used for rounds beyond a team's known next fixture.
const STAGE_OPP = { 1: 1900, 2: 1860, 3: 1815, 4: 1770, 5: 1720 };
function roundProb(eTeam, eOpp) {
  return 1 / (1 + 10 ** ((eOpp - eTeam) / 400));
}

let raceCache = { key: '', value: null };

// Monte-Carlo the rest of the tournament from the ACTUAL knockout state. Each
// drafted team is either eliminated (no more points) or alive with a known next
// opponent + rounds-left. Two drafted teams drawn against each other resolve
// together (only one advances). Tallies each player's final points (current team
// points + simulated knockout wins + award bonus) and the winner, plus each
// team's chance of going all the way and winning the World Cup.
function titleRace({ koState, bonus = {}, runs = 4000 }) {
  const teams = Object.keys(koState || {});
  if (!teams.length) return null;
  const players = [...new Set(teams.map((t) => koState[t].owner).filter(Boolean))];
  if (!players.length) return null;

  const key = JSON.stringify({ koState, bonus });
  if (raceCache.key === key && raceCache.value) return raceCache.value;

  // Drafted-vs-drafted immediate-round collisions — only one can advance.
  const collided = new Set();
  const collisions = [];
  for (const a of teams) {
    const sa = koState[a];
    if (!sa.alive || collided.has(a)) continue;
    const b = sa.nextOppKey;
    if (b && koState[b] && koState[b].alive && koState[b].nextOppKey === a) {
      collisions.push([a, b]); collided.add(a); collided.add(b);
    }
  }

  // Play out a team's rounds AFTER its first (known) one; generic Elo opponents.
  const advanceRest = (teamKey, remaining) => {
    const e = elo(teamKey);
    let gained = 0;
    for (let r = remaining; r >= 1; r -= 1) {
      if (Math.random() < roundProb(e, STAGE_OPP[r] || 1820)) gained += 3;
      else return { gained, wonAll: false };
    }
    return { gained, wonAll: true };
  };

  const wins = {}; const ptsum = {}; const wcWins = {};
  for (const p of players) { wins[p] = 0; ptsum[p] = 0; }
  for (const t of teams) wcWins[t] = 0;

  for (let s = 0; s < runs; s += 1) {
    const gain = {}; const wonWC = {};
    for (const [a, b] of collisions) {
      const winner = Math.random() < roundProb(elo(a), elo(b)) ? a : b;
      const loser = winner === a ? b : a;
      const rest = advanceRest(winner, koState[winner].roundsLeft - 1);
      gain[winner] = 3 + rest.gained; wonWC[winner] = rest.wonAll;
      gain[loser] = 0; wonWC[loser] = false;
    }
    for (const t of teams) {
      const st = koState[t];
      if (!st.alive || collided.has(t)) continue;
      if (Math.random() < roundProb(elo(t), elo(st.nextOppKey))) {
        const rest = advanceRest(t, st.roundsLeft - 1);
        gain[t] = 3 + rest.gained; wonWC[t] = rest.wonAll;
      } else { gain[t] = 0; wonWC[t] = false; }
    }
    const proj = {};
    for (const p of players) proj[p] = bonus[p] || 0;
    for (const t of teams) proj[koState[t].owner] += koState[t].points + (gain[t] || 0);
    let best = -Infinity;
    for (const p of players) { ptsum[p] += proj[p]; if (proj[p] > best) best = proj[p]; }
    const tied = players.filter((p) => proj[p] === best);
    wins[tied[Math.floor(Math.random() * tied.length)]] += 1;
    for (const t of teams) if (wonWC[t]) wcWins[t] += 1;
  }

  const playerResults = players
    .map((p) => ({ player: p, winPct: wins[p] / runs, projectedPoints: ptsum[p] / runs }))
    .sort((a, b) => b.winPct - a.winPct);
  const wcFavourites = teams
    .map((t) => ({ team: koState[t].team, owner: koState[t].owner, pct: wcWins[t] / runs, alive: !!koState[t].alive }))
    .sort((a, b) => b.pct - a.pct || (b.alive === true ? 1 : 0) - (a.alive === true ? 1 : 0));

  const value = { players: playerResults, wcFavourites };
  raceCache = { key, value };
  return value;
}

module.exports = { predict, titleRace, elo };
