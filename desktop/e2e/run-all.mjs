// Runs the suites on this Mac, one after the other (or a few at a time), and prints one table:   npm run all
//   npm run all                        every suite that is not manual (what a manual CI run with no names does)
//   npm run all -- --only jobs,quality  exactly these, even a manual one
//   npm run all -- --manual            also the manual suites (personas)
//   npm run all -- --skip quality,wizard  leave these out;   --parallel 3  three at a time (needs each suite's own Notion token)
// Secrets come from the environment, else from the macOS Keychain (job-pilotto.e2e.notion_token, .notion_token_<suite>; never the Anthropic key). A suite without its
// own token falls back to the wizard's (lib/context.mjs), so on a Mac without them the suites must run one at a time (the default).
import {execFileSync, spawn} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {autoSuites, suitesNamed} from './lib/plan.mjs';
import {SKIPPED, summarize} from './lib/skip.mjs';
import {heavy} from './lib/heavy.mjs';
import {localRunRefused} from './lib/local-run.mjs';
// No whole suite on the Mac: CI runs them on every PR (lib/local-run.mjs); asked before the lock, so nobody queues behind a refused run. Only when run as a script (tests import this file).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) && !process.argv.some(arg => arg === '--list' || arg === '--help')) {
  const why = localRunRefused();
  if (why) { console.error(why); process.exit(2); }
}
heavy('e2e-all', import.meta.url);   // one heavy run at a time on this Mac (tools/heavy-lock.sh)

const HERE = path.dirname(fileURLToPath(import.meta.url));

// -> the suites to run, in order. only: names (all of them allowed); skip: names to leave out; manual: include the manual suites.
export function pickSuites({all, cadence = {}, only = '', skip = '', manual = false}) {
  const names = text => String(text || '').split(',').map(name => name.trim()).filter(Boolean);
  const chosen = names(only).length ? suitesNamed(only, all) : manual ? all : autoSuites(all, cadence);
  const unknown = names(skip).filter(name => !all.includes(name));
  if (unknown.length) throw new Error(`unknown suite to skip: ${unknown.join(', ')}`);
  return chosen.filter(suite => !names(skip).includes(suite));
}

// -> how many suites run at once when --parallel is not given: 4 when every chosen suite has its own Notion token (they then share no page), else one after the other
// (a suite without its own token falls back to the wizard's page, and two on one page break each other). Four, not eight: on a 16 GB Mac more windows run it out of memory
// and Chromium kills their renderers (6 Oct 2026: "renderer gone, killed" with 373 MB free).
export function defaultParallel(suites, env = {}, {most = 4} = {}) {
  return suites.length > 1 && suites.every(suite => env[`E2E_NOTION_TOKEN_${suite.toUpperCase()}`]) ? Math.min(most, suites.length) : 1;
}

// -> the secrets a run needs that are not in the environment yet, read from the Keychain (nothing is printed or written).
// The suites whose Notion tokens a run needs: each suite's own, or the one it borrows (`notionTokenOf`: notion-real uses failuresnotion's).
export const tokenSuites = (suites, tokenOf = {}) => [...new Set(suites.map(suite => tokenOf[suite] || suite))];

