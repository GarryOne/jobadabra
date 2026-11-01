// Layer 3 (Node + the real engine + a temp data folder, no window): a change to the roles, places, level or companies to skip decides which postings the next Jobs check keeps
// (desktop/e2e/suites/strategy.mjs, this Mac's store). The app's own writers (lib/strategy-settings.js: keepLocally is the window's saveStrategy without Notion, addRoles)
// change the files; the check is the very command list a Find jobs press runs (lib/search-steps.js searchSteps) over the suite's two fixture boards, with the AI answered locally
// (a fixed good score for a scoring call, "no credit" for everything else) and the digest it wrote read back. Replaces these e2e steps (this Mac's store leg):
//   - "before any change the check finds neither new posting"
//   - "a role and a place added in the app reach config/search.json"
//   - "the next check keeps the posting that matches the new role and place, and still drops the other"
//   - "a company to skip, set in the app, reaches config/preferences.json"
//   - "the skipped company is not kept any more, while the same role at the other board still is"
//   - "a role changed in the app is used by the next check, and a removed role stops matching"
//   - "a region word and a level set in the app decide which postings the next check keeps"
// and the jobs suite's "the check looks for this person's roles and places (this Mac's config, no Search settings page)".
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {digestTitles} from '../lib/digest.mjs';
import {startAiProxy} from '../lib/ai-proxy.mjs';
import {DUMMY_KEY} from '../lib/engine.mjs';
import {applicantDraft} from '../lib/applicant-seed.mjs';
import {withRoles} from '../lib/search-roles.mjs';

const E2E = path.resolve(import.meta.dirname, '..');
const FEEDS = path.join(E2E, 'fixtures', 'feeds');
const ROLE = 'zebra wrangler', GIRAFFE = 'giraffe keeper', PLACE = 'lugano', SKIP = 'E2E Initech';
// A scoring call gets a fixed good score (the digest leaves out a job still waiting for its score once an AI is ready); any other call is refused locally.
const SCORE = {score: 80, tier: 'B', components: {role_fit: 80, location: 80, compensation: 70, growth: 70, risk: 20}, basis: {salary_stated: false, level_stated: true},
  reason: 'stand-in score', strengths: ['stand-in'], gaps: [], confidence: 'high'};

const proxy = await startAiProxy();
proxy.setCanned(body => (body.output_config?.format?.schema?.properties?.score ? JSON.stringify(SCORE) : {refuse: 'no-credit'}));
const feeds = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-strategy-feeds-'));
fs.cpSync(FEEDS, feeds, {recursive: true});
// The app's own isolation switches, set before its modules read them.
Object.assign(process.env, {JOB_PILOTTO_E2E: '1', JOB_PILOTTO_FIXTURE_DIR: feeds, JOB_PILOTTO_E2E_AI_BASE_URL: proxy.url, JOB_PILOTTO_FOLLOW_APP: '0'});
const {createStorage} = await import('../../lib/storage.js');
const {ensureConfig} = await import('../../lib/pipeline-env.js');
const pipelineRun = await import('../../lib/pipeline-run.js');
const {searchSteps} = await import('../../lib/search-steps.js');
const strategy = await import('../../lib/strategy-settings.js');
const {START, sqliteStart} = await import('../lib/strategy-start.mjs');

