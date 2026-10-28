// One-time moves of user data from this Mac to Notion, the source of truth (the Mac keeps only keys, large
// files and caches). Each step runs at start-up while it has something to move, and only deletes the local
// copy after Notion confirmed it has the data, so nothing is ever lost. A failed step retries next start.
import fs from 'node:fs';
import path from 'node:path';
import * as contact from './contact.js';
import {log} from './log.js';
import * as notion from './notion.js';   // Notion-only: moves this Mac's data into a connected Notion that is the store
import * as notionGate from './notion-gate.js';
import * as questions from './questions.js';
import * as runHistory from './run-history.js';
import * as schema from './schema.js';
import * as pipeline from './pipeline.js';
import * as strategy from './strategy.js';
import {writePrivate} from './private-file.js';

// onMac: why the step does not run while the data lives on this Mac (the rule in run(): nothing in migrate runs unless Notion is the store).
// 'data': it moves (or deletes) this Mac's data into Notion, or fills Notion's rows: "Move my data to Notion" (lib/store-move.js) copies and
// archives that data itself. 'workspace': Notion's workspace or the search config only: the move does that part itself too (schema repair
// before the copy, the Search settings page after). 9 Oct 2026, the storemove e2e: a connect deleted profile.md and answers.md on this Mac's store.
export const STEPS = [
  // The daily applications target, first kept in the app's settings -> ⚙️ Search settings in Notion.
  {name: 'daily target', onMac: 'workspace', run: async storage => {
    const old = storage.settings().dailyTarget;
    if (old == null) return false;
    await strategy.setDailyTarget(storage, old, {run: pipeline.run, ensurePage: notion.ensurePage, writePage: notion.writePage});
    storage.saveSettings({dailyTarget: undefined});
    return true;
  }},
  // The workspace itself: columns and databases the code needs that it lacks (config/notion_schema.json).
  {name: 'workspace', onMac: 'workspace', run: async (storage, fetcher) => {
    const fixed = await schema.repair(storage.secret('NOTION_TOKEN'), storage.settings().notionIds || {}, schema.load(), fetcher);
    for (const step of fixed.manual || []) log('notion', `Do by hand in Notion: ${step}`);
    if (!fixed.created.length && !fixed.columns.length && !fixed.renamed?.length) return false;
    storage.saveSettings({notionIds: fixed.ids});
    return true;
  }},
  // Notion later: a strategy kept on this Mac while the app was only trying (profile.md, answers.md and the search cache)
  // moves in when Notion is connected. notionMoveIn (set at connect, main.js): 'fresh' = the workspace is new/empty, so this
  // Mac's strategy is written into it; 'existing' = the workspace already had data, so Notion wins and the files are only
  // backed up. After 'workspace' (which creates the pages) and before 'profile copies' and 'search settings' (which would
  // link the empty Search settings page and drop this Mac's search choices). Local copies go only after every write succeeded.
  {name: 'strategy from this Mac', onMac: 'data', run: async (storage, _fetcher, deps = {}) => {
    const mode = storage.settings().notionMoveIn;
    if (!mode) return false;
    const {writePage = notion.writePage, ensurePage = notion.ensurePage, run = pipeline.run} = deps;
    const token = storage.secret('NOTION_TOKEN'), ids = storage.settings().notionIds || {};
    const files = ['profile.md', 'answers.md'].map(name => [name, storage.readText(name)]).filter(([, text]) => text.trim());
    if (mode === 'fresh') {
      for (const [name, text] of files) {
        const page = name === 'profile.md' ? ids.NOTION_PROFILE_PAGE_ID : ids.NOTION_ANSWERS_PAGE_ID;
        if (page) await writePage(token, page, text);
      }
      await strategy.publishSearchSettings(storage, {run, ensurePage, writePage});
    } else if (files.length) {
      const folder = storage.path(`backup/before-notion-${new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 13)}`);
      fs.mkdirSync(folder, {recursive: true});
      for (const [name, text] of files) writePrivate(path.join(folder, name), text);
      storage.saveSettings({notionKeptFolder: folder});
    }
    strategy.dropLocalCopies(storage);
    storage.saveSettings({notionMoveIn: undefined});
    return true;
  }},
  // "Reached via" on leads tracked before the column existed (from their Notes), once.
  {name: 'reached via', onMac: 'data', run: async storage => {
    if (storage.settings().reachedViaFilled) return false;
    const {code} = await pipeline.run(storage, ['src.ai.opportunity', 'backfill']);
    if (code !== 0) throw new Error('could not fill Reached via');
    storage.saveSettings({reachedViaFilled: true});
    return true;
  }},
  // Employers checked on this Mac before this Employers & Sources database had them (trying the app without Notion, a failed write,
  // another workspace connected): written once per database (src/scout.py sync_notion), after 'workspace' creates it. 6 Oct 2026: three
  // Find new employers runs made while trying never reached the user's Notion. A failed run is retried next start.
  {name: 'employers from this Mac', onMac: 'data', run: async (storage, _fetcher, run = pipeline.run) => {
    const db = storage.settings().notionIds?.NOTION_EMPLOYERS_DB;
    if (!db || storage.settings().employersSyncedTo === db) return false;
    const {code, stdout = ''} = await run(storage, ['src', 'scout', '--sync-notion']);
    if (code !== 0) throw new Error('could not write the employers to Notion');   // about Notion
    storage.saveSettings({employersSyncedTo: db});
    return !/^Employers: 0 written/m.test(stdout);
  }},
  // Runs made on this Mac with no ⏱️ Search runs row (trying the app before Notion, a row write that failed): written once per database
  // (run-history.js copyLocal), after 'workspace' creates it. 7 Oct 2026: they were listed in Recent activity (f9a5a38) but never reached Notion.
  {name: 'runs from this Mac', onMac: 'data', run: async (storage, fetcher, deps = {}) => {
    const db = storage.settings().notionIds?.NOTION_CRON_RUNS_DB;
    if (!db || storage.settings().runsSyncedTo === db) return false;
    const runs = deps.runs || (() => pipeline.runs(storage)), save = deps.save || (list => pipeline.saveRuns(storage, list));
    const done = await runHistory.copyLocal(storage, {fetcher, runs, save, name: pipeline.taskName});
    log('migrate', 'runs from this Mac copied to Search runs', {...done, decidedBy: 'migrate.runs from this Mac'});
    if (done.failed) throw new Error(`${done.failed} of ${done.failed + done.written + done.linked} runs could not be written`);
    storage.saveSettings({runsSyncedTo: db});
    return done.written + done.linked > 0;
  }},
  // Origin (Inbound / Outbound) on rows tracked before the column existed, from the derived rule (src/notion/origin.py),
  // once. After 'workspace', which adds the column; rows that have an Origin are never touched.
  {name: 'origin', onMac: 'data', run: async (storage, _fetcher, run = pipeline.run) => {
    if (storage.settings().originFilled) return false;
    const {code} = await run(storage, ['src.notion.origin', '--backfill', '--apply']);
    if (code !== 0) throw new Error('could not fill Origin');
    storage.saveSettings({originFilled: true});
    return true;
  }},
  // Profile and standard answers: Notion pages since setup; the local copies are leftovers.
  {name: 'profile copies', onMac: 'data', run: async storage => {
    if (!storage.readText('profile.md') && !storage.readText('answers.md')) return false;
    const {profile, answers} = await strategy.profileTexts(storage);
    if (!profile.trim() || (storage.readText('answers.md') && !answers.trim())) return false;  // Notion looks empty: keep them
    strategy.dropLocalCopies(storage);
    return true;
  }},
  // Search settings -> a readable ⚙️ Search settings page (the local files stay, as its cache).
  {name: 'search settings', onMac: 'workspace', run: async (storage, fetcher) => {
    const ids = storage.settings().notionIds || {};
    if (ids.NOTION_SEARCH_SETTINGS_PAGE) return false;
    // A workspace connected again already has its page, and Notion is the source of truth: link it, never write this Mac's example file over it.
    const there = ids.NOTION_PROFILE_PAGE_ID && await notion.findPageBeside(storage.secret('NOTION_TOKEN'), ids.NOTION_PROFILE_PAGE_ID, strategy.SEARCH_SETTINGS_TITLE, fetcher);
    if (there) { storage.saveSettings({notionIds: {...ids, NOTION_SEARCH_SETTINGS_PAGE: there}}); return true; }
    return !!await strategy.publishSearchSettings(storage, {run: pipeline.run, ensurePage: notion.ensurePage, writePage: notion.writePage});
  }},
  // A Search settings page in the first format (plain entry = whole word) -> the exact format; untouched
  // pages are rebuilt from the cache (same meaning as before), edits are kept (src/notion/search_settings.py).
  {name: 'search settings format', onMac: 'workspace', run: async storage => {
    const page = storage.settings().notionIds?.NOTION_SEARCH_SETTINGS_PAGE;
    if (!page) return false;
    const {code, stdout} = await pipeline.run(storage, ['src.notion.search_settings', 'upgrade']);
    if (code !== 0) throw new Error('could not read the Search settings page');
    if (!stdout.trim()) return false;
    await notion.writePage(storage.secret('NOTION_TOKEN'), page, stdout);
    return true;
  }},
  // Open questions -> ❓ lines of the standard answers page (skipping ones already there).
  {name: 'open questions', onMac: 'data', run: async (storage, fetcher) => {
    const open = storage.settings().openQuestions;
    if (!open?.length && !storage.settings().answeredQuestions) return false;
    const ids = storage.settings().notionIds || {};
    if (!ids.NOTION_ANSWERS_PAGE_ID) return false;
    const token = storage.secret('NOTION_TOKEN');
    const there = new Set((await notion.textBlocks(token, ids.NOTION_ANSWERS_PAGE_ID, fetcher))
      .map(block => questions.key(block.text.split(/:\s| — /)[0].replace(/❓/g, ''))));
    const missing = (open || []).filter(q => !there.has(q.key));
    if (missing.length) await notion.appendBullets(token, ids.NOTION_ANSWERS_PAGE_ID, missing.map(q => questions.questionLine(q.question, q.company)), fetcher);
    storage.saveSettings({openQuestions: undefined, answeredQuestions: undefined});
    return true;
  }},
  // Contact details -> the 📇 Contact details section of the Profile page (what's already in Notion wins).
  {name: 'contact details', onMac: 'data', run: async (storage, fetcher) => {
    const local = storage.settings().contact;
    if (!local || !Object.keys(local).length) return false;
    const there = await contact.read(storage, fetcher);
    await contact.save(storage, {...local, ...there}, fetcher);
    storage.saveSettings({contact: undefined});
    return true;
  }},
];

