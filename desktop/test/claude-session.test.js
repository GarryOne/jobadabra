import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import * as session from '../lib/claude-session.js';
import {createStorage} from '../lib/storage.js';

const tempStorage = () => createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-session-')), {encrypt: v => v, decrypt: v => v});

test('the session gets Notion and the app folders, the app\'s python3 first, never the API key', () => {
  const storage = tempStorage();
  storage.setSecret('NOTION_TOKEN', 'ntn_x');
  storage.setSecret('ANTHROPIC_API_KEY', 'sk-ant-app');
  const env = session.sessionEnv(storage, {PATH: '/usr/bin', HOME: '/Users/x', ANTHROPIC_API_KEY: 'sk-ant-shell'}, 'darwin', '/data/bin');
  assert.equal(env.NOTION_TOKEN, 'ntn_x');
  assert.equal(env.ANTHROPIC_API_KEY, undefined);
  assert.equal(env.PATH, '/data/bin:/usr/bin');
  assert.equal(env.HOME, '/Users/x');
  assert.equal(env.JOB_PILOTTO_APPLY_RUN_DIR, storage.path('apply-runs'));
  const win = session.sessionEnv(storage, {Path: 'C:\\Windows'}, 'win32', 'C:\\data\\bin');
  assert.equal(win.Path, 'C:\\data\\bin;C:\\Windows');
});

test('python3 for the session is a small script pointing at the app\'s Python (forward slashes on Windows)', () => {
  const storage = tempStorage();
  assert.equal(session.pythonShim(storage, 'python3', 'darwin'), null);
  const dir = session.pythonShim(storage, 'C:\\Users\\x\\AppData\\Local\\Programs\\Jobadabra\\resources\\pilot\\python\\python.exe', 'win32');
  assert.match(fs.readFileSync(path.join(dir, 'python3'), 'utf8'), /exec 'C:\/Users\/x\/AppData\/Local\/Programs\/Jobadabra\/resources\/pilot\/python\/python.exe' "\$@"/);
});

