// Publishing the extension to the Chrome Web Store when a release turns stable (owner, 26 Oct 2026: "when we do the beta/stable release we should publish
// the newest extension version in Chrome Web Store"; stable only). The decision is pure; the API calls run against a fake store. The release-pipeline side: tests/test_webstore_publish_pipeline.py.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as cws from '../../tools/webstore-publish.mjs';

const channel = crxVersion => ({distributionChannels: [{deployPercentage: 100, crxVersion}]});
const status = ({published, submitted, submittedState = 'PENDING_REVIEW', takenDown = false} = {}) => ({
  name: 'publishers/p/items/i', itemId: 'i', takenDown,
  ...(published ? {publishedItemRevisionStatus: {state: 'PUBLISHED', ...channel(published)}} : {}),
  ...(submitted ? {submittedItemRevisionStatus: {state: submittedState, ...channel(submitted)}} : {}),
});

test('versions compare by number, not by text', () => {
  assert.ok(cws.newer('0.9.625', '0.9.99'));
  assert.ok(!cws.newer('0.9.625', '0.9.625'));
  assert.ok(cws.newer('1.0', '0.9.999'));
});

test('the store gets our version only when it is newer than everything it has', () => {
  assert.equal(cws.decide(status({published: '0.9.620'}), '0.9.625').action, 'publish');
  assert.equal(cws.decide(status({}), '0.9.625').action, 'publish', 'nothing published yet');
  assert.equal(cws.decide(status({published: '0.9.625'}), '0.9.625').action, 'skip');
  assert.equal(cws.decide(status({published: '0.9.630'}), '0.9.625').action, 'skip', 'a rollback to an older stable never goes to the store');
  assert.equal(cws.decide(status({published: '0.9.620', submitted: '0.9.625'}), '0.9.625').action, 'skip', 'already in review');
});

test('a version in review waits for the next stable; a rejection or take-down stops loudly', () => {
  const waiting = cws.decide(status({published: '0.9.620', submitted: '0.9.622'}), '0.9.625');
  assert.equal(waiting.action, 'wait');
  assert.match(waiting.why, /0\.9\.622.*review/);
  assert.equal(cws.decide(status({published: '0.9.620', submitted: '0.9.622', submittedState: 'STAGED'}), '0.9.625').action, 'wait');
  assert.equal(cws.decide(status({published: '0.9.620', submitted: '0.9.622', submittedState: 'CANCELLED'}), '0.9.625').action, 'publish');
  assert.equal(cws.decide(status({published: '0.9.620', submitted: '0.9.622', submittedState: 'REJECTED'}), '0.9.625').action, 'publish', 'a newer version replaces a rejected one');
  assert.equal(cws.decide(status({published: '0.9.620', submitted: '0.9.625', submittedState: 'REJECTED'}), '0.9.625').action, 'stop');
  assert.equal(cws.decide(status({published: '0.9.620', takenDown: true}), '0.9.625').action, 'stop');
});

// A fake store: answers each call from a script and records what was sent.
function fakeStore(answers) {
  const sent = [];
  const fetch = async (url, init = {}) => {
    sent.push({url, method: init.method || 'GET', auth: init.headers?.Authorization, body: init.body});
    const key = Object.keys(answers).find(k => url.endsWith(k));
    const queue = answers[key];
    assert.ok(queue?.length, `no answer for ${url}`);
    const [code, json] = queue.length > 1 ? queue.shift() : queue[0];
    return {ok: code < 300, status: code, json: async () => json, text: async () => JSON.stringify(json)};
  };
  return {fetch, sent};
}
const ITEM = {publisher: 'pub-1', item: 'item-1', token: 'tok'};

test('publish: uploads the zip, waits for the store to read it, then submits it for review', async () => {
  const store = fakeStore({
    ':fetchStatus': [[200, status({published: '0.9.620'})], [200, {...status({published: '0.9.620'}), lastAsyncUploadState: 'SUCCEEDED'}]],
    ':upload': [[200, {itemId: 'item-1', uploadState: 'IN_PROGRESS'}]],
    ':publish': [[200, {itemId: 'item-1', state: 'PENDING_REVIEW'}]],
  });
  const lines = [];
  const result = await cws.publish({...ITEM, version: '0.9.625', zip: Buffer.from('PK'), fetch: store.fetch, log: line => lines.push(line), pause: async () => {}});
  assert.equal(result.action, 'publish');
  assert.equal(result.state, 'PENDING_REVIEW');
  assert.deepEqual(store.sent.map(s => `${s.method} ${s.url.replace(cws.API, '')}`), [
    'GET /v2/publishers/pub-1/items/item-1:fetchStatus',
    'POST /upload/v2/publishers/pub-1/items/item-1:upload',
    'GET /v2/publishers/pub-1/items/item-1:fetchStatus',
    'POST /v2/publishers/pub-1/items/item-1:publish',
  ]);
  assert.ok(store.sent.every(s => s.auth === 'Bearer tok'));
  assert.ok(lines.every(line => !line.includes('tok')), 'the token is never printed');
  assert.match(lines.join('\n'), /0\.9\.625.*review/);
});

test('publish: nothing is uploaded when the store already has the version', async () => {
  const store = fakeStore({':fetchStatus': [[200, status({published: '0.9.625'})]]});
  const result = await cws.publish({...ITEM, version: '0.9.625', zip: Buffer.from('PK'), fetch: store.fetch, log: () => {}, pause: async () => {}});
  assert.equal(result.action, 'skip');
  assert.equal(store.sent.length, 1);
});

test('publish: a failed upload or a refused call stops with the store\'s own words', async () => {
  const failed = fakeStore({':fetchStatus': [[200, status({published: '0.9.620'})]], ':upload': [[200, {uploadState: 'FAILED'}]]});
  await assert.rejects(cws.publish({...ITEM, version: '0.9.625', zip: Buffer.from('PK'), fetch: failed.fetch, log: () => {}, pause: async () => {}}), /upload FAILED/);
  assert.ok(!failed.sent.some(s => s.url.endsWith(':publish')), 'never publishes after a failed upload');
  const refused = fakeStore({':fetchStatus': [[403, {error: {message: 'The caller does not have permission'}}]]});
  await assert.rejects(cws.check({...ITEM, version: '0.9.625', fetch: refused.fetch, log: () => {}}), /HTTP 403: The caller does not have permission/);
});

test('check reads the store and changes nothing', async () => {
  const store = fakeStore({':fetchStatus': [[200, status({published: '0.9.620'})]]});
  const lines = [];
  const result = await cws.check({...ITEM, version: '0.9.625', fetch: store.fetch, log: line => lines.push(line)});
  assert.equal(result.action, 'publish');
  assert.deepEqual(store.sent.map(s => s.method), ['GET']);
  assert.match(lines.join('\n'), /published 0\.9\.620.*ours 0\.9\.625.*would publish/);
});
