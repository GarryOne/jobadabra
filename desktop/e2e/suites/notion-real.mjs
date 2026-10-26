/* global window */
// The one suite on REAL Notion (P7 step 5, spec docs/superpowers/specs/2026-10-09-store-adapters.md): what the in-memory stand-in cannot prove. An app on
// this Mac's store with real-shaped data (lib/store_seed.py) connects a real test workspace, moves its data there, and the records, the kit, the application
// record, the interview and the file read back from Notion's own pages; the screens show the same. Run by name only (cadence 'manual').
// Isolation: the only suite that may pin store 'notion' (test/store.test.mjs); its token is a pre-P7 suite's, idle since that suite runs on the stand-in
// (failuresnotion, owner's choice 9 Oct 2026); testRoot() refuses any workspace but "Job Pilotto 2" and any token that sees more than its one page. It writes
// only under that page, starts from an emptied page (fresh) and empties it again at the end, asserting nothing is left. No AI: a dummy key, nothing scored.
import fs from 'node:fs';
import path from 'node:path';
import {DUMMY_KEY} from '../lib/engine.mjs';
import {call, clearRoot, pageBlocks} from '../lib/notion.mjs';
import {COMPANIES, sameScreens, screens, seedStore, settingsOf, pressMove} from '../lib/storemove-steps.mjs';
import {connectExisting} from '../lib/notion-reuse.mjs';

export const name = 'notion-real';
export const store = 'notion';
export const notionTokenOf = 'failuresnotion';   // its Keychain item and GitHub secret (a hyphen-free name: E2E_NOTION_TOKEN_FAILURESNOTION)
export const notionPage = 'Job Pilotto E2E — Failures Notion';   // the one page it may empty (lib/context.mjs fails on any other)
export const fresh = true;                       // the page starts empty: last night's workspace would make the move land in an existing one
// No schedule, push or release gate runs it: the e2e audit dropped it (no catch in 30 days; owner's yes, 26 Oct 2026). Run it by name (cadence 'manual', lib/plan.mjs).
export const cadence = 'manual';
export const keepGoing = true;
export const minutes = 15;

const KIT = '📝 Application kit', RECORD = '🗂 Application record';
const RECORD_TEXT = 'E2E notion-real: the frozen application record (answers sent, cover letter).';
const KESTREL = 'https://jobs.example.test/kestrel/sre', HUXLEY = 'https://jobs.example.test/huxley/platform';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// Real Notion lags a write: poll until `check` answers truthy, or say what it last saw.
async function until(label, read, check, {ms = 90000, every = 3000} = {}) {
  const started = Date.now();
  let last;
  for (;;) {
    last = await read();
    if (check(last)) return last;
    if (Date.now() - started > ms) throw new Error(`${label}: still ${JSON.stringify(last).slice(0, 400)} after ${ms / 1000} s`);
    await sleep(every);
  }
}
// Every block on a page, folded ones too (the kit's toggle, a file inside a section), a few levels deep.
async function allBlocks(token, id, depth = 3) {
  const blocks = await pageBlocks(token, id);
  const inner = depth > 0 ? await Promise.all(blocks.filter(block => block.has_children).map(block => allBlocks(token, block.id, depth - 1))) : [];
  return [...blocks, ...inner.flat()];
}
// How many engine searches (src daily) the app started and ended so far, from its own log.
function searches(profile) {
  const file = path.join(profile, 'logs', 'app.log');
  const lines = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(line => /\[run\] (start|end): python -m src daily/.test(line)) : [];
  return {started: lines.filter(line => /\[run\] start:/.test(line)).length, ended: lines.filter(line => /\[run\] end:/.test(line)).length};
}
// What is left under the suite's page: clearRoot moves it to the trash and counts it, so a second pass that finds 0 means the page is empty.
const emptyPage = async ctx => clearRoot(ctx.token, ctx.root.id);

