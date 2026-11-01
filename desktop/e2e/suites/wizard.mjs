// The first-run path of a new install: key, CV, strategy, finish without Notion on this Mac's store (given at first start). One store leg: starting on Notion (Notion connected while that store
// is still empty: the store becomes Notion and the strategy moves in, "Start using Notion") is integration/store/wizard-start-on-notion.test.mjs (1 Nov 2026, wizard 2/2).
import {finish, visit} from '../lib/layout.mjs';
import {runWizard} from '../lib/wizard.mjs';

export const minutes = 20;
export const macos = true;   // runs on a macOS runner: the first run: the Keychain holds the keys it saves (lib/plan.mjs runnerOf)
export const name = 'wizard';
// Started with no store at all, as a new install is (newInstall): the app gives it this Mac. Pinned to this Mac's store: the journey (J1, "finishing the setup without Notion") has one store.
// Why (1 Nov 2026, a8, wizard 2/2): the stand-in leg only added the Notion start, whose AI answers were never recorded (wizard-standin red in 3 night burn-ins). A store with data stays at connect: suites/storemove.mjs.
export const store = 'sqlite';
export const fresh = true;
export const newInstall = true;
export async function run(ctx) {
  ctx.findings = [];
  await runWizard(ctx);
  await ctx.run('the first screens after setup render without layout problems', async () => {
    await visit(ctx, ['focus', 'jobs']);
    finish(ctx);
  }, {needs: ctx.needs});
}
