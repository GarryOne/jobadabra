// A fill's state mark (<html data-jobpilotto-fill>, read by the session's Claude, the form judge's wait and the e2e steps) goes only into the page that fill started on
// (13 Oct 2026, applycv "a sign-up page before the form": the sign-up page's fill ended after the tab had moved to the form; its "done" landed on the form, and the
// step read the form before that page's own fill). Every writer: extension/fill-flow.js writeState and background.js handOff's state().
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';

// A tab whose document can be replaced (a navigation): executeScript runs the page function against the current document, with that document's own script world.
function fakeTab() {
  const tab = {doc: null, navigate() { tab.doc = {world: {}, documentElement: {dataset: {}}}; }};
  tab.navigate();
  globalThis.chrome = {scripting: {executeScript: async ({func, args}) => {
    const keep = {window: globalThis.window, document: globalThis.document};
    globalThis.window = tab.doc.world; globalThis.document = tab.doc;
    try { return [{result: func(...(args || []))}]; } finally { Object.assign(globalThis, keep); }
  }}};
  return tab;
}

test('fill-flow.js: the end state is written only into the page the fill started on', async () => {
  const keep = globalThis.chrome;
  try {
    const {writeState} = await import('../../extension/fill-flow.js');
    const tab = fakeTab();
    await writeState(1, {state: 'running'}, 'fill-a');
    await writeState(1, {state: 'done', filled: 2}, 'fill-a');
    assert.equal(JSON.parse(tab.doc.documentElement.dataset.jobpilottoFill).state, 'done', 'same page: done is written');
    await writeState(1, {state: 'running'}, 'fill-b');
    tab.navigate();   // the person (or the page) moved the tab on before the fill ended
    await writeState(1, {state: 'done', filled: 2}, 'fill-b');
    assert.equal(tab.doc.documentElement.dataset.jobpilottoFill, undefined, 'the next page gets no "done" from the fill before it');
    await writeState(1, {state: 'no-form'});
    assert.equal(JSON.parse(tab.doc.documentElement.dataset.jobpilottoFill).state, 'no-form', 'a single state with no fill behind it is written as before');
  } finally { globalThis.chrome = keep; }
});

test('background.js handOff writes its states through the same rule (the class: every writer of the mark)', () => {
  const source = fs.readFileSync(new URL('../../extension/background.js', import.meta.url), 'utf8');
  const writers = [...source.matchAll(/dataset\.jobpilottoFill = text/g)].length;
  assert.equal(writers, 1, 'one writer of the state mark in background.js');
  assert.match(source, /if \(now === 'running'\) window\.__jobPilottoFillToken = token; else if \(now !== 'error' && window\.__jobPilottoFillToken !== token\) return;/);
});

// Beta 40748263936 (28 Oct 2026, Windows apply, "state: null" for 90 s): the fill's card id (a bare uuid) was written into the same attribute as the state JSON, so whichever
// came last erased the other. The state is read by the session and the e2e steps, the id by the panel at Submit (panel-learn.js, accepted only as /^[\w-]{8,40}$/): on the
// extension-first path `done` follows the id, the Submit report got `{"state":"done",...}` as its fillId, the app refused it and the fill's record was never linked.
// One attribute, one owner: the state keeps <html data-jobpilotto-fill>, the id has <html data-jobpilotto-fill-id>.
test('the card id and the fill state each keep their own attribute, whichever is written last', async () => {
  const keep = globalThis.chrome;
  try {
    const {writeState} = await import('../../extension/fill-flow.js');
    const {markCardId} = await import('../../extension/fill-card.js');
    const read = (tab, name) => tab.doc.documentElement.dataset[name];
    const tab = fakeTab();
    await writeState(1, {state: 'running'}, 'fill-a');
    await chrome.scripting.executeScript({func: markCardId, args: ['3f2a9c1e-7b64-4d0a-9a53-0c1d2e3f4a5b']});   // the id comes inside the fill, before its end
    await writeState(1, {state: 'done', filled: 6}, 'fill-a');
    assert.equal(JSON.parse(read(tab, 'jobpilottoFill')).state, 'done', 'the state reads as JSON');
    assert.equal(read(tab, 'jobpilottoFillId'), '3f2a9c1e-7b64-4d0a-9a53-0c1d2e3f4a5b', 'the id is still there after done (the panel sends it at Submit)');
    await chrome.scripting.executeScript({func: markCardId, args: ['9b1d7c20-1111-4222-8333-444455556666']});   // a second fill's id after the first one's state
    assert.equal(JSON.parse(read(tab, 'jobpilottoFill')).state, 'done', 'an id written after the state leaves the state readable');
    assert.match(read(tab, 'jobpilottoFillId'), /^[\w-]{8,40}$/, 'what the panel sends passes the app\'s check');
  } finally { globalThis.chrome = keep; }
});

test('the class: the state attribute holds only JSON states; every reader of the card id reads its own attribute', () => {
  const source = name => fs.readFileSync(new URL(`../../extension/${name}`, import.meta.url), 'utf8');
  const flow = ['flow.js', 'fill-tab-inputs.js', 'fill-tab-finish.js'].map(source).join('\n');
  const panel = source('panel-learn.js'), report = source('tab-report.js');
  assert.doesNotMatch(flow, /dataset\.jobpilottoFill = id/, 'flow.js writes the id through markCardId, not into the state attribute');
  assert.match(flow, /inPage\(tab\.id, markCardId, \[summary\.card\.id\]\)/);
  assert.equal([...panel.matchAll(/dataset\.jobpilottoFillId/g)].length, 2, 'both Submit reports (sent, and refused) read the id attribute');
  assert.doesNotMatch(panel, /dataset\.jobpilottoFill\b(?!Id)/, 'panel-learn.js does not read the state attribute as an id');
  assert.match(report, /dataset\.jobpilottoFill \|\| document\.documentElement\?\.dataset\.jobpilottoFillId/, 'a page the panel\'s Fill left with an id and no state still counts as looked at (considerMissed)');
});