test('the prompt names the job and the audit file, uses the open form tab and the password helper', () => {
  const text = session.prompt('https://jobs.example.com/1', {auditFile: 'C:/Temp/audit_1.json'});
  assert.match(text, /apply-to-job skill/);
  assert.match(text, /--audit "C:\/Temp\/audit_1.json"/);
  // Claude opens the one tab with the fill mark, and never fires the extension itself (no ticket, no event).
  assert.match(text, /Open the form tab yourself/);
  assert.match(text, /createIfEmpty true/);
  assert.match(text, /https:\/\/jobs\.example\.com\/1#jobadabra-fill/);
  assert.match(text, /never open a second one/);
  assert.match(text, /no-form/);
  assert.match(text, /read by an applicant, not a developer/);
  assert.match(text, /account/);
  assert.match(text, /the extension follows it/);
  assert.match(text, /don't read this repo's tests, config or README/);
  assert.doesNotMatch(text, /jobadabra:fill|ticket/);
  assert.match(text, /src\.ai\.passwords/);
  assert.doesNotMatch(text, /security find-generic-password|\/tmp\//);
});

test('Windows: one console window per job through start, reading its instructions from a file', async () => {
  assert.equal(session.windowsCommand({claude: 'C:\\Users\\x\\.local\\bin\\claude.exe', repo: 'C:\\App\\pilot', promptFile: 'C:\\Temp\\p_1.txt'}),
    '"start "Jobadabra" /D "C:\\App\\pilot" "C:\\Users\\x\\.local\\bin\\claude.exe" --chrome --permission-mode bypassPermissions ' +
    '"Read the file C:/Temp/p_1.txt and do exactly what it says.""');
  const storage = tempStorage();
  const spawned = [], steps = [];
  const run = (command, args, options) => { spawned.push({command, args, options}); return {unref() {}}; };
  const count = await session.launch(storage, ['https://a/1', 'https://b/2'], {claude: 'claude.exe', platform: 'win32', run, gap: 0,
    pipelineRun: async (_, args) => { steps.push(args); return {code: 0}; }, ticket: () => 't'});
  assert.equal(count, 2);
  assert.deepEqual(steps, [['src.ai.apply_batch', '--mark-applying', 'https://a/1'], ['src.ai.apply_batch', '--mark-applying', 'https://b/2']]);
  assert.equal(spawned.length, 2);  // no Mac watcher
  assert.deepEqual(spawned[0].args.slice(0, 3), ['/d', '/s', '/c']);
  assert.equal(spawned[0].options.windowsVerbatimArguments, true);
  const file = spawned[0].args[3].match(/Read the file (\S+) and/)[1];
  assert.match(fs.readFileSync(file, 'utf8'), /apply to this job: https:\/\/a\/1/);
});

test('Mac: a Terminal window per job whose shell loads the session variables from a private file', async () => {
  const storage = tempStorage();
  storage.setSecret('NOTION_TOKEN', 'ntn_x');
  const spawned = [];
  const run = (command, args, options) => { spawned.push({command, args, options}); return {unref() {}}; };
  await session.launch(storage, ['https://a/1'], {claude: '/usr/local/bin/claude', platform: 'darwin', run, gap: 0,
    pipelineRun: async () => ({code: 0}), ticket: () => ''});
  assert.equal(spawned[0].command, 'osascript');
  assert.match(spawned[0].args[1], /--permission-mode bypassPermissions/);
  const envFile = spawned[0].args[1].match(/\. '([^']+session_1\.env)'/)[1];
  if (process.platform !== 'win32') assert.equal(fs.statSync(envFile).mode & 0o777, 0o600);  // Windows has no Unix modes
  assert.match(fs.readFileSync(envFile, 'utf8'), /export NOTION_TOKEN='ntn_x'/);
  assert.doesNotMatch(fs.readFileSync(envFile, 'utf8'), /ANTHROPIC_API_KEY/);
  assert.equal(spawned.length, 1); // the extension watches the submit; this launcher does not
});

// A fake terminal module: what the session code asks of terminals.js.
function fakeTerms(existing = []) {
  const started = [], resumed = [];
  return {started, resumed, hookSettings: (id, port) => `hooks:${id}:${port}`, claudeIdOf: id => existing.find(s => s.id === id)?.claudeId || '',
    list: () => existing, start: async options => { started.push(options); return options; }, resume: async (id, options) => { resumed.push({id, ...options}); return {id}; }};
}

test('each session runs its own Claude conversation, named up front so it can be reopened later', async () => {
  const storage = tempStorage();
  const term = fakeTerms();
  await session.launchInApp(storage, ['https://a/1', 'https://b/2'], {claude: '/bin/claude', platform: 'darwin', gap: 0, term, watch: () => {},
    pipelineRun: async () => ({code: 0}), ticket: () => ''});
  const ids = term.started.map(options => options.args[options.args.indexOf('--session-id') + 1]);
  assert.match(ids[0], /^[0-9a-f-]{36}$/);
  assert.notEqual(ids[0], ids[1]);
  assert.deepEqual(term.started.map(options => options.claudeId), ids);
});

test('resume: the same conversation with fresh hooks; a stopped session is told to carry on, a waiting one is not', async () => {
  const storage = tempStorage();
  const existing = [{id: 'w1', url: 'https://a/1', claudeId: 'conv-1', status: 'input', resumable: true, live: false},
    {id: 'e2', url: 'https://b/2', claudeId: 'conv-2', status: 'ended', resumable: true, live: false},
    {id: 'l3', url: 'https://c/3', claudeId: 'conv-3', status: 'running', resumable: false, live: true},
    {id: 'o4', url: 'https://d/4', claudeId: '', status: 'ended', resumable: false, live: false}];
  const term = fakeTerms(existing);
  const options = {claude: '/bin/claude', platform: 'darwin', term, port: 47111};
  assert.equal((await session.resumeInApp(storage, 'w1', options)).ok, true);
  assert.equal((await session.resumeInApp(storage, 'e2', options)).ok, true);
  const [waiting, stopped] = term.resumed;
  assert.deepEqual(waiting.args.slice(-2), ['--resume', 'conv-1']);  // nothing to add: it waits where it was
  assert.deepEqual(stopped.args.slice(-3, -1), ['--resume', 'conv-2']);
  assert.match(stopped.args.at(-1), /Carry on where you left off/);
  assert.equal(waiting.env.JOB_PILOTTO_SESSION, 'w1');
  const settings = waiting.args[waiting.args.indexOf('--settings') + 1];
  assert.equal(fs.readFileSync(settings, 'utf8'), 'hooks:w1:47111');
  assert.match((await session.resumeInApp(storage, 'l3', options)).error, /already running/);
  assert.match((await session.resumeInApp(storage, 'o4', options)).error, /can't be resumed/);
  assert.match((await session.resumeInApp(storage, 'zz', options)).error, /no longer in the list/);
});

test('a session opens its job in Chrome before Claude starts, once per job', async () => {
  const order = [];
  const storage = tempStorage();
  await session.launchInApp(storage, ['https://a/1', 'https://b/2'], {claude: 'claude', gap: 0, port: 1,
    pipelineRun: async () => ({code: 0}), open: url => order.push(`open ${url}`),
    term: {hookSettings: () => '{}', start: async ({url}) => { order.push(`start ${url}`); return {}; }}});
  assert.deepEqual(order, ['open https://a/1', 'start https://a/1', 'open https://b/2', 'start https://b/2']);
});

test('Claude is told to put the fill mark on every address it navigates the tab to (an address handed in from outside is no longer carried by the extension, #742)', () => {
  const text = session.prompt('https://jobs.example.com/1', {auditFile: 'a.json', session: 'abc123'});
  assert.match(text, /whenever you navigate that tab to another address yourself, put #jobadabra-fill=abc123 at the end of that address too/);
});
