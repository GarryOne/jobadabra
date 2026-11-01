// When the AI is asked whether an application form is ready (extension/form-ready.js): only when the panel's own count claims it, never on an account page.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {claimsReady} from '../../extension/form-ready.js';

test('the AI is asked only when the count says every required field is filled on an application page', () => {
  assert.equal(claimsReady({total: 8, left: 0, account: false}), true);
  assert.equal(claimsReady({total: 8, left: 2, account: false}), false);   // not ready by the count: nothing to veto
  assert.equal(claimsReady({total: 0, left: 0, account: false}), false);   // no required field seen
  assert.equal(claimsReady({total: 8, left: 0, account: true}), false);   // an account page has its own judge
  assert.equal(claimsReady(undefined), false);
});

// 9 Oct 2026, Deloitte's CV step: the CV was attached, the step was done, and nothing asked the AI what comes next, since the panel's HTML count was not "ready".
test('after a fill the AI is asked what the page needs next, whatever the count says, once per page state', async () => {
  const {formNext} = await import('../../extension/form-ready.js');
  const asked = [], decided = [];
  const keep = {chrome: globalThis.chrome, fetch: globalThis.fetch};
  globalThis.chrome = {
    storage: {local: {get: async () => ({workerUrl: 'http://127.0.0.1:47111', token: 't'}), set: async () => {}}, session: {get: async () => ({}), set: async () => {}}},
    scripting: {executeScript: async () => [{result: {url: 'https://apply.example/m', title: 'My CV', headings: [], controls: [], buttons: ['Continue'], texts: ['CV attached'], frames: []}}]},
    runtime: {getManifest: () => ({version: '0'})}};
  globalThis.fetch = async (url, init) => { asked.push([String(url), JSON.parse(init?.body || '{}')]); return {ok: true, status: 200, json: async () => ({answer: 'ready', step: 'middle', nextControl: ''}), text: async () => '{}'}; };
  try {
    await formNext({id: 71, url: 'https://apply.example/m'}, 0);
    await formNext({id: 71, url: 'https://apply.example/m'}, 0);   // the same page state: not asked again
  } finally { Object.assign(globalThis, keep); }
  const judge = asked.filter(([url]) => /account-judge/.test(url));
  assert.equal(judge.length, 1, `asked ${judge.length} times: ${JSON.stringify(asked.map(([url]) => url))}`);
  assert.equal(judge[0][1].phase, 'form');
});

// 11 Oct 2026 (Louis Vuitton): a site dialog sat over the form after the fill and the run read as "5 of 8 filled". A blocked answer reaches the panel (its own words, per kind),
// and nothing is pressed on a blocked page.
test('a blocked answer flags the panel with its kind in words and presses no next step', async () => {
  const {blockedWords, formNext} = await import('../../extension/form-ready.js');
  assert.deepEqual(['dialog', 'error', 'overlay', 'gone'].map(kind => !!blockedWords(kind)), [true, true, true, true]);
  assert.equal(blockedWords('anything else'), blockedWords('overlay'));
  const flagged = [];
  const keep = {chrome: globalThis.chrome, fetch: globalThis.fetch};
  globalThis.chrome = {
    storage: {local: {get: async () => ({workerUrl: 'http://127.0.0.1:47111', token: 't'}), set: async () => {}}, session: {get: async () => ({}), set: async () => {}}},
    scripting: {executeScript: async ({args}) => { if (args?.length) flagged.push(args[0]); return [{result: {url: 'https://apply.example/m', title: 'Apply', headings: [], controls: [], buttons: ['Continue', 'Cancel'], texts: ['Your filled fields may be replaced'], frames: [], }}]; }},
    runtime: {getManifest: () => ({version: '0'})}};
  globalThis.fetch = async () => ({ok: true, status: 200, json: async () => ({answer: 'blocked', blockedKind: 'dialog', step: 'middle', nextControl: 'Continue'}), text: async () => ''});
  try { await formNext({id: 72, url: 'https://apply.example/m'}, 0); await new Promise(resolve => setTimeout(resolve, 30)); } finally { Object.assign(globalThis, keep); }
  assert.deepEqual(flagged, [blockedWords('dialog')]);
});

