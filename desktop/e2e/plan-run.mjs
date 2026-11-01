// What a run of .github/workflows/e2e.yml does, decided in one place and printed as step outputs (matrix, count, ref, tag, review):
// Job: pick the suites
//   node plan-run.mjs >> "$GITHUB_OUTPUT"      (env: EVENT, REPO, SHA, BEFORE, ONLY, PROMOTE_TAG, GATE_TAG, TARGET_REF; needs `gh` and GH_TOKEN)
// schedule: every suite, unless nothing changed since the last run and no finding waits. push: the suites whose files changed. manual: the ones named.
// GATE_TAG (the release run's "E2E · Mac + Linux", desktop.yml, or a gate by hand): every gate suite, on the release's own commit, and `tag` = the release to approve when
// all of them pass. Whatever the event: a gate called from a scheduled release run arrives as `schedule` (7 Oct 2026: one run per release, no workflow_run any more).
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {ensureStaged} from './lib/ensure-staged.mjs';
import {suitesUsing, watchesWithImports} from './lib/import-graph.mjs';
import {tolerantMatrixFlag, autoSuites, cadenceOf, exploreDecision, onWindows, runnerOf, noiseTripped, reviewNeeded, suitesFor, suitesNamed, suitePartsFor, waitingFindings} from './lib/plan.mjs';
import {nightRef, nightSuites, NIGHT_TITLE} from './lib/night-pass.mjs';
import {asIssues, REGISTER_LIST, registerEntries} from './lib/prejudge.mjs';
import {shardLegs, suiteOfKey, windowsMatrix} from './lib/suite-shards.mjs';
import {STORES, WHY} from './lib/pick-why.mjs';

// A PR's (or an after-merge run's) pr_steps: {suite: [step names], "(stores)": {suite: store}, "(why)": [lines]} (pr-suites.mjs). Unreadable: none.
export const prSteps = env => { try { const steps = JSON.parse(env.PR_STEPS || '{}'); return steps && typeof steps === 'object' && !Array.isArray(steps) ? steps : {}; } catch { return {}; } };

