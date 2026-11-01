/* global document, window */
// Job: wait on state
// Settings: every section renders, the CV check on real PDFs, Automatic backup and Your data (export / reset / import). Why (1 Nov 2026): the AI engine panel and ⌘K moved to desktop/test/screen-settings.test.js.
// Was: every section, with each AI engine chosen. Starts from a set-up install (a key saved, a workspace connected).
import {finish, snap} from '../lib/layout.mjs';
import fs from 'node:fs';
import {appLogText, currentLaunchLog} from '../lib/app-log.mjs';
import {pollUntil, waitForLogLine} from '../lib/wait-on-state.mjs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {FIXTURES} from '../lib/cvfixtures.mjs';
import {ensureSetUp} from '../lib/seed.mjs';
import {step as wizardStep} from '../lib/app.mjs';
import crypto from 'node:crypto';
import os from 'node:os';
import {backupNowStep, backupTimerStep, makeBackupFile} from '../lib/backup-steps.mjs';
import {exportedFileDigests} from '../lib/export-snapshot.mjs';
import {roundTripFileDifferences} from '../lib/roundtrip-files.mjs';

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
  await ctx.run('Settings render without layout problems', async () => { finish(ctx); }, {needs: ctx.needs});
  await ctx.run('Automatic backup: Back up now writes a backup with no keys in its folder, and View backups opens it', () => backupNowStep(ctx), {needs: ctx.needs});
  await ctx.run('Automatic backup: a due backup runs once at start and once on the weekly tick', () => backupTimerStep(ctx), {needs: ctx.needs});
  // Last: it restarts the app twice (the steps above hold the first window).
  await ctx.run('Your data: export with keys, reset, then import from the setup brings this computer back as it was', () => roundTrip(ctx), {needs: ctx.needs});
  await ctx.run('Automatic backup: the backup file, imported after a reset, brings this computer back as it was', async () => roundTrip(ctx, () => makeBackupFile(ctx)), {needs: ctx.needs});
}

