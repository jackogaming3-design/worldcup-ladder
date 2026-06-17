/* Home page: fetch the ladder and render every section. */

const $ = (sel, root = document) => root.querySelector(sel);

function toast(msg, kind = 'ok') {
  const t = $('#toast');
  t.textContent = msg;
  t.className = `toast toast-${kind}`;
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.hidden = true; }, 4000);
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  let body = null;
  try { body = await res.json(); } catch (_) { /* non-JSON */ }
  return { ok: res.ok, status: res.status, body };
}

let IS_ADMIN = false;

async function init() {
  const me = await api('/api/admin/me');
  IS_ADMIN = !!(me.body && me.body.admin);
  await load();
}

async function load() {
  const { ok, body } = await api('/api/ladder');
  if (!ok || !body) {
    $('#main').insertAdjacentHTML('afterbegin',
      '<div class="empty-banner">Could not load the ladder. Check the server is running and the database is configured.</div>');
    return;
  }
  renderCommish(body);
  renderStatus(body);
  renderEmpty(body);
  renderUpcoming(body.upcomingHighlight);
  renderNextUp(body.playerNextMatches);
  renderPlayerCards(body.playerLadder);
  renderGoldenBoot(body.goldenBoot);
  renderTeamLadder(body.teamLadder);
  renderBreakdown(body.teamLadder, body.playerLadder);
  renderWchb(body.whatCouldHaveBeen);
  renderRecent(body.recentMatches);
}

function renderCommish(data) {
  const area = $('#commish-area');
  if (IS_ADMIN) {
    area.innerHTML =
      `<button id="sync-btn" class="btn btn-sync">⟳ Sync Latest Results</button>
       <a class="btn btn-ghost" href="/admin">Commissioner Controls</a>`;
    $('#sync-btn').addEventListener('click', onSync);
  } else {
    area.innerHTML = `<a class="btn btn-ghost" href="/admin">Commissioner Controls</a>`;
  }
}

async function onSync() {
  const btn = $('#sync-btn');
  btn.disabled = true;
  btn.textContent = '⟳ Syncing…';
  const { ok, body } = await api('/api/admin/sync-results', { method: 'POST' });
  if (ok && body && body.ok) {
    toast(body.message || 'Results synced.', 'ok');
    await load();
  } else {
    toast((body && (body.error || body.message)) || 'Sync failed.', 'err');
    btn.disabled = false;
    btn.textContent = '⟳ Sync Latest Results';
  }
}

function renderStatus(data) {
  const bar = $('#status-bar');
  const when = formatAdelaide(data.lastUpdated);
  const bits = [];
  bits.push(`<span class="status-chip">🕑 ${when ? 'Last updated ' + esc(when) : 'Not updated yet'}</span>`);

  const s = data.lastSync;
  if (s) {
    if (s.status === 'success') {
      bits.push(`<span class="status-chip ok">✓ Last sync OK${s.fixtures_processed ? ' · ' + s.fixtures_processed + ' updated' : ''}</span>`);
    } else if (s.status === 'error') {
      bits.push(`<span class="status-chip err" title="${esc(s.message || '')}">⚠ Last sync failed</span>`);
    } else if (s.status === 'running') {
      bits.push(`<span class="status-chip">⟳ Sync running…</span>`);
    }
  }
  if (!data.apiConfigured) {
    bits.push(`<span class="status-chip warn">Result sync not configured yet</span>`);
  }
  bar.innerHTML = bits.join('');
}

function renderEmpty(data) {
  const played = (data.teamLadder || []).reduce((n, t) => n + t.played, 0);
  const banner = $('#empty-banner');
  if (played === 0) {
    banner.hidden = false;
    banner.innerHTML =
      '🚀 <strong>Teams are locked in and the tournament is kicking off!</strong> ' +
      'No matches have finished yet — the ladder fills in automatically as World Cup results come in each morning.';
  } else {
    banner.hidden = true;
  }
}

function statRow(s) {
  return `P ${s.played} · W ${s.won} · D ${s.drawn} · L ${s.lost} · ` +
         `GF ${s.gf} · GA ${s.ga} · GD ${signed(s.gd)}`;
}

