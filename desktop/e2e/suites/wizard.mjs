// The first-run path of a new install: key, CV, strategy, finish without Notion on this Mac's store (given at first start). One store leg: starting on Notion (Notion connected while that store
// is still empty: the store becomes Notion and the strategy moves in, "Start using Notion") is integration/store/wizard-start-on-notion.test.mjs (1 Nov 2026, wizard 2/2).
import {runWizard} from '../lib/wizard.mjs';

export const minutes = 20;
export const macos = true;   // runs on a macOS runner: the first run: the Keychain holds the keys it saves (lib/plan.mjs runnerOf)
export const name = 'wizard';
// Started with no store at all, as a new install is (newInstall): the app gives it this Mac. Pinned to this Mac's store: the journey (J1, "finishing the setup without Notion") has one store.
// Why (1 Nov 2026, a8, wizard 2/2): the stand-in leg only added the Notion start, whose AI answers were never recorded (wizard-standin red in 3 night burn-ins). A store with data stays at connect: integration/store/wizard-start-on-notion.test.mjs.
export const store = 'sqlite';
// Why (2 Nov 2026, owner: "A: remove exact matching"; betas 16, 17, 18 red on wizard): its AI asks are answered by name from the stored table, never by the request's exact text,
// which every edit upstream of an ask changed (#2926's template, then #2963's demo draft moved the organize ask's heading ids). A missing name fails, naming it (test/ai/wizard-named-answers.test.mjs).
export const aiAnswers = 'backbone';   // plan-run.mjs puts it in the suite's matrix entry
export const fresh = true;
export const newInstall = true;
export async function run(ctx) {
  await runWizard(ctx);
  // The first screens after setup, laid out: suites/interactions.mjs (night-report) takes the Finder shots of Focus and Jobs on a set-up install (moved 1 Nov 2026, 6/6a-2).
}
