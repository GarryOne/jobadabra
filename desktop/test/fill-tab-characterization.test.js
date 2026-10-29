// Characterizes one tab's fill ordering, arguments, stops, retries and reports without any live services.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fillTab, PAGE_FILES} from '../../extension/flow.js';
import {pushDecisions} from '../../extension/log.js';
import {disarmRecordUpdate} from '../../extension/ladder/record-update.js';

const TAB = {id: 719, url: 'https://forms.example.test/apply#step'};
const PROFILE = {first_name: 'Ada'};
const RESUME = {name: 'cv.pdf'};
const QUESTION = {field: 'q', label: 'Availability', type: 'text', required: true};
const AI = {answers: [{field: 'q', value: 'Soon', confidence: 'high'}], eligible: true, usd: 0.02, cover_letter: 'AI letter'};
const CONFIG = {workerUrl: 'https://fake.invalid', token: 'fake', clickDropdowns: false, repairAct: false};
const ME = {contact: PROFILE, resume: RESUME};

// Chrome and HTTP are the boundaries: page callbacks run against these deterministic page helpers.
async function run(options = {}, scenario = {}) {
  const saved = {chrome: globalThis.chrome, fetch: globalThis.fetch, window: globalThis.window, document: globalThis.document};
  const calls = [], fills = [], steps = [], requests = [], session = {...scenario.cache}, local = {};
  const form = scenario.form || [QUESTION];
  let fillCount = 0;
  const record = (name, value) => { calls.push(name); return value; };
  const page = {
    __jobPilottoDescribeForm: settled => record(settled ? 'settled form' : 'form', structuredClone(settled ? scenario.finalForm ?? [] : form)),
    __jobPilottoCheckboxQuestions: () => [],
    __jobPilottoProfileEntries: () => record('profile fields', []),
    __jobPilottoPageText: () => record('page text', 'Fictional posting'),
    __jobPilottoControls: {fingerprints: () => record('fingerprints', scenario.prints || [])},
    __jobPilottoUpload: {cvCandidates: () => record('upload titles', scenario.titles || [])},
    __jobPilottoExtensionFill: (...args) => {
      fills.push(structuredClone(args)); record('fill'); fillCount++;
      if (scenario.fillError) return scenario.fillError;
      if (scenario.heldPass === fillCount) return {held: true};
      return {filled: fillCount === 1 ? 1 : 2, unfilledRequired: 1, todo: ['Review'], trace: structuredClone(scenario.trace || [])};
    },
    __jobPilottoArmedCount: () => record('armed', 0),
    __jobPilottoSnapshots: (...args) => { record('snapshots'); scenario.onSnapshots?.(...args); return {q: 'scrubbed'}; },
    __jobPilottoRetypeWiped: ms => record(`retype ${ms}`, ms ? scenario.retyped || 0 : 0),
    __jobPilottoRetypeGaveUp: () => record('gave up', []),
    __jobPilottoReadBack: {pass: () => record('read back', scenario.readBack || [])},
    __jobPilottoAttempts: {drain: () => record('drain', scenario.spent || []), summary: () => record('tries', scenario.tries || null)},
  };
  globalThis.window = page;
  globalThis.document = {documentElement: {dataset: {}}, getElementById: () => null, getElementsByName: () => []};
  globalThis.chrome = {
    runtime: {getManifest: () => ({version: 'test'})},
    tabs: {get: async () => ({url: scenario.moved ? 'https://forms.example.test/next' : TAB.url})},
    storage: {
      session: {get: async key => record('cache', {[key]: session[key]}), set: async values => { Object.assign(session, values); }},
      local: {get: async () => ({...CONFIG, ...local}), set: async values => { Object.assign(local, values); }},
    },
    scripting: {executeScript: async ({func, args = [], files, target, world}) => {
      assert.equal(target.tabId, TAB.id);
      if (files) {
        record(files[0] === 'guard-bridge.js' ? 'bridge' : 'inject');
        if (files[0] !== 'guard-bridge.js') {
          assert.deepEqual(files, PAGE_FILES); assert.equal(world, 'MAIN');
          if (scenario.injectError) throw new Error('injection refused');
        } else { assert.equal(target.allFrames, true); if (scenario.bridgeError) throw new Error('bridge refused'); }
        return [{}];
      }
      if (func.name === 'onTop') return [{result: null}];
      if (func.name === 'openClosedSections') return [{result: record('sections', 0)}];
      if (func.name === 'markCardId') record('card id');
      return [{result: await func(...args)}];
    }},
  };
  globalThis.fetch = async (url, init) => {
    assert.equal(new URL(url).origin, 'https://fake.invalid', 'all requests stay in the fake transport');
    const path = new URL(url).pathname, body = init?.body && JSON.parse(init.body);
    requests.push({path, body, method: init?.method, headers: init?.headers});
    if (path !== '/extension/log') record(path);
    if (path === '/extension/answer' && scenario.aiError) throw new Error('offline answer');
    const replies = {'/extension/me': scenario.me ?? ME, '/extension/answer': scenario.ai ?? AI,
      '/extension/aliases': {aliases: ['meaning']}, '/extension/recipes': {recipes: {shape: 'recipe'}},
      '/extension/pick-upload': {title: 'CV document'}, '/extension/run': {id: 'run-id', url: 'https://fake.invalid/run'}};
    return new Response(JSON.stringify(replies[path] || {}), {status: 200});
  };
  try {
    let result, error;
    try { result = await fillTab(TAB, {...CONFIG, ...scenario.config}, {...options, onStep: text => steps.push(text)}); }
    catch (caught) { error = caught; }
    await pushDecisions();
    return {result, error, calls, fills, steps, requests, session, page,
      decisions: (local['jp-decisions'] || []).map(({text, fields}) => ({text, fields})),
      run: requests.find(request => request.path === '/extension/run')?.body};
  } finally {
    disarmRecordUpdate(TAB.id);
    Object.assign(globalThis, saved);
  }
}

