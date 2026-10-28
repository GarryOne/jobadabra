// Apply from the app: choosing jobs and kits, Chrome and Claude sessions, tickets, the extension's base CV.
// Split from app.test.js (8 Oct 2026) without changing any test.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import * as apply from '../lib/apply.js';

// The launcher reads the browser's last-used profile from HOME / LOCALAPPDATA: point both at an empty folder so no test reads the owner's real browser.
const emptyHome = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-home-'));
process.env.HOME = emptyHome;
process.env.LOCALAPPDATA = emptyHome;
import * as strategy from '../lib/strategy.js';
import {createStorage} from '../lib/storage.js';

// Stand-in for safeStorage: reversible, and obviously not plain text on disk.
const fakeCrypto = {encrypt: v => Buffer.from(v).reverse().toString('base64'), decrypt: s => Buffer.from(s, 'base64').reverse().toString()};
const tempStorage = () => createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'pilot-')), fakeCrypto);

test('apply picks saved jobs first, then the best fit, only with a kit, never applied or dismissed ones', () => {
  const jobs = [
    {url: 'a', status: 'unreviewed', fit: 60, kit: true}, {url: 'b', status: 'applied', fit: 95, kit: true},
    {url: 'c', status: 'saved', fit: 40, kit: true}, {url: 'd', status: 'unreviewed', fit: 88, kit: true},
    {url: 'e', status: 'dismissed', fit: 99, kit: true}, {url: 'f', status: 'unreviewed', fit: null, kit: true},
    {url: 'g', status: 'unreviewed', fit: 97},
  ];
  assert.deepEqual(apply.pick(jobs, 3).map(j => j.url), ['c', 'd', 'a']);  // g: best fit, but no kit yet
});

test('agent sessions need Notion; Chrome opens the chosen jobs', async () => {
  const storage = tempStorage();
  const spawned = [];
  const fakeSpawn = (cmd, args) => { spawned.push([cmd, ...args]); return {unref() {}}; };
  const blocked = await apply.start(storage, {n: 2, mode: 'agents'}, fakeSpawn);
  assert.equal(blocked.ok, false);
  assert.equal(spawned.length, 0);
});

test('the background runner queues the chosen jobs for the hidden browser and never opens the person\'s Chrome', async () => {
  const jobs = [{url: 'https://jobs.example.test/background', status: 'saved', fit: 90, title: 'Nurse', company: 'Fictional', kit: true}];
  const launched = [], queued = [];
  const result = await apply.start(tempStorage(), {n: 1, mode: 'background', applyMode: 'fill'}, (...args) => { launched.push(args); return {unref() {}}; }, async () => ({jobs}),
    undefined, undefined, null, undefined, {enqueue: async (selected, applyMode) => { queued.push({selected, applyMode}); return {ok: true}; }});
  assert.equal(result.ok, true);
  assert.deepEqual(queued.map(row => [row.selected.map(job => job.url), row.applyMode]), [[[jobs[0].url], 'fill']]);
  assert.deepEqual(launched, []);
  const unwired = await apply.start(tempStorage(), {n: 1, mode: 'background', applyMode: 'fill'}, (...args) => { launched.push(args); return {unref() {}}; }, async () => ({jobs}));
  assert.equal(unwired.ok, false);   // no queue handed in: refuse, never fall through to the visible Chrome launcher
  assert.deepEqual(launched, []);
});

