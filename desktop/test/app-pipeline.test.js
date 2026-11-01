// The app's engine and Profile plumbing: secrets, the pipeline env whitelist, Notion vs Trying Profile, and the strategy draft (progress, goals, notes).
// Split from app.test.js (8 Oct 2026) without changing any test.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {test} from 'node:test';
import * as pipeline from '../lib/pipeline.js';
import * as strategy from '../lib/strategy.js';
import {createStorage} from '../lib/storage.js';
import {cleanSecret} from '../lib/secrets.js';

const SEARCH_LISTS = {target_roles: ['site reliability engineer', 'sre']};   // every draft has them (lib/strategy-empty.js)

// Stand-in for safeStorage: reversible, and obviously not plain text on disk.
const fakeCrypto = {encrypt: v => Buffer.from(v).reverse().toString('base64'), decrypt: s => Buffer.from(s, 'base64').reverse().toString()};
const tempStorage = () => createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'pilot-')), fakeCrypto);

test('secrets are encrypted on disk and only reported as present', () => {
  const storage = tempStorage();
  storage.setSecret('ANTHROPIC_API_KEY', 'sk-ant-secret');
  assert.equal(storage.secret('ANTHROPIC_API_KEY'), 'sk-ant-secret');
  assert.equal(fs.readFileSync(storage.path('secrets.json'), 'utf8').includes('sk-ant-secret'), false);
  assert.equal(storage.secretsPresent().ANTHROPIC_API_KEY, true);
  assert.equal(storage.secretsPresent().NOTION_TOKEN, false);
  assert.throws(() => storage.setSecret('HOME', 'x'));
  storage.setSecret('ANTHROPIC_API_KEY', '');
  assert.equal(storage.secret('ANTHROPIC_API_KEY'), '');
});

test('the pipeline runs on the user folder, with AI models only when a key is set', () => {
  const storage = tempStorage();
  pipeline.ensureConfig(storage);
  assert.ok(fs.existsSync(storage.path('config/search.json')));
  let env = pipeline.pipelineEnv(storage);
  assert.equal(env.JOBADABRA_DATA_DIR, storage.path('data'));
  assert.equal(env.JOBADABRA_PROFILE_FILE, undefined);  // no file on this Mac yet
  assert.equal(env.JOBADABRA_SCORE_MODEL, undefined);
  storage.setSecret('ANTHROPIC_API_KEY', 'sk-ant-x');
  env = pipeline.pipelineEnv(storage);
  assert.equal(env.ANTHROPIC_API_KEY, 'sk-ant-x');
  assert.equal(env.JOBADABRA_SCORE_MODEL, 'claude-sonnet-5-5');
});

test('the end-to-end stand-ins reach the engine only in a test run (its env is a whitelist)', () => {
  const storage = tempStorage();
  const parent = {PATH: '/bin', JOBADABRA_E2E_NOTION_BASE_URL: 'http://127.0.0.1:1', JOBADABRA_E2E_TELEGRAM_BASE_URL: 'http://127.0.0.1:2',
    JOBADABRA_E2E_GOOGLE_BASE_URL: 'http://127.0.0.1:3', JOBADABRA_E2E_NOTION_STANDIN: '1', GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 's', GOOGLE_REFRESH_TOKEN: 'r'};
  const user = pipeline.pipelineEnv(storage, parent);
  assert.equal(user.JOBADABRA_E2E_NOTION_BASE_URL, undefined);
  assert.equal(user.JOBADABRA_E2E_NOTION_STANDIN, undefined);
  assert.equal(user.GOOGLE_REFRESH_TOKEN, undefined);
  const e2e = pipeline.pipelineEnv(storage, {...parent, JOBADABRA_E2E: '1'});
  assert.equal(e2e.JOBADABRA_E2E_NOTION_BASE_URL, 'http://127.0.0.1:1');
  assert.equal(e2e.JOBADABRA_E2E_NOTION_STANDIN, '1');
  assert.equal(e2e.JOBADABRA_E2E_TELEGRAM_BASE_URL, 'http://127.0.0.1:2');
  assert.equal(e2e.JOBADABRA_E2E_GOOGLE_BASE_URL, 'http://127.0.0.1:3');
  assert.equal(e2e.GOOGLE_REFRESH_TOKEN, 'r');
});