// 11 Oct 2026, the real Louis Vuitton run: the site's "importing your data, wait" dialog covered the form for a few seconds, the judge said blocked, and the page cleared itself.
// A blocked answer is asked once more a little later, so a page that recovers does not stay a failure (and one that does not, stays blocked).
test('a blocked answer is judged again once; the page recovered: the flag is cleared and the log says so', async () => {
  const mod = await import('../../extension/form-ready.js');
  mod.timing.recheckMs = 20;
  const flagged = [], answers = [{answer: 'blocked', blockedKind: 'dialog'}, {answer: 'ready', step: 'final'}];
  let page = 0;
  const keep = {chrome: globalThis.chrome, fetch: globalThis.fetch};
  globalThis.chrome = {
    storage: {local: {get: async () => ({workerUrl: 'http://127.0.0.1:47111', token: 't'}), set: async () => {}}, session: {get: async () => ({}), set: async () => {}}},
    scripting: {executeScript: async ({args, func}) => { if (args?.length) { flagged.push(args[0]); return [{result: undefined}]; } if (String(func).includes('elementFromPoint')) return [{result: page === 0 ? {shape: 'dialog', role: 'dialog', text: 'Importing', buttons: ['Close'], covered: []} : null}]; page += func.name === 'accountSketch' ? 1 : 0; return [{result: {url: 'https://apply.example/m', title: 'Apply', headings: [], controls: [{type: 'text', label: String(page), state: 'filled'}], buttons: ['Send'], texts: [], frames: []}}]; }},
    runtime: {getManifest: () => ({version: '0'})}};
  globalThis.fetch = async () => ({ok: true, status: 200, json: async () => answers.shift() || {}, text: async () => ''});
  try { await mod.formNext({id: 73, url: 'https://apply.example/m'}, 0); await new Promise(resolve => setTimeout(resolve, 250)); } finally { Object.assign(globalThis, keep); mod.timing.recheckMs = 8000; }
  assert.deepEqual(flagged, [mod.blockedWords('dialog'), null]);
});

// 12 Oct 2026, HelloFresh in the app: the panel's count looked ready 0.6 s after the first fields while the AI's answers were still on their way; the judge sketched a half-filled page and
// said "needs First Name*", a stale flag the end of the fill never cleared. While the tab's fill runs, the panel's claim is not judged; once it is done, it is.
test('the panel\'s ready claim is judged only when the tab\'s fill is not running', async () => {
  const {formReady} = await import('../../extension/form-ready.js');
  const keep = {chrome: globalThis.chrome, fetch: globalThis.fetch};
  const asks = async state => {
    const asked = [];
    globalThis.chrome = {
      storage: {local: {get: async () => ({workerUrl: 'http://127.0.0.1:47111', token: 't'}), set: async () => {}}, session: {get: async () => ({}), set: async () => {}}},
      scripting: {executeScript: async ({func}) => [{result: /dataset\.jobadabraFill\b/.test(String(func)) ? state === 'running'
        : {url: 'https://apply.example/f', title: 'Apply', headings: [], controls: [{type: 'text', label: `City ${state}`, required: true, state: 'filled'}], buttons: [], texts: [], frames: []}}]},
      runtime: {getManifest: () => ({version: '0'})}};
    globalThis.fetch = async (url, init) => { asked.push(String(url)); return {ok: true, status: 200, json: async () => ({answer: 'ready', step: 'final'})}; };
    try { await formReady({id: state === 'running' ? 81 : 82, url: 'https://apply.example/f'}, 0, {total: 3, left: 0}); await new Promise(resolve => setTimeout(resolve, 50)); } finally { Object.assign(globalThis, keep); }   // the log line after the judgment runs a moment later
    return asked.filter(url => /account-judge/.test(url)).length;
  };
  assert.equal(await asks('running'), 0, 'not judged while the fill runs');
  assert.equal(await asks('done'), 1, 'judged once the fill is done');
});

// The fill ladder's fill_verify in shadow (PR 3): asked only when a control did not keep what the fill gave it, or the judge names as missing a control the fill kept; logged only.
test('the fill check is asked on a miss or a contradiction, never otherwise, and only logs', async () => {
  const {wantsFillCheck, formNext} = await import('../../extension/form-ready.js');
  const kept = {label: 'First name', match: 'yes'}, lost = {label: 'City', match: 'no'}, untouched = {label: 'Notes', match: ''};
  assert.equal(wantsFillCheck({controls: [kept, untouched]}, {answer: 'ready'}), false);
  assert.equal(wantsFillCheck({controls: [kept, lost]}, {answer: 'ready'}), true);
  assert.equal(wantsFillCheck({controls: [kept]}, {answer: 'needs_person', needs: 'First name'}), true);   // the judge names a control the fill kept
  assert.equal(wantsFillCheck({controls: [kept, untouched]}, {answer: 'needs_person', needs: 'Notes'}), false);
  const keep = {chrome: globalThis.chrome, fetch: globalThis.fetch};
  const asked = [];
  globalThis.chrome = {
    storage: {local: {get: async () => ({workerUrl: 'http://127.0.0.1:47111', token: 't'}), set: async () => {}}, session: {get: async () => ({}), set: async () => {}}},
    scripting: {executeScript: async ({func}) => [{result: /dataset\.jobadabraFill\b/.test(String(func)) ? false : {url: 'https://apply.example/v', title: 'Apply', headings: [], controls: [{type: 'text', ...kept, required: true, state: 'filled'}, {type: 'text', ...lost, required: true, state: 'empty'}], buttons: [], texts: [], frames: []}}]},
    runtime: {getManifest: () => ({version: '0'})}};
  globalThis.fetch = async (url, init) => { const body = JSON.parse(init?.body || '{}'); asked.push(body.phase); return {ok: true, status: 200, json: async () => (body.phase === 'fill' ? {ok: true, answer: 'shadow', counts: {ok: 1, empty: 1, wrong: 0, unreachable: 0, unsure: 0}} : {answer: 'needs_person', needs: 'City', step: 'final'})}; };
  try { await formNext({id: 91, url: 'https://apply.example/v'}, 0); await new Promise(resolve => setTimeout(resolve, 50)); } finally { Object.assign(globalThis, keep); }
  assert.deepEqual(asked.filter(phase => phase === 'form' || phase === 'fill'), ['form', 'fill']);
});

