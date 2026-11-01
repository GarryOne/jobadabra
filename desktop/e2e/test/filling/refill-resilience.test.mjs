// The refill's two guards: a failed GitHub upload is tried again; a fill that asked nothing is "nothing to refill", any other missing memo stays a failure.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {dispatchGh, nothingToRefill, uploadBundle, withRetry} from '../../lib/refill-resilience.mjs';

test('a transient failure is tried again, a lasting one still throws', () => {
  let calls = 0; const waits = [];
  assert.equal(withRetry(() => { if (++calls < 3) throw new Error('HTTP 404'); return 'ok'; }, {wait: ms => waits.push(ms), delayMs: 10}), 'ok');
  assert.deepEqual([calls, waits], [3, [10, 20]]);
  calls = 0;
  assert.throws(() => withRetry(() => { calls++; throw new Error('down'); }, {wait: () => {}}), /down/);
  assert.equal(calls, 3);
});

test('only a fill that asked nothing has nothing to refill', () => {
  assert.equal(nothingToRefill('fill-memo: Digitec job offers check (no model): 0/0 live asks answered, 0 extra, outcome posting null/null'), true);
  assert.equal(nothingToRefill('fill-memo: Aldi check: 3/5 live asks answered'), false);
  assert.equal(nothingToRefill(''), false);
});

test('the bundle uploads before its key; a bundle that never uploads leaves no key on the release', () => {
  const sent = [];
  uploadBundle(file => sent.push(file), 'b.tgz.enc', 'b.k.enc', work => work());
  assert.deepEqual(sent, ['b.tgz.enc', 'b.k.enc']);
  const onRelease = [];
  assert.throws(() => uploadBundle(file => { if (file === 'b.tgz.enc') throw new Error('HTTP 404'); onRelease.push(file); }, 'b.tgz.enc', 'b.k.enc', work => work()), /404/);
  assert.deepEqual(onRelease, [], 'no key without its bundle');
  let tries = 0; const kept = [];
  uploadBundle(file => { if (file === 'b.k.enc' && ++tries < 2) throw new Error('HTTP 404'); kept.push(file); }, 'b.tgz.enc', 'b.k.enc', work => { try { return work(); } catch { return work(); } });
  assert.deepEqual(kept, ['b.tgz.enc', 'b.k.enc'], 'each file is retried on its own: the bundle is not sent twice');
});

test('the dispatch after a publish uses the run token on this repo; with none it changes nothing', () => {
  const env = {GH_TOKEN: 'write-token', DISPATCH_TOKEN: 'run-token', GITHUB_REPOSITORY: 'o/r'};
  const {env: used, repoArgs} = dispatchGh(env);
  assert.equal(used.GH_TOKEN, 'run-token');
  assert.deepEqual(repoArgs, ['-R', 'o/r']);
  assert.deepEqual(dispatchGh({GH_TOKEN: 'mine'}), {env: {GH_TOKEN: 'mine'}, repoArgs: []});
});