test('the app-launched Python client omits the stand-in clock after the env whitelist', () => {
  const storage = tempStorage();
  const code = `import json, os
from src.notion import client, pace
now, waits, calls = [1000.0], [], []
class Answer:
    def __enter__(self): return self
    def __exit__(self, *args): return False
    def read(self, *args): return b'{"ok":true}'
def opener(request, timeout):
    calls.append(request.full_url)
    return Answer()
def sleep(seconds):
    waits.append(seconds)
    now[0] += seconds
client.urllib.request.urlopen = opener
pace.clock = lambda: now[0]
tracker = client.Tracker('pipeline-standin-' + str(os.getpid()), opener=opener, sleep=sleep)
try:
    for _ in range(20):
        assert tracker._request('GET', 'pages/fixture') == {'ok': True}
    assert calls == ['http://127.0.0.1/v1/pages/fixture'] * 20
    print(json.dumps({'calls': len(calls), 'pacing_seconds': round(sum(waits), 2)}))
finally:
    from pathlib import Path
    Path(pace.pace_file(tracker.token)).unlink(missing_ok=True)
`;
  for (const [flag, seconds] of [[undefined, 6.46], ['1', 0]]) {
    const parent = {PATH: process.env.PATH, HOME: storage.path(''), JOBADABRA_E2E: '1', JOBADABRA_E2E_NOTION_BASE_URL: 'http://127.0.0.1',
      ...(flag ? {JOBADABRA_E2E_NOTION_STANDIN: flag} : {})};
    const result = JSON.parse(execFileSync(pipeline.python(), ['-c', code], {cwd: pipeline.REPO, env: pipeline.pipelineEnv(storage, parent), encoding: 'utf8'}));
    assert.deepEqual(result, {calls: 20, pacing_seconds: seconds}, `app engine stand-in flag ${flag || '(absent)'}`);
  }
});

test('Trying (no Notion): the engine reads the Profile and answers from this Mac; connected, it never does', () => {
  const storage = tempStorage();
  storage.writeText('profile.md', 'P');
  assert.equal(pipeline.pipelineEnv(storage).JOBADABRA_PROFILE_FILE, storage.path('profile.md'));
  assert.equal(pipeline.pipelineEnv(storage).JOBADABRA_ANSWERS_FILE, undefined);  // no answers.md
  storage.writeText('answers.md', 'A');
  assert.equal(pipeline.pipelineEnv(storage).JOBADABRA_ANSWERS_FILE, storage.path('answers.md'));
  storage.setSecret('NOTION_TOKEN', 'ntn_x');
  storage.saveSettings({notionIds: {NOTION_PROFILE_PAGE_ID: 'profile'}});
  const env = pipeline.pipelineEnv(storage);
  assert.equal(env.JOBADABRA_PROFILE_FILE, undefined);  // Notion is the source of truth once connected
  assert.equal(env.JOBADABRA_ANSWERS_FILE, undefined);
});

test('demo mode: the engine reads the demo\'s own Profile, though its fictional Notion counts as connected', () => {
  const storage = tempStorage();
  storage.writeText('profile.md', 'P');
  storage.setSecret('NOTION_TOKEN', 'ntn_x');
  storage.saveSettings({notionIds: {NOTION_PROFILE_PAGE_ID: 'profile'}});
  try {
    pipeline.setDemo(true);
    assert.equal(pipeline.pipelineEnv(storage).JOBADABRA_PROFILE_FILE, storage.path('profile.md'));
  } finally { pipeline.setDemo(false); }
  assert.equal(pipeline.pipelineEnv(storage).JOBADABRA_PROFILE_FILE, undefined, 'a real connected install still reads Notion');
});