test('Chrome mode marks each job link so the extension fills every tab by itself', {skip: process.platform === 'win32' && 'Mac launcher (open -a, Terminal); Windows is covered below'}, async () => {
  const storage = tempStorage();
  const spawned = [];
  const fakeSpawn = (cmd, args) => { spawned.push([cmd, ...args]); return {unref() {}}; };
  const fakeList = async () => ({jobs: [
    {url: 'https://job-boards.greenhouse.io/a/jobs/1#top', status: 'unreviewed', fit: 80, title: 'SRE', company: 'A', kit: true},
    {url: 'https://jobs.lever.co/b/2', status: 'saved', fit: 60, title: 'DevOps', company: 'B', kit: true}]});
  const result = await apply.start(storage, {n: 2, mode: 'chrome'}, fakeSpawn, fakeList);
  assert.equal(result.ok, true);
  const ids = spawned[0].slice(3).map(address => address.split('#jobpilotto-fill=')[1]);   // each tab carries the form session made for its job
  assert.deepEqual(spawned[0].slice(0, 3), ['open', '-a', 'Google Chrome']);
  assert.deepEqual(spawned[0].slice(3).map(address => address.split('#')[0]), ['https://jobs.lever.co/b/2', 'https://job-boards.greenhouse.io/a/jobs/1']);
  assert.ok(ids.every(Boolean) && new Set(ids).size === 2, ids.join());
});

test('an Apply batch drafts the missing kits for the best jobs first, quietly, and says so', {skip: process.platform === 'win32' && 'Mac launcher'}, async () => {
  const storage = tempStorage();
  const spawned = [];
  const fakeSpawn = (cmd, args) => { spawned.push([cmd, ...args]); return {unref() {}}; };
  const jobs = [{code: 'a', url: 'https://a/1', status: 'unreviewed', fit: 90, title: 'SRE', company: 'A', kit: true},
    {code: 'b', url: 'https://b/2', status: 'unreviewed', fit: 85, title: 'Ops', company: 'B'},
    {code: 'c', url: 'https://c/3', status: 'unreviewed', fit: 70, title: 'Dev', company: 'C'}];
  const prepared = [];
  const prepare = async code => { prepared.push(code); jobs.find(job => job.code === code).kit = true; return {ok: true}; };
  const result = await apply.start(storage, {n: 2, mode: 'chrome'}, fakeSpawn, async () => ({jobs}), undefined, undefined, prepare);
  assert.deepEqual(prepared, ['b']);  // only the shortfall, best fit first
  assert.match(result.message, /^Drafted 1 kit first\. Opened 2 job/);
  assert.equal(spawned[0].length, 3 + 2);
});

test('an Apply batch does not wait for kits drafted on GitHub, and says so', async () => {
  const jobs = [{code: 'b', url: 'https://b/2', status: 'unreviewed', fit: 85, title: 'Ops', company: 'B'}];
  const result = await apply.start(tempStorage(), {n: 1, mode: 'chrome'}, () => ({unref() {}}), async () => ({jobs}), undefined, undefined, async () => ({ok: true, cloud: true}));
  assert.equal(result.ok, false);
  assert.match(result.error, /GitHub/);
});

test('missing kits are picked saved first, then by fit, open jobs only', () => {
  const jobs = [{code: 'a', url: 'u', status: 'unreviewed', fit: 90}, {code: 'b', url: 'u', status: 'saved', fit: 50}, {code: 'c', url: 'u', status: 'applied', fit: 99},
    {code: 'd', url: 'u', status: 'unreviewed', fit: 95, kit: true}];
  assert.deepEqual(apply.pickMissing(jobs, 5).map(job => job.code), ['b', 'a']);
});

test('Tailor CVs for top matches: open jobs without a tailored CV, saved first, then by fit, capped', () => {
  const jobs = [{code: 'a', url: 'u', status: 'unreviewed', fit: 90}, {code: 'b', url: 'u', status: 'saved', fit: 50, tailored: true}, {code: 'c', url: 'u', status: 'saved', fit: 40},
    {code: 'd', url: 'u', status: 'dismissed', fit: 99}, {code: 'e', url: 'u', status: 'unreviewed', fit: 95}];
  assert.deepEqual(apply.pickUntailored(jobs, 5).map(job => job.code), ['c', 'e', 'a']);
  assert.deepEqual(apply.pickUntailored(jobs, 2).map(job => job.code), ['c', 'e']);
});