// This Mac's store, set up the way the wizard leaves it: the key, the applicant's strategy kept here, no Notion.
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-strategy-int-'));
const storage = createStorage(profile, {encrypt: value => value, decrypt: value => value});
const read = file => JSON.parse(fs.readFileSync(path.join(profile, 'config', file), 'utf8'));
const exec = (s, args, onLine, extra, options) => pipelineRun.run(s, args, onLine, {...extra, JOB_PILOTTO_STORE: 'sqlite', JOB_PILOTTO_FOLLOW_APP: '0'}, options);
const deps = {run: exec, ensurePage: async () => { throw new Error('no Notion page on this Mac\'s store'); }, writePage: async () => { throw new Error('no Notion page on this Mac\'s store'); }};
// The window's saveStrategy on this Mac's store (lib/strategy-draft-handlers.js): only the accepted parts are written.
const saveInApp = (search, preferences, parts) => strategy.keepLocally(storage, {profile_markdown: 'Placeholder.', answers_markdown: 'Placeholder.', contact: {}, search, preferences}, parts);
const has = (list, word) => (list || []).some(entry => new RegExp(word, 'i').test(entry));
const listed = (jobs, word, level) => jobs.some(job => new RegExp(word, 'i').test(job) && (!level || job.startsWith(level)));
// A new posting on one of the boards (the seen ones are not "new" again, so each check is judged on postings added just before it).
const addPosting = (file, id, title, place = 'Lugano') => {
  const feed = path.join(feeds, file), data = JSON.parse(fs.readFileSync(feed, 'utf8'));
  data.jobs.push({id, title, location: {name: place}, absolute_url: `https://boards.e2e.test/job/${id}`, updated_at: '2026-10-02T09:00:00Z',
    content: `<p>${title}: run production on Kubernetes and AWS with Terraform, SLOs and on-call. Senior level, English working language, ${place}.</p>`});
  fs.writeFileSync(feed, JSON.stringify(data));
};
// One Jobs check on the feeds: the steps of a Find jobs press, to their end; -> the titles its digest listed.
const check = async () => {
  const lines = [];
  const done = await searchSteps(storage, line => lines.push(String(line)), 'run', 'you', exec);
  assert.equal(done.code, 0, `the Jobs check failed: ${lines.slice(-8).join(' | ')}`);
  return digestTitles(lines.join('\n'));
};

test('the Mac store starts with the applicant\'s strategy and this suite\'s start state: no job, two small boards, no strategy change', async () => {
  storage.saveSettings({store: 'sqlite', setupDone: true, aiEngine: 'api', lastScoutAt: new Date(0).toISOString()});   // lastScoutAt: no employer finder at the press's end
  storage.setSecret('ANTHROPIC_API_KEY', DUMMY_KEY);
  ensureConfig(storage);
  strategy.keepLocally(storage, applicantDraft(), null);
  // The jobs suite's step "the check looks for this person's roles and places (this Mac's config, no Search settings page)":
  assert.ok(read('search.json').role_keywords.some(word => /site reliability/.test(word)), `config/search.json holds roles ${JSON.stringify(read('search.json').role_keywords)}, not the applicant's`);
  fs.copyFileSync(path.join(FEEDS, 'sources-strategy.json'), path.join(profile, 'config', 'sources.json'));
  const start = sqliteStart(read('search.json'), read('preferences.json'));
  saveInApp(start.search, start.preferences, ['search', 'filters']);
  assert.ok(read('search.json').role_keywords.includes('data analyst'), 'the start state did not reach config/search.json');
});

test('before any change the check finds neither new posting', async () => {
  const jobs = await check();
  assert.ok(!listed(jobs, 'zebra|giraffe'), `jobs for roles nobody asked for were kept: ${jobs.filter(job => /zebra|giraffe/i.test(job)).join('; ')}`);
});

test('a role and a place added in the app reach config/search.json, and the next check keeps the matching posting and still drops the other', async () => {
  const added = await strategy.addRoles(storage, [ROLE], deps);
  assert.ok(added.added.includes(ROLE), `addRoles: ${JSON.stringify(added)}`);
  const search = read('search.json');
  saveInApp({locations: {...search.locations, top_tier: [...search.locations.top_tier, PLACE]}}, null, ['search']);
  const file = read('search.json');
  assert.ok(has(file.role_keywords, ROLE) && has(file.locations.top_tier, PLACE), `config/search.json lacks the new role or place (roles: ${file.role_keywords.join(', ')}; places: ${file.locations.top_tier.join(', ')})`);
  const jobs = await check();
  assert.ok(listed(jobs, 'zebra', 'Senior'), `the Zebra Wrangler posting was not kept (listed: ${jobs.join('; ') || 'nothing'})`);
  assert.ok(!listed(jobs, 'giraffe'), 'the Giraffe Keeper posting was kept without anybody asking for that role');
  assert.ok(listed(jobs, 'zebra', 'Staff'), 'the same role at the other board was not kept, although that company is not skipped yet');
});

