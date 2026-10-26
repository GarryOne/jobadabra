// The applying report upload (lib/applying-report.mjs): only hosts and fixed words leave the Mac, never from CI or a control run, the key never in the output.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {buildOnMain, hostOnly, skipReason, upload} from '../lib/applying-report.mjs';

test('never from CI or a control run on an old build; a posting address becomes its host', () => {
  assert.equal(skipReason({CI: '1'}), 'CI');
  assert.match(skipReason({REAL_EXTENSION_DIR: '/tmp/old'}), /control run/);
  assert.equal(skipReason({}), '');
  assert.equal(hostOnly('https://www.jobs.ch/en/vacancies/detail/abc/?x=1'), 'www.jobs.ch');
});

test('the upload sends the rows with the key as a Bearer, and the outcome line never shows the key', async () => {
  let sent;
  const line = await upload('smoke', [{name: 'Lever form', host: 'jobs.lever.co', reached: 'ready'}], {env: {}, key: 'SECRET-KEY', day: '2026-10-12',
    fetcher: async (url, init) => { sent = {url, init}; return {ok: true, json: async () => ({ok: true, stored: 1})}; }});
  assert.equal(sent.init.headers.Authorization, 'Bearer SECRET-KEY');
  assert.deepEqual(JSON.parse(sent.init.body).rows, [{name: 'Lever form', host: 'jobs.lever.co', reached: 'ready'}]);
  assert.match(line, /1 smoke row\(s\) sent/);
  assert.ok(!line.includes('SECRET'));
  assert.match(await upload('smoke', [], {env: {CI: 'true'}}), /not sent \(CI\)/);
});

test('the upload says whether main\'s extension ran: its extension equals main\'s and its commit is on main; a branch, an unknown main or a git error is not main', async () => {
  const git = ({other = false, ahead = false, dirty = false} = {}) => args => {
    if (args[0] === 'diff' && args.includes('origin/main') && other) throw new Error('extension differs from main');
    if (args[0] === 'merge-base' && ahead) throw new Error('not an ancestor');
    if (args[0] === 'diff' && !args.includes('origin/main') && dirty) throw new Error('changed');
    return '';
  };
  assert.equal(buildOnMain({git: git()}), true);
  assert.equal(buildOnMain({git: git({other: true})}), false, 'a fixer\'s branch: other extension files');
  assert.equal(buildOnMain({git: git({ahead: true})}), false, 'a branch that changes the app only: the extension matches, the commit is not on main');
  assert.equal(buildOnMain({git: git({dirty: true})}), false, 'an uncommitted change to the app or the extension');
  assert.equal(buildOnMain({git: () => { throw new Error('no origin/main'); }}), false);
  for (const onMain of [true, false]) {
    let sent; await upload('smoke', [{name: 'Lever form', reached: 'ready'}], {env: {}, key: 'K', onMain: () => onMain, fetcher: async (url, init) => { sent = JSON.parse(init.body); return {ok: true, json: async () => ({stored: 1})}; }});
    assert.equal(sent.onMain, onMain);
  }
});

test('the pool upload: every site with its start host and signature, never a posting address (a path or query fails this)', async () => {
  const {poolRows} = await import('../lib/applying-report.mjs');
  const shapes = [{shape: 'Acme', urls: ['https://job-boards.greenhouse.io/acme/jobs/123?gh_src=secret&token=abc']}, {shape: 'Never run', like: ['%x.com%']}, {shape: 'Local', urls: ['https://a.b.ch/x/y']}];
  const rows = poolRows(shapes, {Acme: 'other>form@job-boards.greenhouse.io#form', Local: 'form@a.b.ch/x?q=1#form'});
  assert.deepEqual(rows, [{name: 'Acme', start_host: 'job-boards.greenhouse.io', signature: 'other>form@job-boards.greenhouse.io#form'}, {name: 'Never run'},
    {name: 'Local', start_host: 'a.b.ch'}]);   // a signature carrying a path is dropped, not sent
  assert.ok(!/[?=]|\/(acme|x)|token|secret/.test(JSON.stringify(rows)));
  let sent; await (await import('../lib/applying-report.mjs')).upload('pool', rows, {env: {}, key: 'K', fetcher: async (url, init) => { sent = init.body; return {ok: true, json: async () => ({stored: 3})}; }});
  assert.equal(JSON.parse(sent).kind, 'pool');
  assert.equal(JSON.parse(sent).full, undefined, 'a plain upload is not the whole pool');
  await (await import('../lib/applying-report.mjs')).upload('pool', rows, {env: {}, key: 'K', full: true, fetcher: async (url, init) => { sent = init.body; return {ok: true, json: async () => ({stored: 3})}; }});
  assert.equal(JSON.parse(sent).full, true, 'the whole pool list says so: the site drops the names it lacks');
});

