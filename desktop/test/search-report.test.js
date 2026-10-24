// The search report (lib/search-report.js): only listed fields, counts and seconds, nothing a person wrote; sent only with Technical reports on.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {siteTest} from './site-private.js';
import fs from 'node:fs';
import {FIELDS, FAMILIES, READ_METHODS, READ_MEASURES, record, reportSearch} from '../lib/search-report.js';
import {create, KINDS} from '../lib/telemetry.js';

const storageWith = (settings = {}) => {
  const files = {};
  return {settings: () => settings, saveSettings: next => Object.assign(settings, next), secret: () => '', readText: n => files[n], writeText: (n, t) => { files[n] = t; }};
};
const measured = {family: 'hospitality', country: 'CH', city: 'zurich', in_places: 40, scored: 12, fit70: 3, first_s: 9, tenth_s: 41, first_fit70_s: 77};

test('a search is a telemetry kind', () => assert.ok(KINDS.includes('search')));

test('the record keeps listed fields and drops anything else, including text and wrong shapes', () => {
  const got = record({...measured, title: 'Barista at Acme', link: 'https://x.y/job/1', cv: 'my CV', email: 'a@b.c', in_places: -3, family: 'barista', city: 'https://x.y'}, {nth: 2});
  assert.deepEqual(Object.keys(got).sort(), ['country', 'first_fit70_s', 'first_s', 'fit70', 'nth', 'scored', 'tenth_s']);
  for (const value of Object.values(got)) assert.ok(typeof value === 'number' || /^[A-Z]{2}$/.test(value));
});

test('every listed field is the one the privacy page names, and the family list equals the engine\'s', () => {
  const reads = READ_METHODS.flatMap(method => READ_MEASURES.map(measure => `read_${method}_${measure}`));
  assert.deepEqual(Object.keys(FIELDS).sort(), ['city', 'country', 'engine', 'family', 'first_fit70_s', 'first_s', 'fit70', 'in_places', 'nth', 'result', 'runs_to_fit70', 'scored', 'tenth_s', 'trigger', ...reads].sort());
  const readPy = fs.readFileSync(new URL('../../src/read_methods.py', import.meta.url), 'utf8');
  assert.deepEqual(READ_METHODS, readPy.match(/^METHODS = \(([^)]*)\)/m)[1].match(/'(\w+)'/g).map(s => s.slice(1, -1)), 'the engine names the same methods');
  assert.deepEqual(READ_MEASURES, readPy.match(/^MEASURES = \(([^)]*)\)/m)[1].match(/'(\w+)'/g).map(s => s.slice(1, -1)));
  assert.equal(record({}, {read_browser_sources: 3, read_browser_host: 5, read_feed_api_s: -1}).read_browser_sources, 3);
  assert.deepEqual(Object.keys(record({}, {read_browser_sources: 3, read_unknown_sources: 1, read_feed_api_s: -1})), ['read_browser_sources'], 'an unlisted method or a negative count is dropped');
  const py = fs.readFileSync(new URL('../../src/role_kinds.py', import.meta.url), 'utf8').match(/^KINDS = \(([^)]*)\)/m)[1].match(/'(\w+)'/g).map(s => s.slice(1, -1));
  assert.deepEqual(FAMILIES, py);
});

test('one report per finished run: the nth search and the runs until the first 70+; off or failed: nothing', async () => {
  const storage = storageWith(), telemetry = create(storage, {version: '1', fetcher: async () => ({ok: true})});
  const answers = [{...measured, fit70: 0}, measured, measured];
  const exec = async () => ({code: 0, stdout: `noise\n${JSON.stringify(answers.shift())}\n`});
  const a = await reportSearch(storage, telemetry, {startedAt: 't', ok: true, trigger: 'first'}, exec);
  const b = await reportSearch(storage, telemetry, {startedAt: 't', ok: true, trigger: 'you'}, exec);
  const c = await reportSearch(storage, telemetry, {startedAt: 't', ok: true, trigger: 'schedule'}, exec);
  assert.deepEqual([a.kind, a.nth, a.runs_to_fit70], ['search', 1, undefined]);
  assert.deepEqual([b.nth, b.runs_to_fit70, c.nth, c.runs_to_fit70], [2, 2, 3, 2]);
  assert.equal(c.result, 'done');
  storage.saveSettings({telemetry: false});
  assert.equal(await reportSearch(storage, telemetry, {startedAt: 't', ok: true}, async () => assert.fail('no measuring when reports are off')), null);
});

test('a failed or stopped search sends only its outcome: no measuring, no count of searches', async () => {
  const storage = storageWith({searchReport: {n: 2, toFit: 2}}), telemetry = create(storage, {version: '1', fetcher: async () => ({ok: true})});
  const exec = async () => assert.fail('a search that did not finish is not measured');
  const failed = await reportSearch(storage, telemetry, {startedAt: 't', ok: false, trigger: 'schedule'}, exec);
  const stopped = await reportSearch(storage, telemetry, {startedAt: 't', ok: false, stopped: true, trigger: 'you'}, exec);
  assert.deepEqual([failed.kind, failed.result, failed.trigger, failed.nth, failed.in_places], ['search', 'failed', 'schedule', undefined, undefined]);
  assert.deepEqual([stopped.result, stopped.trigger], ['stopped', 'you']);
  assert.deepEqual(storage.settings().searchReport, {n: 2, toFit: 2});
});

test('a search that cannot be measured says why in the app log, never silently', async () => {
  const lines = [], storage = storageWith(), telemetry = create(storage, {version: '1', fetcher: async () => ({ok: true})});
  const say = (area, message, data) => lines.push([area, message, data]);
  const exit1 = async () => ({code: 1, stdout: ''}), garbage = async () => ({code: 0, stdout: 'not json'});
  assert.equal(await reportSearch(storage, telemetry, {startedAt: 't', ok: true}, exit1, say), null);
  assert.equal(await reportSearch(storage, telemetry, {startedAt: 't', ok: true}, garbage, say), null);
  assert.equal(lines.length, 2);
  assert.ok(lines.every(([area, message]) => area === 'telemetry' && /search report not sent/.test(message)));
  assert.equal(storage.settings().searchReport, undefined);   // a report that was not made does not count as a search
});

test('Settings and the privacy page both say that search counts and times are sent', () => {
  const read = file => fs.readFileSync(new URL(file, import.meta.url), 'utf8');
  assert.match(read('../renderer/index.html'), /After each search: how many jobs it found and scored, and how many seconds it took/);
});

siteTest('the privacy page says that search counts and times are sent', () => {
  const read = file => fs.readFileSync(new URL(file, import.meta.url), 'utf8');
  assert.match(read('../../web/public/privacy.html'), /after each search how many jobs it found in your places/);
});