// Dropping an injection, changing a fill argument, or moving verification ahead of typing breaks this sequence.
test('AI off: inject, fill, verify and report in order, preserving arguments and result', async () => {
  const got = await run({useAI: false, jobUrl: 'https://posting.example.test/job#anchor'});
  assert.ifError(got.error);
  assert.deepEqual(got.calls, ['/extension/event', 'sections', 'inject', 'bridge', 'fingerprints', '/extension/aliases', 'upload titles', '/extension/me', 'form', 'fill', 'armed', 'snapshots', 'retype 15000', 'settled form', 'gave up', 'read back', 'drain', 'tries', 'retype 0', 'card id', '/extension/event', '/extension/run']);
  assert.deepEqual(got.fills, [[[], PROFILE, RESUME, '', true]]);
  assert.deepEqual(got.steps, ['Reading the form…', 'Filling the form…']);
  const {card, ...result} = got.result;
  assert.deepEqual(result, {filled: 1, unfilledRequired: 0, todo: ['Review'], trace: [], usd: undefined, aiError: null, coverLetter: undefined, aiEligible: null, forced: ''});
  assert.equal(card.ai, 'off'); assert.equal(card.kit, false);
  assert.equal(got.run.url, 'https://posting.example.test/job'); assert.equal(got.run.pageUrl, TAB.url);
  assert.deepEqual(got.run.debug.steps.map(item => item.step), ['filled the page']);
  assert.deepEqual(got.requests.filter(item => item.path === '/extension/event').map(item => item.body), [
    {type: 'fill-started', url: 'https://posting.example.test/job'}, {type: 'fill-done', url: 'https://posting.example.test/job', filled: 1, left: 1}]);
  assert.equal(got.requests.find(item => item.path === '/extension/run').headers.Authorization, 'Bearer fake');
});

