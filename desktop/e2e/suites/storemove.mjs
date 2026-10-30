/* global document, window */
// "Move my data to Notion" and export/import, end to end (spec docs/superpowers/specs/2026-10-09-store-adapters.md, P4): an app on this Mac's store with
// real-shaped data (lib/store_seed.py: applications with a kit and a file, events, an interview, a run, a match, an employer, the three texts) moves into
// the in-memory Notion (no token) from Settings → Your data. The copy is killed halfway and moved again: nothing twice. A Profile Notion already had is
// kept. Then the export of the same data goes into a fresh install, shows the same on every screen, and moves into a second, empty stand-in.
// The move: desktop/lib/store-move.js + src/stores/copy.py. Steps read the screens through lib/storemove-steps.mjs.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {launch} from '../lib/app.mjs';
import {DUMMY_KEY} from '../lib/engine.mjs';
import {buildStandIn, startNotionFake} from '../lib/notion-fake.mjs';
import {connectExisting} from '../lib/notion-reuse.mjs';
import {NOTION_PROFILE, TEXTS, answerImport, answerSave, copyProcess, fileBlocks, journalOf, pageText, rowsIn, sameScreens, screens, seedStore, standInRows,
  afterFirstSearch, logLines, searches, settingsOf, pressMove, storeMessage, writeProfile, yourData} from '../lib/storemove-steps.mjs';

export const name = 'storemove';
export const store = 'sqlite';
export const notionStandIn = true;   // an empty stand-in to move into (lib/context.mjs), behind the fault proxy so the copy can be stalled
export const notionProxy = true;
export const keepGoing = true;
export const minutes = 12;
// Why (30 Oct 2026, ap, main run 40985357367): stored organizer and background answers need no live key or relay.
export const offlineAi = true;
// Why (30 Oct 2026, ap, main run 40985357367): moving the store must never pay for a new background AI ask.
export const realAi = false;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function setUp(page) {
  await page.evaluate(async key => {
    await window.pilot.saveSecret('ANTHROPIC_API_KEY', key);
    await window.pilot.saveSettings({setupDone: true, wizardStep: 'extras', setupFurthest: 'extras', store: 'sqlite'});
  }, DUMMY_KEY);
  await page.reload();
  await page.waitForSelector('.view:not([hidden])', {timeout: 60000});
}
async function connect(page, token) {
  const result = await connectExisting(page, token);
  if (!result?.ok) throw new Error(`Notion did not connect: ${result?.error || JSON.stringify(result)}`);
  await page.reload();
  await page.waitForSelector('.view:not([hidden])', {timeout: 60000});
  return result;
}
function noLocalCopies(profile, archive) {
  const left = ['data/tracker.sqlite', 'data/files', 'profile.md', 'answers.md', 'knowledge.md'].filter(name => fs.existsSync(path.join(profile, name)));
  if (left.length) throw new Error(`still in use on this Mac after the move: ${left.join(', ')}`);
  if (!archive || !fs.existsSync(path.join(archive, 'data', 'tracker.sqlite'))) throw new Error(`the archive folder lacks the SQLite store (${archive})`);
  if (!fs.readdirSync(path.join(archive, 'data', 'files')).length) throw new Error('the archive folder lacks the job files');
}
function oncePerRecord(standIn, label) {
  const counts = {applications: rowsIn(standIn, 'Job Tracker'), events: rowsIn(standIn, 'Events'), interviews: rowsIn(standIn, 'Interviews'), files: fileBlocks(standIn)};
  const wanted = {applications: 3, events: 2, interviews: 1, files: 1};
  const wrong = Object.keys(wanted).filter(key => counts[key] !== wanted[key]);
  if (wrong.length) throw new Error(`${label}: Notion holds ${JSON.stringify(counts)}, not ${JSON.stringify(wanted)}`);
}

