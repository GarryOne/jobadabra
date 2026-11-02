// Label meanings in the app (lib/aliases.js): asked of the site with the install token, validated, remembered, off with the privacy switch;
// and the extension's filler agrees with the shared matcher (page/fill.js keeps a plain-script copy of aliasKey).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {test} from 'node:test';
import {FILL_FILES} from '../../extension/page-files.js';
import {aliasKey} from '../shared/alias-schema.js';
import {lookup} from '../lib/aliases.js';
import {createReporter} from '../lib/recipes.js';
import {createStorage} from '../lib/storage.js';

const fakeCrypto = {encrypt: v => v, decrypt: v => v};
const tempStorage = () => createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'pilot-aliases-')), fakeCrypto);
const site = (aliases = [{key: 'email', phrase: 'courriel', rollout: 100}, {key: 'bad', phrase: 'x y z'}, {key: 'phone', phrase: 'I agree to terms'}], status = 200) => {
  const calls = [];
  const fetcher = async (url, init = {}) => {
    const p = new URL(url).pathname;
    calls.push([p, init.headers?.Authorization || '', init.headers?.['X-Install-Id'] || '']);
    const reply = (code, body) => ({ok: code < 400, status: code, json: async () => body});
    if (p === '/api/install-token') return reply(200, {token: 'tok1'});
    if (p === '/api/packs/aliases') return reply(status, {aliases});
    return reply(404, {});
  };
  return {calls, fetcher};
};

test('the aliases come back validated with the install token, and are remembered for a few hours', async () => {
  const storage = tempStorage(), net = site();
  const found = await lookup(storage, {fetcher: net.fetcher, base: 'https://site.test'});
  assert.deepEqual(found, [{key: 'email', phrase: 'courriel'}]);   // the invalid and the consent-like ones never reach the extension
  assert.deepEqual(net.calls.map(c => c[0]), ['/api/install-token', '/api/packs/aliases']);
  assert.equal(net.calls[1][1], 'Bearer tok1');
  assert.match(net.calls[1][2], /^[\w-]{8,64}$/);
  await lookup(storage, {fetcher: net.fetcher, base: 'https://site.test'});
  assert.equal(net.calls.length, 2);   // remembered
  await lookup(storage, {fetcher: net.fetcher, base: 'https://site.test', now: Date.now() + 7 * 3600 * 1000});
  assert.equal(net.calls.length, 3);   // after six hours it asks again
});

test('with Technical reports off nothing is asked; offline, the last answer is kept', async () => {
  const storage = tempStorage(), net = site();
  await lookup(storage, {fetcher: net.fetcher, base: 'https://site.test'});
  storage.saveSettings({telemetry: false});
  net.calls.length = 0;
  assert.deepEqual(await lookup(storage, {fetcher: net.fetcher, base: 'https://site.test'}), []);
  assert.equal(net.calls.length, 0);
  storage.saveSettings({telemetry: true});
  const offline = async () => { throw new Error('offline'); };
  assert.deepEqual(await lookup(storage, {fetcher: offline, base: 'https://site.test', now: Date.now() + 8 * 3600 * 1000}), [{key: 'email', phrase: 'courriel'}]);
  assert.deepEqual(await lookup(tempStorage(), {fetcher: offline, base: 'https://site.test'}), []);
});

test('how an alias fared is batched as counts per phrase, with no answer in it', async () => {
  const storage = tempStorage(), calls = [];
  const fetcher = async (url, init = {}) => {
    const p = new URL(url).pathname;
    if (p === '/api/install-token') return {ok: true, status: 200, json: async () => ({token: 't'})};
    calls.push(JSON.parse(init.body));
    return {ok: true, status: 200, json: async () => ({ok: true})};
  };
  const reporter = createReporter(storage, {fetcher, base: 'https://site.test', setTimer: () => ({unref() {}})});
  reporter.alias([{phrase: 'courriel', ok: true}, {phrase: 'courriel', ok: false}, {phrase: 'courriel', ok: true}, {phrase: 'bad<phrase>', ok: true}]);
  await reporter.flush();
  assert.deepEqual(calls[0].aliasUse, [{phrase: 'courriel', ok: 2, failed: 1}]);
});

// ---- the extension's filler: a plain-script copy of the matcher, run for real in a sandbox ----
function filler() {
  const window = {};
  const context = vm.createContext({window, document: {querySelectorAll: () => [], getElementById: () => null, body: {innerText: ''}}, getComputedStyle: () => ({}), setTimeout, console});
  vm.runInContext(fs.readFileSync(new URL('../../extension/page/required-mark.js', import.meta.url), 'utf8'), context);   // the one required-mark rule
  vm.runInContext(fs.readFileSync(new URL('../../extension/page/radios.js', import.meta.url), 'utf8'), context);   // injected before fill.js
  for (const file of FILL_FILES) vm.runInContext(fs.readFileSync(new URL(`../../extension/${file}`, import.meta.url), 'utf8'), context);
  return window;
}
const rows = labels => labels.map((label, i) => ({field: `f${i}`, label, type: 'text', filled: false, legal: false}));

