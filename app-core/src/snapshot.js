// Fill-failure snapshots, on the Worker's side: every report's snapshot tree is scrubbed again here (anyone can post
// a report), then written as the HTML the intake workflow puts in the GitHub issue. The scrubber is a copy of
// extension/page/snapshot.js's <scrub> block (the page can't import modules); app-core/test/snapshot.test.js keeps them equal.
// <scrub> The scrubber, a pure function of a {t, a, c} tree. This block is identical in app-core/src/snapshot.js,
// which scrubs every report again (anyone can post one); app-core/test/snapshot.test.js fails when the two differ.
// Kept: tags, type, role, id/name/for, class names (react-select's select__control…), aria-* structure, label and
// option texts. Dropped: every value the user typed or chose, hidden and password inputs, textarea contents, data-*,
// links, styles, scripts, images, Jobadabra's own marks. Emails, URLs, phone-like numbers, long tokens and the
// given secrets (the user's contact details) are replaced in every text that is kept.
const SNAPSHOT_MAX = 8192;
const SNAPSHOT_TAGS = new Set(['div', 'span', 'label', 'legend', 'fieldset', 'input', 'select', 'option', 'optgroup', 'textarea',
  'button', 'ul', 'ol', 'li', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'small', 'strong', 'b', 'em', 'i', 'a', 'sup', 'section',
  'form', 'abbr', 'svg', 'br', 'table', 'thead', 'tbody', 'tr', 'td', 'th']);