function renderPlayerCards(players) {
  const wrap = $('#player-leaderboard');
  wrap.innerHTML = (players || []).map((p) => {
    const medal = p.rank <= 3 ? `medal medal-${p.rank}` : 'medal medal-plain';
    const teams = p.teams.map((t) => `${flag(t)} ${esc(t)}`).join(' &nbsp;·&nbsp; ');
    return `
      <article class="pcard rank-${p.rank}">
        <div class="${medal}">${p.rank}</div>
        <div class="pcard-main">
          <div class="pcard-name">${esc(p.player)}</div>
          <div class="pcard-teams">${teams}</div>
          <div class="pcard-stats">${statRow(p)}</div>
          ${p.bootBonus ? `<div class="pcard-bonus">👟 +${p.bootBonus} Golden Boot bonus</div>` : ''}
        </div>
        <div class="pcard-points"><strong>${p.points}</strong><span>pts</span></div>
      </article>`;
  }).join('');
}

function renderTeamLadder(teams) {
  const table = $('#team-ladder');
  const head = `
    <thead><tr>
      <th class="c-rank">#</th>
      <th class="c-team">Team</th>
      <th class="c-owner">Owner</th>
      <th>P</th><th>W</th><th>D</th><th>L</th>
      <th class="c-opt">GF</th><th class="c-opt">GA</th>
      <th>GD</th><th class="c-pts">Pts</th>
    </tr></thead>`;
  const rows = (teams || []).map((t) => `
    <tr class="${t.rank <= 3 ? 'top' : ''}">
      <td class="c-rank">${t.rank}</td>
      <td class="c-team"><span class="tflag">${flag(t.team)}</span>${esc(t.team)}</td>
      <td class="c-owner"><span class="owner-chip" style="${ownerChipStyle(t.owner)}">${esc(t.owner)}</span></td>
      <td>${t.played}</td><td>${t.won}</td><td>${t.drawn}</td><td>${t.lost}</td>
      <td class="c-opt">${t.gf}</td><td class="c-opt">${t.ga}</td>
      <td>${signed(t.gd)}</td><td class="c-pts">${t.points}</td>
    </tr>`).join('');
  table.innerHTML = head + `<tbody>${rows}</tbody>`;
}

function renderBreakdown(teams, players) {
  const byOwner = new Map();
  for (const t of teams || []) {
    if (!byOwner.has(t.owner)) byOwner.set(t.owner, []);
    byOwner.get(t.owner).push(t);
  }
  // Order players by their ladder rank.
  const order = (players || []).map((p) => p.player);
  const wrap = $('#player-breakdown');
  wrap.innerHTML = order.map((name) => {
    const ts = byOwner.get(name) || [];
    const total = ts.reduce((n, t) => n + t.points, 0);
    const body = ts.map((t) => `
      <tr>
        <td class="b-team">${flag(t.team)} ${esc(t.team)}</td>
        <td>${t.played}</td><td>${t.won}</td><td>${t.drawn}</td><td>${t.lost}</td>
        <td>${t.gf}</td><td>${t.ga}</td><td>${signed(t.gd)}</td>
        <td class="b-pts">${t.points}</td>
      </tr>`).join('');
    return `
      <article class="bcard">
        <header class="bcard-head">
          <span class="bcard-name">${esc(name)}</span>
          <span class="bcard-total">${total} pts</span>
        </header>
        <div class="table-scroll">
          <table class="mini-table">
            <thead><tr><th class="b-team">Team</th><th>P</th><th>W</th><th>D</th><th>L</th><th>GF</th><th>GA</th><th>GD</th><th>Pts</th></tr></thead>
            <tbody>${body}</tbody>
          </table>
        </div>
      </article>`;
  }).join('');
}

function sideClass(team, winner, gHome, gAway, isHome) {
  if (winner) return team === winner ? 'win' : 'lose';
  if (gHome === gAway) return 'draw';
  const teamWon = isHome ? gHome > gAway : gAway > gHome;
  return teamWon ? 'win' : 'lose';
}

