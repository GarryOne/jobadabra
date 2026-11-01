// Where a notification click leads (renderer/targets.js, lib/run-history.js notice): only fixed, known destinations, and one for every finished task.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {clean, plan, VIEWS} from '../renderer/targets.js';
import {notice} from '../lib/run-history.js';
import {mainSource} from './main-source.js';

test('a target keeps only the fixed keys, with known pages and sections', () => {
  assert.deepEqual(clean({view: 'jobs', job: ' abc123 '}), {view: 'jobs', job: 'abc123'});
  assert.deepEqual(clean({view: 'settings', section: 'profile'}), {view: 'settings', section: 'profile'});
  assert.deepEqual(clean({run: '42'}), {run: 42});
  assert.deepEqual(clean({activity: true}), {activity: true});
  assert.equal(clean({view: 'jobs', evil: 'x', run: undefined}).evil, undefined);
});

test('an unknown page, section or an empty target opens nothing', () => {
  for (const bad of [null, undefined, 'jobs', 5, {}, {view: 'admin'}, {view: 'jobs', section: 'profile'}, {run: 'abc'}, {run: ''}, {run: null}, {job: '  '}, {activity: 'yes'}]) {
    const result = clean(bad);
    assert.ok(result === null || (result.section === undefined && result.view !== 'admin'), JSON.stringify(bad));
  }
  assert.equal(clean({view: 'admin'}), null);
  assert.equal(clean({view: 'jobs', section: 'profile'}).section, undefined);   // a section belongs to Settings only
  assert.deepEqual(plan(null), []);
});

test('the window takes the steps in a fixed order: the result or panel, then the page, its section, then the job', () => {
  assert.deepEqual(plan({run: 7}), ['run:7']);
  assert.deepEqual(plan({view: 'jobs', job: 'k1'}), ['view:jobs', 'job:k1']);
  assert.deepEqual(plan({view: 'settings', section: 'profile'}), ['view:settings', 'section:profile']);
  assert.deepEqual(plan({activity: true}), ['activity']);
  assert.ok(VIEWS.includes('focus') && VIEWS.includes('interviews'));
});

test('every finished background task notification opens its own result', () => {
  const kinds = ['search', 'scout', 'insight', 'interviewInsight', 'weekly', 'kits', 'today', 'interview', 'rejection', 'prep', 'add', 'import', 'prepare'];
  for (const kind of kinds) {
    const done = notice({id: 1001, kind, ok: true, result: 'ok', new: 3});
    assert.deepEqual(done?.target, {run: 1001}, `${kind} done`);
    const failed = notice({id: 1002, kind, ok: false});
    assert.deepEqual(failed?.target, {run: 1002}, `${kind} failed`);
  }
  assert.deepEqual(notice({id: 5, kind: 'mail', ok: true, updates: ['a', 'b']}).target, {run: 5});
  assert.deepEqual(notice({id: 6, ok: true, new: 0}).target, {run: 6});   // a Jobs check with no kind
  assert.equal(notice({id: 7, kind: 'mail', ok: true}), null, 'a Gmail check that recorded nothing says nothing');
});

// Owner, 8 Oct 2026: "Filling the application…" opened the Applying list, not the session it was about.
test('a session target opens that session\'s card, and every application notification names its session', async () => {
  assert.deepEqual(clean({view: 'sessions', session: 'a094bc8f'}), {view: 'sessions', session: 'a094bc8f'});
  assert.equal(clean({view: 'sessions', session: '../x'}).session, undefined);
  assert.deepEqual(plan({view: 'sessions', session: 'a094bc8f'}), ['view:sessions', 'session:a094bc8f']);
  const {sessionOfJob} = await import('../lib/server.js');
  const list = [{id: 'old', url: 'https://jobs.coop.ch/job/1/', startedAt: '2026-10-08T10:00:00Z'},
    {id: 'new', url: 'https://jobs.coop.ch/job/1', startedAt: '2026-10-08T13:09:00Z'},
    {id: 'sent', url: 'https://jobs.coop.ch/job/1', startedAt: '2026-10-08T14:00:00Z', outcome: 'submitted'},
    {id: 'other', url: 'https://jobs.migros.ch/job/2', startedAt: '2026-10-08T14:00:00Z'}];
  assert.equal(sessionOfJob('https://jobs.coop.ch/job/1#jobpilotto-fill', list), 'new');
  assert.equal(sessionOfJob('https://example.com/', list), '');
  // The class: a notification about filling a form, or a session needing you, carries its session (a window toast too).
  const fs = await import('node:fs');
  const server = fs.readFileSync(new URL('../lib/server.js', import.meta.url), 'utf8'), main = mainSource();
  for (const title of ['Filling the application…', 'Form filled: a few things left for you']) assert.match(server.slice(server.indexOf(title), server.indexOf(title) + 400), /, target(, [^)]+)?\)/, title);   // the tone may follow
  assert.match(main, /toWindow\('toast', \{title: `Needs your input · \$\{what\}`, body: text, target: targets\.clean\(\{view: 'sessions', session: session\.id\}\), tone: 'warn'\}\)/);
});