test('the running ping: a site starts or ends its run, sent as fixed words and the site name only; never from CI; a failed send never throws', async () => {
  const {ping} = await import('../lib/applying-report.mjs');
  let sent; const fetcher = async (url, init) => { sent = JSON.parse(init.body); return {ok: true, json: async () => ({stored: 1})}; };
  await ping('Lever form', 'start', {env: {}, key: 'K', fetcher});
  assert.deepEqual([sent.kind, sent.rows], ['running', [{name: 'Lever form', state: 'start'}]]);
  await ping('Lever form', 'end', {env: {}, key: 'K', fetcher});
  assert.equal(sent.rows[0].state, 'end');
  sent = null; await ping('Lever form', 'start', {env: {CI: '1'}, key: 'K', fetcher});
  assert.equal(sent, null);   // nothing leaves from CI
  await ping('Lever form', 'start', {env: {}, key: 'K', fetcher: async () => { throw new Error('offline'); }});   // must not throw
});

// A recorded case is uploaded only with its control (10 Oct 2026: a case that passed on the old build reached /admin/form-filling/lab as a pass): `control: {build, failed}` names the
// older extension version it was seen failing on and the check that failed, or `control: {guard}` says why it cannot fail on an old build. No control, nothing uploads.
test('a recorded case uploads only with a control seen on an older build, or a stated guard', async () => {
  const {controlProblem, uploadable} = await import('../lib/applying-report.mjs');
  assert.match(controlProblem({name: 'a'}, '0.9.179'), /no control/);
  assert.match(controlProblem({name: 'a', control: {build: '0.9.179', failed: 'x'}}, '0.9.179'), /older/);
  assert.match(controlProblem({name: 'a', control: {build: '0.9.180', failed: 'x'}}, '0.9.179'), /older/);
  assert.match(controlProblem({name: 'a', control: {build: '0.9.178'}}, '0.9.179'), /failed check/);
  assert.match(controlProblem({name: 'a', control: {build: 'old', failed: 'x'}}, '0.9.179'), /version/);
  assert.match(controlProblem({name: 'a', control: {guard: ''}}, '0.9.179'), /no control/);
  assert.equal(controlProblem({name: 'a', control: {build: '0.9.99', failed: 'pressed #apply'}}, '0.9.179'), '');
  assert.equal(controlProblem({name: 'a', control: {build: '0.9.178', failed: 'x'}}, '0.10.0'), '');   // 0.9.99 < 0.10.0: numbers, not text
  assert.equal(controlProblem({name: 'a', control: {guard: 'a guard: it passes on every build'}}, '0.9.179'), '');
  const {rows, held} = uploadable([{name: 'good', ok: true, control: {guard: 'g'}}, {name: 'bad', ok: true}, {name: 'weak', ok: true, control: {build: '0.9.179', failed: 'x'}}], '0.9.179');
  assert.deepEqual(rows.map(row => row.name), ['good']);
  assert.deepEqual(held.map(one => one.name), ['bad', 'weak']);
});

test('every recorded case in the repo already carries a control (the rule is not skipped for the old ones)', async () => {
  const {controlProblem, extensionVersion} = await import('../lib/applying-report.mjs');
  const {loadCases} = await import('../lib/page-replay.mjs');
  const bad = loadCases().map(item => [item.name, controlProblem(item, extensionVersion())]).filter(([, why]) => why);
  assert.deepEqual(bad, []);
});

