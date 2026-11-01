/* global document, window */
// Strategy journey (J13, Tier 1) and the Notion page's Always on edit (Tier 2): a role and a place set in the app reach the next Jobs check, a role changed in the app
// (this Mac's store) or on the ⚙️ Search settings page (Notion) is used by the check after it, and a removed role stops matching.
// Why (1 Nov 2026, owner's three layers, a8's registry): only these 3 steps stay in e2e (they are the journey); the other 8 steps of the old suite moved to
// desktop/integration/store/strategy-integration.test.mjs and strategy-notion-integration.test.mjs (#2763), which run the same writers and the real engine in seconds.
import fs from 'node:fs';
import path from 'node:path';
import {digestTitles} from '../lib/digest.mjs';
import {watch} from '../lib/activity.mjs';
import {closeRunningRows, findPagesBeside, pageSections, restoreSections, setSection, trashPage} from '../lib/notion.mjs';
import {clearData} from '../lib/start-state.mjs';
import {forgetFixtureJobs} from '../lib/forget.mjs';
import {ensureSetUp} from '../lib/seed.mjs';
import {withRoles} from '../lib/search-roles.mjs';
import {START, sqliteStart} from '../test/strategy-start.mjs';

export const realAi = false;   // every AI call is answered by the stand-in below; the harness fails the run if one reaches a real model
export const engine = 'api';   // the suite relies on the AI proxy answering scoring calls locally, which needs the API engine (nothing reaches a real model on either turn)
export const minutes = 15;
export const name = 'strategy';
// Either store (P7, owner 9 Oct 2026): on Notion (the stand-in) a change made on either side, the app or the ⚙️ Search settings page (a Notion rendering of the
// settings, spec 2026-10-09-store-adapters.md §4), reaches the other and the next check; on this Mac's store there is no page, the person's settings are
// config/search.json + preferences.json written by the app (saveStrategy), so the page's steps are the same edits made in the app, and the reconnect is Notion's only.
const TITLE = '⚙️ Search settings';
const ROLE = 'zebra wrangler', GIRAFFE = 'giraffe keeper', PLACE = 'lugano';