const realGh = args => execFileSync('gh', args, {encoding: 'utf8', maxBuffer: 20 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe']});   // gh's own error text stays out of the log (a failed call falls back below)

function offlineMatrixFlag(suite, offlineAi) {
  return offlineAi.includes(suite) ? {offlineAi: true} : {};
}

// Why (30 Oct 2026, beta 41078746088, owner's go on one fix for the class): a suite says itself that it answers its AI from the stored table (`aiAnswers`);
// every workflow reads matrix.aiAnswers. Three hand-kept lists in two workflows drifted: the beta ran applyflows, jobs, interviews and failuresnotion live.
function answersMatrixFlag(suite, backbone) {
  return backbone.includes(suite) ? {aiAnswers: 'backbone'} : {};
}

function prLegs(suite, shards, env, picks) {
  const pr = String(env.PR_SUITES || '').trim();
  const admitted = pr && picks['(burn-in)']?.includes(suite);
  const names = pr && !admitted ? picks['(step-burn-in)']?.[suite] : null;
  const normal = shardLegs(suite, shards[suite]);
  if (!admitted && !names?.length) return normal;
  // Why (2026-10-31, owner a8): admissions prove five whole journeys; new-step proof supplements the suite's ordinary PR journeys.
  // Offset proof keys by normal leg count, preserving suite-NofM parsing and uniqueness even when the suite already has five shards.
  const offset = admitted ? 0 : normal.length;
  const five = Array.from({length: 5}, (_, at) => ({key: `${suite}-${offset + at + 1}of${offset + 5}`, shard: '', burnIn: at + 1,
    ...(names?.length ? {burnInSteps: names, stepFilter: [...new Set(names.map(name => name.split(',')[0].trim()))].join(',')} : {})}));
  return admitted ? five : [...normal, ...five];
}

function aiPlanOutputs(suites, offlineAi, review) {
  // Why (29 Oct 2026, owner): an offline-only run must survive revoked AI keys and must not ask a screenshot reviewer either.
  const aiRequired = suites.some(suite => !offlineAi.includes(suite));
  return {ai_required: aiRequired ? '1' : '0', review: review && aiRequired ? '1' : '0'};
}

// all: every suite; cadence / watches: what each suite exports (lib/plan.mjs says what they mean).
// clean-code-ok: Why (29 Oct 2026, st): old function; this change adds one option to its signature (offlineAi) and its score falls (63 to 62)
export async function planRun({env, gh = realGh, all, minutes, os = async () => 'macos-latest', cadence = {}, watches = {}, parts = {}, judges = {}, varies = [], sameOnEveryOs = [], storeless = [], shards = {}, offlineAi = [], backbone = []}) {
  const {EVENT: event, REPO: repo, SHA: sha} = env;
  // TARGET_REF (the gate, the soak top-ups and the stable canary): test THAT release's commit, with this workflow file. The workflow file of an old tag does not know newer
  // inputs (canary, soak), so the run is started on main and told which tag to check out.
  // NIGHT_PASS ("3/5", lib/night-pass.mjs): one of the five nightly full runs; each tests the commit of pass 1.
  const night = env.NIGHT_PASS ? nightRef({pass: env.NIGHT_PASS, sha, now: Date.now(), runs: JSON.parse(gh(['run', 'list', '-R', repo, '--workflow', 'e2e.yml', '-L', '40', '--json', 'headSha,createdAt,displayTitle']) || '[]')}) : null;
  const targetRef = env.TARGET_REF || (night && night.ref !== sha ? night.ref : '');
  let target = '';
  if (targetRef) {
    try { target = gh(['api', `repos/${repo}/commits/${targetRef}`, '-q', '.sha']).trim(); } catch { throw new Error(`target_ref ${targetRef} is not a commit of ${repo}`); }
  }
  const ref = target || sha;
  const lines = text => String(text || '').split('\n').map(line => line.trim()).filter(Boolean);
  const changed = (from, to) => { try { return lines(gh(['api', `repos/${repo}/compare/${from}...${to}`, '--paginate', '-q', '.files[]?.filename'])); } catch { return null; } };
  const json = args => { try { return JSON.parse(gh(args)); } catch { return []; } };

  const runs = json(['run', 'list', '-R', repo, '--workflow', 'e2e.yml', '--status', 'completed', '-L', '60', '--json', 'event,headSha,conclusion,createdAt,displayTitle']);
  // A run tested something only when it ended green or red. A run that planned no suite ends cancelled (e2e.yml "Nothing tested", gate G7, 26 Oct 2026): it is never the
  // last tested commit and never one of a commit's looks. Before G7 it ended green: on 25 Oct two runs skipped while beta 2 ran, read as green, and counted as looks.
  const tested = run => ['success', 'failure'].includes(run.conclusion);
  // Runs that test something else (a release, a mutation, one bisect step at an older commit: gate G2b), a PR's branch (the run list is every branch's), or a few
  // steps after a merge (main-steps.yml: not a look; the nightly full run stays) are never main's last tested commit nor its looks.
  const otherCode = run => /^(Stable canary|RC soak|Gate|Beta E2E tests|Night burn-in|Mutant|Bisect|E2E for PR ·|E2E after merge ·|E2E check · outside world) /.test(run.displayTitle || '');
  const lastSha = runs.find(run => run.event !== 'push' && tested(run) && !otherCode(run))?.headSha || '';
  const issues = json(['issue', 'list', '-R', repo, '--label', 'auto-ui', '--state', 'open', '--limit', '300', '--json', 'number,state,labels,body,comments,createdAt']);
  const waiting = waitingFindings(issues);
  // Runs of main's code on this commit (a gate run, a release candidate's top-up or the stable canary tests another commit under main's name: not these).
  const own = run => run.headSha === ref && tested(run) && run.event !== 'push' && run.event !== 'workflow_run' && !otherCode(run);
  let exploring = false, why = '';

  let changedFiles = [], pushReach = [];
  let suites = [], tag = '';
  if (event === 'push') {
    changedFiles = changed(env.BEFORE, sha) || ['desktop/e2e/suite.mjs'];
    const pointing = {watches: watchesWithImports(watches), cadence, uses: suitesUsing(path.dirname(fileURLToPath(import.meta.url)))};
    suites = suitesFor(changedFiles, all, pointing);
    pushReach = changedFiles.filter(file => suitesFor([file], all, pointing).includes('qualityai'));
  }
  else if (env.PROMOTE_TAG) suites = [];   // a manual dry run of the promotion step: no suites
  // A night pass: the beta's own layout (the gate's suites, both stores), without the release steps and without a paid model. A release run that is testing owns the per-suite groups, so the pass
  // skips itself rather than cancel a gate job waiting there (the same rule as a scheduled run's, below).
  else if (night) {
    const releasing = json(['run', 'list', '-R', repo, '--workflow', 'desktop.yml', '-L', '5', '--json', 'status,displayTitle']).filter(run => run.status !== 'completed' && !/^Build only/.test(run.displayTitle || ''));
    suites = releasing.length ? [] : nightSuites(all, cadence, night.pass);
    why = releasing.length ? `${NIGHT_TITLE} ${night.pass}/5 skipped: a release run is testing (${releasing[0].displayTitle})` : night.why;
  }
  // The gate: the release run calls it only for a release it built (a nightly or a beta by hand, desktop.yml), or a gate by hand. Always + nightly suites, not the manual ones.
  else if (env.GATE_TAG) {
    tag = env.GATE_TAG; suites = autoSuites(all, cadence);
    // A beta by hand (GATE_KIND=beta) is often a re-run: a nightly-only suite (quality: Sonnet, ~$0.30 a run) runs only when what it watches changed since the
    // last release approved for Mac, whose gate it passed (the nightly) or had nothing to judge. The nightly always runs it (owner, 7 Oct 2026: "$30 a week").
    if (env.GATE_KIND === 'beta') {
      const nightly = suites.filter(suite => cadence[suite] === 'nightly');
      let base = '';
      for (const {tagName} of json(['release', 'list', '-R', repo, '-L', '15', '--exclude-drafts', '--json', 'tagName'])) {   // `release list` has no body field: read each release
        if (tagName === tag) continue;
        if (/^Beta-approved:/m.test(json(['release', 'view', tagName, '-R', repo, '--json', 'body']).body || '')) { try { base = gh(['api', `repos/${repo}/commits/${tagName}`, '-q', '.sha']).trim(); } catch { /* unreadable: run it */ } break; }
      }
      const files = base ? changed(base, ref) : null;
      const skip = nightly.filter(suite => files && !files.some(file => [...(watches[suite] || []), ...(judges[suite] || [])].some(watched => file === watched || file.startsWith(watched))));   // judges: a changed prompt the suite judges runs it (#2234)
      if (skip.length) { suites = suites.filter(suite => !skip.includes(suite)); why = `${skip.join(', ')} not run: nothing it watches changed since the last Mac-approved release (the nightly runs it)`; }
    }
  }
  // Why (30 Oct 2026, a8, #2502): the outside world has its own daily cron (e2e.yml OUTSIDE), never inferred from run history: the Worker starts looks as dispatches.
  else if (env.OUTSIDE) suites = all.filter(suite => cadence[suite] === 'outside');
  else if (event === 'schedule') {   // the three-a-day schedule: the always suites, on a new commit, for a finding that waits, or while exploring still finds something
    const decision = exploreDecision({head: ref, lastSha, runsOnHead: runs.filter(own)});
    exploring = decision.exploring; why = decision.why;
    // A release run is testing (desktop.yml, both lanes at once, 7 Oct 2026): its gate jobs wait in the per-suite groups (e2e-<suite>), and a newer job queued in a group
    // CANCELS the one already waiting there. A scheduled run then would cancel the release's gate: it skips, and the next one runs.
    const releasing = json(['run', 'list', '-R', repo, '--workflow', 'desktop.yml', '-L', '5', '--json', 'status,displayTitle']).filter(run => run.status !== 'completed' && !/^Build only/.test(run.displayTitle || ''));
    if (releasing.length) { decision.run = false; why = `a release run is testing (${releasing[0].displayTitle}): skipped, so its gate jobs are not cancelled in the shared suite groups`; }
    // Exploring (an unchanged commit): only the suites that walk a different path each run; the others would repeat themselves at full cost. None vary: nothing to explore.
    suites = !decision.run ? [] : decision.exploring ? autoSuites(all, cadence, true).filter(suite => varies.includes(suite)) : autoSuites(all, cadence, true);
  }
  // names: exactly those, even a manual one; none: everything not manual. A release's repeat (TARGET_REF without a gate: a soak top-up, the stable canary) leaves the slim ones out.
  else suites = String(env.ONLY || '').trim() ? suitesNamed(env.ONLY, all) : autoSuites(all, cadence, false, !!env.TARGET_REF);

  // Stale PR/after-merge dispatch inputs must never reintroduce the outside world.
  if (env.PR_SUITES || event === 'pull_request') suites = suites.filter(suite => !['outside', 'night-report'].includes(cadence[suite]));

  const files = lastSha ? changed(lastSha, ref) : null;
  let review = !night && (exploring || reviewNeeded({files: files || [], waiting, known: files !== null}));   // an exploring run exists for what the AI review sees
  if (review) {   // the noise breaker: no AI tokens on a review whose recent issues were mostly noise
    try {
      const issues = JSON.parse(gh(['issue', 'list', '--label', 'auto-ui', '--state', 'all', '--limit', '300', '--json', 'number,state,stateReason,labels,comments,createdAt']));
      // Noise judged before filing never became an issue: it still counts against the review (lib/prejudge.mjs asIssues).
      const judged = asIssues(registerEntries(JSON.parse(gh(REGISTER_LIST))[0]?.body));
      const noise = noiseTripped([...issues, ...judged]);
      // While tripped, a scheduled run still reviews (a probe, 9 Oct 2026): a paused review finds nothing real, so it could never earn its way back.
      if (noise.tripped && event === 'schedule') why = `${why ? `${why} · ` : ''}AI review on as a probe: ${noise.noise} of the last ${noise.judged} judged review issues were noise (the noise breaker, lib/plan.mjs)`;
      else if (noise.tripped) { review = false; why = `${why ? `${why} · ` : ''}AI review paused: ${noise.noise} of the last ${noise.judged} judged review issues were noise (the noise breaker, lib/plan.mjs)`; }
    } catch { /* cannot tell: the review runs */ }
  }
  // The store (lib/store.mjs, P7): the gate runs every suite that keeps data on BOTH stores of the same build (owner, 9 Oct 2026), as two jobs: `key` names
  // each one's job, artifacts, caches and group (the stand-in's ends in -standin: triage.mjs suiteOf drops it). Any other run: one job, the store alternating by run number.
  // GATE_STORE_LEGS=one (the release run, desktop.yml): ONE job per suite. Its copy of the Mac job never passed `E2E_STORE` from the leg, so both legs ran the SAME store (the one the
  // run number picks): a duplicate that waited on its twin in the suite's group, and a third contender for GitHub's single waiting slot there when the Windows job of the suite
  // arrived (15 of 41 Mac jobs cancelled, 10 Oct 2026). Both stores in one job is the next step; until then one leg loses nothing the duplicate covered.
  // A PR's run: each suite on the store its picked steps were recorded on (pr-suites.mjs "(stores)"; e2e.yml falls back to SQLite).
  const picks = prSteps(env);
  const prStores = String(env.PR_SUITES || '').trim() ? picks[STORES] || {} : {};
  // Only suites handed step names can need a renamed-pick fallback; each leg carries the same roster for both attempts.
  const fallbackSuites = suites.filter(suite => Array.isArray(picks[suite]) && picks[suite].length > 0).join(',');
  const legs = key => ((env.GATE_TAG || night) && env.GATE_STORE_LEGS !== 'one' && !storeless.includes(suiteOfKey(key)) ? [{store: 'sqlite', key}, {store: 'standin', key: `${key}-standin`}] : [{store: prStores[suiteOfKey(key)] || '', key}]);
  // A suite with `shards` is one job per slice (lib/suite-shards.mjs), on both lanes: the recorded replay outgrew one job's budget (13 Oct 2026).
  const qualityParts = env.PR_SUITES ? picks['(parts)']?.qualityai || ['journey']
    : event === 'push' ? suitePartsFor(changedFiles, watchesWithImports(parts.qualityai || {}), pushReach)
    : !env.GATE_TAG && event === 'workflow_dispatch' && String(env.ONLY || '').split(',').map(name => name.trim()).includes('qualityai:mail') ? ['mail'] : ['journey'];
  const include = [];
  for (const suite of suites) for (const slice of prLegs(suite, shards, env, picks)) for (const leg of legs(slice.key)) include.push({suite, ...(suite === 'qualityai' ? {qualityParts: qualityParts.length ? qualityParts : ['journey']} : {}), ...tolerantMatrixFlag(suite), fallbackSuites: slice.burnIn ? '' : fallbackSuites, ...offlineMatrixFlag(suite, offlineAi), ...answersMatrixFlag(suite, backbone), ...slice, ...leg, minutes: await minutes(suite), os: await os(suite, {pr: !!String(env.PR_SUITES || '').trim()})});
  if (env.AI_ANSWERS === 'record') {
    const blocked = include.find(leg => leg.offlineAi && !leg.burnIn);
    if (blocked) throw new Error(`suite ${blocked.suite} declares offlineAi, so it cannot record: record from a branch where it does not declare it, then declare it`);
  }
  // Windows runs apply and the settings smoke of these (lib/plan.mjs WINDOWS, the e2e audit 26 Oct 2026), never one that judges what is the same on every OS
  // (quality: the AI's answers; owner, 7 Oct 2026: Windows paid $1.36 a day for it).
  const windows = onWindows(suites.filter(suite => !sameOnEveryOs.includes(suite)));
  return {...aiPlanOutputs(suites, offlineAi, review), matrix: JSON.stringify({include}), count: String(include.length), suites: suites.join(','), windows_suites: windows.join(','), windows_matrix: JSON.stringify(windowsMatrix(windows, shards)), ref, tag, why};
}

// What every suite says about itself (cadence, watches, varies, minutes, runner): planRun's inputs from the real suites. plan-windows.mjs plans the Windows gate with it too.
export async function suiteFacts() {
  ensureStaged(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));   // suites/apply.mjs imports app code that needs desktop/shared/, which CI never staged (a crash hidden by the workflow's pipe)
  const {SUITES} = await import('./lib/context.mjs');
  const cadence = {}, watches = {}, parts = {}, judges = {}, varies = [], sameOnEveryOs = [], storeless = [], shards = {}, offlineAi = [], backbone = [];
  for (const suite of SUITES) { const module = await import(`./suites/${suite}.mjs`); if (module.aiAnswers === 'backbone') backbone.push(suite); if (cadenceOf(suite, module)) cadence[suite] = cadenceOf(suite, module); if (module.watches) watches[suite] = module.watches; parts[suite] = module.parts; if (module.judges) judges[suite] = module.judges; if (module.offlineAi) offlineAi.push(suite); if (module.varies) varies.push(suite); if (module.shards > 1) shards[suite] = module.shards; if (module.sameOnEveryOs) sameOnEveryOs.push(suite); if (module.notion === false || module.light || module.store) storeless.push(suite); }   // storeless: no store to vary (no Notion part, a model-only eval, or a store of its own)
  return {all: SUITES, cadence, watches, parts: Object.fromEntries(Object.entries(parts).filter(([, value]) => value)), judges, varies, sameOnEveryOs, storeless, shards, offlineAi, backbone, minutes: async suite => (await import(`./suites/${suite}.mjs`)).minutes || 15,
    os: async (suite, options) => runnerOf(await import(`./suites/${suite}.mjs`), options)};
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const out = await planRun({env: process.env, ...(await suiteFacts())});
  for (const [key, value] of Object.entries(out)) console.log(`${key}=${value}`);
  const suites = [...new Set(JSON.parse(out.matrix).include.map(item => item.suite))];   // the matrix has one entry per OS
  console.error([`### E2E plan · commit \`${String(out.ref).slice(0, 7)}\``,
    `- **Suites (${suites.length}):** ${suites.map(suite => `\`${suite}\``).join(' ') || '(none)'}`,
    ...(out.tag ? [`- **Promotes:** \`${out.tag}\` when all pass`] : []),
    `- **AI review:** ${out.review === '1' ? 'on' : 'off'}`,
    ...(out.why ? [`- **Note:** ${out.why}`] : []), ''].join('\n'));
  // Why each picked step or whole suite runs, with the changed line that reached it (pr-suites.mjs; owner on #2156, 27 Oct 2026: "Is that correct?").
  const reasons = prSteps(process.env)[WHY];
  if (Array.isArray(reasons) && reasons.length) console.error(`Why each one runs (suite [store] · step ← the changed line that reached it):\n${reasons.map(line => `  ${line}`).join('\n')}\n`);
}
