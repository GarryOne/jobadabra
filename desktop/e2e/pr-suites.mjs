// Which e2e suites a PR runs (lib/pr-suites.mjs): the table of suites that quote UI text it removes, and with --plan the suites pr-suites.yml starts and waits for (they block the merge since 26 Oct 2026, gate G1a). Always exits 0: the e2e run decides.
//   node pr-suites.mjs --base origin/main          the table
//   node pr-suites.mjs --base origin/main --plan   also: `suites=a,b` and `steps={suite: [step names]}` for the PR run (workflow pr-suites.yml; needs the staged app files and installs, like e2e.yml's plan)
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {removedStrings, suitesExpecting, report, planPrSuites, stepsQuoting, windowsSmoke, windowsCiText, WINDOWS_SMOKE, newSideRanges, stepCalls, stepsTouched, rehomeQuotes, stepHomes, pointedWithMap} from './lib/pr-suites.mjs';
import {suitesFor} from './lib/plan.mjs';
import {suitesUsing, watchesWithImports} from './lib/import-graph.mjs';
import {hunksFromDiff, mapShas, stepNamesFor, steplessSuites, stepsCovering, stillWholeBy, storeFor} from './lib/coverage-pick.mjs';
import {STORES, WHY, whyLines} from './lib/pick-why.mjs';
import os from 'node:os';