test('no kit: ask before the first fill, await afterwards, then fill only the AI answers and cache them', async () => {
  const got = await run();
  assert.ifError(got.error);
  assert.deepEqual(got.calls.filter(item => ['fill', '/extension/answer', 'cache', 'page text'].includes(item)), ['cache', 'page text', 'fill', '/extension/answer', 'fill']);
  assert.deepEqual(got.fills, [[[], PROFILE, RESUME, '', true], [[{...AI.answers[0], question: 'Availability', source: 'Claude (on the page)'}], {}, null, 'AI letter', true]]);
  assert.deepEqual(got.steps, ['Reading the form…', 'Filling the form…', "AI is answering 1 question and checking you're eligible (usually 10–30 s)…"]);
  assert.deepEqual(got.session['fill:719'], {url: 'https://forms.example.test/apply', ai: AI, test: false, asked: ['q']});
  assert.equal(got.result.filled, 3); assert.equal(got.result.usd, 0.02); assert.equal(got.result.coverLetter, 'AI letter');
  assert.deepEqual(got.run.debug.steps.map(item => item.step), ['read the form', 'filled the page', 'AI answered (after the fill)', "filled the AI's answers"]);
  assert.ok(got.decisions.some(item => item.text === 'first fields filled' && item.fields.waiting === 1));
});

test('kit answers are mapped with review confidence and no AI call for covered fields', async () => {
  const got = await run({kitAnswers: [{field: 'q', answer: 'Tomorrow', question: 'Availability', needs_review: true, category: 'fact'}]});
  assert.ifError(got.error);
  assert.deepEqual(got.fills[0][0], [{field: 'q', value: 'Tomorrow', question: 'Availability', source: 'kit', confidence: 'low', category: 'fact'}]);
  assert.equal(got.requests.some(item => item.path === '/extension/answer'), false);
  assert.equal(got.result.card.kit, true);
});

test('hasKit with no matching answers fills first and asks later without the eligibility stop', async () => {
  const got = await run({hasKit: true}, {ai: {...AI, eligible: false}});
  assert.ifError(got.error);
  assert.deepEqual(got.calls.filter(item => ['fill', '/extension/answer'].includes(item)), ['fill', '/extension/answer', 'fill']);
  assert.equal(got.fills[1][3], ''); assert.equal(got.result.ineligible, undefined);
  assert.equal(got.session['fill:719'], undefined);
  assert.equal(got.steps[2], 'AI is answering 1 more question…');
});

const cached = ai => ({'fill:719': {url: 'https://forms.example.test/apply', ai, test: false, asked: ['q']}});
test('reuse accepts cached answers in the first pass without asking again', async () => {
  const got = await run({}, {cache: cached(AI)});
  assert.deepEqual(got.fills[0][0], [{...AI.answers[0], source: 'Claude (on the page)'}]);
  assert.equal(got.fills.length, 1); assert.equal(got.requests.some(item => item.path === '/extension/answer'), false);
});

test('reuse false asks again despite cached answers', async () => {
  const got = await run({reuse: false}, {cache: cached(AI)});
  assert.equal(got.calls.includes('cache'), false); assert.equal(got.fills.length, 2);
});

for (const cache of [true, false]) {
  test(`ineligible ${cache ? 'cached' : 'later'} answer stops at the original boundary`, async () => {
    const ai = {...AI, eligible: false, eligibility_note: 'Needs a permit'};
    const got = await run({}, {ai, cache: cache ? cached(ai) : {}});
    assert.ifError(got.error);
    assert.equal(got.result.ineligible, true); assert.equal(got.result.note, 'Needs a permit');
    assert.equal(got.result.partly, cache ? undefined : true); assert.equal(got.result.usd, cache ? 0 : 0.02);
    assert.equal(got.fills.length, cache ? 0 : 1); assert.equal(got.run, undefined);
  });
  test(`force keeps filling after an ineligible ${cache ? 'cached' : 'later'} answer`, async () => {
    const ai = {...AI, eligible: false};
    const got = await run({force: true}, {ai, cache: cache ? cached(ai) : {}});
    assert.ifError(got.error); assert.equal(got.result.ineligible, undefined);
    assert.equal(got.result.forced, 'fill anyway'); assert.ok(got.run);
  });
}

test('eligibility setting off preserves filling and the verdict', async () => {
  const got = await run({}, {ai: {...AI, eligible: false}, config: {checkEligibility: false}});
  assert.ifError(got.error); assert.equal(got.result.ineligible, undefined); assert.ok(got.run);
});