test('strategy draft: CV as a PDF document, structured output; only the search settings cache is saved on the Mac', async () => {
  const storage = tempStorage();
  pipeline.ensureConfig(storage);
  storage.writeText('cv.pdf', '%PDF-1.4 fake');
  const reply = {
    summary: 'Set up for SRE roles in Zurich.', profile_markdown: '# Hard constraints\n- EU citizen',
    answers_markdown: '# Eligibility\n- No sponsorship', open_questions: ['Salary in EUR?'],
    search: {target_roles: ['site reliability engineer'], title_exclude_keywords: ['intern'], board_discovery_keywords: ['devops'],
      quality_stack_keywords: ['kubernetes'],
      locations: {top_tier: ['z[uü]rich'], country_wide: ['switzerland'], abroad: []}, remote_excluded_regions: ['\\busa?\\b'],
      google_jobs: {queries: ['sre'], country: 'ch', locations: [{location: 'Zurich,Zurich,Switzerland', language: 'de'}]}},
    preferences: {disqualifying_languages: ['German'], excluded_companies: ['Acme']},
  };
  const seen = [];
  const client = {messages: {create: async request => {
    seen.push(request);
    return {stop_reason: 'end_turn', usage: {input_tokens: 10000, output_tokens: 3000}, content: [{type: 'text', text: JSON.stringify(reply)}]};
  }}};
  const result = await strategy.draft(storage, {roles: 'SRE'}, 'sk-ant-x', client);
  assert.equal(result.usd, 0.05);
  assert.equal(seen[0].model, 'claude-sonnet-5-5');
  assert.equal(seen[0].messages[0].content[0].type, 'document');
  assert.equal(seen[0].output_config.format.type, 'json_schema');
  strategy.save(storage, result);
  assert.equal(storage.readText('profile.md'), '');  // the Profile goes to Notion, not the Mac
  const search = JSON.parse(storage.readText('config/search.json'));
  assert.deepEqual(search.role_keywords, ['site reliability engineer']);   // written from the one list
  assert.deepEqual(search.jobs_board_search_queries, ['site reliability engineer']);
  assert.equal(search.google_jobs.searches_per_run, 1);
  const preferences = JSON.parse(storage.readText('config/preferences.json'));
  assert.deepEqual(preferences.excluded_companies, ['Acme']);
  assert.equal(preferences.digest_min_score, 50);
});

test('the pipeline never inherits the developer\'s tokens or .env', () => {
  const storage = tempStorage();
  const env = pipeline.pipelineEnv(storage, {PATH: '/usr/bin', HOME: '/Users/x', NOTION_TOKEN: 'owner', SERPAPI_API_KEY: 'owner',
    GITHUB_TOKEN: 'owner', JOBADABRA_ENRICH_MODEL: 'x', TELEGRAM_CHAT_ID: '1'});
  assert.equal(env.PATH, '/usr/bin');
  for (const leaked of ['NOTION_TOKEN', 'SERPAPI_API_KEY', 'GITHUB_TOKEN', 'JOBADABRA_ENRICH_MODEL', 'TELEGRAM_CHAT_ID']) {
    assert.equal(env[leaked], undefined, leaked);
  }
  assert.equal(env.JOBADABRA_NO_DOTENV, '1');
});

test('the user\'s own Adzuna and Jooble keys reach the engine, and a developer\'s never do', () => {
  const storage = tempStorage();
  storage.setSecret('ADZUNA_APP_ID', 'id1');
  storage.setSecret('ADZUNA_APP_KEY', 'key1');
  storage.setSecret('JOOBLE_API_KEY', 'jk1');
  const env = pipeline.pipelineEnv(storage, {PATH: '/usr/bin', ADZUNA_APP_ID: 'owner'});
  assert.deepEqual([env.ADZUNA_APP_ID, env.ADZUNA_APP_KEY, env.JOOBLE_API_KEY], ['id1', 'key1', 'jk1']);
  assert.equal(pipeline.pipelineEnv(tempStorage(), {PATH: '/usr/bin', ADZUNA_APP_ID: 'owner'}).ADZUNA_APP_ID, undefined);
});