const here = path.dirname(fileURLToPath(import.meta.url));
const base = process.argv[process.argv.indexOf('--base') + 1] || 'origin/main';
const git = args => execFileSync('git', args, {cwd: here, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024});
// The code → suite map (gate G1b): --map <file>, else the newest `e2e-coverage-map` artifact (e2e.yml's coverage-map job after a scheduled main run). None yet: {}.
function loadMap() {
  const file = process.argv.includes('--map') ? process.argv[process.argv.indexOf('--map') + 1] : '';
  try {
    if (file) return JSON.parse(fs.readFileSync(file, 'utf8'));
    const repo = process.env.GITHUB_REPOSITORY;
    if (!repo) return {};
    const run = execFileSync('gh', ['api', `repos/${repo}/actions/artifacts?name=e2e-coverage-map&per_page=1`, '--jq', '.artifacts[0].workflow_run.id // ""'], {encoding: 'utf8'}).trim();
    if (!run) return {};
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-coverage-'));
    execFileSync('gh', ['run', 'download', run, '-R', repo, '-n', 'e2e-coverage-map', '-D', dir], {stdio: 'ignore'});
    return JSON.parse(fs.readFileSync(path.join(dir, 'coverage-map.json'), 'utf8'));
  } catch (error) { console.log(`pr-suites: no coverage map (${error.message.split('\n')[0]}): the other picks only`); return {}; }
}
// The suites and STEPS whose recorded lines this PR changes: the diff from each suite's recorded commit to the PR's head, for the files the PR changes (a superset when
// main moved on). -> {map, picked: {suite: {steps, setup, whole, reason}}} (lib/coverage-pick.mjs stepsCovering).
function covered(changedFiles) {
  const map = loadMap(), bySha = {};
  if (!changedFiles.length) return {map, picked: {}};   // `git diff <sha> HEAD --` with no path would diff the whole repo since the map's commit
  for (const sha of mapShas(map)) { try { bySha[sha] = hunksFromDiff(git(['-C', '../..', 'diff', '-U0', sha, 'HEAD', '--', ...changedFiles])); } catch { /* commit not here: that suite is not picked by lines */ } }
  return {map, picked: stepsCovering(map, bySha)};
}
try {
  const changedFiles = git(['diff', '--name-only', `${base}...HEAD`]).split('\n').filter(Boolean);
  const strings = removedStrings(git(['diff', '-U0', `${base}...HEAD`, '--', '../']));
  const sources = {};
  for (const dir of ['suites', 'lib']) for (const name of fs.readdirSync(path.join(here, dir))) if (name.endsWith('.mjs')) sources[`${dir}/${name}`] = fs.readFileSync(path.join(here, dir, name), 'utf8');
  const out = report({strings, hits: suitesExpecting(strings, sources), changedFiles, sources});
  console.log(out.text);
  if (process.argv.includes('--plan')) {
    const {suiteFacts} = await import('./plan-run.mjs');
    const facts = await suiteFacts();
    const linux = {};
    for (const suite of facts.all) linux[suite] = (await facts.os(suite)) === 'ubuntu-24.04';
    const {map, picked: all} = covered(changedFiles);
    const picked = Object.fromEntries(Object.entries(all).filter(([suite]) => facts.all.includes(suite)));   // a suite removed since the map was made: gone
    const covering = Object.fromEntries(Object.entries(picked).map(([suite, p]) => [suite, p.reason]));
    // A suite a changed file points at runs whole, unless the step map recorded that file for it (a watched src/ Python file): then its lines pick the steps.
    const pointing = {...facts, watches: watchesWithImports(facts.watches), uses: suitesUsing(here)};
    // A changed file of steps (a suite, or a helper holding `ctx.run` steps: lib/apply-journeys.mjs) runs the steps the change touches, in each suite that runs them
    // (owner, 26 Oct 2026: "a change to a suite runs that suite's affected steps (apply/applyflows included)"); a file several suites share goes by each suite's
    // `ownsStep` (applyflows runs apply.mjs's 'flows' steps). A change outside a named step, or any other file (a plain helper, the extension, a watched file the map
    // has not seen), runs its suites whole.
    const added = newSideRanges(git(['diff', '-U0', `${base}...HEAD`, '--', 'suites/', 'lib/'])), users = suitesUsing(here), own = {}, byStep = new Set();
    for (const file of changedFiles.filter(name => /^desktop\/e2e\/(suites|lib)\/[^/]+\.mjs$/.test(name))) {
      const rel = file.slice('desktop/e2e/'.length), text = sources[rel] || '';
      if (!stepCalls(text).length) continue;   // no steps here: a plain helper (suitesFor below)
      const touched = stepsTouched(text, added[file] || []);
      if (touched.whole) continue;
      byStep.add(file);
      const suites = [...new Set([...(rel.startsWith('suites/') ? [rel.slice(7, -4)] : []), ...(users[rel] || [])])].filter(name => facts.all.includes(name));
      for (const suite of suites) {
        const owns = (await import(`./suites/${suite}.mjs`)).ownsStep || (() => true);
        // a step another suite runs (it imports this file) is that suite's (lib/pr-suites.mjs stepHomes)
        for (const name of touched.steps.filter(owns)) for (const home of stepHomes(map, suite, name)) if (facts.all.includes(home)) (own[home] ||= []).push(name);
      }
    }
    const exactWatches = {...pointing, watches: Object.fromEntries(Object.entries(pointing.watches).map(([suite, paths]) => [suite, paths.filter(path => !path.endsWith('/'))]))};
    const pointsAt = file => pointedWithMap(file, suitesFor([file], facts.all, pointing), suitesFor([file], facts.all, exactWatches), map);   // lib/pr-suites.mjs
    const pointedBy = stillWholeBy(changedFiles.filter(file => !byStep.has(file)), pointsAt, map), pointedElse = Object.keys(pointedBy);
    // Removed text → the steps that quote it, each in the suite that runs it (rehomeQuotes: #2137's channels step was picked in activityfailures).
    const {hits, quoting} = rehomeQuotes(suitesExpecting(strings, sources), stepsQuoting(suitesExpecting(strings, sources), sources), map);
    const pointed = [...new Set([...pointedElse, ...Object.keys(own)])];
    const plan = planPrSuites({pointed, hits, covering, linux: suite => linux[suite], cadence: facts.cadence});
    // Steps per suite: those its changed lines reach, those that quote removed UI text, those its own file's change touches. Whole: a suite a helper, the extension
    // or the harness points at, a change or a quote outside a named step, a line nobody ran.
    const byLines = stepNamesFor(picked), steps = {};
    for (const suite of plan.suites) {
      if (pointedElse.includes(suite) || quoting[suite]?.whole || (picked[suite] && !byLines[suite])) continue;
      const names = [...(byLines[suite] || []), ...(quoting[suite]?.steps || []), ...(own[suite] || [])];
      const real = names.filter(name => name !== '(setup)');
      steps[suite] = real.length ? [...new Set(real)] : names;
    }
    // The store each suite's picked steps run on: the one they were recorded on (lib/coverage-pick.mjs storeFor; #2156's settings and strategy picked steps that exist
    // only on the Notion stand-in, failed "not found" on SQLite and ran whole again). A step no store of the run has is named and left out.
    const stores = {}, dropped = {};
    for (const suite of Object.keys(steps)) {
      if (!map.suites?.[suite]?.stores) continue;
      const chosen = storeFor(map.suites[suite], steps[suite]);
      if (!chosen.steps.length) { delete steps[suite]; continue; }   // never happens (the chosen store has the most), but an empty list would run nothing
      stores[suite] = chosen.store; steps[suite] = chosen.steps;
      if (chosen.dropped.length) dropped[suite] = chosen.dropped;
    }
    const why = Object.entries(picked).map(([suite, p]) => `| \`${suite}\` | ${steps[suite] ? steps[suite].map(name => `"${name}"`).join(', ') : 'whole suite'} | ${p.reason} |`).join('\n');
    if (why) console.log(`\n### Steps that run the lines this PR changes (coverage map)\n\n| Suite | Steps | Why |\n|---|---|---|\n${why}\n`);
    const stepCount = Object.values(steps).reduce((sum, names) => sum + names.length, 0), whole = plan.suites.filter(suite => !steps[suite]);
    const reasons = whyLines({suites: plan.suites, steps, stores, dropped, picked, pointedBy, hits, quoting, own});
    console.log(`\n### Why each one runs (suite [store] · step ← the changed line that reached it)\n${reasons.join('\n')}\n`);
    console.log(`Precise: ${plan.suites.length} suite(s); ${stepCount} picked step(s) in ${Object.keys(steps).length}, ${whole.length} whole (${whole.join(', ') || 'none'})`);
    const stepless = steplessSuites(map);
    if (stepless.length) console.log(`Map: ${stepless.length} of ${Object.keys(map.suites).length} suites have no steps yet (${[...new Set(stepless.map(entry => `${entry.sha} ${entry.at}`))].join('; ')}): a line they ran picks them whole until a whole run of each records its steps`);
    const stepsOut = JSON.stringify({...steps, ...(Object.keys(stores).length ? {[STORES]: stores} : {}), [WHY]: reasons});   // two keys no suite has: e2e.yml reads steps by suite name
    console.log(`suites=${plan.suites.join(',')}\nleft=${plan.left.join(',')}\nsteps=${stepsOut}`);
    const ciText = windowsCiText(file => { try { return fs.readFileSync(path.join(here, '..', '..', file), 'utf8'); } catch { return null; } });
    const windows = windowsSmoke(changedFiles, ciText) ? JSON.stringify(WINDOWS_SMOKE.steps) : '';
    if (windows) console.log(`\nWindows: ${WINDOWS_SMOKE.suite} · ${WINDOWS_SMOKE.steps.join(', ')} (this PR changes CI plumbing or shell)`);
    if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `suites=${plan.suites.join(',')}\nleft=${plan.left.join(',')}\nsteps=${stepsOut}\nwindows=${windows}\n`);
  }
} catch (error) {
  console.log(`pr-suites: could not read the diff (${error.message.split('\n')[0]}); nothing reported`);
}
