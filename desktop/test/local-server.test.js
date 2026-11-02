// The application the extension reports as submitted (POST /extension/applied) is marked Applied in Notion — and
// the Claude session that filled that form leaves Application sessions. The job stays on Jobs.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import * as server from '../lib/server.js';
import * as terminals from '../lib/terminals.js';
import {logText} from './log-text.mjs';

function fakePty() {
  const spawned = [];
  return {spawned, loader: async () => ({spawn: (file, args, options) => {
    const handlers = {};
    const term = {file, args, options, written: [], killed: false,
      onData: fn => { handlers.data = fn; }, onExit: fn => { handlers.exit = fn; },
      write: data => term.written.push(data), resize: () => {}, kill: () => { term.killed = true; handlers.exit?.({exitCode: 0}); },
      emit: data => handlers.data(data)};
    spawned.push(term);
    return term;
  }})};
}


// The extension keeps its own decisions and pushes them (worker /extension/log): the app writes them to its log, so a
// decision made in Chrome can be read beside everything else instead of dying with the service worker.
test('the extension\'s decisions land in the app log', async () => {
  const log = await import('../lib/log.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-extlog-'));
  log.logTo(dir);
  const storage = {settings: () => ({}), secret: () => 't', setSecret: () => {}, path: (...p) => path.join(dir, ...p)};
  await server.localEnv(storage).onLog([
    {at: '2026-10-01T08:00:00.000Z', kind: 'submitted?', text: 'looks like a confirmation URL, but no submit press was seen: not marked',
      fields: {job: 'https://job-boards.greenhouse.io/anthropic/jobs/5114768008', version: '0.8.26'}},
  ]);
  const written = logText(path.join(dir, 'app.log')).trim().split('\n');
  assert.match(written.at(-1), /\[extension\] submitted\?: looks like a confirmation URL, but no submit press was seen: not marked/);
  assert.match(written.at(-1), /"version":"0\.8\.26"/);
  log.logTo(null);
});

// The extension reports a submission with what decided it, and the app writes that down before it acts: an
// irreversible mark that nothing explained is what made 1 Oct 2026's wrong "Applied" unattributable.
test('a reported submit is logged with its evidence, before the job is marked', async () => {
  const log = await import('../lib/log.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-applog-'));
  log.logTo(dir);
  const storage = {settings: () => ({}), secret: () => 't', setSecret: () => {}, path: (...p) => path.join(dir, ...p)};
  const env = server.localEnv(storage, undefined, {find: async () => null});  // the job isn't in the list
  const result = await env.markApplied('https://jobs.test/acme/1', 'applied submit press seen 3s before (submit on jobs.test, extension 0.8.24)');
  assert.equal(result.ok, false);
  const written = logText(path.join(dir, 'app.log')).trim().split('\n');
  assert.match(written.at(-1), /\[extension\] mark Applied: https:\/\/jobs\.test\/acme\/1 — applied submit press seen 3s before/);
  assert.match(written.at(-1), /extension 0\.8\.24/);
  log.logTo(null);  // the app log goes quiet again for the rest of the suite
});

test('the session behind a reported submit is marked Submitted and leaves the list', async () => {
  terminals._reset();
  terminals.usePty(fakePty().loader);
  await terminals.start({id: 'c1', url: 'https://job-boards.greenhouse.io/canonical/jobs/3014391',
                         title: 'Software Engineer - Data Infrastructure', company: 'Canonical', claudeId: 'conv-c1',
                         file: 'claude', env: {}});
  const record = terminals.record('c1');
  assert.equal(server.sessionSubmitted('https://job-boards.greenhouse.io/canonical/jobs/3014391'), 'c1');
  assert.equal(terminals.get('c1'), null);        // gone from Application sessions
  assert.equal(record.outcome, 'submitted');      // its statistics say why it ended (lib/session-runs.js)
  assert.ok(record.decidedAt);
  // Asking twice (reconciliation runs on every jobs read) does nothing more.
  assert.equal(server.sessionSubmitted('https://job-boards.greenhouse.io/canonical/jobs/3014391'), null);
  terminals._reset();
});

test('a job with a Claude session and a form session loses both when it is submitted', async () => {
  terminals._reset();
  terminals.usePty(fakePty().loader);
  const url = 'https://www.jobs.ch/en/vacancies/detail/c59e9c97/';
  await terminals.start({id: 'c1', url, company: 'Undisclosed', file: 'claude', env: {}});
  terminals.startForm({id: 'f1', url: url.replace(/\/$/, ''), title: 'Developpeur', company: 'Undisclosed'});
  assert.ok(server.sessionSubmitted(url));
  assert.equal(terminals.get('c1'), null);
  assert.equal(terminals.get('f1'), null);
  terminals._reset();
});

test('another job\'s session is left alone, and a URL with no session is harmless', async () => {
  terminals._reset();
  terminals.usePty(fakePty().loader);
  await terminals.start({id: 'o1', url: 'https://jobs.test/other', company: 'Other', file: 'claude', env: {}});
  assert.equal(server.sessionSubmitted('https://job-boards.greenhouse.io/canonical/jobs/3014391'), null);
  assert.notEqual(terminals.get('o1'), null);
  terminals._reset();
});