export async function run(ctx) {
  const {page, token: NOTION} = ctx;
  const onNotion = ctx.store !== 'sqlite';
  // This suite is about which postings the crawl keeps, not about scoring them, and it must cost nothing: the proxy answers a scoring call locally. A scoring call gets a fixed good score,
  // because the digest leaves out a job still waiting for its score once an AI is ready (6ffc22b); any other call is refused locally with "no credit" (a stub, by design), so the engine falls back to its rules as it always did here and nothing reaches a real model.
  const SCORE = {score: 80, tier: 'B', components: {role_fit: 80, location: 80, compensation: 70, growth: 70, risk: 20}, basis: {salary_stated: false, level_stated: true},
    reason: 'stand-in score', strengths: ['stand-in'], gaps: [], confidence: 'high'};
  ctx.proxy.setCanned(body => (body.output_config?.format?.schema?.properties?.score ? JSON.stringify(SCORE) : {refuse: 'no-credit'}));
  await ensureSetUp(ctx);   // after the stand-in: the setup's own AI calls stay local too
  const read = file => JSON.parse(fs.readFileSync(path.join(ctx.profile, 'config', file), 'utf8'));
  // The app links (or creates) the page a moment after it connects (lib/migrate.js runs in the background): wait for it.
  const linkedPage = async window_ => {
    for (let i = 0; i < 45; i++) {
      const id = await window_.evaluate(() => window.pilot.state()).then(s => s?.settings?.notionIds?.NOTION_SEARCH_SETTINGS_PAGE || '');
      if (id) return id;
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    return '';
  };
  // fastSeed connects Notion before "setup done" is saved, and the Notion-side moves (lib/migrate.js) only run for a finished setup: connect once more, as a user
  // reconnecting does, and they run.
  const reconnect = async window_ => {
    const done = await window_.evaluate(token => window.pilot.notionConnect(token), NOTION);
    if (!done?.ok) throw new Error(`Notion did not reconnect: ${done?.error}`);
  };
  const settingsPage = () => linkedPage(page);
  const profileId = onNotion ? await page.evaluate(() => window.pilot.state()).then(s => s.settings.notionIds.NOTION_PROFILE_PAGE_ID) : '';
  // This Mac's store: the strategy is changed where the person changes it, in the app (the Strategy page saves through saveStrategy, its parts only).
  const saveInApp = async (search, preferences, parts) => {
    const saved = await page.evaluate(([draft, chosen]) => window.pilot.saveStrategy(draft, chosen), [{profile_markdown: 'Placeholder.', answers_markdown: 'Placeholder.', contact: {}, search, preferences}, parts]);
    if (!saved?.ok) throw new Error(`saveStrategy: ${saved?.error}`);
  };
  // Read right after the app rewrote the page, Notion can list it without its headings for a while (7 Oct 2026: "Cannot read properties of undefined
  // (reading 'filter')" on 'Target roles' (named 'Roles to look for' until 21 Oct 2026, 8c8bd70), 14 s after a delete-and-append rewrite). Wait for the headings every step reads, then say which were missing.
  const HEADINGS = ['Target roles', 'Best places', 'Companies to skip'];
  const sections = async () => {
    const id = await settingsPage();
    let found = {};
    for (let i = 0; i < 10; i++) {
      found = await pageSections(NOTION, id);
      if (HEADINGS.every(heading => found[heading])) return found;
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
    throw new Error(`the Search settings page (${id}) still lacks ${HEADINGS.filter(heading => !found[heading]).join(', ')} after 30 s; it reads: ${Object.keys(found).join(' | ') || 'no headings'}`);
  };
  const has = (list, word) => (list || []).some(entry => new RegExp(word, 'i').test(entry));

  // One Jobs check on the feeds in this suite; resolves with the titles its digest listed.
  const check = async () => {
    const engineLog = path.join(ctx.profile, 'logs', 'engine.log');
    const logStart = fs.existsSync(engineLog) ? fs.statSync(engineLog).size : 0;   // only what this check writes counts
    await page.click('.nav[data-view="jobs"]');
    await page.click('#refresh');
    const {samples, endedAt} = await watch(page, {every: 3000, maxMs: 420000});
    if (endedAt == null) throw new Error('the Jobs check was still running after 7 minutes');
    if (samples.at(-1).newest?.ok === false) throw new Error(`the Jobs check failed: ${samples.at(-1).newest.result}`);
    // What the check told the person: the digest it just wrote to the engine log (it exists whether or not the AI scored the jobs, and it is after the person's own filters).
    const log = path.join(ctx.profile, 'logs', 'engine.log');
    return digestTitles(fs.existsSync(log) ? fs.readFileSync(log).subarray(logStart).toString('utf8') : '');
  };
  // A new posting on one of the boards (the seen ones are not "new" again, so each check is judged on postings added just before it).
  const addPosting = (file, id, title, place = 'Lugano') => {
    const feed = path.join(ctx.feeds, file), data = JSON.parse(fs.readFileSync(feed, 'utf8'));
    data.jobs.push({id, title, location: {name: place}, absolute_url: `https://boards.e2e.test/job/${id}`, updated_at: '2026-10-02T09:00:00Z',
      content: `<p>${title}: run production on Kubernetes and AWS with Terraform, SLOs and on-call. Senior level, English working language, ${place}.</p>`});
    fs.writeFileSync(feed, JSON.stringify(data));
  };
  // Titles tell the two boards apart: "Senior …" is E2E Zebra's, "Staff …" is E2E Initech's.
  const listed = (jobs, word, level) => jobs.some(job => new RegExp(word, 'i').test(job) && (!level || job.startsWith(level)));

  await ctx.run('this suite starts with no jobs, two small boards and no strategy change', async () => {
    await clearData(ctx, 'Job Matches — AI Scored');
    fs.mkdirSync(path.join(ctx.profile, 'config'), {recursive: true});
    fs.copyFileSync(path.join(ctx.E2E, 'fixtures', 'feeds', 'sources-strategy.json'), path.join(ctx.profile, 'config', 'sources.json'));
    if (!onNotion) {   // a fresh profile: nothing is left from an earlier run; the start state is saved in the app
      const start = sqliteStart(read('search.json'), read('preferences.json'));
      await saveInApp(start.search, start.preferences, ['search', 'filters']);
      if (!read('search.json').role_keywords.includes('data analyst')) throw new Error('the start state did not reach config/search.json');
      return;
    }
    const closed = await closeRunningRows(NOTION);   // start state: no run left "Running" by a killed earlier run
    if (closed) console.log(`  closed ${closed} run row(s) an earlier, killed run had left "Running"`);
    await reconnect(page);
    const pageId = await settingsPage();
    if (!pageId) throw new Error('the app has no ⚙️ Search settings page id after setup');
    // Leftovers of older test runs (a duplicate page used to be made on every connect): keep only the one the app linked, so the checks below start clean.
    for (const extra of (await findPagesBeside(NOTION, profileId, TITLE)).filter(block => block.id.replace(/-/g, '') !== pageId.replace(/-/g, ''))) await trashPage(NOTION, extra.id);
    const found = await findPagesBeside(NOTION, profileId, TITLE);
    // The page starts from this suite's declared start state (6 Oct 2026, snapshot preseeding): every section the steps touch is set to START, whatever an
    // earlier run left (a run killed mid-step left "junior", and every later check dropped Senior titles). A section that differed is said in the log.
    const restored = await restoreSections(NOTION, pageId, START);
    if (restored.length) {
      console.log(`  the page differed from the suite's start state, restored: ${restored.join(' | ')}`);
      await reconnect(page);   // the app takes the restored page, not the one it read when it first connected
    }
    if (found.length !== 1 || found[0].id.replace(/-/g, '') !== pageId.replace(/-/g, '')) throw new Error(`expected exactly the linked ${TITLE} page, found ${found.length}`);
    // Connecting ran a Jobs check on whatever strategy the page held then (the previous run's end state: the Giraffe role). Wait for it, then forget what it kept, or the next
    // digest lists those postings as new although nobody asks for them any more.
    await page.waitForFunction(() => document.querySelector('#activity')?.dataset.state !== 'busy', null, {timeout: 120000});
    const forgotten = forgetFixtureJobs(ctx.profile);
    if (forgotten) console.log(`  forgot ${forgotten} fixture posting(s) kept by the connect-time check`);
  }, {needs: ctx.needs});

  await ctx.run(onNotion ? 'a role and a place added in the app reach the Notion page and config/search.json' : 'a role and a place added in the app reach config/search.json', async () => {
    const added = await page.evaluate(terms => window.pilot.addRoles(terms), [ROLE]);
    if (!added?.ok || !added.added.includes(ROLE)) throw new Error(`addRoles: ${JSON.stringify(added)}`);
    const search = read('search.json'), preferences = read('preferences.json');
    const saved = await page.evaluate(draft => window.pilot.saveStrategy(draft, ['search']), {
      profile_markdown: 'Placeholder, not saved (only the search part is accepted).', answers_markdown: 'Placeholder.', contact: {},
      search: {locations: {...search.locations, top_tier: [...search.locations.top_tier, PLACE]}}, preferences});
    if (!saved?.ok) throw new Error(`saveStrategy: ${saved?.error}`);
    const file = read('search.json'), notion = onNotion ? await sections() : null;
    if (!has(file.role_keywords, ROLE) || !has(file.locations.top_tier, PLACE)) throw new Error(`config/search.json lacks the new role or place (roles: ${file.role_keywords.join(', ')}; places: ${file.locations.top_tier.join(', ')})`);
    if (!notion) return;
    if (!has(notion['Target roles'], ROLE)) throw new Error(`the Notion page lacks the role (it lists: ${(notion['Target roles'] || []).join(', ')})`);
    if (!has(notion['Best places'], PLACE)) throw new Error(`the Notion page lacks the place (it lists: ${(notion['Best places'] || []).join(', ')})`);
  }, {needs: ctx.needs});

  await ctx.run('the next check keeps the posting that matches the new role and place, and still drops the other', async () => {
    const jobs = await check();
    if (!listed(jobs, 'zebra', 'Senior')) throw new Error(`the Zebra Wrangler posting was not kept (listed: ${jobs.join('; ') || 'nothing'})`);
    if (listed(jobs, 'giraffe')) throw new Error('the Giraffe Keeper posting was kept without anybody asking for that role');
    if (!listed(jobs, 'zebra', 'Staff')) throw new Error('the same role at the other board was not kept, although that company is not skipped yet');
  }, {needs: ctx.needs});

  if (!onNotion) {   // this Mac's store: the page's two edits made in the app instead; no page to reconnect to
    await ctx.run('a role changed in the app is used by the next check, and a removed role stops matching', async () => {
      const search = read('search.json');
      await saveInApp(withRoles(search, [...search.role_keywords.filter(entry => !has([entry], ROLE)), GIRAFFE]), read('preferences.json'), ['search']);
      addPosting('zebra.json', 3006, 'Senior Zebra Wrangler, Cloud');
      addPosting('zebra.json', 3007, 'Senior Giraffe Keeper, Cloud');
      const jobs = await check();
      const file = read('search.json');
      if (!has(file.role_keywords, GIRAFFE) || has(file.role_keywords, ROLE)) throw new Error(`config/search.json did not take the change: ${file.role_keywords.join(', ')}`);
      if (!listed(jobs, 'giraffe keeper, cloud')) throw new Error(`the role added in the app found nothing (listed: ${jobs.join('; ') || 'nothing'})`);
      if (listed(jobs, 'zebra wrangler, cloud')) throw new Error('the role removed in the app still matches a new posting');
    }, {needs: ctx.needs});
    return;
  }

  await ctx.run('an edit made directly on the Notion page is used by the next check, and a removed role stops matching', async () => {
    const id = await settingsPage();
    const before = await sections();
    // The page is the source of truth: a person adds a role there, and takes the other one out.
    await setSection(NOTION, id, 'Target roles', [...before['Target roles'].filter(entry => !has([entry], ROLE)), GIRAFFE]);
    addPosting('zebra.json', 3006, 'Senior Zebra Wrangler, Cloud');
    addPosting('zebra.json', 3007, 'Senior Giraffe Keeper, Cloud');
    const jobs = await check();
    const file = read('search.json');
    if (!has(file.role_keywords, GIRAFFE) || has(file.role_keywords, ROLE)) throw new Error(`config/search.json did not follow the page: ${file.role_keywords.join(', ')}`);
    if (!listed(jobs, 'giraffe keeper, cloud')) throw new Error(`the role added in Notion found nothing (listed: ${jobs.join('; ') || 'nothing'})`);
    if (listed(jobs, 'zebra wrangler, cloud')) throw new Error('the role removed in Notion still matches a new posting');
  }, {needs: ctx.needs});
}