test('Tailor CVs for top matches: with nothing to tailor it says why, and never claims CVs are ready when there are no jobs (issue #347)', () => {
  const tailored = [{code: 'a', url: 'u', status: 'unreviewed', fit: 90, tailored: true}];
  assert.match(apply.nothingToTailor(tailored), /already has a tailored CV/);
  for (const jobs of [[], [{code: 'd', url: 'u', status: 'dismissed', fit: 99}], [{code: 'x', status: 'unreviewed'}]]) {
    const said = apply.nothingToTailor(jobs);
    assert.match(said, /no jobs/i);
    assert.doesNotMatch(said, /already has a tailored CV/);
  }
});

test('Apply on one job opens it in Chrome with the fill marker; no link, no Chrome', {skip: process.platform === 'win32' && 'Mac launcher (open -a, Terminal); Windows is covered below'}, () => {
  const calls = [];
  const open = (...args) => { calls.push(args); return {unref() {}}; };
  assert.deepEqual(apply.openOne('https://jobs.lever.co/acme/1#top', {session: 's1', open}), {ok: true});
  assert.deepEqual(calls[0].slice(0, 2), ['open', ['-a', 'Google Chrome', 'https://jobs.lever.co/acme/1#jobpilotto-fill=s1']]);
  assert.equal(apply.openOne('', {session: 's1', open}).ok, false);
  assert.equal(calls.length, 1);
});

test('the extension gets the base CV from the app; contact details and notes need Notion', async () => {
  const storage = tempStorage();
  storage.writeText('cv.pdf', '%PDF-1.4 fake');
  storage.saveSettings({cvName: 'CV_Ada.pdf'});
  const server = await import('../lib/server.js');
  const me = await server.me(storage);
  assert.deepEqual(me.contact, {});  // without Notion there is nowhere to read them from
  assert.match(me.contactError, /Notion/);  // and it says why, instead of an empty answer that looks like "no details"
  assert.equal(me.contactSource, 'none');
  assert.equal(me.resume.name, 'CV_Ada.pdf');
  assert.equal(Buffer.from(me.resume.data, 'base64').toString(), '%PDF-1.4 fake');
  assert.ok(strategy.DRAFT_SCHEMA.required.includes('contact'));
});

test('Apply with Claude needs Claude Code, Notion and the job\'s kit, then starts one session for the job', async () => {
  const storage = tempStorage();
  const launched = [];
  const launch = async (_, urls, options) => { launched.push([urls, options]); return urls.length; };
  const found = () => '/usr/local/bin/claude';
  const kit = async () => ({ok: true});
  const url = 'https://www.jobs.ch/en/vacancies/detail/1/';
  assert.match((await apply.claudeOne(storage, url, launch, () => '', kit)).error, /Claude Code/);
  assert.match((await apply.claudeOne(storage, url, launch, found, kit)).error, /Notion/);
  storage.setSecret('NOTION_TOKEN', 'ntn_test');
  assert.equal((await apply.claudeOne(storage, '', launch, found, kit)).ok, false);
  assert.match((await apply.claudeOne(storage, url, launch, found, async () => ({ok: false, error: 'No application kit'}))).error, /kit/);
  assert.equal(launched.length, 0);
  assert.deepEqual(await apply.claudeOne(storage, `${url}#top`, launch, found, kit), {ok: true});
  assert.deepEqual(launched[0][0], [url]);
  assert.equal(launched[0][1].claude, '/usr/local/bin/claude');
  assert.equal(typeof launched[0][1].open, 'function');  // the form tab opens (with the fill mark) before Claude starts
  assert.match(apply.claudeReady(storage, found, 'win32', () => '').error, /Git for Windows/);
  assert.equal(apply.claudeReady(storage, found, 'win32', () => 'C:\\Git\\bin\\bash.exe').ok, true);
});