function renderRecent(matches) {
  const wrap = $('#recent-results');
  if (!matches || matches.length === 0) {
    wrap.innerHTML = '<div class="muted-note">No completed matches involving a drafted team yet.</div>';
    return;
  }
  wrap.innerHTML = matches.map((m) => {
    const involved = new Set((m.involved || []).map((s) => s.toLowerCase()));
    const homeOwned = involved.has(m.homeTeam.toLowerCase());
    const awayOwned = involved.has(m.awayTeam.toLowerCase());
    const hCls = sideClass(m.homeTeam, m.winner, m.homeGoals, m.awayGoals, true);
    const aCls = sideClass(m.awayTeam, m.winner, m.homeGoals, m.awayGoals, false);
    const round = [m.round, shortDate(m.date)].filter(Boolean).join(' · ');
    const pen = m.penalties
      ? `<div class="rr-note">${esc(m.winner || '')} won on penalties (${m.penalties.home}–${m.penalties.away})</div>`
      : '';
    return `
      <div class="result-row">
        <div class="rr-meta">${esc(round)}</div>
        <div class="rr-body">
          <span class="rr-team ${hCls} ${homeOwned ? 'owned' : ''}">${flag(m.homeTeam)} ${esc(m.homeTeam)}</span>
          <span class="rr-score">${m.homeGoals} <span class="dash">–</span> ${m.awayGoals}</span>
          <span class="rr-team away ${aCls} ${awayOwned ? 'owned' : ''}">${esc(m.awayTeam)} ${flag(m.awayTeam)}</span>
        </div>
        ${pen}
      </div>`;
  }).join('');
}

