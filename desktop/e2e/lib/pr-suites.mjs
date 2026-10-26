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

// The suites to run ON the PR (they block its merge since 26 Oct 2026, gate G1a): the ones its files point at (plan.mjs suitesFor: a suite's own file, the extension, the harness)
// plus the ones that quote removed UI text, on the Linux runner only (a macOS suite is left to the gate: the Free plan runs few macOS jobs at once). No count cap since G1a:
// a capped suite was a suite the PR could break unseen; they run in parallel, so the PR waits for the slowest one, not their sum.
export function planPrSuites({pointed = [], hits = {}, linux, cadence = {}}) {
  const wanted = [...new Set([...pointed, ...Object.keys(hits)])].filter(suite => (cadence[suite] || 'always') !== 'manual');
  const onLinux = wanted.filter(suite => linux(suite));
  return {suites: onLinux, left: wanted.filter(suite => !onLinux.includes(suite))};
}