test('Apply to N with Claude: the best N jobs with a kit, one session each; none says so', async () => {
  const storage = tempStorage();
  storage.setSecret('NOTION_TOKEN', 'ntn_test');
  const launched = [];
  const launch = async (_, urls) => { launched.push(urls); };
  const two = async () => ['https://a/1', 'https://b/2'];
  const binary = apply.claudeBinary() ? null : 'skip';
  if (binary) return;  // no Claude Code on this machine: claudeReady stops first
  const result = await apply.start(storage, {n: 3, mode: 'agents'}, null, null, launch, two);
  assert.equal(result.ok, true);
  assert.deepEqual(launched[0], ['https://a/1', 'https://b/2']);
  assert.match(result.message, /Starting 2 Claude/);
  assert.match((await apply.start(storage, {n: 3, mode: 'agents'}, null, null, launch, async () => [])).error, /no application kit|application kit yet/i);
});

test('the next jobs with a kit come from apply_batch --next, links only', async () => {
  const run = async (_, args) => ({code: 0, stdout: `Loading…\r\n{"url": "https://a/1", "title": "SRE", "company": "Acme"}\r\nhttps://b/2\n`, args});
  const urls = await apply.nextWithKits({}, 2, run);
  assert.deepEqual([...urls], ['https://a/1', 'https://b/2']);
  assert.deepEqual(urls.details['https://a/1'], {title: 'SRE', company: 'Acme'});  // for the session card and notification
  assert.deepEqual([...await apply.nextWithKits({}, 2, async () => ({code: 1, stdout: 'https://a/1'}))], []);
});

test('the kit check asks Notion through apply_batch --has-kit and says how to draft one when there is none', async () => {
  const seen = [];
  const run = async (_, args, onLine) => { seen.push(args); onLine('No Applications row for x — prepare a kit first (📝 Prepare).'); return {code: 1}; };
  const result = await apply.hasKit({}, 'https://x', run);
  assert.deepEqual(seen[0], ['src.ai.apply_batch', '--has-kit', 'https://x']);
  assert.equal(result.ok, false);
  assert.match(result.error, /Prepare only/);
  assert.deepEqual(await apply.hasKit({}, 'https://x', async () => ({code: 0})), {ok: true});
});

test('claude is found outside the shell PATH, where the installer puts it', () => {
  const found = apply.claudeBinary({PATH: '/usr/bin'}, file => file === '/opt/homebrew/bin/claude', 'darwin');
  assert.equal(found, '/opt/homebrew/bin/claude');
  assert.equal(apply.claudeBinary({PATH: ''}, () => false, 'darwin'), '');
});

test('Apply with Claude tickets: one job, three hours, unknown ones refused', async () => {
  const server = await import('../lib/server.js');
  const now = Date.parse('2026-09-28T10:00:00Z');
  const ticket = server.issueTicket('https://boards.greenhouse.io/acme/jobs/1#jobpilotto-fill', now);
  assert.match(ticket, /^[0-9a-f]{32}$/);
  assert.equal(server.checkTicket(ticket, 'https://boards.greenhouse.io/acme/jobs/1/', now + 1000), true);
  assert.equal(server.checkTicket(ticket, 'https://boards.greenhouse.io/acme/jobs/2', now), false);
  assert.equal(server.checkTicket(ticket, 'https://boards.greenhouse.io/acme/jobs/1', now + 3 * 3600 * 1000 + 1), false);
  assert.equal(server.checkTicket('guess', 'https://boards.greenhouse.io/acme/jobs/1', now), false);
});

test('Apply with Claude checklist: Claude Code found and signed in, Git for Windows only on Windows', () => {
  const signedIn = apply.claudeSignedIn('/home/x', () => JSON.stringify({oauthAccount: {emailAddress: 'a@b.c'}}));
  assert.equal(signedIn, true);
  assert.equal(apply.claudeSignedIn('/home/x', () => { throw new Error('no file'); }), false);
  assert.deepEqual(apply.claudePrereqs('darwin', {binary: () => '/usr/local/bin/claude', signedIn: () => false, bash: () => '', chrome: () => true}),
    {claude: true, signedIn: false, git: null, windows: false, chrome: true});
  assert.equal(apply.claudePrereqs('win32', {binary: () => '', signedIn: () => true, bash: () => 'C:\\Program Files\\Git\\bin\\bash.exe'}).git, true);
  const bash = 'C:\\Program Files\\Git\\bin\\bash.exe';
  assert.equal(apply.gitBash({ProgramFiles: 'C:\\Program Files'}, file => file === bash), bash);
  assert.equal(apply.gitBash({}, () => true), '');
});

