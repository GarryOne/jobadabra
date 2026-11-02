/* global document */
// Job: wait on state
// Settings: every section renders, the CV check on real PDFs. Why (1 Nov 2026): Automatic backup and Your data (export / reset / import) moved to desktop/integration/store/data-roundtrip.test.mjs; the AI engine panel and ⌘K moved to desktop/integration/app/screen-settings.test.js.
// Was: every section, with each AI engine chosen. Starts from a set-up install (a key saved, a workspace connected).
import {snap} from '../lib/layout.mjs';
import {ensureSetUp} from '../lib/seed.mjs';
import {profileCvStep, profileDetailStep} from '../lib/profile-journey-steps.mjs';

export const name = 'settings';
import {hangCapsFor} from '../lib/hang-caps.mjs'; export const hangCaps = hangCapsFor('settings');
// Why (29 Oct 2026, owner, Rule B): measured per-step hang caps replace the aggregate clock; a slow runner is not a failed state assertion.
export const aggregateBudget = false;
// Why (29 Oct 2026, owner): settings saves keys without validation and parses CVs locally, so CI needs neither live AI nor an AI secret.
export const offlineAi = true;
export const realAi = false;
// One failed step never hides the rest: the runner records it and goes on (lib/runner.mjs); only the setup steps marked `critical` stop the suite.
export const keepGoing = true;

export async function run(ctx) {
  const {page} = ctx;
  ctx.findings = [];
  await ensureSetUp(ctx);
  await ctx.run('every Settings section renders', async () => {
    await page.click('.nav[data-view="settings"]:not([data-settings="profile"])');
    // The sections are the ones the page lists (Profile left Settings on 18 Oct 2026 and a fixed list failed the gate for three days).
    const SECTIONS = await page.evaluate(() => [...document.querySelectorAll('.settings-nav [data-settings-go]')].map(button => button.dataset.settingsGo));
    if (SECTIONS.length < 5) throw new Error(`Settings lists ${SECTIONS.length} sections: ${SECTIONS.join()}`);
    for (const section of SECTIONS) {
      // Profile is its own page (UI redesign fix 9, 18 Oct 2026): it hides Settings' list of sections, so the next one is reached through the menu's Settings.
      if (await page.isHidden('.settings-nav')) await page.click('.nav[data-view="settings"]:not([data-settings="profile"])');
      await page.click(`[data-settings-go="${section}"]`);
      await snap(ctx, `settings-${section}`, {view: 'settings'});
    }
  }, {needs: ctx.needs});
  // Why (2 Nov 2026, owner: "the e2e Profile journey keeps only the thin path a user takes"): J14 is two steps on the real app, the CV check's score and a detail reaching the extension (lib/profile-journey-steps.mjs).
  // The CV check on real PDFs is integration/app/cv-check.test.js; the Experience editor is integration/store/profile-experience-edit.test.mjs.
  await ctx.run('Profile CV: the CV is checked with the card\'s button and the card shows its Readability score', () => profileCvStep(ctx), {needs: ctx.needs});
  await ctx.run('Profile Your details: a phone edited and saved is what the extension is handed after the app is quit and started again', () => profileDetailStep(ctx), {needs: ctx.needs, data: true});
  // Why (1 Nov 2026, owner: "Only tier 1 … should stay e2e"; "None of these are critical user journeys"): 'Settings render without layout problems' (J17) is integration/app/screen-settings.test.js.
  // The Your data and Automatic backup steps (export with keys / reset / import, the backup file, Back up now, the due-at-start and weekly-tick backup; J10) are integration/store/data-roundtrip.test.mjs.
}
