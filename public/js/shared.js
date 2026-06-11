/* Shared helpers used by both the home page and the admin page. */

// Flag emoji by lowercased country name. Falls back to the soccer ball for
// anything unmapped.
const FLAGS = {
  // Drafted teams
  france: '\u{1F1EB}\u{1F1F7}',
  germany: '\u{1F1E9}\u{1F1EA}',
  spain: '\u{1F1EA}\u{1F1F8}',
  norway: '\u{1F1F3}\u{1F1F4}',
  england: '\u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}',
  argentina: '\u{1F1E6}\u{1F1F7}',
  portugal: '\u{1F1F5}\u{1F1F9}',
  brazil: '\u{1F1E7}\u{1F1F7}',
  // Hosts + likely opponents
  usa: '\u{1F1FA}\u{1F1F8}',
  'united states': '\u{1F1FA}\u{1F1F8}',
  canada: '\u{1F1E8}\u{1F1E6}',
  mexico: '\u{1F1F2}\u{1F1FD}',
  netherlands: '\u{1F1F3}\u{1F1F1}',
  belgium: '\u{1F1E7}\u{1F1EA}',
  croatia: '\u{1F1ED}\u{1F1F7}',
  italy: '\u{1F1EE}\u{1F1F9}',
  denmark: '\u{1F1E9}\u{1F1F0}',
  switzerland: '\u{1F1E8}\u{1F1ED}',
  uruguay: '\u{1F1FA}\u{1F1FE}',
  colombia: '\u{1F1E8}\u{1F1F4}',
  japan: '\u{1F1EF}\u{1F1F5}',
  'south korea': '\u{1F1F0}\u{1F1F7}',
  'korea republic': '\u{1F1F0}\u{1F1F7}',
  australia: '\u{1F1E6}\u{1F1FA}',
  morocco: '\u{1F1F2}\u{1F1E6}',
  senegal: '\u{1F1F8}\u{1F1F3}',
  nigeria: '\u{1F1F3}\u{1F1EC}',
  ghana: '\u{1F1EC}\u{1F1ED}',
  cameroon: '\u{1F1E8}\u{1F1F2}',
  ecuador: '\u{1F1EA}\u{1F1E8}',
  peru: '\u{1F1F5}\u{1F1EA}',
  chile: '\u{1F1E8}\u{1F1F1}',
  poland: '\u{1F1F5}\u{1F1F1}',
  serbia: '\u{1F1F7}\u{1F1F8}',
  austria: '\u{1F1E6}\u{1F1F9}',
  sweden: '\u{1F1F8}\u{1F1EA}',
  wales: '\u{1F3F4}\u{E0067}\u{E0062}\u{E0077}\u{E006C}\u{E0073}\u{E007F}',
  scotland: '\u{1F3F4}\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F}',
  turkey: '\u{1F1F9}\u{1F1F7}',
  greece: '\u{1F1EC}\u{1F1F7}',
  'saudi arabia': '\u{1F1F8}\u{1F1E6}',
  iran: '\u{1F1EE}\u{1F1F7}',
  qatar: '\u{1F1F6}\u{1F1E6}',
  egypt: '\u{1F1EA}\u{1F1EC}',
  tunisia: '\u{1F1F9}\u{1F1F3}',
  algeria: '\u{1F1E9}\u{1F1FF}',
  'costa rica': '\u{1F1E8}\u{1F1F7}',
  panama: '\u{1F1F5}\u{1F1E6}',
  jamaica: '\u{1F1EF}\u{1F1F2}',
  'new zealand': '\u{1F1F3}\u{1F1FF}',
  paraguay: '\u{1F1F5}\u{1F1FE}',
  venezuela: '\u{1F1FB}\u{1F1EA}',
  'ivory coast': '\u{1F1E8}\u{1F1EE}',
  "cote d'ivoire": '\u{1F1E8}\u{1F1EE}',
  'south africa': '\u{1F1FF}\u{1F1E6}',
  ukraine: '\u{1F1FA}\u{1F1E6}',
  'czech republic': '\u{1F1E8}\u{1F1FF}',
  czechia: '\u{1F1E8}\u{1F1FF}',
  romania: '\u{1F1F7}\u{1F1F4}',
  slovenia: '\u{1F1F8}\u{1F1EE}',
  slovakia: '\u{1F1F8}\u{1F1F0}',
  hungary: '\u{1F1ED}\u{1F1FA}',
  ireland: '\u{1F1EE}\u{1F1EA}',
};

const BALL = '⚽';

function flag(name) {
  return FLAGS[String(name || '').toLowerCase()] || BALL;
}

// One stable colour per owner name (for chips), derived from the name.
function ownerHue(name) {
  let h = 0;
  for (const ch of String(name || '')) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}
function ownerChipStyle(name) {
  const h = ownerHue(name);
  return `background:hsl(${h} 75% 93%); color:hsl(${h} 70% 32%); border-color:hsl(${h} 60% 82%);`;
}

// Goal-difference with an explicit sign.
function signed(n) {
  return n > 0 ? `+${n}` : `${n}`;
}

// Percentage display: the infinity sign when goals were scored but none conceded.
function pctDisplay(gf, ga, pct) {
  if (ga === 0) return gf > 0 ? '∞' : '-';
  return pct == null ? '-' : `${pct.toFixed(1)}%`;
}

// Format a timestamp in Adelaide time as "Today 8:03am" / "Yesterday 9:15pm" /
// "Wed 11 Jun 7:00pm".
function formatAdelaide(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d)) return null;
  const tz = 'Australia/Adelaide';
  try {
    // Time only, e.g. "8:03am".
    const time = new Intl.DateTimeFormat('en-AU', {
      timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true,
    })
      .format(d)
      .replace(/\s+/g, '')
      .toLowerCase();

    // Compare calendar days in Adelaide for Today / Yesterday labels.
    const ymd = (x) =>
      new Intl.DateTimeFormat('en-CA', {
        timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
      }).format(x);
    const now = new Date();
    let label;
    if (ymd(d) === ymd(now)) label = 'Today';
    else if (ymd(d) === ymd(new Date(now.getTime() - 86400000))) label = 'Yesterday';
    else {
      label = new Intl.DateTimeFormat('en-AU', {
        timeZone: tz, weekday: 'short', day: 'numeric', month: 'short',
      }).format(d);
    }
    return `${label} ${time}`;
  } catch (_) {
    return d.toLocaleString();
  }
}

// Short date for match rows, e.g. "11 Jun".
function shortDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  try {
    return new Intl.DateTimeFormat('en-AU', {
      timeZone: 'Australia/Adelaide', day: 'numeric', month: 'short',
    }).format(d);
  } catch (_) {
    return '';
  }
}

// Tiny escape for any user/admin-entered text rendered into HTML.
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}