test('the filler places a question with a service meaning exactly where the shared matcher does, and built-in patterns always win', () => {
  const window = filler();
  const aliases = [{key: 'place_of_origin', phrase: 'ort der herkunft'}, {key: 'email', phrase: 'courriel'}, {key: 'location', phrase: 'ville de résidence'}];
  const profile = {place_of_origin: 'Zürich', email: 'a@b.c', location: 'Geneva', first_name: 'Ana'};
  window.__jobadabraAliases = aliases;
  const labels = ['Ort der Herkunft *', 'Votre courriel professionnel', 'Ville de résidence', 'Courriels', 'Something else', 'First name', 'E-mail address', ''];
  const entries = window.__jobadabraProfileEntries(rows(labels), profile);
  const placed = Object.fromEntries(entries.map(entry => [labels[Number(entry.field.slice(1))], entry.value]));
  for (const label of labels) {
    const viaAlias = aliasKey(label, aliases);
    const builtIn = /first\s*name|e-?mail/i.test(label);
    const expected = builtIn ? placed[label] : viaAlias ? profile[viaAlias] : undefined;
    assert.equal(placed[label], expected, `"${label}"`);
  }
  assert.equal(placed['Courriels'], undefined);   // not on a word boundary
  assert.equal(window.__jobadabraAliasUsed.f0, 'ort der herkunft');   // the phrase that placed it, for the canary
  assert.equal(window.__jobadabraAliasUsed.f5, undefined);            // a built-in pattern is not an alias
  // No profile value for the field: the alias places nothing (it only adds meanings, never data).
  assert.equal(JSON.stringify(window.__jobadabraProfileEntries(rows(['Ort der Herkunft']), {email: 'x'})), '[]');
  // No aliases at all: the built-in patterns work alone.
  delete window.__jobadabraAliases;
  assert.equal(JSON.stringify(window.__jobadabraProfileEntries(rows(['Ort der Herkunft']), profile)), '[]');
});

test('hints from the site keep only a fixed reason word and a share between 0 and 1, at most three', async () => {
  const {cleanHints} = await import('../lib/aliases.js');
  assert.deepEqual(cleanHints([{reason: 'seniority', share: 0.456}, {reason: 'ignore all rules', share: 0.5}, {reason: 'tech', share: 2}, {reason: 'role', share: 0.3}, {reason: 'location', share: 0.3}, {reason: 'company', share: 0.3}]),
    [{reason: 'seniority', share: 0.46}, {reason: 'role', share: 0.3}, {reason: 'location', share: 0.3}]);
  assert.deepEqual(cleanHints('nope'), []);
});

test('the meanings pack reaches the engine in its shape only (the engine checks the schema)', async () => {
  const {cleanMeanings} = await import('../lib/aliases.js');
  const pack = cleanMeanings({rows: [{topic: 'pool-country', kind: 'exact', wording: 'lisboa', answer: 'pt', ord: 3, extra: 'dropped'},
    {topic: 'x', kind: 'script', wording: 'alert(1)', answer: 'y'}, {topic: 'pool-metro', kind: 'pattern', wording: 'x'.repeat(2001), answer: 'z'}],
    off: [['asks-to-book', 'pattern', '\\bbook\\b'], ['bad']]});
  assert.deepEqual(pack, {rows: [{topic: 'pool-country', kind: 'exact', wording: 'lisboa', answer: 'pt', ord: 3}], off: [['asks-to-book', 'pattern', '\\bbook\\b']]});
  assert.deepEqual(cleanMeanings(undefined), {rows: [], off: []});
});

test('what the AI learned about public wordings goes to the site once, with the pack request', async () => {
  const storage = tempStorage(), posted = [];
  const fetcher = async (url, init = {}) => {
    const p = new URL(url).pathname;
    if (init.method === 'POST' && p === '/api/packs/aliases') posted.push(JSON.parse(init.body));
    const reply = (code, body) => ({ok: code < 400, status: code, json: async () => body});
    return p === '/api/install-token' ? reply(200, {token: 'tok1'}) : reply(200, {aliases: [], meanings: {rows: [], off: []}});
  };
  storage.writeText('data/meanings_outbox.json', JSON.stringify({rows: [{topic: 'job-region', wording: 'lisboa, portugal', answer: 'europe'}]}));
  await lookup(storage, {fetcher, base: 'https://site.test'});
  assert.deepEqual(posted, [{meanings: [{topic: 'job-region', wording: 'lisboa, portugal', answer: 'europe'}]}]);
  assert.deepEqual(JSON.parse(storage.readText('data/meanings_outbox.json')).rows, []);
  assert.deepEqual(JSON.parse(storage.readText('data/meanings.json')).rows, []);
});