export function keychainEnv(suites, {env = process.env, read = defaultRead} = {}) {
  // The Anthropic key is never read here: the e2e on a Mac runs on Claude Code (lib/engine.mjs), and CI gets its key from GitHub's secrets.
  const wanted = [['E2E_NOTION_TOKEN', 'notion_token'], ...suites.map(suite => [`E2E_NOTION_TOKEN_${suite.toUpperCase()}`, `notion_token_${suite}`])];
  const found = {};
  for (const [variable, item] of wanted) {
    if (env[variable]) continue;
    const value = read(`job-pilotto.e2e.${item}`);
    if (value) found[variable] = value;
  }
  return found;
}
function defaultRead(service) {
  if (process.platform !== 'darwin') return '';
  try { return execFileSync('security', ['find-generic-password', '-a', 'job-pilotto', '-s', service, '-w'], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']}).trim(); } catch { return ''; }
}

const run = (suite, env, quiet) => new Promise(resolve => {
  const started = Date.now();
  const log = quiet ? fs.openSync(path.join(HERE, 'artifacts', `${suite}.run.log`), 'w') : null;
  const child = spawn('node', ['suite.mjs', suite], {cwd: HERE, env: {E2E_SKIP_EXIT: String(SKIPPED), ...env}, stdio: quiet ? ['ignore', log, log] : 'inherit'});
  child.on('exit', code => resolve({suite, code: code ?? 1, seconds: Math.round((Date.now() - started) / 1000)}));
});

// -> what is wrong with the command line, or []. Every word must be a known flag or a value-flag's value: a bare word is refused, never ignored
// (9 Oct 2026: `node run-all.mjs applyflows` ran all 24 suites, each clearing its own Notion test page; a suite's name goes after --only).
const VALUE_FLAGS = ['--only', '--skip', '--parallel'], PLAIN_FLAGS = ['--manual'];
export function argProblems(args, suites = []) {
  const problems = [];
  for (let at = 0; at < args.length; at++) {
    const word = args[at];
    if (PLAIN_FLAGS.includes(word)) continue;
    if (VALUE_FLAGS.includes(word)) { if (!args[at + 1] || args[at + 1].startsWith('--')) problems.push(`${word} needs a value`); else at++; continue; }
    problems.push(suites.includes(word) ? `"${word}" is not a flag: to run that suite, use --only ${word}` : `unknown argument "${word}" (known: ${[...VALUE_FLAGS, ...PLAIN_FLAGS].join(', ')})`);
  }
  return problems;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const option = flag => { const at = process.argv.indexOf(flag); return at < 0 ? '' : process.argv[at + 1] || ''; };
  (await import('./lib/ensure-staged.mjs')).ensureStaged(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));   // the suites load app code that needs desktop/shared/ (test/ensure-staged.test.mjs)
  const {SUITES} = await import('./lib/context.mjs');
  const cadence = {}, tokenOf = {};   // tokenOf: a suite that uses another's Notion token (notion-real) gets that Keychain item loaded
  for (const suite of SUITES) { const module = await import(`./suites/${suite}.mjs`); if (module.cadence) cadence[suite] = module.cadence; if (module.notionTokenOf) tokenOf[suite] = module.notionTokenOf; }
  const wrong = argProblems(process.argv.slice(2), SUITES);
  if (wrong.length) { console.error(`run-all: ${wrong.join('; ')}`); process.exit(2); }
  let suites;
  try { suites = pickSuites({all: SUITES, cadence, only: option('--only'), skip: option('--skip'), manual: process.argv.includes('--manual')}); } catch (error) { console.error(error.message); process.exit(2); }
  const env = {...process.env, ...keychainEnv(tokenSuites(suites, tokenOf))};
  const parallel = Math.max(1, Number(option('--parallel')) || defaultParallel(suites, env));
  console.log(`Running ${suites.length} suite(s)${parallel > 1 ? `, ${parallel} at a time` : ' one after the other'}: ${suites.join(', ')}\n`);
  fs.mkdirSync(path.join(HERE, 'artifacts'), {recursive: true});
  const minutes = {};
  for (const suite of suites) minutes[suite] = (await import(`./suites/${suite}.mjs`)).minutes || 15;
  const results = [], queue = parallel > 1 ? [...suites].sort((a, b) => minutes[b] - minutes[a]) : [...suites];   // the longest first, so the last suite to start is a short one
  await Promise.all(Array.from({length: parallel}, async () => {
    while (queue.length) results.push(await run(queue.shift(), env, parallel > 1));
  }));
  results.sort((a, b) => suites.indexOf(a.suite) - suites.indexOf(b.suite));
  const summary = summarize(results, {parallel, requireSecrets: env.E2E_REQUIRE_SECRETS === '1'});
  console.log('\n' + summary.text);
  process.exit(summary.exit);
}
