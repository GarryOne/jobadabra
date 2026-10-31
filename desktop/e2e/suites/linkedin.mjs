// LinkedIn jobs on every Find jobs (owner, 31 Oct 2026; PR 2b of 3, spec docs/superpowers/specs/2026-10-31-linkedin-headless-design.md): the person's own press with the switch on reads a
// stand-in for www.linkedin.com in the app's hidden browser with a FAKE copied session, stops at a sign-in page, a check or a 429, ends on Stop, and leaves the session nowhere.
// Why (31 Oct 2026, a8): its own small suite: putting it in the jobs suite would add Chromium and the forms server to every jobs run, and the apply suite has an 11-minute budget and is flakier.
// The steps are in lib/linkedin-steps.mjs; the fixture is lib/linkedin-fixture.mjs. Never the owner's LinkedIn, Chrome profile or Keychain: the session is a fake in the run's secrets file.
import {ensureSetUp} from '../lib/seed.mjs';
import {hangCapsFor} from '../lib/hang-caps.mjs';
import {runLinkedinSteps} from '../lib/linkedin-steps.mjs';

export const name = 'linkedin';
export const minutes = 12;
export const keepGoing = true;   // a red step does not hide the others (a wall, a Stop and a leak are separate facts)
export const browser = true;   // the forms server (www.linkedin.com is one of its hosts) and the hidden browser's host map
export const needsChromium = true;   // CI installs Chromium for it (.github/workflows/e2e.yml)
// Why (31 Oct 2026, a8): no AI at all; a backbone suite fails any ask without a stored answer (aiMissesMax 0) and the stand-in must never reach a real model.
export const offlineAi = true;
export const realAi = false;
export const aiAnswers = 'backbone';
export const store = 'sqlite';
// Why (31 Oct 2026): the suite asks no AI question, so it takes the stand-in's API engine on a Mac too (lib/engine.mjs pickEngine) and needs no signed-in Claude Code to run one step locally.
export const engine = 'api';
export const hangCaps = hangCapsFor('linkedin');
// Why (30 Oct 2026, owner, Rule B): measured per-step hang caps replace the aggregate clock.
export const aggregateBudget = false;

/** Sets the app up, then plays the seven LinkedIn steps (lib/linkedin-steps.mjs) on the stand-in site; a failed step is reported by name, the run goes on (keepGoing). */
export async function run(ctx) {
  await ensureSetUp(ctx);
  await runLinkedinSteps(ctx);
}
