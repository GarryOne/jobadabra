// Check queue concurrency from stored states, including the beta's repeated ready report.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import {fillingPair} from '../../lib/background-proof.mjs';

test('a later ready report does not turn the beta queue into concurrent filling', () => {
  const first = {session: 'fill1', state: 'ready_for_review', readyAt: 1793392253407};
  const next = {session: 'fill3', state: 'preflight', launchedAt: 1793392251971};
  assert.throws(() => assert.ok(next.launchedAt >= first.readyAt), 'the old time comparison fails on the beta record');
  assert.equal(fillingPair([first, {session: 'fill2', state: 'needs_user_handoff'}, next, {session: 'fill4', state: 'queued'}]), null);
});

test('two preflight or filling records identify both overlapping sessions and states', () => {
  for (const states of [['preflight', 'filling'], ['filling', 'preflight'], ['preflight', 'preflight'], ['filling', 'filling']]) {
    const pair = states.map((state, index) => ({session: `fill${index + 1}`, state}));
    assert.deepEqual(fillingPair([{session: 'ready', state: 'ready_for_review'}, ...pair]), pair);
  }
});

test('idle, completed and single filling records have no overlap', () => {
  assert.equal(fillingPair([]), null);
  assert.equal(fillingPair([null, {state: 'queued'}, {state: 'waiting_to_submit'}, {state: 'receipt_confirmed'}, {session: 'one', state: 'filling'}]), null);
});

test('the queue proof stops its wait at an overlap and reports both sessions and states', async () => {
  const jobs = ['fill1', 'fill2', 'fill3'].map(url => ({url}));
  const samples = [
    [{session: 'fill1', state: 'preflight'}, {session: 'fill2', state: 'needs_user_handoff'}, {session: 'fill3', state: 'queued'}],
    [{session: 'fill1', state: 'filling'}, {session: 'fill2', state: 'needs_user_handoff'}, {session: 'fill3', state: 'preflight'}],
    [{session: 'fill1', state: 'ready_for_review'}, {session: 'fill2', state: 'needs_user_handoff'}, {session: 'fill3', state: 'ready_for_review'}],
  ];
  let poll = -1;
  const reads = [];
  const proveQueue = loadQueueProof(async (_ctx, url) => {
    reads.push([poll, url]);
    return samples[poll][jobs.findIndex(job => job.url === url)];
  });
  const ctx = {
    profile: 'unused', relaunch: async () => {}, forms: {posts: []},
    proxy: {canned: () => null, setCanned: () => {}},
    page: {evaluate: async (_fn, value) => typeof value === 'number' ? {sessions: jobs.map(job => job.url)} : null},
  };
  const until = async (_what, check) => {
    while (++poll < samples.length) if (await check()) return true;
    throw new Error('scripted wait exhausted');
  };
  await assert.rejects(proveQueue(ctx, {jobs, mode: 'fill', seed: async () => {}, until}),
    /two jobs filled at once: \[\{"session":"fill1","state":"filling"\},\{"session":"fill3","state":"preflight"\}\]/);
  assert.equal(poll, 1, 'overlap settles the wait before the later ready records');
  assert.deepEqual(reads.slice(0, 6), [0, 1].flatMap(sample => jobs.map(job => [sample, job.url])), 'every poll reads every queued job, including the stopped one');
});

// Run the real proof body with in-memory queue reads; no app, browser, profile or store is opened.
function loadQueueProof(recordOf) {
  const source = fs.readFileSync(new URL('../../lib/background-proof.mjs', import.meta.url), 'utf8');
  const proof = source.slice(source.indexOf('export async function proveQueue')).replace(/^export /, '');
  return vm.runInNewContext(`${proof}; proveQueue`, {
    fillingPair, recordOf, HANDOFF: /^(needs_user_handoff|manual_submit_required)$/,
    linkRuntime: () => '', withFormJudge: () => null,
    sessionOf: async (_page, url) => url, skipJob: async () => {}, closeHiddenBrowser: async () => {},
    describeHidden: async () => 'scripted queue', process: {platform: process.platform},
  });
}