test('the end-to-end journey\'s fixture feeds and its fictional candidate reach the engine; nothing else of the shell does', () => {
  const env = pipeline.pipelineEnv(tempStorage(), {PATH: '/usr/bin', JOBADABRA_FIXTURE_DIR: '/fx', JOBADABRA_LOCATIONS_FILE: '/fx/person.json', JOBADABRA_EXCLUDED_COMPANIES: 'Acme'});
  assert.equal(env.JOBADABRA_FIXTURE_DIR, '/fx');
  assert.equal(env.JOBADABRA_LOCATIONS_FILE, '/fx/person.json');   // dropped before, so the scout judged feeds for the example Amsterdam analyst, not the test candidate
  assert.equal(env.JOBADABRA_EXCLUDED_COMPANIES, undefined);
});

test('the persona search check\'s tape reaches the engine (src/search_tape.py)', () => {
  const tape = {JOBADABRA_SEARCH_TAPE: '/tape', JOBADABRA_SEARCH_TAPE_MODE: 'replay', JOBADABRA_TAPE_WAIT_SCALE: '0', JOBADABRA_TAPE_LIVE: '0'};
  const env = pipeline.pipelineEnv(tempStorage(), {PATH: '/usr/bin', ...tape});
  for (const [name, value] of Object.entries(tape)) assert.equal(env[name], value);
  assert.equal(pipeline.pipelineEnv(tempStorage(), {PATH: '/usr/bin'}).JOBADABRA_SEARCH_TAPE, undefined);
});

test('with Notion connected, the Profile comes from Notion, not the local file', () => {
  const storage = tempStorage();
  storage.setSecret('NOTION_TOKEN', 'ntn_x');
  storage.saveSettings({notionIds: {NOTION_APPLICATIONS_DB: 'abc'}});
  const env = pipeline.pipelineEnv(storage, {PATH: '/usr/bin'});
  assert.equal(env.JOBADABRA_PROFILE_FILE, undefined);
  assert.equal(env.NOTION_TOKEN, 'ntn_x');
  assert.equal(env.NOTION_APPLICATIONS_DB, 'abc');
});

test('pasted keys lose copy artefacts; look-alike letters from another layout are named, not sent', () => {
  assert.deepEqual(cleanSecret(' sk-ant-api03-abc\u200b\n'), {value: 'sk-ant-api03-abc'});
  const {value, error} = cleanSecret('sk-ant-api03-frp802\u0415\u0435hN');
  assert.equal(value, undefined);
  assert.match(error, /Character 20 \("\u0415", U\+0415\)/);
});

test('strategy draft streams: progress names the part being written and grows to 100 only at the end', async () => {
  const storage = tempStorage();
  pipeline.ensureConfig(storage);
  storage.writeText('cv.pdf', '%PDF-1.4 fake');
  const text = JSON.stringify({summary: 'S'.repeat(120), profile_markdown: 'P'.repeat(400), answers_markdown: 'A'.repeat(300), open_questions: [],
    search: {target_roles: ['sre'], title_exclude_keywords: [], board_discovery_keywords: [],
      quality_stack_keywords: [], locations: {top_tier: [], country_wide: [], abroad: []}, remote_excluded_regions: [],
      google_jobs: {queries: [], country: 'ch', locations: []}}, preferences: {disqualifying_languages: [], excluded_companies: []}});
  const client = {messages: {stream: () => {
    const handlers = [];
    return {
      on: (event, handler) => { if (event === 'text') handlers.push(handler); },
      finalMessage: async () => {
        for (let end = 50; end < text.length; end += 50) handlers.forEach(h => h('', text.slice(0, end)));
        return {stop_reason: 'end_turn', usage: {}, content: [{type: 'text', text}]};
      },
    };
  }}};
  const seen = [];
  await strategy.draft(storage, {}, 'sk-ant-x', client, p => seen.push(p));
  const parts = [...new Set(seen.map(p => p.part))];
  assert.deepEqual(parts.slice(0, 3), ['Writing the summary', 'Writing your Profile', 'Writing your standard answers']);
  assert.ok(seen.every((p, i) => i === 0 || p.percent >= seen[i - 1].percent));
  assert.ok(seen.every(p => p.percent <= 99));
  assert.equal(storage.settings().draftSections.profile_markdown, strategy.sectionLengths(text).profile_markdown);  // the next draft's bar
});

