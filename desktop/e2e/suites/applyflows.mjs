// The journeys half of the apply suite (docs/flows/applying.md): a posting whose Apply opens a new tab, then a "To apply" step; two applications side by side; a sign-up
// and a sign-in before the form; menus worded differently; an upload slot behind +; collapsed sections; the account and the application on one page; a closed form tab;
// a second browser; a wrong page kind; "I submitted it". `apply` runs the single forms and the tailored CV. One suite everywhere (13 Oct 2026: it was two copies, applycv
// on CI and applyflows on the Mac, with the same steps): the proxy replays the app's AI answers; each step waits on state with a measured hang cap, without an aggregate budget.
//     `npm run live` (LIVE=1): the live run on a real posting instead of the journeys, on this Mac's Claude Code (lib/engine.mjs flowsEngine; LIVE_ENGINE overrides).
// The suite uses SQLite or the local Notion stand-in (lib/notion-fake.mjs via openContext); it needs no Notion secret.
// Job: wait on state
import {partOf, runApply, stepNeeds as applyNeeds} from './apply.mjs';
import {answersMode} from '../lib/ai-answers.mjs';
import {flowsEngine} from '../lib/engine.mjs';

export {hangCaps} from '../lib/applyflows-caps.mjs';
export const stepNeeds = applyNeeds;
export const ownsStep = name => ['flows', 'live', 'both'].includes(partOf(name));   // its steps live in apply.mjs: a PR that changes one runs this suite (pr-suites.mjs)   // what a step needs when E2E_STEPS picks it (lib/runner.mjs wantedWords)

// Why (30 Oct 2026, owner redesign): fixture journeys never need a live model; npm run live explicitly opts into the real-site measurement.
export const offlineAi = !process.env.LIVE;
export const realAi = process.env.LIVE ? true : false;

export const varies = true;
export const minutes = 17;   // CI's job-limit plumbing, including setup and a retry; step hang caps decide whether a check is stuck
// Why (29 Oct 2026, a8, 21b): measured per-step hang caps catch hangs; cumulative runner slowness must not suppress later state checks
export const aggregateBudget = false;
export const shards = 2;   // the journeys take turns across two gate jobs (JP_REPLAY_SHARD, suites/apply.mjs runApply); a Mac run is the whole suite
export const stepSharded = true;   // its slices are steps, not recorded cases (test/suite-shards.test.mjs)
export const browser = true;
export const keepGoing = true;   // as `apply`: a failed journey never hides the others; the setup step is critical (suites/apply.mjs)
export const engine = flowsEngine();   // the proxy answers the app's AI calls (CI and the matrix); LIVE=1: this Mac's Claude Code; LIVE_ENGINE overrides (lib/engine.mjs)
export const macos = 'release';   // a release, a gate and the night run it on a macOS runner (the real Chrome extension, opened through `open` as on a Mac); a PR's run on Linux (lib/plan.mjs runnerOf)
export const name = 'applyflows';
/** Run fixture journeys only with declared answers; explicit LIVE delegates to real-site measurement. */
export const run = ctx => {
  if (!process.env.LIVE && answersMode() === 'off') throw new Error('applyflows is a backbone suite: set E2E_AI_ANSWERS=backbone');
  return runApply(ctx, process.env.LIVE ? ['live'] : ['flows']);
};   // LIVE=1: the live run on a real posting (npm run live), not the journeys