export async function run(ctx) {
  const {page} = ctx;
  let before = null, afterConnect = null, exportFile = '', profileId = '';   // afterConnect: what the move must keep (the store after the connect's search)

  await ctx.run('an app on this Mac\'s store holds real-shaped data on every screen', async () => {
    if (!ctx.standIn || ctx.root) throw new Error('the suite needs the stand-in and no real workspace');   // isolation: no token, no real Notion
    await setUp(page);
    const seeded = seedStore(ctx.profile);
    if (seeded.applications !== 3) throw new Error(`the seed wrote ${JSON.stringify(seeded)}`);
    await page.reload();
    await page.waitForSelector('.view:not([hidden])', {timeout: 60000});
    before = await screens(page);
    // The positive control: the seed is what the screens show, so "the same after" means something.
    if (before.jobs.length < 4 || before.interviews.length !== 1 || !before.activity.length) throw new Error(`the seeded data is not on the screens: ${JSON.stringify(before)}`);
    console.log(`  before: ${JSON.stringify(before)}`);
  }, {critical: true});

  await ctx.run('Export data writes this Mac\'s data to one file', async () => {
    exportFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-e2e-export-')), 'export.tar.gz');
    await answerSave(ctx.app, exportFile);
    await yourData(page);
    await page.click('#export-data');
    await page.waitForFunction(() => /Exported ✓|Export failed/.test(document.getElementById('data-message')?.textContent || ''), null, {timeout: 60000});
    if (!fs.existsSync(exportFile) || fs.statSync(exportFile).size < 1000) throw new Error(`no export at ${exportFile}`);
  });

  await ctx.run('Notion connects with a Profile of its own; this Mac keeps its data until the move', async () => {
    const ids = await buildStandIn(ctx.standIn);   // a workspace from before, as a person who used Notion earlier has
    profileId = ids.NOTION_PROFILE_PAGE_ID;
    writeProfile(ctx.standIn, profileId, NOTION_PROFILE);
    const mark = searches(ctx.profile);
    const result = await connect(page, ctx.token);
    // The screens the move must keep are the store's once the search the connect starts has ended (lib/storemove-steps.mjs afterFirstSearch).
    afterConnect = await afterFirstSearch(ctx.profile, mark, before, () => ctx.data('matches', 'list'));
    const settings = settingsOf(ctx.profile);
    if (settings.store !== 'sqlite') throw new Error(`connecting changed the store to ${settings.store}`);
    // With data here the connect says so and points to the move (lib/store-handlers.js startOnNotionIfEmpty: only an empty store switches).
    if (result.startedOnNotion || !result.stayedOnMac) throw new Error(`the connect answered startedOnNotion ${result.startedOnNotion}, stayedOnMac ${result.stayedOnMac}`);
    await yourData(page);
    if (!await page.locator('#store-move').isVisible()) throw new Error('"Move my data to Notion" is not offered after connecting with data on this Mac');
    const gone = Object.keys(TEXTS).filter(name => !fs.existsSync(path.join(ctx.profile, `${name}.md`)));
    if (gone.length) throw new Error(`connecting Notion took ${gone.join(', ')} off this Mac while its data is still here (store sqlite)`);
  });

  await ctx.run('a move killed halfway changes nothing, and the next one goes on with nothing twice', async () => {
    // The 6th write hangs (inside the applications: their pages, kit sections and file): the copy is then killed as a crash or a power cut would.
    ctx.notion.fail('hang', {writes: true, every: 6, times: 1});
    const pending = pressMove(page);
    const started = Date.now();
    while (ctx.notion.stats.failed < 1) { if (Date.now() - started > 120000) throw new Error('the copy never reached the stalled write'); await sleep(250); }
    const pids = copyProcess(ctx.app.process().pid);
    if (pids.length !== 1) { ctx.notion.pass(); await pending.catch(() => {}); throw new Error(`expected one copy process of this app, found ${pids.length}`); }
    const moved = Object.keys(journalOf(ctx.profile).applications || {}).length;
    if (moved >= 3) { ctx.notion.pass(); await pending.catch(() => {}); throw new Error(`the stall came after all ${moved} applications: move it earlier`); }
    process.kill(pids[0], 'SIGKILL');
    ctx.notion.pass();
    const stopped = await pending;
    console.log(`  killed after ${moved} of 3 applications: "${stopped}"`);
    if (!/stopped before the end/.test(stopped)) throw new Error(`a killed move says "${stopped}"`);
    if (settingsOf(ctx.profile).store !== 'sqlite') throw new Error('a killed move switched the store');
    if (!fs.existsSync(path.join(ctx.profile, 'data', 'tracker.sqlite'))) throw new Error('a killed move took the SQLite store away');
    const done = await pressMove(page);
    if (!/Moved to Notion ✓/.test(done)) throw new Error(`the second move says "${done}"`);
    oncePerRecord(ctx.standIn, 'after a killed move and a second one');
  });

  await ctx.run('after the move the store is Notion, the Profile Notion had is kept, and this Mac\'s files are in the archive', async () => {
    const settings = settingsOf(ctx.profile);
    if (settings.store !== 'notion') throw new Error(`the store is ${settings.store} after the move`);
    noLocalCopies(ctx.profile, settings.storeArchive);
    const profile = pageText(ctx.standIn, profileId);
    if (!profile.includes(NOTION_PROFILE) || profile.includes('ten years')) throw new Error(`the Notion Profile was not kept: "${profile.slice(0, 200)}"`);
    if (!/already had a Profile, so it was kept/.test(await storeMessage(page))) throw new Error(`the result does not say the Profile was kept: "${await storeMessage(page)}"`);
    if (!fs.readFileSync(path.join(settings.storeArchive, 'profile.md'), 'utf8').includes('ten years')) throw new Error('this Mac\'s Profile is not in the archive');
  });

  await ctx.run('Jobs, Focus, Interviews and Recent activity show the same items from Notion', async () => {
    await page.reload();
    await page.waitForSelector('.view:not([hidden])', {timeout: 60000});
    const wanted = afterConnect || before;
    sameScreens(wanted, await screens(page, {jobs: wanted.jobs.length}));
  });

  // A second install: the export, imported into a fresh profile, then moved into its own empty Notion.
  let second = null, standIn2 = null;
  try {
    await ctx.run('the export, imported into a fresh install, shows the same on every screen (still this Mac\'s store)', async () => {
      standIn2 = await startNotionFake();
      const env = {...ctx.appEnv, JOB_PILOTTO_E2E_NOTION_BASE_URL: standIn2.url};
      second = await launch({env});
      await second.page.waitForSelector('#welcome-import', {state: 'visible', timeout: 60000});
      await answerImport(second.app, exportFile);
      await second.page.click('#welcome-import');
      // The restart is the app's own exit (relaunch answered above): its log says so, whatever Playwright saw of the process.
      const started = Date.now();
      while (!logLines(second.profile).some(line => /restart: import/.test(line)) || !logLines(second.profile).some(line => /process exit/.test(line))) {
        if (Date.now() - started > 30000) {
          await second.shot('import-not-restarted').catch(() => {});
          throw new Error(`the app did not restart for the import; its log: ${JSON.stringify(logLines(second.profile))}`);
        }
        await sleep(250);
      }
      const profile = second.profile;
      await second.close().catch(() => {});
      second = await launch({env, profile});
      await second.page.waitForSelector('.view:not([hidden])', {timeout: 60000});
      if (settingsOf(profile).store !== 'sqlite') throw new Error(`the import's store is ${settingsOf(profile).store}`);
      sameScreens(before, await screens(second.page));
    }, {needs: [{name: 'the export file', value: exportFile}]});

    await ctx.run('the imported install moves into an empty Notion: its Profile and every record arrive once', async () => {
      if (!second) throw new Error('no second install');
      const mark = searches(second.profile);
      await connect(second.page, standIn2.token);
      const expected = await afterFirstSearch(second.profile, mark, before, () => ctx.data('matches', 'list', {}, {profile: second.profile}));
      const done = await pressMove(second.page);
      if (!/Moved to Notion ✓/.test(done) || /already had/.test(done)) throw new Error(`the move says "${done}"`);
      oncePerRecord(standIn2, 'the imported install');
      const ids = settingsOf(second.profile).notionIds || {};
      if (!pageText(standIn2, ids.NOTION_PROFILE_PAGE_ID).includes('ten years')) throw new Error('this Mac\'s Profile did not reach the empty Notion');
      await second.page.reload();
      await second.page.waitForSelector('.view:not([hidden])', {timeout: 60000});
      try { sameScreens(expected, await screens(second.page, {jobs: expected.jobs.length})); } catch (error) {
        // Evidence for a failure only seen on Windows CI (10 Oct 2026: the hidden "Orrin AG" shows after the move there): what the second install's store holds, and its own log.
        throw new Error(`${error.message}\n  Job Matches in the second Notion after the move: ${JSON.stringify(standInRows(standIn2, 'Job Matches'))}; Job Tracker: ${JSON.stringify(standInRows(standIn2, 'Job Tracker').map(row => row.title))}`
          + `\n  searches seen by its log: ${JSON.stringify(searches(second.profile))} (before the connect: ${JSON.stringify(mark)}); its log: ${JSON.stringify(logLines(second.profile, /\\[(store|data|run)\\]|search|daily/i))}`);
      }
      if (standIn2.stats.unknown.length) throw new Error(`the second stand-in met requests it does not know: ${standIn2.stats.unknown.join('; ')}`);
    });
  } finally {
    await second?.close().catch(() => {});
    await standIn2?.close();
  }
}