function daysUntil(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const ms = d.getTime() - Date.now();
  if (ms < -3 * 3600 * 1000) return '';
  const days = Math.round(ms / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'tomorrow';
  return `in ${days} days`;
}

function renderUpcoming(g) {
  const el = $('#upcoming');
  if (!g) {
    el.innerHTML =
      '<div class="upcoming-card empty">⭐ <strong>Next clash between your teams:</strong> ' +
      "none scheduled yet — we'll spotlight one the moment the bracket lines up.</div>";
    return;
  }
  const when = formatAdelaide(g.date);
  const countdown = daysUntil(g.date);
  const owners = g.homeOwner && g.awayOwner
    ? `<div class="upcoming-owners">${esc(g.homeOwner)} vs ${esc(g.awayOwner)}</div>`
    : '';
  const meta = [g.round, when, countdown].filter(Boolean).map(esc).join(' · ');
  el.innerHTML = `
    <div class="upcoming-card">
      <div class="upcoming-label">⭐ Next clash between your teams</div>
      <div class="upcoming-teams">
        <span class="ut">${flag(g.homeTeam)} ${esc(g.homeTeam)}</span>
        <span class="vs">vs</span>
        <span class="ut">${esc(g.awayTeam)} ${flag(g.awayTeam)}</span>
      </div>
      ${owners}
      <div class="upcoming-meta">${meta}</div>
    </div>`;
}

function renderWchb(rows) {
  const el = $('#wchb');
  if (!rows || rows.length === 0) {
    el.innerHTML =
      '<div class="muted-note">Nothing yet — once the teams you passed on start racking up wins, ' +
      "they'll show up here to haunt you.</div>";
    return;
  }
  const head = `
    <thead><tr>
      <th class="c-rank">#</th>
      <th class="c-team">Team</th>
      <th>P</th><th>W</th><th>D</th><th>L</th>
      <th class="c-opt">GF</th><th class="c-opt">GA</th>
      <th>GD</th><th class="c-pts">Pts</th>
    </tr></thead>`;
  const body = rows.map((t) => `
    <tr>
      <td class="c-rank">${t.rank}</td>
      <td class="c-team"><span class="tflag">${flag(t.team)}</span>${esc(t.team)}</td>
      <td>${t.played}</td><td>${t.won}</td><td>${t.drawn}</td><td>${t.lost}</td>
      <td class="c-opt">${t.gf}</td><td class="c-opt">${t.ga}</td>
      <td>${signed(t.gd)}</td><td class="c-pts">${t.points}</td>
    </tr>`).join('');
  el.innerHTML =
    `<div class="table-card"><div class="table-scroll"><table class="ladder-table">${head}<tbody>${body}</tbody></table></div></div>`;
}

function renderNextUp(rows) {
  const el = $('#next-up');
  if (!rows || rows.length === 0) {
    el.innerHTML = '<div class="muted-note">No upcoming matches scheduled yet.</div>';
    return;
  }
  el.innerHTML = rows.map((r) => {
    const m = r.match;
    const chip = `<span class="owner-chip" style="${ownerChipStyle(r.player)}">${esc(r.player)}</span>`;
    if (!m) {
      return `
        <article class="nextup-card">
          <div class="nu-player">${chip}</div>
          <div class="nu-none">No upcoming match — done for now or awaiting the bracket.</div>
        </article>`;
    }
    const when = formatAdelaide(m.date);
    const countdown = daysUntil(m.date);
    const rival = m.opponentOwner ? `<span class="nu-rival">🔥 vs ${esc(m.opponentOwner)}</span>` : '';
    const live = m.status === 'LIVE' ? '<span class="nu-live">● LIVE</span>' : '';
    const meta = [m.round, when, countdown].filter(Boolean).map(esc).join(' · ');
    return `
      <article class="nextup-card">
        <div class="nu-player">${chip}${rival}${live}</div>
        <div class="nu-match">
          <span class="nu-team">${flag(m.team)} ${esc(m.team)}</span>
          <span class="nu-vs">vs</span>
          <span class="nu-opp">${flag(m.opponent)} ${esc(m.opponent)}</span>
        </div>
        <div class="nu-meta">${meta}</div>
      </article>`;
  }).join('');
}

function gbCardHtml(s) {
  const place = s.tier || 'bronze';
  const medal = place === 'gold' ? '🥇' : place === 'silver' ? '🥈' : '🥉';
  const owner = s.owner
    ? `<span class="owner-chip" style="${ownerChipStyle(s.owner)}">${esc(s.owner)}</span>`
    : '';
  return `
    <div class="podium-col ${place}">
      <div class="gb-card">
        <div class="gb-photo-wrap">
          <span class="gb-flag-fallback">${flag(s.team)}</span>
          ${s.photoUrl ? `<img class="gb-photo" src="${esc(s.photoUrl)}" alt="${esc(s.name)}" loading="lazy"
               onload="this.previousElementSibling.style.display='none'" onerror="this.remove()" />` : ''}
        </div>
        <div class="gb-name">${esc(s.name)}</div>
        <div class="gb-team">${flag(s.team)} ${esc(s.team)}</div>
        ${owner}
        <div class="gb-goals"><strong>${s.goals}</strong><span>goal${s.goals === 1 ? '' : 's'}</span></div>
      </div>
      <div class="podium-block ${place}-block">
        <span class="podium-medal">${medal}</span>
        <span class="podium-bonus">+${s.bonus}</span>
      </div>
    </div>`;
}

function renderGoldenBoot(boot) {
  const el = $('#golden-boot');
  if (!boot || boot.length === 0) {
    el.innerHTML =
      '<div class="muted-note">No goals from your teams yet — the Golden Boot race kicks off with the first one.</div>';
    return;
  }
  const byRank = {};
  boot.forEach((s) => { byRank[s.rank] = s; });
  // DOM order silver, gold, bronze so the gold winner sits tall in the middle.
  // Place rank-1 in the middle (tall), the next two on the flanks; each is
  // styled by its own tier, so tied scorers show matching pedestals.
  const cols = [];
  if (byRank[2]) cols.push(gbCardHtml(byRank[2]));
  if (byRank[1]) cols.push(gbCardHtml(byRank[1]));
  if (byRank[3]) cols.push(gbCardHtml(byRank[3]));
  el.innerHTML =
    `<div class="podium">${cols.join('')}</div>` +
    `<div class="gb-bonus-note">🔥 Juicy bonus, added to the ladder: ` +
    `Golden Boot <strong>+5</strong> · Silver <strong>+2</strong> · Bronze <strong>+1</strong> ` +
    `to each scorer's owner. Tied scorers share the same bonus.</div>`;
}

init();
