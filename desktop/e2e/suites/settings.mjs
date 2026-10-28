/* global document, window */
// Settings: every section, with each AI engine chosen. Starts from a set-up install (a key saved, a workspace connected).
import {finish, snap} from '../lib/layout.mjs';
import fs from 'node:fs';
import {appLogText} from '../lib/app-log.mjs';
import {waitForLogLine} from '../lib/wait-on-state.mjs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {FIXTURES} from '../lib/cvfixtures.mjs';
import {ensureSetUp} from '../lib/seed.mjs';
import {step as wizardStep} from '../lib/app.mjs';
import crypto from 'node:crypto';
import os from 'node:os';
import {backupNowStep, backupTimerStep, makeBackupFile} from '../lib/backup-steps.mjs';
import {exportedFileDigests} from '../lib/export-snapshot.mjs';

// What a step needs from an earlier one when E2E_STEPS picks it (lib/runner.mjs wantedWords).
export const stepNeeds = {'AI engine panel': ['every Settings section renders']};
export const name = 'settings';
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
  await ctx.run('the AI engine panel is coherent with each engine chosen (a key is saved in both)', async () => {
    // The family under test's pair (lib/engine.mjs): Claude Code and the Anthropic key, or Codex and the OpenAI key (9 Oct 2026: the first OpenAI run looked for
    // Claude Code in a panel that showed OpenAI's cards). This step goes from the API key to the family's CLI and back. A Mac is seeded on the CLI (lib/seed.mjs): start from the key, as CI does.
    const openai = ctx.family === 'openai';
    const pair = openai ? {cli: 'codex', api: 'openai', name: 'Codex', notice: 'codexNotice', status: 'codexStatus'} : {cli: 'cli', api: 'api', name: 'Claude Code', notice: 'claudeCodeNotice', status: 'claudeCodeStatus'};
    if (['cli', 'codex'].includes(ctx.engine)) {
      await page.evaluate(async ({api, notice}) => { await window.pilot.setAiEngine(api); await window.pilot.saveSettings({[notice]: false}); }, pair);   // the seed accepted the one-time notice
      await page.reload();
      await page.waitForSelector('.view:not([hidden])', {timeout: 60000});
    }
    await page.click('[data-settings-go="connections"]');
    // The engine panel opens from its service row's Manage button (the "AI" row: "Claude or OpenAI: …"), as it does for a person; it shows the chosen engine's family.
    await page.locator('#conn-on .service-card, #conn-off .service-card').filter({hasText: 'Claude or OpenAI'}).first().getByRole('button').click();
    const card = id => `#ai-engine-settings [data-choice="${id}"]`;
    await page.locator(card(pair.cli)).waitFor({state: 'visible', timeout: 15000});
    // Choosing the CLI selects its card at once and shows a note under it (no confirm); the engine is saved once it can run. Then back to the API key, which switches at once.
    // A CI runner has no Claude Code or Codex (6 Oct 2026, the first real CI run of this suite): there the app must refuse the switch and say why; on a Mac with it, switch.
    const installed = (await page.evaluate(status => window.pilot[status](), pair.status))?.installed;
    await page.locator(card(pair.cli)).click();
    if (!installed) {
      await page.waitForFunction(() => /not installed|not found/i.test(document.getElementById('ai-engine-settings')?.textContent || ''), null, {timeout: 15000})
        .catch(() => { throw new Error(`without ${pair.name} the panel does not say it is not installed`); });
      if ((await page.evaluate(() => window.pilot.state())).settings.aiEngine === pair.cli) throw new Error(`the app saved ${pair.name} as the engine although it is not installed`);
      await snap(ctx, `settings-engine-${pair.cli}-missing`, {view: 'settings', situation: `${pair.name} chosen on a computer where it is not installed: the API key stays the engine`});
      return;
    }
    await page.waitForFunction(selector => document.querySelector(selector)?.getAttribute('aria-checked') === 'true', card(pair.cli), {timeout: 15000});
    await page.waitForTimeout(800);
    await snap(ctx, `settings-engine-${pair.cli}-chosen`, {view: 'settings', situation: `${pair.name} is the chosen engine, and an ${openai ? 'OpenAI' : 'Anthropic'} API key is saved`});
    await page.locator(card(pair.api)).click();
    await page.waitForFunction(selector => document.querySelector(selector)?.getAttribute('aria-checked') === 'true', card(pair.api), {timeout: 15000});
    await page.waitForTimeout(800);
    await snap(ctx, `settings-engine-${pair.api}-chosen`, {view: 'settings', situation: `The ${openai ? 'OpenAI' : 'Anthropic'} API key is the chosen engine`});
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
  // ⌘K (6 Oct 2026: the palette had no end-to-end step). Every page is listed, Enter on a typed command opens it, Esc closes. Only "Open <page>" commands are
  // run here: an Actions command starts its task at once (a paid run).
  await ctx.run('⌘K opens the palette: every page is listed, a typed command opens its page, Esc closes it', async () => {
    const pages = await page.evaluate(() => [...new Map([...document.querySelectorAll('.nav[data-view]')].map(nav => [nav.dataset.view, (nav.getAttribute('aria-label') || nav.title || nav.textContent).trim()])).entries()]);
    if (pages.length < 5) throw new Error(`only ${pages.length} pages in the sidebar: this step would test little`);
    await page.click('.nav[data-view="focus"]');
    await page.keyboard.press('ControlOrMeta+k');
    await page.locator('#palette[open]').waitFor({timeout: 5000}).catch(() => { throw new Error('⌘K did not open the palette'); });
    const listed = await page.locator('#palette-list [role="option"]').allInnerTexts();
    const opens = listed.filter(text => /^Open /.test(text.trim())).length;
    if (opens < new Set(pages.map(([view]) => view)).size) throw new Error(`the palette lists ${opens} "Open …" commands for ${pages.length} pages: ${listed.slice(0, 12).join(' | ')}`);
    // Settings, the whole class: every page, every section heading, and Export/Import data (6 Oct 2026: Export and Import were not in ⌘K). A Settings row shows
    // its path (27 Oct 2026): "Settings → Connections → Chrome extension", each step without its leading emoji.
    const wanted = await page.evaluate(() => {
      const name = node => node?.textContent.replace(/\s+/g, ' ').trim().replace(/^\P{L}+/u, '');
      return [
        ...[...new Map([...document.querySelectorAll('[data-settings-go]')].reverse().map(go => [go.dataset.settingsGo, name(go)])).values()].map(page => `Settings → ${page}`),   // one a page: its first button
        ...[...document.querySelectorAll('[data-settings-page] .setting[id]')].filter(section => !section.closest('[hidden]:not(.view):not([data-settings-page])'))
          .map(section => name(section.querySelector('h3') || section.querySelector('h4, summary'))).filter(Boolean),
        'Move your data → Export data', 'Move your data → Import data'];
    });
    const text = listed.map(item => item.replace(/\s+/g, ' '));
    const absent = wanted.filter(label => !text.some(item => item.includes(label)));
    if (absent.length) throw new Error(`not in ⌘K: ${absent.join(' | ')}`);
    // One row per card (owner, 27 Oct 2026: "when searching for Extension, I see too many options. I'd expect to see Settings -> Connections -> Chrome extension.
    // and that's pretty much it"): typed, "extension" lists that card alone; over the card names people type, no row twice and no row found only by its hint or
    // keywords beside a label match (palette.js rank; the demo-app twin with exact top rows: test/palette-one-row-per-card.test.js, local only).
    await page.locator('#palette[open] input').fill('extension');
    const extension = (await page.locator('#palette-list [role="option"]').allInnerTexts()).map(item => item.split('\n')[0].trim());
    if (extension.length !== 1 || !extension[0].endsWith('Connections → Chrome extension')) throw new Error(`⌘K "extension" should list Settings → Connections → Chrome extension alone: ${extension.join(' | ')}`);
    const crowded = await page.evaluate(async queries => {
      const {rank, shownLabel} = await import(new URL('palette.js', document.baseURI).href);
      const entries = window.__jp.paletteCommands(), words = text => String(text).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
      const named = (command, query) => words(query).some(term => words(`${command.label} ${command.alias || ''}`).some(word => word.startsWith(term)));
      return queries.flatMap(query => {
        const rows = rank(entries, query), shown = rows.map(row => `${row.group}|${shownLabel(row)}`);
        const twice = shown.filter((row, i) => shown.indexOf(row) !== i), weak = rows.some(row => named(row, query)) ? rows.filter(row => !named(row, query)) : [];
        return [...twice.map(row => `"${query}" lists ${row} twice`), ...weak.map(row => `"${query}" lists ${shownLabel(row)}, found only by its hint or keywords`)];
      });
    }, ['extension', 'chrome', 'telegram', 'gmail', 'notion', 'calendar', 'cv', 'profile', 'plan', 'promo', 'find jobs']);
    if (crowded.length) throw new Error(`⌘K lists more than the card asked for: ${crowded.join(' | ')}`);
    await page.locator('#palette[open] input').fill('');   // Esc in a search box with text clears the text first
    await page.keyboard.press('Escape');
    await page.locator('#palette[open]').waitFor({state: 'detached', timeout: 5000}).catch(async () => {
      if (await page.locator('#palette[open]').count()) throw new Error('Esc did not close the palette');
    });
    await page.keyboard.press('ControlOrMeta+k');
    await page.locator('#palette[open] input').fill('open interviews');
    await page.keyboard.press('Enter');
    await page.locator('.view[data-view="interviews"]:not([hidden])').waitFor({timeout: 5000}).catch(() => { throw new Error('Enter on "open interviews" did not open the Interviews page'); });
    if (await page.locator('#palette[open]').count()) throw new Error('the palette stayed open after running a command');
  }, {needs: ctx.needs});
  await ctx.run('Settings render without layout problems', async () => { finish(ctx); }, {needs: ctx.needs});
  await ctx.run('Automatic backup: Back up now writes a backup with no keys in its folder, and View backups opens it', () => backupNowStep(ctx), {needs: ctx.needs});
  await ctx.run('Automatic backup: a due backup runs once at start and once on the weekly tick', () => backupTimerStep(ctx), {needs: ctx.needs});
  // Last: it restarts the app twice (the steps above hold the first window).
  await ctx.run('Your data: export with keys, reset, then import from the setup brings this computer back as it was', () => roundTrip(ctx), {needs: ctx.needs});
  await ctx.run('Automatic backup: the backup file, imported after a reset, brings this computer back as it was', async () => roundTrip(ctx, await makeBackupFile(ctx)), {needs: ctx.needs});
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
async function roundTrip(ctx, backupFile = '') {   // backupFile: the file the automatic backup made, imported instead of an export
  const file = backupFile || path.join(os.tmpdir(), `jp-e2e-export-${process.pid}-${Date.now()}.tar.gz`);
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
  // page.evaluate, not waitForFunction: an async predicate returns a Promise, which counts as true at once.
  let setUp = false;
  for (let i = 0; i < 60 && !setUp; i++) setUp = await ctx.page.evaluate(async () => (await window.pilot.state()).settings.setupDone === true) || (await ctx.page.waitForTimeout(1000), false);
  if (!setUp) throw new Error(`after the import the app is not set up again (${JSON.stringify(await ctx.page.evaluate(() => window.pilot.lastReset()))})`);
  const after = {files: Object.fromEntries(FILES.map(name => [name, digest(name)])), ...await ctx.page.evaluate(async () => {
    const state = await window.pilot.state();
    return {secrets: state.secrets, notionIds: state.settings.notionIds || null, jobs: (await window.pilot.jobs())?.total ?? null};
  })};
  // Field by field, so a failure names what changed (a whole object is cut off in the report).
  const differ = [];
  // Keys: none lost. One the app makes at start when missing (the extension's token) may appear. A backup never holds keys (lib/backup.js),
  // so after a reset they come back only where the platform kept them (the Mac's Keychain; not Windows, 17 Oct 2026): not checked for a backup.
  if (!backupFile) for (const name of Object.keys(before.secrets)) if (before.secrets[name] && !after.secrets?.[name]) differ.push(`key ${name} lost`);
  for (const key of ['files', 'notionIds']) for (const name of new Set([...Object.keys(before[key] || {}), ...Object.keys(after[key] || {})]))
    if (JSON.stringify(before[key]?.[name]) !== JSON.stringify(after[key]?.[name])) differ.push(`${key}.${name} ${JSON.stringify(before[key]?.[name])} -> ${JSON.stringify(after[key]?.[name])}`);
  if (before.jobs !== after.jobs) differ.push(`jobs ${before.jobs} -> ${after.jobs}`);
  // A file that did not come back says where it went: what the export held and what the folder holds now (beta 20, 24 Oct 2026: Linux lost profile.md and answers.md, and the
  // report said only "-> null").
  if (differ.length) throw new Error(`not as before the export: ${differ.join('; ')}${whereItWent(file, ctx.profile)}`);
  if (!backupFile) fs.rmSync(file, {force: true});
}