// At a Notion connect, what to remember about this Mac's Profile and answers. Elsewhere: whether they move into the workspace ('fresh': a
// workspace just built, they win; 'existing': Notion wins, they are backed up), for 'strategy from this Mac'. On this Mac's store they are its
// texts and the move takes them: only whether the workspace was just built (its pages hold the template's text), so the move writes them over it.
export function connectSettings(settings, {hadLocal, fresh}) {
  if (settings?.store === 'sqlite') return {storeTextsWin: !!fresh};
  return hadLocal ? {notionMoveIn: fresh ? 'fresh' : 'existing'} : {};
}

// Once, at the first start of the version whose default is "no own scout": an install that is already set up keeps
// its daily scout (written down, so it stays whatever the default is); a new install starts without one.
export function pinScoutSchedule(storage) {
  const settings = storage.settings();
  if (settings.scoutDefaultPinned) return false;
  const keep = !!settings.setupDone && settings.schedule?.scout == null;
  storage.saveSettings({scoutDefaultPinned: true, ...(keep ? {schedule: {...(settings.schedule || {}), scout: 'daily'}} : {})});
  return keep;
}

// "Help the pool grow" is opt-out for everyone (owner, 7 Oct 2026). Installs set up before 7 Oct were once pinned off
// (poolShareDefaultPinned) without choosing; once, they are turned on. A choice made with the switch (shareEmployersChosen,
// recorded since 7 Oct) is never overwritten. An off set by hand before 7 Oct can't be told apart from the old pin.
export function openPoolShare(storage) {
  const settings = storage.settings();
  if (settings.poolShareOptOut) return false;
  const reopen = settings.shareEmployers === false && !settings.shareEmployersChosen;
  storage.saveSettings({poolShareOptOut: true, ...(reopen ? {shareEmployers: true} : {})});
  return reopen;
}

export async function run(storage, onLine = () => {}, steps = STEPS, fetcher) {
  pinScoutSchedule(storage);
  if (openPoolShare(storage)) log('pool', 'Help the pool grow turned on (opt-out since 7 Oct 2026)', {decidedBy: 'migrate.openPoolShare'});
  const settings = storage.settings();
  if (!settings.setupDone || !storage.secret('NOTION_TOKEN') || !settings.notionIds?.NOTION_PROFILE_PAGE_ID) return [];
  if (!notionGate.notionInUse(storage)) return [];   // the data lives on this Mac (lib/store): nothing moves into a Notion left connected
  const moved = [];
  for (const step of steps) {
    try {
      if (await step.run(storage, fetcher)) moved.push(step.name);
    } catch (error) {
      onLine(`Moving ${step.name} to Notion failed (will retry next start): ${error.message}`);   // about Notion
    }
  }
  if (moved.length) onLine(`Moved to Notion: ${moved.join(', ')}.`);
  return moved;
}
