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
function predict({ teams, played, remaining, target }, runs = 10000) {
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

// --- Box Seat: full draft title-race simulation ---
const KO_OPP = [1730, 1765, 1805, 1845, 1885]; // R32→Final opponent strength ramp

function titleCase(s) {
  return String(s || '').replace(/\b\w/g, (c) => c.toUpperCase());
}

let raceCache = { key: '', value: null };

// Monte-Carlo the rest of the tournament for the 4-player title race. Each run:
// play out every group (real results + simulated remaining), give each drafted
// team a knockout run (Elo, round by round), tally each player's points from
// their two teams + the (current) Golden Boot bonus, and record the winner.
function titleRace({ drafted, owners, groups, bonus, runs = 10000 }) {
  if (!groups || !groups.length) return null;
  const key = JSON.stringify({ groups, bonus, owners });
  if (raceCache.key === key && raceCache.value) return raceCache.value;

  const players = [...new Set(Object.values(owners))];
  const wins = {};
  const ptsum = {};
  for (const p of players) { wins[p] = 0; ptsum[p] = 0; }

  for (let s = 0; s < runs; s += 1) {
    const teamPts = {};
    for (const G of groups) {
      const pts = {}; const gd = {}; const gf = {};
      for (const t of G.teams) { pts[t] = 0; gd[t] = 0; gf[t] = 0; }
      const app = (h, a, hg, ag) => {
        gf[h] += hg; gf[a] += ag; gd[h] += hg - ag; gd[a] += ag - hg;
        if (hg > ag) pts[h] += 3; else if (ag > hg) pts[a] += 3; else { pts[h] += 1; pts[a] += 1; }
      };
      for (const m of G.played) app(m.h, m.a, m.hg, m.ag);
      for (const m of G.remaining) {
        const [lh, la] = lambdas(elo(m.h), elo(m.a));
        app(m.h, m.a, poisson(lh), poisson(la));
      }
      const ranked = G.teams.slice().sort(
        (x, y) => pts[y] - pts[x] || gd[y] - gd[x] || gf[y] - gf[x] || (Math.random() < 0.5 ? -1 : 1)
      );
      ranked.forEach((t, i) => {
        if (!drafted.has(t)) return;
        let total = pts[t];
        const advance = i < 2 || (i === 2 && Math.random() < 0.55);
        if (advance) {
          for (let r = 0; r < 5; r += 1) {
            if (Math.random() < 1 / (1 + 10 ** ((KO_OPP[r] - elo(t)) / 400))) total += 3;
            else break;
          }
        }
        teamPts[t] = total;
      });
    }
    const pl = {};
    for (const p of players) pl[p] = bonus[p] || 0;
    for (const team of Object.keys(owners)) pl[owners[team]] += teamPts[team] || 0;
    let best = -Infinity;
    for (const p of players) { ptsum[p] += pl[p]; if (pl[p] > best) best = pl[p]; }
    const tied = players.filter((p) => pl[p] === best);
    wins[tied[Math.floor(Math.random() * tied.length)]] += 1;
  }

  const playerResults = players
    .map((p) => ({ player: p, winPct: wins[p] / runs, projectedPoints: ptsum[p] / runs }))
    .sort((a, b) => b.winPct - a.winPct);

  // Rough World Cup favourites by Elo knockout survival.
  const wc = {};
  for (const t of Object.keys(ELO)) {
    let sv = 0.9;
    for (let r = 0; r < 5; r += 1) sv *= 1 / (1 + 10 ** ((KO_OPP[r] - elo(t)) / 400));
    wc[t] = sv;
  }
  const tot = Object.values(wc).reduce((a, b) => a + b, 0) || 1;
  const wcFavourites = Object.keys(wc)
    .map((t) => ({ team: titleCase(t), pct: wc[t] / tot, owner: owners[t] || null }))
    .sort((a, b) => b.pct - a.pct)
    .slice(0, 6);

  const value = { players: playerResults, wcFavourites };
  raceCache = { key, value };
  return value;
}

module.exports = { predict, titleRace, elo };
