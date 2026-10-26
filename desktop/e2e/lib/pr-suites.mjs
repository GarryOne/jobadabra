// Which e2e suites expect text an app change just removed: the UI strings a PR deletes or rewrites, found in the suites (and the lib files they import). A test that copied the
// app's words fails in the next beta, not on this PR (beta runs 5-11, 21-24 Oct 2026: 8 of ~10 e2e fixes were tests lagging the app). Pure; the CLI is desktop/e2e/pr-suites.mjs.

const APP_FILE = /^desktop\/(renderer\/|lib\/|main\.js$|main\/|actions[^/]*\.js$|activity[^/]*\.js$)/;
export const isAppFile = file => APP_FILE.test(file) && !/\.(test|spec)\.|\/test\//.test(file);

// Quoted literals on the REMOVED lines of an app diff (git diff -U0): the words a screen no longer says. Short or code-looking ones are left out.
export function removedStrings(diff) {
  const found = new Set();
  let file = '';
  for (const line of String(diff).split('\n')) {
    const header = /^\+\+\+ b\/(.+)$/.exec(line);
    if (header) { file = header[1]; continue; }
    if (!isAppFile(file) || !line.startsWith('-') || line.startsWith('---')) continue;
    for (const [, , text] of line.matchAll(/(["'`])((?:\\.|(?!\1).){8,80})\1/g)) {
      if (/^[A-Za-z][A-Za-z0-9'’ .,!?…-]*[A-Za-z.!?…]$/.test(text) && /[A-Za-z]{2,}\s+[A-Za-z]{2,}/.test(text) && !/^[a-z]+(?:[A-Z][a-z]+)+\b|, \w+:/.test(text)) found.add(text.trim());   // prose with two words, not a code fragment
    }
  }
  return [...found];
}

// The suites that mention one of these strings: `sources` maps an e2e file (suites/x.mjs, lib/y.mjs) to its text; a lib file counts for every suite that imports it (one hop, as
// the suites do; a deeper lib is named by its own importer). Returns {suite: [strings]}.
export function suitesExpecting(strings, sources) {
  const hits = {};
  const add = (suite, text) => { (hits[suite] ||= new Set()).add(text); };
  const importers = {};
  for (const [file, text] of Object.entries(sources)) {
    const suite = /^suites\/([^/]+)\.mjs$/.exec(file)?.[1];
    if (!suite) continue;
    for (const [, target] of text.matchAll(/from\s+['"]\.\.\/(lib\/[^'"]+)['"]/g)) (importers[target] ||= new Set()).add(suite);
  }
  for (const [file, text] of Object.entries(sources)) {
    const direct = /^suites\/([^/]+)\.mjs$/.exec(file)?.[1];
    const owners = direct ? [direct] : [...(importers[file] || [])];
    for (const string of strings) if (text.includes(string)) for (const owner of owners) add(owner, string);
  }
  return Object.fromEntries(Object.entries(hits).map(([suite, set]) => [suite, [...set]]));
}

// Did the PR touch the suite's step: the suite file, or a lib file it imports.
export function stepTouched(suite, changedFiles, sources) {
  const own = `suites/${suite}.mjs`;
  const libs = [...String(sources[own] || '').matchAll(/from\s+['"]\.\.\/(lib\/[^'"]+)['"]/g)].map(m => m[1]);
  return changedFiles.some(file => file.startsWith('desktop/e2e/') && [own, ...libs].includes(file.slice('desktop/e2e/'.length)));
}

export function report({strings, hits, changedFiles, sources}) {
  const rows = Object.entries(hits).map(([suite, words]) => ({suite, words, updated: stepTouched(suite, changedFiles, sources)}));
  const stale = rows.filter(row => !row.updated);
  const lines = [];
  if (!strings.length) lines.push('No UI text was removed or rewritten in the app files: no suite is named.');
  else if (!rows.length) lines.push(`${strings.length} UI text(s) removed or rewritten; no suite quotes any of them.`);
  else {
    lines.push(`| Suite | Quotes text this PR removed | Its step in this PR |`, '|---|---|---|');
    for (const row of rows) lines.push(`| \`${row.suite}\` | ${row.words.slice(0, 3).map(word => `\`${word}\``).join(' ')}${row.words.length > 3 ? ` +${row.words.length - 3}` : ''} | ${row.updated ? '✅ touched' : '⚠ not touched'} |`);
    if (stale.length) lines.push('', `⚠ ${stale.map(row => row.suite).join(', ')}: the suite quotes words this PR removes and the PR does not touch it. Run it (\`npm run all -- --only ${stale[0].suite}\`) or update the step here, not in the next beta.`);
  }
  return {rows, stale: stale.map(row => row.suite), text: lines.join('\n')};
}

// The suites to run ON the PR (they block its merge since 26 Oct 2026, gate G1a): the ones its files point at (plan.mjs suitesFor: a suite's own file, the extension, the harness),
// the ones that quote removed UI text, and the ones that RUN the lines it changes (the coverage map, gate G1b: `covering`, {suite: reason}). Linux suites always; a macOS
// suite only when it RAN the changed lines (owner, 26 Oct 2026: "Yes, mapped Mac suites too"; #1911 broke the Mac-only interactions with a CSS change). A line no suite
// ran (reason "loads …": a file's top level, an unused rule) picks every suite that loads the file, on Linux only: the Free plan runs 5 macOS jobs at once.
// No count cap since G1a: suites run in parallel, so the PR waits for the slowest one, not their sum.
export function planPrSuites({pointed = [], hits = {}, covering = {}, linux, cadence = {}}) {
  const wanted = [...new Set([...pointed, ...Object.keys(hits), ...Object.keys(covering)])].filter(suite => (cadence[suite] || 'always') !== 'manual');
  const run = wanted.filter(suite => linux(suite) || String(covering[suite] || '').startsWith('runs '));
  return {suites: run, left: wanted.filter(suite => !run.includes(suite))};
}

// The step that quotes each removed UI text (PR 2 of the PR-checks plan): in a suite file, the `ctx.run('<name>', ...)` call whose text holds the quote. A quote outside
// any step with a literal name (a helper, a lib file, a `${}` name) → the whole suite. -> {suite: {steps: [names], whole: bool}}
export function stepCalls(text) {
  const calls = [];
  const re = /\bctx\.run\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/g;
  for (let m; (m = re.exec(text));) {
    const literal = m[1] !== '`' || !m[2].includes('${');
    let depth = 0, i = m.index + m[0].indexOf('('), quote = '', end = text.length;
    for (; i < text.length; i++) {
      const c = text[i];
      if (quote) { if (c === '\\') i++; else if (c === quote) quote = ''; continue; }
      if (c === '/' && text[i + 1] === '/') { i = text.indexOf('\n', i); if (i < 0) break; continue; }
      if (c === '/' && text[i + 1] === '*') { i = text.indexOf('*/', i + 2) + 1; if (i <= 0) break; continue; }
      if (c === '\'' || c === '"' || c === '`') { quote = c; continue; }
      if (c === '(') depth++;
      else if (c === ')' && --depth === 0) { end = i; break; }
    }
    calls.push({name: literal ? m[2].replace(/\\(.)/g, '$1') : null, start: m.index, end});
  }
  return calls;
}
export function stepsQuoting(hits, sources) {
  const out = {};
  for (const [suite, strings] of Object.entries(hits)) {
    const text = String(sources[`suites/${suite}.mjs`] || ''), calls = stepCalls(text), entry = out[suite] = {steps: [], whole: false};
    for (const string of strings) {
      let at = text.indexOf(string), placed = false;
      if (at < 0) { entry.whole = true; continue; }   // quoted in a lib file the suite imports
      for (; at >= 0; at = text.indexOf(string, at + 1)) {
        const inside = calls.filter(call => call.start <= at && at <= call.end).sort((a, b) => (a.end - a.start) - (b.end - b.start))[0];
        if (!inside?.name) { entry.whole = true; break; }
        if (!entry.steps.includes(inside.name)) entry.steps.push(inside.name);
        placed = true;
      }
      if (!placed) entry.whole = true;
    }
  }
  return out;
}

// One short Windows check on a PR that changes CI plumbing or shell (PR 3 of the PR-checks plan, owner's yes 26 Oct 2026): #1997's relay tar read "D:\a\_temp" as
// a host and every Windows suite went red, seen only by the next beta. The app launch, the relay and one settings step, on SQLite (no Notion lock to wait for).
export const WINDOWS_SMOKE = {suite: 'settings', steps: ['every Settings section renders']};
// A shell script counts only when CI runs it (`ci`: the text of the workflows and actions): tools/ship.sh runs on the Mac, tools/e2e-lock.sh on every runner.
const SHELL = /^(tools|desktop\/scripts)\/[^/]+\.sh$/;
export const windowsSmoke = (files, ci = '') => files.some(file => file.startsWith('.github/') || (SHELL.test(file) && ci.includes(file)));
