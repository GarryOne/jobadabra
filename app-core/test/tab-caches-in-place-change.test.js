// Every per-tab memory keyed by the page's address must tell a page that changed in place at the same address from the one it kept (16 Oct 2026, Workday: sign-in and the form behind
// it share one address; the kept answers of the first stood for the second). The class: flow.js cachedAI (kept AI reply), early-answers.js (the early ask), account-step.js kindKey
// (the 20 s page-kind memo). The two other address-keyed memories need no state check: read-gen.js landAsk drops by address and takes the NEWEST judgment of it (right for a page that
// changed), fill-flow.js fillKey is eb's #1013. A new memory of this kind is added to CASES.
import test from 'node:test';
import assert from 'node:assert/strict';

const URL_ = 'https://jobs.example.com/apply/applyManually#step';
globalThis.chrome = {runtime: {getManifest: () => ({version: 'test'}), onMessage: {addListener() {}}}, storage: {local: {get: async () => ({})}, session: {get: async () => ({})}}};
const flow = await import('../../extension/flow.js');
const early = await import('../../extension/early-answers.js');
const step = await import('../../extension/account-step.js');

const SIGN_IN = [{field: 'input-15'}], FORM = [{field: 'hear'}, {field: 'radio:employed'}];
const CASES = {
  async cachedAI() {
    globalThis.chrome.storage.session.get = async () => ({'fill:1': {url: URL_.split('#')[0], ai: {answers: []}, asked: SIGN_IN.map(f => f.field)}});
    return [!!await flow.cachedAI({id: 1, url: URL_}, SIGN_IN), !!await flow.cachedAI({id: 1, url: URL_}, FORM)];
  },
  async earlyAnswers() {
    early.keepEarly(1, URL_, SIGN_IN, Promise.resolve({answers: []}));
    const sameState = !!early.takeEarly(1, URL_, SIGN_IN);
    early.keepEarly(1, URL_, SIGN_IN, Promise.resolve({answers: []}));
    return [sameState, !!early.takeEarly(1, URL_, FORM)];
  },
  async kindKey() {
    const signIn = {boxes: 1, empty: 1, pending: false}, form = {boxes: 0, empty: 0, pending: false};
    return [step.kindKey(URL_, signIn) === step.kindKey(URL_, signIn), step.kindKey(URL_, signIn) === step.kindKey(URL_, form)];
  },
};
for (const [name, run] of Object.entries(CASES)) {
  test(`${name}: reused for the same page state, never for another state at the same address`, async () => {
    const [sameState, otherState] = await run();
    assert.equal(sameState, true, 'the same state is reused');
    assert.equal(otherState, false, 'a page that changed in place is not');
  });
}
