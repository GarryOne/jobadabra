// Fill waits accept the final read and retain evidence for only the requested attempt.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs';
import {waitForFill} from '../lib/fill-attempt.mjs';
import {fillNote, formTab} from '../lib/extension.mjs';
import {flakyProof} from '../lib/flaky-proof.mjs';
import {markedSession, sessionTabUrl} from '../../lib/session-tab.js';

function clock() {
  let ms = 0;
  return {now: () => ms, sleep: async tick => { ms += tick; }};
}
const page = url => ({url: () => url, isClosed: () => false});

test('accepts done and error on the read after the last sleep', async () => {
  for (const terminal of ['done', 'error']) {
    const time = clock(), tab = page('https://example.test/apply#jobpilotto-fill=ours');
    let reads = 0;
    const result = await waitForFill({...time, capMs: 1000, pickTab: () => ({tab, tabs: 1}),
      readState: async () => (++reads === 3 ? {state: terminal} : {state: 'running'})});
    assert.equal(result.ok, true);
    assert.equal(result.ms, 1000);
    assert.equal(result.state.state, terminal);
    assert.equal(reads, 3);
  }
});

test('exhaustion keeps the last rejected read, URL and tab count without reading again', async () => {
  const time = clock(), tab = page('https://example.test/apply#jobpilotto-fill=ours');
  let reads = 0;
  const result = await waitForFill({...time, capMs: 750, pickTab: () => ({tab, tabs: 2}),
    readState: async () => (++reads <= 3 ? {state: 'unreadable', raw: `read-${reads}`} : {state: 'done'})});
  assert.equal(result.ok, false);
  assert.equal(result.ms, 750);
  assert.equal(result.tab, tab);
  assert.equal(result.tabs, 2);
  assert.equal(result.url, tab.url());
  assert.equal(fillNote(result.state, result.ms / 1000), 'state: {"state":"unreadable","raw":"read-3"}');
  assert.equal(reads, 3);
});

test('re-resolves this attempt among two tabs at one address, including after navigation', async () => {
  const time = clock(), address = 'https://example.test/apply', url = `${address}#jobpilotto-fill=ours`;
  const old = page(`${address}#jobpilotto-fill=old`), blank = page('about:blank');
  let tabs = [old, blank];
  const browser = {pages: {[url]: blank}, context: {pages: () => tabs}};
  const result = await waitForFill({...time, capMs: 1000, pickTab: () => ({tab: formTab(browser, url), tabs: tabs.length}),
    readState: async tab => {
      if (time.now() === 0) { tabs = [old, page('https://example.test/next#jobpilotto-fill=ours')]; return null; }
      return {state: tab === old || tab === blank ? 'running' : 'done'};
    }});
  assert.equal(result.ok, true);
  assert.equal(result.tab, tabs[1]);
});

test('a running fill at exhaustion is classified as timing by G5', async () => {
  const result = await waitForFill({...clock(), capMs: 1000, pickTab: () => ({tab: page('https://example.test'), tabs: 1}),
    readState: async () => ({state: 'running'})});
  const message = `the extension never finished filling Engineer (${fillNote(result.state, result.ms / 1000)})`;
  assert.equal(result.ok, false);
  assert.match(message, /did not finish within 1 s \(still running\)/);
  assert.match(flakyProof(message).why, /^timing:/);
});

test('opening waits check a tab first seen on the last read', async () => {
  const time = clock(), tab = page('https://example.test/apply#jobpilotto-fill=ours');
  const result = await waitForFill({...time, capMs: 500, pickTab: () => ({tab: time.now() ? tab : null, tabs: 1}),
    readState: async () => ({opened: true}), accept: state => state?.opened === true});
  assert.equal(result.ok, true);
  assert.equal(result.tab, tab);
});