test('a company to skip, set in the app, reaches config/preferences.json; its new posting is not kept while the same role at the other board still is', async () => {
  const search = read('search.json'), preferences = read('preferences.json');
  saveInApp(search, {...preferences, excluded_companies: [...(preferences.excluded_companies || []), SKIP]}, ['filters']);
  assert.ok(has(read('preferences.json').excluded_companies, SKIP), 'config/preferences.json lacks the company');
  assert.ok(has(read('search.json').role_keywords, ROLE), 'saving the companies lost the role added before (config/search.json)');
  addPosting('initech.json', 3102, 'Staff Zebra Wrangler, Platform');
  addPosting('zebra.json', 3005, 'Senior Zebra Wrangler, Data');
  const jobs = await check();
  assert.ok(!listed(jobs, 'Platform', 'Staff'), 'a new posting from the skipped company was kept');
  assert.ok(listed(jobs, 'Data', 'Senior'), 'a new posting from a company that is not skipped was lost');
});

test('a role changed in the app is used by the next check, and a removed role stops matching', async () => {
  const search = read('search.json');
  saveInApp(withRoles(search, [...search.role_keywords.filter(entry => !has([entry], ROLE)), GIRAFFE]), read('preferences.json'), ['search']);
  addPosting('zebra.json', 3006, 'Senior Zebra Wrangler, Cloud');
  addPosting('zebra.json', 3007, 'Senior Giraffe Keeper, Cloud');
  const jobs = await check();
  const file = read('search.json');
  assert.ok(has(file.role_keywords, GIRAFFE) && !has(file.role_keywords, ROLE), `config/search.json did not take the change: ${file.role_keywords.join(', ')}`);
  assert.ok(listed(jobs, 'giraffe keeper, cloud'), `the role added in the app found nothing (listed: ${jobs.join('; ') || 'nothing'})`);
  assert.ok(!listed(jobs, 'zebra wrangler, cloud'), 'the role removed in the app still matches a new posting');
});

test('a region word and a level set in the app decide which postings the next check keeps', async () => {
  const search = read('search.json');
  // "Ticino" is a region word (src/regions.py): a posting in Bellinzona has no "lugano" in it. "junior" skips the titles that plainly name a senior role.
  saveInApp({...search, level: ['junior'], locations: {...search.locations, top_tier: ['ticino']}}, read('preferences.json'), ['search']);
  addPosting('zebra.json', 3008, 'Junior Giraffe Keeper, Nord', 'Bellinzona');
  addPosting('zebra.json', 3009, 'Senior Giraffe Keeper, Nord', 'Bellinzona');
  addPosting('zebra.json', 3010, 'Junior Giraffe Keeper, Sued', 'Zurich, Switzerland');
  const jobs = await check();
  assert.ok(listed(jobs, 'junior giraffe keeper, nord'), `a posting in Bellinzona was not kept for the region "Ticino" (listed: ${jobs.join('; ') || 'nothing'})`);
  assert.ok(!listed(jobs, 'senior giraffe keeper, nord'), 'the level "junior" still kept a Senior title');
  assert.ok(!listed(jobs, 'giraffe keeper, sued'), 'a posting in Zurich was kept for the region "Ticino"');
});

test('the AI stand-in answered locally: nothing reached a real model', () => {
  assert.ok(START['Target roles'].length > 0);
  assert.ok(proxy.stats.calls > 0, 'positive control: the checks asked the stand-in');
  assert.equal(proxy.stats.paid || 0, 0, 'a call went past the stand-in to a real model');
});

test('teardown', async () => { await proxy.close(); });
