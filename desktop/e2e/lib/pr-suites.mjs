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
// suite when it RAN the changed lines (owner, 26 Oct 2026: "Yes, mapped Mac suites too"; #1911 broke the Mac-only interactions with a CSS change) or when the PR changes the
// suite itself (its file, a helper it imports, the extension for apply/applyflows: owner's yes to the e2e audit, 26 Oct 2026; #2074, #2075 and #2091 changed apply and
// it never ran: it had left PRs on 13 Oct, c6a6366, when it ran whole on every flow PR). A line no suite ran (reason "loads …": a file's top level, an unused rule) picks
// every suite that loads the file, on Linux only: the Free plan runs 5 macOS jobs at once. No count cap since G1a: suites run in parallel.
export function planPrSuites({pointed = [], hits = {}, covering = {}, linux, cadence = {}}) {
  const wanted = [...new Set([...pointed, ...Object.keys(hits), ...Object.keys(covering)])].filter(suite => (cadence[suite] || 'always') !== 'manual');
  const run = wanted.filter(suite => linux(suite) || pointed.includes(suite) || String(covering[suite] || '').startsWith('runs '));
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

// The lines a diff adds or changes, on the NEW side, per file (git diff -U0): {path: [[from, to], ...]}; a pure deletion is the line after it.
export function newSideRanges(diff) {
  const out = {};
  let file = '';
  for (const line of String(diff || '').split('\n')) {
    const header = /^\+\+\+ (?:b\/)?(.+)$/.exec(line);
    if (header) { file = header[1] === '/dev/null' ? '' : header[1]; continue; }
    const m = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (m && file) { const start = Number(m[1]), count = m[2] === undefined ? 1 : Number(m[2]); (out[file] ||= []).push(count === 0 ? [start + 1, start + 1] : [start, start + count - 1]); }
  }
  return out;
}

// The steps a change to a suite's OWN file touches: each changed line range inside a `ctx.run('<name>', ...)` picks that step; a line outside any literal step
// (the suite's setup, a helper, an import) runs the whole suite. -> {steps: [names], whole: bool}
export function stepsTouched(text, ranges) {
  const lines = String(text).split('\n'), offset = [0];
  for (const line of lines) offset.push(offset[offset.length - 1] + line.length + 1);
  const calls = stepCalls(text), out = {steps: [], whole: false};
  for (const [from, to] of ranges) {
    for (let n = Math.max(from, 1); n <= Math.min(Math.max(to, from), lines.length); n++) {   // line by line: a range across two steps picks both
      if (!lines[n - 1].trim() || /^\s*(\/\/|\/\*|\*)/.test(lines[n - 1])) continue;   // a blank or comment-only line changes no step (#1992: a header comment picked 17 suites)
      const a = offset[n - 1] + lines[n - 1].search(/\S/), b = offset[n - 1] + lines[n - 1].replace(/\s+$/, '').length - 1;
      // the innermost step holding the line; its own first line (`await ctx.run(...`) and its closing `});` count as inside it
      const holder = calls.filter(call => call.start <= offset[n] - 1 && a <= call.end && b <= call.end + 1).sort((x, y) => (x.end - x.start) - (y.end - y.start))[0];
      if (!holder?.name) out.whole = true;
      else if (!out.steps.includes(holder.name)) out.steps.push(holder.name);
    }
  }
  return out;
}

// One short Windows check on a PR that changes CI plumbing or shell (PR 3 of the PR-checks plan, owner's yes 26 Oct 2026): #1997's relay tar read "D:\a\_temp" as
// a host and every Windows suite went red, seen only by the next beta. The app launch, the relay and one settings step, on SQLite (no Notion lock to wait for).
export const WINDOWS_SMOKE = {suite: 'settings', steps: ['every Settings section renders']};
// Only what the Windows run itself runs counts (owner's yes to the e2e audit, 26 Oct 2026: any .github/ file started it, and a workflow COMMENT naming tools/ship.sh
// did: #2073, #2088 central-scout.yml, #2090 ship.sh, #2070 main-steps.yml): e2e-windows.yml, the local actions and workflows it uses, and the scripts its
// steps name (`ci`: windowsCiText). A comment names nothing.
const SHELL = /^(tools|desktop\/scripts)\/[^/]+\.sh$/;
export const WINDOWS_WORKFLOW = '.github/workflows/e2e-windows.yml';
const uncommented = text => String(text || '').replace(/(^|\s)#.*$/gm, '$1');
// The text the Windows run executes, comments dropped: e2e-windows.yml and every local action or workflow it `uses:` (read(path) -> text or null). -> {text, files}
export function windowsCiText(read) {
  const files = [WINDOWS_WORKFLOW], parts = [];
  for (let i = 0; i < files.length; i++) {
    const text = uncommented(read(files[i]));
    parts.push(text);
    for (const [, local] of text.matchAll(/uses:\s*\.\/(?:\.ci-relay\/)?(\.github\/[\w./-]+)/g)) {
      const file = /\.ya?ml$/.test(local) ? local : `${local.replace(/\/$/, '')}/action.yml`;
      if (!files.includes(file) && read(file) != null) files.push(file);
    }
  }
  return {text: parts.join('\n'), files};
}
const named = (file, text) => text.includes(file) || (file.startsWith('desktop/') && text.includes(file.slice('desktop/'.length)));
export const windowsSmoke = (files, ci = {text: '', files: [WINDOWS_WORKFLOW]}) =>
  files.some(file => ci.files.includes(file) || ci.files.some(used => used.endsWith('/action.yml') && file.startsWith(used.slice(0, -'action.yml'.length))) || (SHELL.test(file) && named(file, ci.text)));

// The suite that really runs a step found by its text: a suite file's steps can run in another suite that imports it (activityfailures.mjs runParts: its
// 'channels' steps run in failureschannels). #2137 (26 Oct 2026) removed text a channels step quotes; the step was picked for activityfailures, was "not
// found" there, and activityfailures ran whole again (6.5 min). A name the suite's recorded steps lack but another suite's have goes to that suite; a name no
// suite recorded (a new step) or a suite recorded without steps stays. map: the coverage map. -> [suites]
export function stepHomes(map, suite, name) {
  const suites = map?.suites || {}, has = other => Boolean(suites[other]?.steps?.[name]);
  if (!suites[suite]?.steps || has(suite)) return [suite];
  const others = Object.keys(suites).filter(other => other !== suite && has(other));
  return others.length ? others : [suite];
}

// stepsQuoting's {suite: {steps, whole}} and the hits behind it, each step moved to the suite that runs it (stepHomes). A suite left with no step and no
// whole-suite quote is no longer pointed at by text. -> {hits: {suite: Set}, quoting}
export function rehomeQuotes(hits, quoting, map) {
  const outHits = {}, outQuoting = {};
  const add = (suite, strings, name) => {
    const entry = outQuoting[suite] ||= {steps: [], whole: false};
    if (name && !entry.steps.includes(name)) entry.steps.push(name);
    for (const text of strings) (outHits[suite] ||= new Set()).add(text);
  };
  for (const [suite, entry] of Object.entries(quoting)) {
    const strings = [...(hits[suite] || [])];
    if (entry.whole) { add(suite, strings); outQuoting[suite].whole = true; }
    for (const name of entry.steps) for (const home of stepHomes(map, suite, name)) add(home, strings, name);
  }
  return {hits: outHits, quoting: outQuoting};
}