// The Fixed-site replays table shows CI on main only (12 Oct 2026: local runs of work-in-progress branches on a loaded Mac showed main as broken).
test('the replays go up only from CI on a push to main, with the build\'s sha; a local run, a PR or a control run never sends', async () => {
  const {replayReason, uploadReplays} = await import('../lib/applying-report.mjs');
  const main = {CI: 'true', GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/heads/main', GITHUB_SHA: 'abc1234def', REPLAYS_PUBLISH_KEY: 'SECRET-KEY'};
  assert.equal(replayReason(main), '');
  assert.match(replayReason({}), /local run/);
  assert.match(replayReason({...main, GITHUB_EVENT_NAME: 'pull_request'}), /not a push to main/);
  assert.match(replayReason({...main, GITHUB_REF: 'refs/heads/fix-x'}), /not a push to main/);
  assert.match(replayReason({...main, REAL_EXTENSION_DIR: '/tmp/old'}), /control run/);
  let sent; const fetcher = async (url, init) => { sent = {url, init}; return {ok: true, json: async () => ({ok: true, stored: 2})}; };
  assert.match(await uploadReplays([{name: 'a', ok: true}], {env: {}, fetcher}), /not sent \(a local run/);
  assert.equal(sent, undefined);
  const line = await uploadReplays([{name: 'a', ok: true}, {name: 'b', ok: false, note: 'x'}], {env: main, fetcher});
  assert.equal(sent.init.method, 'PUT');
  assert.match(sent.url, /\/applying\/replays$/);
  assert.equal(sent.init.headers.Authorization, 'Bearer SECRET-KEY');
  assert.deepEqual(JSON.parse(sent.init.body).sha, 'abc1234def');
  assert.match(line, /2 replay row\(s\) sent for abc1234/);
  assert.ok(!line.includes('SECRET'));
  assert.match(await uploadReplays([{name: 'a', ok: true}], {env: {...main, REPLAYS_PUBLISH_KEY: ''}, fetcher}), /not set up/);
});

test('a dry run (a PR proving the step) says what it would send and sends nothing', async () => {
  const {uploadReplays} = await import('../lib/applying-report.mjs');
  let called = false;
  const line = await uploadReplays([{name: 'a', ok: true}], {env: {CI: 'true', GITHUB_EVENT_NAME: 'pull_request', GITHUB_SHA: 'abc1234', JP_REPLAYS_DRY: '1'}, fetcher: async () => { called = true; }});
  assert.equal(called, false);
  assert.match(line, /dry run: would send 1 replay row\(s\) for abc1234/);
});

test('the recorded replay never uploads from its own run: it writes its results for CI\'s report job', async () => {
  const {readFileSync} = await import('node:fs');
  const source = readFileSync(new URL('./recorded-pages.test.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /upload\(\s*'recorded'/);
  assert.match(source, /JP_REPLAY_RESULTS/);
});

// 12 Oct 2026: `cond && '' || '1'` in the workflow always gave '1' (an empty string is falsy in GitHub expressions), so main's first run was a dry run too.
test('the workflow\'s dry-run switch is a plain true/false that is false on a push to main, and "false" sends', async () => {
  const {readFileSync} = await import('node:fs');
  const {uploadReplays} = await import('../lib/applying-report.mjs');
  const line = readFileSync(new URL('../../../.github/workflows/page-cases.yml', import.meta.url), 'utf8').split('\n').find(text => text.includes('JP_REPLAYS_DRY:'));
  assert.equal(line.trim(), "JP_REPLAYS_DRY: ${{ github.event_name != 'push' || github.ref != 'refs/heads/main' }}");
  const main = {CI: 'true', GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/heads/main', GITHUB_SHA: 'abc1234', REPLAYS_PUBLISH_KEY: 'K'};
  let sent = 0; const fetcher = async () => { sent += 1; return {ok: true, json: async () => ({stored: 1})}; };
  assert.match(await uploadReplays([{name: 'a', ok: true}], {env: {...main, JP_REPLAYS_DRY: 'false'}, fetcher}), /1 replay row\(s\) sent/);
  assert.match(await uploadReplays([{name: 'a', ok: true}], {env: {...main, JP_REPLAYS_DRY: 'true'}, fetcher}), /dry run/);
  assert.equal(sent, 1);
});
