/* Commissioner page: login, sync, edit assignments, reset results. */

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

async function init() {
  const me = await api('/api/admin/me');
  if (me.body && me.body.admin) {
    showPanel();
  } else {
    $('#login').hidden = false;
  }
}

function showPanel() {
  $('#login').hidden = true;
  $('#panel').hidden = false;
  loadStatus();
  loadAssignments();
}

/* ---- Login ---- */
$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#login-error').textContent = '';
  const password = $('#password').value;
  const { ok, body } = await api('/api/admin/login', {
    method: 'POST',
    body: JSON.stringify({ password }),
  });
  if (ok && body && body.ok) {
    showPanel();
  } else {
    $('#login-error').textContent = (body && body.error) || 'Login failed.';
  }
});

$('#logout-btn').addEventListener('click', async () => {
  await api('/api/admin/logout', { method: 'POST' });
  location.reload();
});

/* ---- Sync status + trigger ---- */
async function loadStatus() {
  const { ok, body } = await api('/api/admin/status');
  if (!ok || !body) return;
  const s = body.lastSync;
  const rows = [];
  rows.push(kv('Data source', body.source || 'ESPN (free public feed)'));
  if (s) {
    rows.push(kv('Status', s.status));
    rows.push(kv('When', formatAdelaide(s.finished_at || s.started_at) || '—'));
    rows.push(kv('Trigger', s.trigger || '—'));
    rows.push(kv('Fixtures updated', String(s.fixtures_processed ?? 0)));
    if (s.message) rows.push(kv('Message', s.message));
  } else {
    rows.push(kv('Status', 'never run'));
  }
  $('#sync-status').innerHTML = rows.join('');
}

function kv(k, v) {
  return `<div class="kv"><span class="k">${esc(k)}</span><span class="v">${esc(v)}</span></div>`;
}

$('#sync-btn').addEventListener('click', async () => {
  const btn = $('#sync-btn');
  btn.disabled = true;
  btn.textContent = '⟳ Syncing…';
  $('#sync-result').textContent = '';
  const { ok, body } = await api('/api/admin/sync-results', { method: 'POST' });
  if (ok && body && body.ok) {
    $('#sync-result').textContent = body.message || 'Done.';
    toast('Results synced.', 'ok');
  } else {
    $('#sync-result').textContent = (body && (body.error || body.message)) || 'Sync failed.';
    toast('Sync failed.', 'err');
  }
  btn.disabled = false;
  btn.textContent = '⟳ Sync Latest Results';
  loadStatus();
});

/* ---- Assignments ---- */
async function loadAssignments() {
  const { ok, body } = await api('/api/players');
  if (!ok || !body) return;
  const players = body.players || [];
  $('#assign-rows').innerHTML = players.map((p, i) => {
    const t = p.teams || [];
    return `
      <div class="assign-row" data-player="${esc(p.player)}">
        <div class="pname">${esc(p.player)}</div>
        <div>
          <label>Team 1</label>
          <input type="text" class="team-input" data-slot="0" value="${esc(t[0] || '')}" />
        </div>
        <div>
          <label>Team 2</label>
          <input type="text" class="team-input" data-slot="1" value="${esc(t[1] || '')}" />
        </div>
      </div>`;
  }).join('');
}

$('#reload-assign').addEventListener('click', (e) => { e.preventDefault(); loadAssignments(); $('#assign-result').textContent = ''; });

$('#save-assign').addEventListener('click', async () => {
  const rows = [...document.querySelectorAll('.assign-row[data-player]')];
  const assignments = rows.map((row) => ({
    player: row.getAttribute('data-player'),
    teams: [...row.querySelectorAll('.team-input')]
      .map((inp) => inp.value.trim())
      .filter(Boolean),
  }));
  $('#assign-result').textContent = '';
  const { ok, body } = await api('/api/admin/assign-teams', {
    method: 'POST',
    body: JSON.stringify({ assignments }),
  });
  if (ok && body && body.ok) {
    $('#assign-result').textContent = 'Saved.';
    toast('Assignments saved.', 'ok');
    loadAssignments();
  } else {
    $('#assign-result').textContent = (body && body.error) || 'Save failed.';
    toast((body && body.error) || 'Save failed.', 'err');
  }
});

/* ---- Reset results ---- */
$('#reset-confirm').addEventListener('input', (e) => {
  $('#reset-btn').disabled = e.target.value.trim().toUpperCase() !== 'RESET';
});

$('#reset-btn').addEventListener('click', async () => {
  if ($('#reset-confirm').value.trim().toUpperCase() !== 'RESET') return;
  const { ok, body } = await api('/api/admin/reset-results', { method: 'POST' });
  if (ok && body && body.ok) {
    $('#reset-result').textContent = `Cleared ${body.deleted} match result(s).`;
    toast('Results cleared.', 'ok');
    $('#reset-confirm').value = '';
    $('#reset-btn').disabled = true;
    loadStatus();
  } else {
    $('#reset-result').textContent = (body && body.error) || 'Reset failed.';
    toast('Reset failed.', 'err');
  }
});

init();