// 14 Oct 2026, the combo stall's required variant: the fill gave up on a required suggest-only menu and nothing ended the run ("dead end: silent" 31 s later). The fill's own rows hand the page
// to the person, naming the field, without the AI; a menu given up on that is optional, or a required one not given up on, hands nothing over.
test('nothing given up on hands nothing to the person (the given-up case is the recorded page combo-never-opens-required-1)', async () => {
  const {handGivenUpToPerson} = await import('../../extension/form-ready.js');
  const {gaveUpOn} = await import('../../extension/flow.js');
  assert.deepEqual(gaveUpOn(81), []);
  const flagged = [];
  const keep = {chrome: globalThis.chrome};
  globalThis.chrome = {scripting: {executeScript: async ({args}) => { if (args?.length) flagged.push(args[0]); return [{result: undefined}]; }}};
  try {
    assert.deepEqual(await handGivenUpToPerson({id: 81, url: 'https://apply.example/m'}, 0, [{label: 'Address', required: true, outcome: 'left'}]), []);   // nothing given up on
  } finally { Object.assign(globalThis, keep); }
  assert.deepEqual(flagged, []);
});

// Beta 17 Oct 2026 (sign-in form ending at the person): the judge gave no usable answer, the panel's count claimed ready, and every look asked again: 595 calls in 5 minutes.
test('a page the judge never answers is asked MAX_NO_ANSWER times, then left alone until it changes', async () => {
  const {formNext, MAX_NO_ANSWER} = await import('../../extension/form-ready.js');
  const asked = [];
  let text = 'Sign in';
  const keep = {chrome: globalThis.chrome, fetch: globalThis.fetch};
  globalThis.chrome = {
    storage: {local: {get: async () => ({workerUrl: 'http://127.0.0.1:47111', token: 't'}), set: async () => {}}, session: {get: async () => ({}), set: async () => {}}},
    scripting: {executeScript: async () => [{result: {url: 'https://apply.example/s', title: 'Sign in', headings: [], controls: [], buttons: [], texts: [text], frames: []}}]},
    runtime: {getManifest: () => ({version: '0'})}};
  globalThis.fetch = async (url, init) => { asked.push([String(url), JSON.parse(init?.body || '{}')]); return {ok: true, status: 200, json: async () => ({error: 'not an answer'}), text: async () => ''}; };
  try {
    for (let look = 0; look < 12; look++) await formNext({id: 90, url: 'https://apply.example/s'}, 0);
    const first = asked.filter(([url]) => /account-judge/.test(url)).length;
    assert.equal(first, MAX_NO_ANSWER, `asked ${first} times for one unchanged page`);
    text = 'Something changed';   // a different page state is asked again
    await formNext({id: 90, url: 'https://apply.example/s'}, 0);
    assert.equal(asked.filter(([url]) => /account-judge/.test(url)).length, MAX_NO_ANSWER + 1);
  } finally { Object.assign(globalThis, keep); }
});

// Same day: api() hands back null for an answer dropped as late; the fill read null.answers and the app logged "Claude did not answer the questions".
test('Claude\'s answers dropped as late are a dropped answer, not a crash reading null.answers', async () => {
  const {answersOrDropped} = await import('../../extension/flow.js');
  assert.throws(() => answersOrDropped(null), error => error.dropped === true && !/Cannot read properties/.test(error.message));
  assert.throws(() => answersOrDropped(undefined), error => error.dropped === true);
  const found = {answers: [], eligible: true};
  assert.equal(answersOrDropped(found), found);
});