test('draft progress: 10% once Claude starts writing, then each part by its share, in order', () => {
  assert.deepEqual(strategy.progress('', {}), {part: 'Reading your CV', percent: 0, chars: 0, notes: []});
  const summary = '{"summary":"' + 'x'.repeat(400) + '",';
  assert.equal(strategy.progress(summary, {}).percent, 13);  // reading 10 + summary 3
  assert.equal(strategy.progress(summary + '"profile_markdown":"' + 'y'.repeat(7480), {}).percent, 33);  // + half of the Profile's 40
  const typical = {profile_markdown: 7500};  // this user's Profile is usually shorter: learned from the last draft
  assert.equal(strategy.progress(summary + '"profile_markdown":"' + 'y'.repeat(7480), typical).percent, 51);  // a part being written stops at 95% of its share
  assert.equal(strategy.progress('{"summary":"x","profile_markdown":"y","answers_markdown":"z', {}).part, 'Writing your standard answers');
  // A short Profile that's finished counts in full once the answers start (it used to count by length: bar ended ~45%).
  assert.equal(strategy.progress(summary + '"profile_markdown":"' + 'y'.repeat(3000) + '","answers_markdown":"', {}).percent, 53);
  const done = summary + '"goals":{"seniority":"Senior"},"profile_markdown":"y","answers_markdown":"z","open_questions":[],"search":{},"preferences":{},"contact":{"email":"a"';
  assert.ok(strategy.progress(done, {}).percent >= 97);
  assert.ok(strategy.progress(summary + '"profile_markdown":"' + 'y'.repeat(99999) + '","answers_markdown":"' + 'z'.repeat(99999)
    + '","open_questions":[],"search":{' + 'q'.repeat(9999) + '},"preferences":{' + 'p'.repeat(999) + '},"contact":{' + 'c'.repeat(999), {}).percent <= 99);
});

test('setup asks no questionnaire: the AI proposes the goals from the CV, the optional note wins', async () => {
  const storage = tempStorage();
  pipeline.ensureConfig(storage);
  storage.writeText('cv.pdf', '%PDF-1.4 fake');
  assert.deepEqual(strategy.DRAFT_SCHEMA.properties.goals.required, ['seniority', 'work_mode', 'minimum_salary', 'languages']);
  assert.ok(strategy.DRAFT_SCHEMA.required.includes('goals'));
  const seen = [];
  const client = {messages: {create: async request => { seen.push(request); return {stop_reason: 'end_turn', usage: {}, content: [{type: 'text', text: JSON.stringify({search: SEARCH_LISTS})}]}; }}};
  await strategy.draft(storage, {anything_else: 'Remote only, please'}, 'sk-ant-x', client);
  await strategy.draft(storage, {}, 'sk-ant-x', client);
  assert.match(seen[0].messages[0].content[1].text, /<note_from_user>\nRemote only, please\n<\/note_from_user>/);
  assert.match(seen[1].messages[0].content[1].text, /propose everything from the CV/);
  assert.doesNotMatch(seen[1].messages[0].content[1].text, /questionnaire/);
  assert.match(seen[0].system, /propose what they are looking for from the CV/);
  const text = '{"summary":"x","goals":{"seniority":"Senior","work_mode":"Remote only","minimum_salary":"CHF 130,000 (estimate)","languages":"English"},"profile_markdown":"';
  assert.ok(strategy.notes(text).includes('Proposed goals: Senior · Remote only · CHF 130,000 (estimate) · English'));
  assert.equal(strategy.progress(text).part, 'Writing your Profile');
});