export async function run(ctx) {
  let before = null;   // ctx.page, read each time: the relaunch below replaces the window
  try {
    await ctx.run('the suite holds the real test workspace and its page starts empty', async () => {
      if (ctx.store !== 'notion' || ctx.standIn || !ctx.root) throw new Error(`the suite needs the real test workspace (store ${ctx.store}, root ${ctx.root?.title || 'none'})`);
      if (!/job pilotto 2/i.test(ctx.root.workspace)) throw new Error(`not the test workspace: "${ctx.root.workspace}"`);
      const left = await emptyPage(ctx);   // openContext's fresh already trashed last run's items: nothing more is there
      if (left) throw new Error(`the page still held ${left} item(s) after the fresh start`);
      console.log(`  Notion test page "${ctx.root.title}" in "${ctx.root.workspace}": empty`);
    }, {critical: true});

    await ctx.run('an app on this Mac\'s store holds real-shaped data on every screen', async () => {
      // The store is chosen at start-up, as a person's next start would: settings.json says sqlite before the app opens it.
      await ctx.relaunch({}, profile => {
        const file = path.join(profile, 'settings.json');
        const settings = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
        fs.writeFileSync(file, JSON.stringify({...settings, setupDone: true, wizardStep: 'extras', setupFurthest: 'extras', store: 'sqlite'}));
      });
      await ctx.page.evaluate(key => window.pilot.saveSecret('ANTHROPIC_API_KEY', key), DUMMY_KEY);
      if (settingsOf(ctx.profile).store !== 'sqlite') throw new Error(`the app starts on ${settingsOf(ctx.profile).store}`);
      const seeded = seedStore(ctx.profile);
      if (seeded.applications !== 3) throw new Error(`the seed wrote ${JSON.stringify(seeded)}`);
      const kestrel = await ctx.data('applications', 'get', {url: KESTREL});
      await ctx.data('applications', 'set_section', {app_id: kestrel.id, name: RECORD, markdown: RECORD_TEXT});
      await ctx.page.reload();
      await ctx.page.waitForSelector('.view:not([hidden])', {timeout: 60000});
      before = await screens(ctx.page);
      if (before.jobs.length < 4 || before.interviews.length !== 1 || !before.activity.length) throw new Error(`the seeded data is not on the screens: ${JSON.stringify(before)}`);
      console.log(`  before: ${JSON.stringify(before)}`);
    }, {critical: true});

    await ctx.run('the real workspace connects and this Mac keeps its data until the move', async () => {
      const result = await connectExisting(ctx.page, ctx.token);
      if (!result?.ok) throw new Error(`Notion did not connect: ${result?.error || JSON.stringify(result)}`);
      await ctx.page.reload();
      await ctx.page.waitForSelector('.view:not([hidden])', {timeout: 60000});
      const settings = settingsOf(ctx.profile);
      if (settings.store !== 'sqlite') throw new Error(`connecting changed the store to ${settings.store}`);
      if (!settings.notionIds?.NOTION_APPLICATIONS_DB) throw new Error(`no workspace ids after the connect: ${JSON.stringify(settings.notionIds || {})}`);
    }, {critical: true});

    await ctx.run('Move to Notion copies every record into the real workspace once', async () => {
      // Connecting starts the app's first search (src daily) on this Mac's store; its full sync may mark the seeded match not seen. The move must carry
      // what the store holds when it starts, so the screens are read again once that search has ended.
      await until('the first search after the connect', () => searches(ctx.profile), ({started, ended}) => started === ended, {ms: 180000, every: 2000});
      // What the move must carry is the store as it is now: a match that search marked not seen leaves the Jobs list (read from the store, not a second
      // screen read, which under load can catch a half-loaded list).
      const matches = await ctx.data('matches', 'list');
      console.log(`  matches before the move: ${JSON.stringify(matches.map(match => [match.company, match.status]))}`);
      const hidden = matches.filter(match => /not seen|dismissed/i.test(match.status || '')).map(match => match.company);
      before = {...before, jobs: before.jobs.filter(company => !hidden.includes(company))};
      // Real Notion has bad moments (9 Oct 2026: a 520 on POST pages after 14 s). The move then stops with nothing changed and goes on where it stopped when
      // pressed again: that is what a person does, once. A second stop fails the step.
      let said = await pressMove(ctx.page, {timeout: 600000});
      if (/stopped before the end/.test(said)) {
        console.log(`  the move stopped once ("${said}"); pressing Move again, as a person would: it goes on where it stopped`);
        said = await pressMove(ctx.page, {timeout: 600000});
      }
      if (!/Moved to Notion ✓/.test(said) || /already had/.test(said)) throw new Error(`the move says "${said}"`);
      if (settingsOf(ctx.profile).store !== 'notion') throw new Error(`the store is ${settingsOf(ctx.profile).store} after the move`);
      const apps = await until('the applications in Notion', () => ctx.data('applications', 'list'), rows => rows.length >= 3);
      const companies = apps.map(app => app.company).sort();
      if (JSON.stringify(companies) !== JSON.stringify(COMPANIES.slice(0, 3).sort())) throw new Error(`Notion holds the applications ${JSON.stringify(companies)}`);
      const events = await until('the events in Notion', () => ctx.data('events', 'list'), rows => rows.length >= 2);
      const interviews = await ctx.data('interviews', 'list');
      if (events.length !== 2 || interviews.length !== 1) throw new Error(`Notion holds ${events.length} events and ${interviews.length} interviews, not 2 and 1`);
    });

    await ctx.run('the kit, the application record, the interview, the file and the Profile read back from Notion\'s pages', async () => {
      const kestrel = await ctx.data('applications', 'get', {url: KESTREL});
      const kit = await ctx.data('applications', 'section', {app_id: kestrel.id, name: KIT});
      if (!/Dear Kestrel Labs team/.test(kit || '') || !/Notice period: 3 months/.test(kit || '')) throw new Error(`the kit reads back as "${(kit || '').slice(0, 200)}"`);
      const record = await ctx.data('applications', 'section', {app_id: kestrel.id, name: RECORD});
      if (!(record || '').includes(RECORD_TEXT)) throw new Error(`the application record reads back as "${(record || '').slice(0, 200)}"`);
      const files = (await allBlocks(ctx.token, kestrel.id)).filter(block => ['file', 'image', 'pdf'].includes(block.type));
      if (files.length !== 1) throw new Error(`the job's page holds ${files.length} file blocks, not 1`);
      const huxley = await ctx.data('applications', 'get', {url: HUXLEY});
      const [listed] = await ctx.data('interviews', 'list', {app_id: huxley.id});   // a listing has no page body: the transcript comes with get
      const interview = listed && await ctx.data('interviews', 'get', {interview_id: listed.id});
      if (!interview || !/on-call/.test(interview.transcript || '')) throw new Error(`the interview reads back as ${JSON.stringify(interview || null).slice(0, 300)}`);
      const profile = await ctx.data('texts', 'get', {name: 'profile'});
      if (!profile.includes('ten years')) throw new Error(`a new workspace did not take this Mac's Profile: "${profile.slice(0, 200)}"`);
      // The page itself, as a person opens it in Notion: the kit is a section heading on the job's ctx.page.
      const jobPage = await call(ctx.token, 'GET', `pages/${kestrel.id}`);
      if (jobPage.archived || !jobPage.url) throw new Error('the job has no page a person can open');
    });

    await ctx.run('Jobs, Focus, Interviews and Recent activity show the same items from Notion', async () => {
      await ctx.page.reload();
      await ctx.page.waitForSelector('.view:not([hidden])', {timeout: 60000});
      sameScreens(before, await screens(ctx.page));
    });
  } finally {
    // Leave the page as found: everything this run wrote goes to the trash, and a second pass proves nothing is left.
    if (ctx.root) {
      await ctx.run('the run\'s rows are cleaned up: the test page is empty again', async () => {
        const trashed = await emptyPage(ctx);
        const left = await emptyPage(ctx);
        console.log(`  cleanup: ${trashed} item(s) moved to the trash, ${left} left`);
        if (left) throw new Error(`${left} item(s) were still on the test page after the cleanup`);
      });
    }
  }
}