function applyHarness({spooled = true, reloadOwn = false} = {}) {
  const source = fs.readFileSync(new URL('../suites/apply.mjs', import.meta.url), 'utf8');
  const body = source.slice(source.indexOf('  async function apply('), source.indexOf('  // The panel opens'));
  const time = clock(), url = 'https://example.test/apply', marked = sessionTabUrl(url, 'ours');
  const own = page(marked), other = page(sessionTabUrl(url, 'other')), listeners = new Map();
  for (const tab of [own, other]) { tab.on = (_, fn) => listeners.set(tab, fn); tab.off = () => listeners.delete(tab); }
  const browser = {opened: [], pages: {[marked]: own}, context: {pages: () => [own, other]}};
  const ui = {click: async () => {}, evaluate: async () => [{id: 'ours'}], locator: () => ({locator: () => ({click: async () => {
    if (spooled) browser.opened.push(marked, sessionTabUrl('https://other.test', 'other'));
    listeners.get(reloadOwn ? own : other)?.();
  }})})};
  let reads = 0, dumps = 0;
  const apply = new Function('ctx', 'page', 'formTab', 'markedSession', 'sessionTabUrl', 'waitForFill', 'fillState', 'fillNote', 'dumpExtension', `return ${body}`)(
    {browser}, ui, formTab, markedSession, sessionTabUrl,
    options => waitForFill({...options, ...time, capMs: 1000}),
    async tab => { assert.equal(tab, own); return {state: dumps ? 'done' : 'running', read: ++reads}; }, fillNote, async () => { dumps++; });
  return {apply: () => apply({url, title: 'Engineer'}), reads: () => reads, dumps: () => dumps, listeners};
}

test('Apply ignores the global spool tail and reports its rejected read even if the dump sees done', async () => {
  const h = applyHarness();
  await assert.rejects(h.apply(), /never finished filling Engineer \(the fill did not finish within 90 s \(still running\), read on https:\/\/example.test\/apply#jobpilotto-fill=ours, 2 tab\(s\)\)/);
  assert.equal(h.reads(), 3, 'no fresh state read while formatting the failure');
  assert.equal(h.dumps(), 1);
  assert.equal(h.listeners.size, 0, 'listeners leave with the attempt');
});

test('Apply ignores a reload of another session at the same address', async () => {
  const h = applyHarness({spooled: false});
  await assert.rejects(h.apply(), /Apply did not open Engineer in the browser/);
  assert.equal(h.reads(), 0);
  assert.equal(h.listeners.size, 0);
});

test('Apply accepts a reload of its own session without a new spool entry', async () => {
  const h = applyHarness({spooled: false, reloadOwn: true});
  await assert.rejects(h.apply(), /never finished filling Engineer/);
  assert.equal(h.reads(), 3, 'the fill wait ran on the owned reload');
});

test('every ordinary apply step has one hang cap and setup remains critical', () => {
  const source = fs.readFileSync(new URL('../suites/apply.mjs', import.meta.url), 'utf8');
  const weights = new Function(`return ${source.match(/export const stepSeconds = ([\s\S]*?);/)[1]}`)();
  const caps = new Function('REAL_FORMS', 'stepSeconds', `return ${source.match(/export const hangCaps = ([\s\S]*?);/)[1]}`)([], weights);
  const cv = fs.readFileSync(new URL('../lib/apply-cv-steps.mjs', import.meta.url), 'utf8') + fs.readFileSync(new URL('../lib/apply-silent-steps.mjs', import.meta.url), 'utf8') + fs.readFileSync(new URL('../lib/apply-triage-steps.mjs', import.meta.url), 'utf8') + fs.readFileSync(new URL('../lib/apply-restart-steps.mjs', import.meta.url), 'utf8');
  const names = [...(source + cv).matchAll(/ctx\.run\('((?:[^'\\]|\\.)*)'/g)].map(match => match[1].replace(/\\'/g, "'"));
  // Inner caps add up past the runner's 8-minute default: the default stays, no entry (Why (29 Oct 2026, ap) above hangCaps).
  const UNCAPPED = ['"I submitted it"', 'Tailor CVs for top matches', 'Full automation presses Submit once on its own'];
  for (const name of names.filter(name => !UNCAPPED.some(head => name.startsWith(head)))) {
    const matches = Object.keys(caps).filter(head => name.startsWith(head));
    assert.equal(matches.length, 1, name);
    assert.ok(caps[matches[0]] > 0);
  }
  for (const head of UNCAPPED.slice(1)) assert.equal(Object.keys(caps).filter(key => head.startsWith(key)).length, 0, head);
  const seen = [], ctx = {run: (...args) => seen.push(args)};
  const wrapper = source.slice(source.indexOf('  const all = ctx.run;'), source.indexOf('  await ensureSetUp(ctx);'));
  new Function('ctx', 'hangCaps', wrapper)(ctx, caps);
  ctx.run('the app is seeded as a set-up install', () => {}, {critical: true, needs: ['setup']});
  assert.deepEqual(seen[0][2], {critical: true, needs: ['setup']});
  assert.ok(caps['a multi-step form'] >= (30 + 90 + 45 + 15 + 60 + 15 + 15 + 30));
});