test('the note to the AI is kept in the drafted Profile (What I told the AI), replaced on a regenerated draft', async () => {
  const storage = tempStorage();
  pipeline.ensureConfig(storage);
  storage.writeText('cv.pdf', '%PDF-1.4 fake');
  const reply = JSON.stringify({summary: 'x', profile_markdown: '# Hard constraints\n\n| Work mode | Remote |\n', search: SEARCH_LISTS});
  const client = {messages: {create: async () => ({stop_reason: 'end_turn', usage: {}, content: [{type: 'text', text: reply}]})}};
  const drafted = await strategy.draft(storage, {anything_else: 'Staff level, permanent only\nCompanies under 500 people'}, 'sk-ant-x', client);
  assert.equal(drafted.profile_markdown, '# Hard constraints\n\n| Work mode | Remote |\n\n# What I told the AI\n\nStaff level, permanent only\nCompanies under 500 people\n');
  assert.equal((await strategy.draft(storage, {}, 'sk-ant-x', client)).profile_markdown, '# Hard constraints\n\n| Work mode | Remote |\n');
  // A regenerated draft (or one that already has the section) keeps one section, with the new note; later sections stay.
  const again = strategy.withNote(`${drafted.profile_markdown}\n# Confirmed during setup\n\n- Senior\n`, {anything_else: 'Remote only'});
  assert.equal(again.match(/# What I told the AI/g).length, 1);
  assert.match(again, /- Senior\n\n# What I told the AI\n\nRemote only\n$/);
  assert.match(again, /# Confirmed during setup\n\n- Senior/);
  assert.doesNotMatch(again, /Staff level/);
  assert.doesNotMatch(strategy.withNote(drafted.profile_markdown, {}), /What I told the AI/);
});

test('a goal corrected in the review lands in the drafted Profile (its row, else a Confirmed during setup section)', async () => {
  const {applyGoal} = await import('../renderer/markdown-edit.js');
  const md = '# Hard constraints\n\n| Constraint | Value |\n|---|---|\n| Work mode | Hybrid |\n| Minimum seniority | Senior |\n\n# Compensation\n\n- Target: x\n- Minimum acceptable: CHF 1 (estimate)\n';
  let out = applyGoal(md, 'work_mode', 'Remote only');
  assert.match(out, /\| Work mode \| Remote only \|/);
  out = applyGoal(out, 'seniority', 'Staff');
  assert.match(out, /\| Minimum seniority \| Staff \|/);
  out = applyGoal(out, 'minimum_salary', 'CHF 150,000');
  assert.match(out, /- Minimum acceptable: CHF 150,000\n/);
  out = applyGoal(out, 'languages', 'English');
  out = applyGoal(out, 'languages', 'English, German');
  assert.match(out, /# Confirmed during setup\n\n- Languages I can work in: English, German\n$/);
  assert.equal(out.match(/Languages I can work in/g).length, 1);
});

// 17 Oct 2026: languages moved into Your details → Languages as a line; Strategy's edit finds it there (no second copy), and a bold label stays bold.
test('a goal kept as a line is edited in place, its bold kept', async () => {
  const {applyGoal} = await import('../renderer/markdown-edit.js');
  const moved = '## Targets\n- **Minimum acceptable:** CHF 1\n\n## 🗣️ Languages\n- Languages I can work in: English (fluent)\n';
  let out = applyGoal(moved, 'languages', 'English (fluent), German (B1)');
  assert.match(out, /## 🗣️ Languages\n- Languages I can work in: English \(fluent\), German \(B1\)\n/);
  assert.doesNotMatch(out, /Confirmed during setup/);
  out = applyGoal(out, 'minimum_salary', 'CHF 140,000');
  assert.match(out, /- \*\*Minimum acceptable:\*\* CHF 140,000\n/);
  assert.match(applyGoal('- **Work mode**: Hybrid\n- **Languages I can work in**: English\n', 'languages', 'Spanish'), /- \*\*Languages I can work in\*\*: Spanish/);
});

test('demo mode has a fictional draft with proposed goals (the setup review renders without AI)', () => {
  const demo = JSON.parse(fs.readFileSync(new URL('../demo/draft.json', import.meta.url), 'utf8'));
  for (const key of strategy.DRAFT_SCHEMA.required) assert.ok(key in demo.draft, key);
  assert.deepEqual(Object.keys(demo.draft.goals), strategy.DRAFT_SCHEMA.properties.goals.required);
});

test('while the strategy is drafted, the screen lists what Claude has finished so far', async () => {
  const {notes} = await import('../lib/strategy.js');
  const full = JSON.stringify({summary: 'Senior SRE roles in Zurich.', profile_markdown: '# Hard constraints\n- EU citizen\n# Compensation\n- CHF 150k',
    answers_markdown: '# Eligibility\n- No sponsorship', open_questions: ['Notice period?'],
    search: {target_roles: ['site reliability', 'sre'], locations: {top_tier: ['z[uü]rich'], country_wide: [], abroad: []}},
    preferences: {disqualifying_languages: ['German']}, contact: {email: 'a@b.c'}});
  const early = notes(full.slice(0, full.indexOf('"answers_markdown"') + 25));
  assert.deepEqual(early, ['Summary: Senior SRE roles in Zurich.', 'Profile: Hard constraints', 'Profile: Compensation', 'Profile written']);
  const all = notes(full);
  for (const line of ['Standard answers: Eligibility', 'Things for you to check: 1', 'Target roles: site reliability, sre',
    'Best places: zürich', 'Jobs requiring German will be hidden', 'Contact details found in your CV']) assert.ok(all.includes(line), line);
});

test('an edited cell or line goes back into its markdown line; the rest is untouched', async () => {
  const {replaceCell, replaceLine, withLine} = await import('../renderer/markdown-edit.js');
  assert.equal(replaceCell('| Pronouns | ❓ |', 1, 'he/him'), '| Pronouns | he/him |');
  assert.equal(replaceCell('| **School** | ❓ | x |', 1, 'Babeș-Bolyai | UBB\n'), '| **School** | Babeș-Bolyai / UBB | x |');
  assert.equal(replaceLine('  - Tone: direct', 'Tone: **direct**, factual'), '  - Tone: **direct**, factual');
  assert.equal(replaceLine('❓ Not provided', 'Decline to self-identify'), 'Decline to self-identify');
  assert.equal(withLine('# A\n| k | v |\n- x', 1, '| k | w |'), '# A\n| k | w |\n- x');
});

test('Rebuild from CV: changes grouped by what they trigger, contact edits ignored, location changes tie search and Profile', async () => {
  const {rebuildGroups, save} = await import('../lib/strategy.js');
  const current = {search: {role_keywords: ['\\bsre\\b'], locations: {top_tier: ['z[uü]rich']}}, preferences: {excluded_companies: ['Acme']},
    profile: '# Goals\n- SRE\n# Contact\n- Phone: 1', answers: '# Eligibility\n- EU citizen'};
  const draft = {search: {role_keywords: ['\\bsre\\b'], locations: {top_tier: ['z[uü]rich', 'basel']}}, preferences: {excluded_companies: ['Acme']},
    profile_markdown: '# Goals\n- SRE, platform\n# Contact\n- Phone: 2', answers_markdown: '# Eligibility\n- EU citizen'};
  const groups = rebuildGroups(current, draft, {scored: 120, kits: 5});
  assert.deepEqual(groups.map(group => group.id), ['search', 'profile']);  // no filter or answer changes; contact ignored
  assert.deepEqual(groups[0].changes, ['Top cities: +basel']);
  assert.equal(groups[0].linked, 'profile');
  assert.equal(groups[1].linked, 'search');
  assert.deepEqual(groups[1].changes, ['~ Goals']);
  assert.equal(groups[1].cost, 'Uses AI');
  assert.match(groups[1].impact, /Re-scores 120 jobs over the next 2 searches; 5 unsent kits/);
  // A contact-only change isn't a Profile change for scoring.
  assert.deepEqual(rebuildGroups(current, {...draft, search: current.search, profile_markdown: '# Goals\n- SRE\n# Contact\n- Phone: 9'}), []);
  // Saving only the search criteria leaves the preferences file untouched.
  const storage = tempStorage();
  storage.writeText('config/search.json', '{"role_keywords":["old"]}');
  storage.writeText('config/preferences.json', '{"excluded_companies":["Keep"]}');
  save(storage, {search: {role_keywords: ['new']}, preferences: null});
  assert.deepEqual(JSON.parse(storage.readText('config/search.json')).role_keywords, ['new']);
  assert.deepEqual(JSON.parse(storage.readText('config/preferences.json')), {excluded_companies: ['Keep']});
});
