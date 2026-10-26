// The journeys half of the apply suite (docs/flows/applying.md): a posting whose Apply opens a new tab, then a "To apply" step; two applications side by side; a sign-up
// and a sign-in before the form; menus worded differently; an upload slot behind +; collapsed sections; the account and the application on one page; a closed form tab;
// a second browser; a wrong page kind; "I submitted it". `apply` runs the single forms and the tailored CV. One suite everywhere (13 Oct 2026: it was two copies, applycv
// on CI and applyflows on the Mac, with the same steps):
//   - CI (the schedule, the release and Windows gates; not on PRs since 13 Oct 2026, owner): the API proxy's replayed answers, the default 7-minute budget, a macOS runner.
//   - A Mac (`npm run flows`, the scenario matrix): the same proxy, a 10-minute budget (a first run builds the workspace with the wizard's path).
//     `npm run live` (LIVE=1): the live run on a real posting instead of the journeys, on this Mac's Claude Code (lib/engine.mjs flowsEngine; LIVE_ENGINE overrides).
// Its own Notion token either way (E2E_NOTION_TOKEN_APPLYFLOWS: a CI secret; Keychain job-pilotto.e2e.notion_token_applyflows on a Mac).
import {partOf, runApply, stepNeeds as applyNeeds} from './apply.mjs';
import {flowsEngine} from '../lib/engine.mjs';

const ci = !!process.env.CI;
export const stepNeeds = applyNeeds;
export const ownsStep = name => ['flows', 'live', 'both'].includes(partOf(name));   // its steps live in apply.mjs: a PR that changes one runs this suite (pr-suites.mjs)   // what a step needs when E2E_STEPS picks it (lib/runner.mjs wantedWords)

export const varies = true;
export const minutes = 17;   // CI's job limit: a first attempt may use the default 7-minute budget and the retry ('once more, to tell flaky from real') another 7, plus setup (15 since 096c8fa cut a slow retry short; test/suite-retry-room.test.mjs)
export const budgetMinutes = ci ? 0 : 10;   // a Mac's first run builds the workspace once with the wizard's path (10); CI: the default 7, each of its two slices takes ~3.5 min (24 Oct 2026: the whole suite took ~6 of 7 and its retry ran out)
export const shards = 2;   // the journeys take turns across two gate jobs (JP_REPLAY_SHARD, suites/apply.mjs runApply); a Mac run is the whole suite
export const stepSharded = true;   // its slices are steps, not recorded cases (test/suite-shards.test.mjs)
export const browser = true;
export const keepGoing = true;   // as `apply`: a failed journey never hides the others; the setup step is critical (suites/apply.mjs)
export const engine = flowsEngine();   // the proxy answers the app's AI calls (CI and the matrix); LIVE=1: this Mac's Claude Code; LIVE_ENGINE overrides (lib/engine.mjs)
export const macos = 'release';   // a release, a gate and the night run it on a macOS runner (the real Chrome extension, opened through `open` as on a Mac); a PR's run on Linux (lib/plan.mjs runnerOf)
export const name = 'applyflows';
export const run = ctx => runApply(ctx, process.env.LIVE ? ['live'] : ['flows']);   // LIVE=1: the live run on a real posting (npm run live), not the journeys