test('explicit cover letter wins and approved PDF and consent setting travel with the resume', async () => {
  const me = {...ME, coverLetterText: 'Saved letter', coverLetterFile: {name: 'letter.pdf'}, coverLetterStatus: {state: 'approved'}, acceptConsents: false};
  const got = await run({coverLetter: 'Explicit letter', me});
  assert.deepEqual(got.fills[0].slice(1), [PROFILE, {...RESUME, coverLetterFile: me.coverLetterFile, coverLetterStatus: me.coverLetterStatus}, 'Explicit letter', false]);
  assert.equal(got.fills[1][3], 'Explicit letter'); assert.equal(got.fills[1][4], false);
  assert.equal(got.calls.includes('/extension/me'), false);
});

test('page refuses injection: reject before reading details or filling', async () => {
  const got = await run({}, {injectError: true});
  assert.equal(got.error.message, 'injection refused'); assert.deepEqual(got.calls, ['/extension/event', 'sections', 'inject']);
  assert.deepEqual(got.steps, ['Reading the form…']); assert.equal(got.run, undefined);
});

test('isolated bridge failure is optional; recipes, aliases and upload choice still arrive before the fill', async () => {
  const got = await run({useAI: false}, {bridgeError: true, prints: ['shape'], titles: ['Import', 'CV document']});
  assert.ifError(got.error); assert.deepEqual(got.page.__jobPilottoRecipes, {shape: 'recipe'});
  assert.deepEqual(got.page.__jobPilottoAliases, ['meaning']); assert.deepEqual(got.page.__jobPilottoUploadChoice, {resume: 'CV document'});
  assert.ok(got.calls.indexOf('/extension/recipes') < got.calls.indexOf('fill'));
});

test('fill leaves required fields: snapshot, retype, settle and report the page outcome', async () => {
  const trace = [{field: 'q', label: 'Availability', type: 'text', required: true, outcome: 'left', reason: 'answer given, but the field did not take it'}];
  const got = await run({useAI: false}, {trace, finalForm: [QUESTION], retyped: 2, onSnapshots: (targets, secrets) => {
    assert.deepEqual(targets, [{label: 'Availability', field: 'q'}]); assert.deepEqual(secrets, ['Ada']);
  }});
  assert.ifError(got.error); assert.equal(got.result.unfilledRequired, 1); assert.equal(got.result.trace[0].outcome, 'left');
  assert.equal(got.result.card.causes.not_taken, 1); assert.deepEqual(got.run.snapshots, {q: 'scrubbed'});
  assert.equal(got.run.debug.steps[1].step, 'typed 2 boxes again that the page emptied');
});

test('AI failure after first fill is reported, leaving the first pass intact', async () => {
  const got = await run({}, {aiError: true});
  assert.ifError(got.error); assert.equal(got.result.aiError, 'offline answer'); assert.equal(got.result.filled, 1);
  assert.deepEqual(got.run.debug.errors, ['Claude (after the fill): offline answer']);
});

for (const heldPass of [1, 2]) test(`held page at pass ${heldPass} stops before verification`, async () => {
  const got = await run({}, {heldPass});
  assert.deepEqual(got.result, {held: true, layer: null, note: 'a dialog covers the form', usd: 0});
  assert.equal(got.calls.includes('snapshots'), false); assert.equal(got.run, undefined);
});

test('errored page fill returns its error before dropdowns or verification', async () => {
  const got = await run({useAI: false}, {fillError: {error: 'broken control', pageError: 'at control'}});
  assert.deepEqual(got.result, {error: 'broken control', pageError: 'at control', filled: 0, trace: [], todo: [], usd: 0});
  assert.equal(got.calls.includes('armed'), false); assert.equal(got.run, undefined);
});

test('dropdowns on uses the shared debugger turn even when no menu is armed', async () => {
  const got = await run({useAI: false}, {config: {clickDropdowns: true}});
  assert.ifError(got.error); assert.deepEqual(got.steps, ['Reading the form…', 'Filling the form…', 'Choosing the drop-down answers…']);
  assert.deepEqual(got.run.debug.steps.map(item => item.step), ['filled the page', 'clicked dropdowns']);
});