test('a fresh job list ends the sessions of jobs already Applied, and only those', async () => {
  terminals._reset();
  terminals.usePty(fakePty().loader);
  await terminals.start({id: 'a1', url: 'https://jobs.test/canonical/3014391', company: 'Canonical', file: 'claude', env: {}});
  await terminals.start({id: 'b2', url: 'https://jobs.test/canonical/5002072', company: 'Canonical', file: 'claude', env: {}});
  const jobs = [
    {url: 'https://jobs.test/canonical/3014391', stage: 'Applied'},              // the form was submitted
    {url: 'https://jobs.test/canonical/5002072', stage: 'Applying'},             // filled, not submitted: ask
    {url: 'https://jobs.test/acme/1', stage: 'Applied'}];                        // no session for it
  assert.deepEqual(server.appliedSessions(jobs), ['https://jobs.test/canonical/3014391']);
  assert.deepEqual(server.reconcileAppliedSessions(jobs), ['https://jobs.test/canonical/3014391']);
  assert.equal(terminals.get('a1'), null);            // Applied: off Application sessions
  assert.notEqual(terminals.get('b2'), null);         // still Applying: the "Did you submit?" question owns it
  assert.deepEqual(server.reconcileAppliedSessions(jobs), []);  // idempotent: every jobs read can call it
  terminals._reset();
});

test('a rejected or interviewing job also ends its session; a trailing slash is the same job', async () => {
  terminals._reset();
  terminals.usePty(fakePty().loader);
  await terminals.start({id: 'r1', url: 'https://jobs.test/acme/9/', company: 'Acme', file: 'claude', env: {}});
  assert.deepEqual(server.reconcileAppliedSessions([{url: 'https://jobs.test/acme/9', stage: 'Rejected'}]), ['https://jobs.test/acme/9/']);
  assert.equal(terminals.get('r1'), null);  // past Applied: the session leaves the screen too
  terminals._reset();
});

// A fill that fails while Chrome runs an older copy of the extension than the app ships is explained, not left as
// "the extension can't fill these fields" (1 Oct 2026: a Claude session hit that and filled a whole form by hand).
test('a stale extension is named, with the reload to do; matching or unknown versions say nothing', () => {
  assert.match(server.staleExtension('0.8.20', '0.8.23'),
               /Chrome runs Jobadabra extension 0\.8\.20, older than this app's 0\.8\.23: reload it once/);
  assert.equal(server.staleExtension('0.8.23', '0.8.23'), '');
  assert.equal(server.staleExtension('', '0.8.23'), '');       // nothing reported yet
  assert.equal(server.staleExtension('0.8.23', ''), '');       // the app's copy isn't readable
});

test('the extension version the app reads is its own manifest', async () => {
  const fs = await import('node:fs');
  const manifest = JSON.parse(fs.readFileSync(new URL('../../extension/manifest.json', import.meta.url), 'utf8'));
  assert.match(server.latestExtension(), new RegExp(`^${manifest.version.replace(/\./g, '\\.')}(\\.\\d+)?$`));   // a development copy is told the stamped one (dev-extension-version.js)
});

// A session that leaves the file must stay readable: the app's list is the only copy of "which sessions do I have",
// and 1 Oct 2026 lost one twice — a reconciler deleting it, and a quit that saved an empty list over a record
// written by hand while the app was running.
test('a save that would write fewer sessions keeps the file it is replacing', async () => {
  terminals._reset();
  terminals.usePty(fakePty().loader);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-sessions-'));
  const file = path.join(dir, 'sessions.json');
  terminals.persist(file);
  await terminals.start({id: 'k1', url: 'https://jobs.test/acme/1', company: 'Acme', file: 'claude', env: {}});
  terminals.saveNow();
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).length, 1);
  assert.ok(!fs.existsSync(`${file}.previous`));          // nothing was lost yet: no copy to keep

  terminals.remove('k1');                                  // the session goes
  terminals.saveNow();
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).length, 0);
  const kept = JSON.parse(fs.readFileSync(`${file}.previous`, 'utf8'));
  assert.deepEqual(kept.map(record => record.id), ['k1']);
  assert.equal(kept[0].url, 'https://jobs.test/acme/1');   // and it can be read back and restored by hand

  // A file that isn't ours (garbage on disk) doesn't stop the save, and the kept copy stays the last good one.
  fs.writeFileSync(file, 'not json');
  terminals.saveNow();
  assert.equal(fs.readFileSync(file, 'utf8'), '[]');                    // the app's own list is written
  assert.deepEqual(JSON.parse(fs.readFileSync(`${file}.previous`, 'utf8')), kept);  // never the garbage
  terminals._reset();
  terminals.persist(null);
});

test('the local port is 47111 (the extension has it built in) unless JOBADABRA_PORT names another whole port', () => {
  assert.equal(server.DEFAULT_PORT, 47111);
  assert.equal(server.portFrom({}), 47111);
  assert.equal(server.portFrom({JOBADABRA_PORT: '48123'}), 48123);
  for (const bad of ['', 'abc', '0', '65536', '-5', '47111x', '4711.5', ' 48123']) assert.equal(server.portFrom({JOBADABRA_PORT: bad}), 47111, `"${bad}" is ignored`);
  assert.equal(server.PORT, server.portFrom(process.env), 'the server uses the same rule');
});
