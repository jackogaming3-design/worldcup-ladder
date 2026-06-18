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

module.exports = { predict, elo };
