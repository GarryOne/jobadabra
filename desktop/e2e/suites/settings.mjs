/* global document, window */
// Job: wait on state
// Settings: every section renders, the CV check on real PDFs. Why (1 Nov 2026): Automatic backup and Your data (export / reset / import) moved to desktop/integration/store/data-roundtrip.test.mjs; the AI engine panel and ⌘K moved to desktop/integration/app/screen-settings.test.js.
// Was: every section, with each AI engine chosen. Starts from a set-up install (a key saved, a workspace connected).
import {snap} from '../lib/layout.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {FIXTURES} from '../lib/cvfixtures.mjs';
import {ensureSetUp} from '../lib/seed.mjs';
import {profileExperienceStep} from '../lib/profile-experience-step.mjs';

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
  const {page, app} = ctx;
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
  await ctx.run('the CV check reads real PDFs: a plain CV passes, each known problem is found, a picture of a CV fails', async () => {
    const target = path.join(ctx.profile, 'cv.pdf'), original = fs.existsSync(target) ? fs.readFileSync(target) : null;
    try {
      for (const [name, fixture] of Object.entries(FIXTURES)) {
        // Printed by the app's own Chromium, then read by the app's own PDF reader (the same path a person's CV takes).
        const pdf = await app.evaluate(async ({BrowserWindow}, html) => {
          const win = new BrowserWindow({show: false, width: 794, height: 1123});
          await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
          const data = await win.webContents.printToPDF({pageSize: 'A4', printBackground: true, preferCSSPageSize: true});
          win.destroy();
          return data.toString('base64');
        }, fixture.html);
        fs.writeFileSync(target, Buffer.from(pdf, 'base64'));
        const result = await page.evaluate(() => window.pilot.cvCheckRun());
        if (!result.ok) throw new Error(`${name}: the CV check did not run: ${result.error}`);
        const byId = Object.fromEntries(result.ats.checks.map(item => [item.id, item.status]));
        const wrong = [...fixture.pass.filter(id => byId[id] !== 'pass').map(id => `${id} should pass but is ${byId[id]}`), ...fixture.fail.filter(id => byId[id] === 'pass').map(id => `${id} should be flagged`)];
        if (wrong.length) throw new Error(`${name} (score ${result.ats.score}): ${wrong.join('; ')}`);
        console.log(`  ${name}: score ${result.ats.score}, flagged ${result.ats.checks.filter(item => item.status !== 'pass').map(item => item.id).join(', ') || 'nothing'}`);
      }
    } finally { if (original) fs.writeFileSync(target, original); }
  }, {needs: ctx.needs});
  // Why (1 Nov 2026, owner: "Profile (CV, Experience)" is tier 1): the Experience half of J14; its integration counterpart is integration/store/profile-experience-edit.test.mjs.
  await ctx.run('Profile Experience: an edited summary is saved with the Profile save bar, and is still there after a restart', () => profileExperienceStep(ctx), {needs: ctx.needs, data: true});
  // Why (1 Nov 2026, owner: "Only tier 1 … should stay e2e"; "None of these are critical user journeys"): 'Settings render without layout problems' (J17) is integration/app/screen-settings.test.js.
  // The Your data and Automatic backup steps (export with keys / reset / import, the backup file, Back up now, the due-at-start and weekly-tick backup; J10) are integration/store/data-roundtrip.test.mjs.
}