// Export -> reset (kept as a backup) -> the app opens at the setup -> "Import an export…" on its Welcome -> restart: the user's files come back
// byte for byte, the keys and the set-up state too (6 Oct 2026: the export left out profile.md and answers.md, and Import was only in Settings,
// out of reach at the setup). Native dialogs are stood in for, and so is the app's own relaunch: the suite starts it again on the same folder.
// " | the file holds: <first names> | the folder holds: <names>", for the report of a round trip that lost something.
function whereItWent(file, dir) {
  const names = list => list.filter(Boolean).slice(0, 40).join(', ');
  let held = '', folder = '';
  try { held = names(spawnSync('tar', ['-tzf', file], {encoding: 'utf8', timeout: 20000}).stdout.split(/\r?\n/)); } catch { held = 'unreadable'; }
  try { folder = names(fs.readdirSync(dir)); } catch { folder = 'unreadable'; }
  let removed = '';   // who took the files: the app logs every drop of the local copies (lib/strategy-settings.js dropLocalCopies)
  try { removed = appLogText(dir).split('\n').filter(line => /local copies dropped/.test(line)).slice(-3).join(' / '); } catch { /* no log */ }
  return ` | the file holds: ${held || 'nothing listed'} | the folder holds: ${folder} | ${removed || 'the app logged no drop of the local copies'}`;
}
async function roundTrip(ctx, makeBackup = null) {   // makeBackup: makes the automatic backup whose file is imported instead of an export
  const at = name => path.join(ctx.profile, name);
  const digest = name => fs.existsSync(at(name)) ? crypto.createHash('sha256').update(fs.readFileSync(at(name))).digest('hex') : null;
  // The app's start-up move into the store drops these two files once Notion has them (lib/migrate.js, 'profile copies'); writing them while it runs lost them under the
  // export (main's settings, 28 Oct 2026: "[files] local copies dropped" 48 ms before "tar failed (2)"; the 25 Oct beta 0.8.30 failure). It tells when it is over.
  await waitForLogLine(ctx.profile, /startup moves finished/g, {what: 'the app\'s start-up move into the store'});
  // What a person who has not connected Notion yet keeps only here (the wizard's "Notion later"): written if this install has none.
  for (const name of ['profile.md', 'answers.md']) if (!fs.existsSync(at(name))) fs.writeFileSync(at(name), `# e2e ${name}\nkept across an export\n`);
  const FILES = ['profile.md', 'answers.md', 'cv.pdf'];
  const before = {files: Object.fromEntries(FILES.map(name => [name, digest(name)])), ...await ctx.page.evaluate(async () => {
    const state = await window.pilot.state();
    return {secrets: state.secrets, notionIds: state.settings.notionIds || null, jobs: (await window.pilot.jobs())?.total ?? null};
  })};
  if (!Object.values(before.secrets).some(Boolean)) throw new Error('the set-up install has no key saved: nothing to prove about keys');
  // Why (28 Oct 2026, beta 3: settings red on Mac+Linux and Windows, "export archive omitted profile.md"): the one order is wait, seed, capture, then make the file. The backup used to be made
  // by the caller before the wait and the seed, so on a store that holds the two files (the beta's) it was made without them and the round trip then expected them in it.
  const backupFile = makeBackup ? await makeBackup() : '';
  const file = backupFile || path.join(os.tmpdir(), `jp-e2e-export-${process.pid}-${Date.now()}.tar.gz`);
  const standIn = () => ctx.app.evaluate(({app, dialog}, filePath) => {
    dialog.showSaveDialog = async () => ({canceled: false, filePath});
    dialog.showOpenDialog = async () => ({canceled: false, filePaths: [filePath]});
    dialog.showMessageBoxSync = () => 1;   // "Reset and restart" / "Import and restart"
    app.relaunch = () => {};               // the suite starts the app again itself, so it keeps hold of it
  }, file);

  await standIn();
  const page = ctx.page;
  await page.click('.nav[data-view="settings"]:not([data-settings="profile"])');
  await page.click('[data-settings-go="data"]');
  await page.click('#setting-data details.troubleshoot summary');   // "Export options", folded
  await page.locator('#export-keys').check();
  if (!backupFile) {
    await page.click('#export-data');
    await page.waitForFunction(() => /Exported ✓/.test(document.getElementById('data-message')?.textContent || ''), null, {timeout: 60000})
      .catch(async () => { throw new Error(`the export did not finish: "${await page.locator('#data-message').textContent().catch(() => '')}"`); });
  }
  if (!fs.existsSync(file)) throw new Error('Export said done but wrote no file');
  // Why (#2304): opening Settings can tidy the profile after the initial capture; restore must match the bytes actually exported.
  const exported = exportedFileDigests(file, before.files);
  for (const name of FILES) if (before.files[name] !== exported[name])
    console.log(`export snapshot ${name}: before=${before.files[name]} archived=${exported[name]}`);
  before.files = exported;

  await page.click('[data-settings-go="advanced"]');   // the danger zone is on Advanced
  await page.click('#reset-review');
  if (await page.locator('#reset-confirm').isEnabled()) throw new Error('RESET can be typed before the export was made or skipped');
  const resetExport = path.join(path.dirname(file), 'reset-export.tar.gz');
  await ctx.app.evaluate(({dialog}, filePath) => { dialog.showSaveDialog = async () => ({canceled: false, filePath}); }, resetExport);
  await page.click('#reset-export');
  await page.waitForFunction(() => !document.getElementById('reset-confirm').disabled, null, {timeout: 60000})
    .catch(async () => { throw new Error(`the export before the reset did not finish: "${await page.locator('#reset-message').textContent().catch(() => '')}"`); });
  if (!fs.existsSync(resetExport)) throw new Error('the reset card said exported but wrote no file');
  if (!/✓ Saved/.test(await page.locator('#reset-export-state').textContent())) throw new Error('the reset card shows no "✓ Saved" chip after the export');
  await page.fill('#reset-confirm', 'RES');
  if (!/2 more letters/.test(await page.locator('#reset-hint').textContent()) || !(await page.locator('#reset-go').getAttribute('title'))) throw new Error('the reset card does not say why the button is off while RESET is half typed');
  await page.fill('#reset-confirm', 'RESET');
  if (!/Ready/.test(await page.locator('#reset-hint').textContent())) throw new Error('the reset card does not say Ready once RESET is typed');
  await page.click('#reset-go').catch(() => {});   // the app exits under the click
  await ctx.waitForExit();   // after its work (it disconnects Gmail first), not before: relaunch() closes the app
  await ctx.relaunch();
  await ctx.page.waitForSelector('.step[data-step="welcome"]', {state: 'visible', timeout: 60000})
    .catch(async () => { throw new Error(`after a reset the app should open at the setup, it shows "${await wizardStep(ctx.page)}"`); });
  if (fs.existsSync(at('profile.md'))) throw new Error('the reset left profile.md in place: the round trip would prove nothing');

  await standIn();
  await ctx.page.click('#welcome-import').catch(() => {});   // the app exits under the click
  await ctx.waitForExit();
  await ctx.relaunch();
  // Why (29 Oct 2026, st): poll resolved state so an async predicate's Promise cannot finish the wait at once.
  const {value: setUp} = await pollUntil(() => ctx.page.evaluate(async () => (await window.pilot.state()).settings.setupDone === true), value => value, {capMs: 60000, log: () => {}});
  if (!setUp) throw new Error(`after the import the app is not set up again (${JSON.stringify(await ctx.page.evaluate(() => window.pilot.lastReset()))})`);
  await waitForLogLine(ctx.profile, /startup moves finished/g, {what: 'the imported launch\'s start-up move into the store'});
  const after = {files: Object.fromEntries(FILES.map(name => [name, digest(name)])), ...await ctx.page.evaluate(async () => {
    const state = await window.pilot.state();
    return {secrets: state.secrets, notionIds: state.settings.notionIds || null, jobs: (await window.pilot.jobs())?.total ?? null};
  })};
  // Field by field, so a failure names what changed (a whole object is cut off in the report).
  const differ = [];
  // Keys: none lost. One the app makes at start when missing (the extension's token) may appear. A backup never holds keys (lib/backup.js),
  // so after a reset they come back only where the platform kept them (the Mac's Keychain; not Windows, 17 Oct 2026): not checked for a backup.
  if (!backupFile) for (const name of Object.keys(before.secrets)) if (before.secrets[name] && !after.secrets?.[name]) differ.push(`key ${name} lost`);
  differ.push(...roundTripFileDifferences(before.files, after.files, currentLaunchLog(ctx.profile)));
  for (const name of new Set([...Object.keys(before.notionIds || {}), ...Object.keys(after.notionIds || {})]))
    if (JSON.stringify(before.notionIds?.[name]) !== JSON.stringify(after.notionIds?.[name])) differ.push(`notionIds.${name} ${JSON.stringify(before.notionIds?.[name])} -> ${JSON.stringify(after.notionIds?.[name])}`);
  if (before.jobs !== after.jobs) differ.push(`jobs ${before.jobs} -> ${after.jobs}`);
  // A file that did not come back says where it went: what the export held and what the folder holds now (beta 20, 24 Oct 2026: Linux lost profile.md and answers.md, and the
  // report said only "-> null").
  if (differ.length) throw new Error(`not as before the export: ${differ.join('; ')}${whereItWent(file, ctx.profile)}`);
  if (!backupFile) fs.rmSync(file, {force: true});
}
