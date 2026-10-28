// The text of a UI-fix pull request (ui-fix.yml): what Claude wrote (root cause, change, test) laid out with headings, a facts table, a before/after table and
// the merge rule, so it reads at a glance (owner, 4 Oct 2026: "way too little formatting"). Pure: pr-body.mjs fetches, this renders.
const SEVERITY = {high: '🔴 High', medium: '🟠 Medium', low: '🟢 Low'};
const KIND = {layout: '📐 Layout', text: '📝 Text', consistency: '🔁 Consistency', functionality: '⚙️ Functionality', crash: '💥 Crash', a11y: '♿ Accessibility', 'dead-control': '🚫 Dead control',
  'expand-broken': '🪗 Expander', 'no-loading-state': '⏳ No loading state', 'console-error': '🧯 Console error', 'test-failure': '🧪 Test step', 'broken-resource': '🖼️ Broken resource'};

const names = labels => (labels || []).map(label => label.name || label);
const pick = (labels, prefix) => (names(labels).find(name => name.startsWith(prefix)) || '').slice(prefix.length);
const code = text => String(text || '').replace(/(^|[\s(])((?:desktop|src|tests|tools|\.github)\/[\w./-]+\.\w+(?::\d+(?:-\d+)?)?)(?=[\s,;:.)]|$)/g, (all, lead, file) => `${lead}\`${file}\``);

// Claude writes "Root cause: …", "Change: …", "Test: …" (the prompt asks); anything else is kept under "What happened".
export function sections(text) {
  const out = {rootCause: '', change: '', test: '', rest: []};
  let at = 'rest';
  for (const line of String(text || '').split('\n')) {
    const m = line.match(/^\s*(Root cause\s*:|Changed?\b\s*:?|Tests?\s*:)\s*(.*)$/i);
    if (m) { at = /^root/i.test(m[1]) ? 'rootCause' : /^test/i.test(m[1]) ? 'test' : 'change'; out[at] = `${out[at]} ${m[1].includes(':') ? m[2] : line.trim()}`.trim(); continue; }   // "Changed both to…" keeps its first word
    if (at === 'rest') { if (line.trim()) out.rest.push(line.trim()); } else if (line.trim()) out[at] = `${out[at]} ${line.trim()}`.trim();
  }
  return out;
}

const row = (a, b) => `| ${a} | ${b} |`;

export function prBody({number, labels = [], text = '', shot = '', files = [], added = 0, removed = 0, tests = []} = {}) {
  const s = sections(text);
  const severity = SEVERITY[pick(labels, 'severity:')] || '', kind = KIND[pick(labels, 'kind:')] || pick(labels, 'kind:'), view = pick(labels, 'view:');
  const platform = pick(labels, 'platform:'), suite = pick(labels, 'suite:'), confirmed = names(labels).includes('confirmed');
  const engine = files.some(file => /^(src|desktop\/lib)\//.test(file));
  const total = added + removed;
  const facts = [severity, kind, view && `📍 \`${view}\``, platform && `🖥️ ${platform}`, suite && `🧪 \`${suite}\``, confirmed && '✅ confirmed'].filter(Boolean).join(' · ');
  const lines = [
    '> [!NOTE]',
    `> 🤖 **Automatic fix for #${number}** — ${facts || 'a finding of the UI loop'}`,
    '',
    '## 🔎 Root cause',
    code(s.rootCause) || '_not stated: read the diff_',
    '',
    '## 🛠️ What changed',
    code(s.change || s.rest.join(' ')) || '_see the diff_',
    '',
    '## ✅ Proof',
    '| | |',
    '|---|---|',
    row('Test added', tests.length ? tests.map(file => `\`${file}\``).join(', ') : code(s.test) || '_none named_'),
    row('Suites', 'Python, desktop and the lint passed before this was opened'),
    row('Size', `${files.length} file${files.length === 1 ? '' : 's'} · **+${added} −${removed}** (${total} lines) · ${engine ? 'engine / app logic' : 'window only'}`),
    '',
    '## 📸 Before → after',
    '| Before (the end-to-end run) | After |',
    '|---|---|',
    `| ${shot ? `![before](${shot})` : '_no screenshot_'} | _the next run that photographs this page comments here and on the issue_ |`,
    '',
    engine
      ? '> [!IMPORTANT]\n> **Engine / app-logic change.** It merges itself only if the bug is `confirmed`, it stays in `src/` or `desktop/lib/` with its tests, it brings its own test and it is at most 40 lines. Otherwise a person merges it.'
      : '> [!TIP]\n> **Window-only change.** It merges itself when it is at most 80 lines and everything passed; the issue then closes and its suite runs again at once.',
    '',
    '<details><summary>🧭 Review checklist</summary>',
    '',
    '- [ ] The root cause is the real cause, not a patch over the symptom',
    '- [ ] The test fails without the change (it was written first)',
    '- [ ] Nothing next to it was restyled',
    `- [ ] The issue #${number} has the severity, the app's state, the logs and the run's artifacts`,
    '',
    '</details>',
    '',
    `Fixes #${number}`,
    '',
    '<sub>Opened by the UI fixer for a finding seen in two runs or confirmed by a person. [How the loop works](../blob/main/docs/ARCHITECTURE.md)</sub>',
  ];
  return lines.join('\n');
}