const SNAPSHOT_DROP = /^(script|style|noscript|iframe|frame|img|canvas|video|audio|object|embed|template|link|meta|picture|source|base|head|title)$/;
const SNAPSHOT_EMPTY = /^(input|br|textarea|svg)$/;
const SNAPSHOT_IDENT = /^(id|name|for|type|role|autocomplete|inputmode|tabindex|maxlength|required|disabled|multiple|readonly|data-jp-(field|truncated)|aria-(labelledby|describedby|controls|owns|activedescendant|errormessage|haspopup|expanded|required|invalid|autocomplete|hidden|multiselectable|disabled|live|atomic|modal|orientation|level|posinset|setsize|busy|readonly))$/;
const SNAPSHOT_TEXT = /^(aria-label|placeholder|value)$/;
const snapshotScrub = (root, secretValues = []) => {
  const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const parts = new Set();
  for (const raw of Array.isArray(secretValues) ? secretValues : []) {
    const value = String(raw ?? '').trim().toLowerCase();
    if (value.length < 3) continue;
    parts.add(value);
    if (/^https?:\/\/|^www\./.test(value)) { const last = value.replace(/[?#].*$/, '').split('/').filter(Boolean).pop(); if (last && last.length >= 3 && !/\./.test(last)) parts.add(last); }
    else if (value.includes('@')) parts.add(value.split('@')[0]);
    else for (const word of value.split(/[\s,]+/)) if (word.length >= 3) parts.add(word);
    const digits = value.replace(/\D/g, '');
    if (digits.length >= 6) parts.add(digits);
  }
  const secrets = [...parts].sort((a, b) => b.length - a.length).map(p => new RegExp(`(?<![\\p{L}\\p{N}])${escape(p)}(?![\\p{L}\\p{N}])`, 'giu'));
  const hide = s => secrets.reduce((out, re) => out.replace(re, '[redacted]'), s);
  const text = (value, max) => hide(String(value ?? '').replace(/[\u0000-\u001f\u007f`]/g, ' ')
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '[email]')
    .replace(/\b(https?:\/\/|www\.)[^\s"'<>]*/gi, '[url]')
    .replace(/\+?\d[\d ().\/-]{5,}\d/g, '[number]')
    .replace(/\b(?=[\w-]*\d)(?=[\w-]*[a-z])[\w-]{32,}\b/gi, '[token]'))
    .replace(/\s+/g, ' ').slice(0, max);
  const ident = (value, max) => hide(String(value ?? '').replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '[email]')
    .replace(/[^\w:.\[\]\s-]/g, '')).replace(/\s+/g, ' ').trim().slice(0, max);
  let count = 0;
  const walk = (node, depth) => {
    if (typeof node === 'string') { const s = text(node, 200); return s.trim() ? s : null; }
    if (!node || typeof node !== 'object' || typeof node.t !== 'string' || depth > 40 || ++count > 800) return null;
    let t = node.t.toLowerCase();
    if (SNAPSHOT_DROP.test(t) || !/^[a-z][a-z0-9-]{0,40}$/.test(t)) return null;
    if (!SNAPSHOT_TAGS.has(t) && !t.includes('-')) t = 'div';
    const raw = node.a && typeof node.a === 'object' ? node.a : {};
    const type = String(raw.type || '').toLowerCase();
    if (t === 'input' && /^(hidden|password)$/.test(type)) return null;
    // Jobadabra's own elements (the dropdown badge, which names the answer; the panel, styles); its classes on a field go.
    if (/(^|\s)jobadabra-badge(\s|$)/.test(String(raw.class || '')) || /^jobadabra/i.test(String(raw.id || ''))) return null;
    const a = {};
    for (const [key, value] of Object.entries(raw)) {
      const name = String(key).toLowerCase();
      if (name === 'value' && !(t === 'option' || (t === 'input' && /^(radio|checkbox)$/.test(type)))) continue;
      if (name === 'class') {
        const classes = ident(value, 300).split(' ').filter(c => c && !/jobadabra/i.test(c)).join(' ');
        if (classes) a.class = classes;
      } else if (SNAPSHOT_IDENT.test(name)) a[name] = ident(value, 120);
      else if (SNAPSHOT_TEXT.test(name)) a[name] = text(value, 120).trim();
    }
    // react-select shows the chosen answer in a single-value / multi-value element: that is the user's answer.
    const chosen = /(^|[\s_-])(single-value|multi-value__label)(\s|$)/.test(a.class || '');
    const c = SNAPSHOT_EMPTY.test(t) ? [] : chosen ? ['[chosen]']
      : (Array.isArray(node.c) ? node.c : []).map(child => walk(child, depth + 1)).filter(x => x != null);
    return {t, a, c};
  };
  return walk(root, 0);
};
const snapshotHtml = (node, indent = '') => {
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  if (typeof node === 'string') return `${indent}${esc(node.trim())}\n`;
  const attrs = Object.entries(node.a).map(([k, v]) => (v === '' ? ` ${k}` : ` ${k}="${esc(v)}"`)).join('');
  if (/^(input|br)$/.test(node.t)) return `${indent}<${node.t}${attrs}>\n`;
  if (!node.c.length) return `${indent}<${node.t}${attrs}></${node.t}>\n`;
  if (node.c.length === 1 && typeof node.c[0] === 'string') return `${indent}<${node.t}${attrs}>${esc(node.c[0].trim())}</${node.t}>\n`;
  return `${indent}<${node.t}${attrs}>\n${node.c.map(child => snapshotHtml(child, `${indent} `)).join('')}${indent}</${node.t}>\n`;
};
// Over the size cap: the element with the most children keeps its first half (a long country list), never the
// branch with the failing field. Returns {tree, html}, or null when it can't fit.
const snapshotFit = (tree, max = SNAPSHOT_MAX) => {
  if (!tree || typeof tree !== 'object') return null;
  const holdsField = n => typeof n === 'object' && ('data-jp-field' in n.a || n.c.some(holdsField));
  let html = snapshotHtml(tree);
  for (let round = 0; html.length > max && round < 60; round++) {
    let widest = null;
    const visit = n => { if (typeof n !== 'object') return; if (n.c.length > 3 && (!widest || n.c.length > widest.c.length)) widest = n; n.c.forEach(visit); };
    visit(tree);
    if (!widest) return null;
    const keep = Math.max(3, Math.floor(widest.c.length / 2));
    const cut = widest.c.slice(keep);
    const saved = cut.filter(holdsField);
    widest.c = [...widest.c.slice(0, keep), ...saved];
    widest.a['data-jp-truncated'] = String(Number(widest.a['data-jp-truncated'] || 0) + cut.length - saved.length);
    html = snapshotHtml(tree);
  }
  return html.length <= max ? {tree, html} : null;
};
// </scrub>

export { SNAPSHOT_MAX, snapshotScrub, snapshotHtml, snapshotFit };

// A report's snapshot (the tree the page sent) as scrubbed HTML, or '' when there is none or it can't fit.
export function snapshotFromReport(tree, max = SNAPSHOT_MAX) {
  const fitted = snapshotFit(snapshotScrub(tree), max);
  return fitted ? fitted.html : '';
}