test('Claude in Chrome: found in any Chrome profile, false when Chrome or the extension is missing', async () => {
  const {claudeInChrome, CLAUDE_IN_CHROME} = await import('../lib/apply.js');
  const {join} = await import('node:path');  // the platform's separators (the Windows run uses backslashes)
  const fsTree = {'/c': ['Default', 'Profile 1', 'Local State'], [join('/c', 'Default', 'Extensions')]: ['abc'], [join('/c', 'Profile 1', 'Extensions')]: [CLAUDE_IN_CHROME]};
  const list = dir => { if (!fsTree[dir]) throw new Error('ENOENT'); return fsTree[dir]; };
  assert.equal(claudeInChrome('/c', list), true);
  assert.equal(claudeInChrome('/c', dir => (dir === '/c' ? ['Default'] : list(dir))), false);
  assert.equal(claudeInChrome('/missing', list), false);
});

test('Application sessions start collapsed: the pills say what needs you, and the head expands them', async () => {
  const fs = await import('node:fs');
  const html = fs.readFileSync(new URL('../renderer/index.html', import.meta.url), 'utf8');
  const toggle = /id="sd-toggle"[^>]*aria-expanded="(\w+)"/.exec(html);
  assert.equal(toggle?.[1], 'false');  // what the window paints before any session exists (1 Oct 2026: the dock covered a third of the screen by default)
  const shared = fs.readFileSync(new URL('../renderer/pages/shared.js', import.meta.url), 'utf8');
  assert.match(shared, /dockOpen:\s*false/);  // and the state renderDock reads, so a reload doesn't open it again
});

// Owner's scenario (28 Oct 2026, screenshot: "Apply to 1 job" with Background automation → "This job is not eligible to start another application"; 1 job In process).
// The picker took the best open match by job status alone, so a job already in process (stage Screening) with a kit and the top fit was picked, and Background refused it.
test('apply picks the best job that may start: an in-process job with the top fit is skipped, never picked and refused', () => {
  const jobs = [
    {url: 'process', status: 'unreviewed', stage: 'Screening', fit: 99, kit: true},
    {url: 'confirmed', status: 'unreviewed', stage: 'Confirmation received', fit: 98, kit: true},
    {url: 'ready', status: 'unreviewed', stage: 'Kit ready', fit: 70, kit: true},
    {url: 'saved', status: 'saved', stage: 'Saved', fit: 50, kit: true},
    {url: 'unstaged', status: 'unreviewed', fit: 40, kit: true},
  ];
  assert.deepEqual(apply.pick(jobs, 1).map(j => j.url), ['saved'], 'saved first, then the best fit among jobs that may start');
  assert.deepEqual(apply.pick(jobs, 5).map(j => j.url), ['saved', 'ready', 'unstaged']);
  assert.deepEqual(apply.pick(jobs.slice(0, 2), 1), [], 'nothing eligible: nothing is picked');
});

test('the picker and Background automation share one eligibility rule', async () => {
  const {canStart, STARTABLE_STAGES} = await import('../lib/apply-eligibility.js');
  for (const stage of ['', 'Saved', 'Kit ready', 'Applying', 'Screening', 'Applied', 'Closed', 'Dismissed']) {
    assert.equal(apply.pick([{url: 'x', status: 'unreviewed', stage, kit: true}], 1).length === 1, canStart(stage), `stage "${stage}"`);
  }
  assert.deepEqual(STARTABLE_STAGES, ['Saved', 'Kit ready', 'Applying']);
});
