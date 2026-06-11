'use strict';

// Ladder scoring: Win = 3, Draw = 1, Loss = 0.
const POINTS = { W: 3, D: 1, L: 0 };

// Fixture statuses that count as a finished result.
//   FT  = full time, AET = after extra time, PEN = decided on penalties,
//   AWD = awarded,   WO  = walkover.
const COMPLETED_STATUSES = new Set(['FT', 'AET', 'PEN', 'AWD', 'WO']);

function isCompleted(status) {
  return COMPLETED_STATUSES.has(status);
}

// Result for each side of a completed match.
//
// `winnerTeam` is derived at sync time from API-Football's `teams.*.winner`
// flags, which already reflect extra-time AND penalty-shootout outcomes. So a
// knockout level after extra time but won on penalties returns W for the team
// that advanced and L for the other (per the chosen "shootout winner wins"
// rule). When `winnerTeam` is null and the goals are level it's a true draw.
function resultFor(match) {
  const { homeTeam, awayTeam, homeGoals, awayGoals, winnerTeam } = match;
  let home;
  let away;

  if (winnerTeam && winnerTeam === homeTeam) {
    home = 'W';
    away = 'L';
  } else if (winnerTeam && winnerTeam === awayTeam) {
    home = 'L';
    away = 'W';
  } else if (homeGoals > awayGoals) {
    home = 'W';
    away = 'L';
  } else if (awayGoals > homeGoals) {
    home = 'L';
    away = 'W';
  } else {
    home = 'D';
    away = 'D';
  }

  return { home, away };
}

module.exports = { POINTS, COMPLETED_STATUSES, isCompleted, resultFor };
