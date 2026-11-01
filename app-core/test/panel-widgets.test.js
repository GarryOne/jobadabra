// The panel (extension/review.js) counts a REQUIRED custom control it cannot read (a slider, a switch, a rich-text box) as left for the person, until the control's own
// state changes: it used to say "Ready to submit" over an unanswered question (found by the apply end-to-end suite, 2 Oct 2026).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadJsdom, openPage } from './helpers/page.js';
import { evalPanel } from './helpers/panel.js';

const read = (path) => fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const JSDOM = await loadJsdom();

const FORM = (widget) => `<form>
  <label for="a">First name *</label><input id="a" required value="Ada">
  <label for="b">Last name *</label><input id="b" required value="Tester">
  <label for="c">Email *</label><input id="c" type="email" required value="ada@example.test">
  ${widget}</form>`;
const SLIDER = '<div id="lbl">How would you rate your Terraform skill? *</div><div role="slider" id="skill" aria-labelledby="lbl" aria-required="true" aria-valuenow="1" tabindex="0"></div>';

async function panel(html, after) {
  const { window } = openPage(JSDOM, html);
  window.chrome = { runtime: { id: 'test', getManifest: () => ({ version: 'test' }), sendMessage: async (message) => (message.type === 'panelAllowed' ? { ok: true } : {}), onMessage: { addListener() {} } } };
  window.document.documentElement.setAttribute('data-jobpilotto-page', 'form');   // the fill flow judged this page a form (extension/page-mark.js): only then may the panel count or say Ready
  window.eval(read('extension/page/skeleton.js'));
  evalPanel(window);
  await new Promise((resolve) => setTimeout(resolve, 50));
  const read2 = () => {
    const root = window.document.getElementById('jobpilotto-review-host')?.shadowRoot;
    return root && { pill: root.querySelector('.pill b').textContent, ring: root.querySelector('.ring span').textContent };
  };
  const before = read2();
  if (after) { after(window.document); await new Promise((resolve) => setTimeout(resolve, 3500)); }   // the panel re-reads the page every few seconds
  const result = { before, after: after ? read2() : null };
  window.close();   // stops the panel's polling: the test run can end
  return result;
}

test('a page nothing has judged yet says only "Reading this page…", never Ready or a count (owner, 15 Oct 2026)', { skip: !JSDOM }, async () => {
  const { window } = openPage(JSDOM, FORM(''));
  window.chrome = { runtime: { id: 'test', getManifest: () => ({ version: 'test' }), sendMessage: async (message) => (message.type === 'panelAllowed' ? { ok: true } : {}), onMessage: { addListener() {} } } };
  window.eval(read('extension/page/skeleton.js'));
  evalPanel(window);
  await new Promise((resolve) => setTimeout(resolve, 50));
  const pill = window.document.getElementById('jobpilotto-review-host')?.shadowRoot?.querySelector('.pill b')?.textContent;
  window.close();
  assert.equal(pill, 'Reading this page…');
});

test('a required slider nobody has touched is one left: the panel is not "Ready to submit"', { skip: !JSDOM }, async () => {
  const { before } = await panel(FORM(SLIDER));
  assert.equal(before.pill, '1 left');
});

test('the same form without the slider is "Ready to submit" (the check is about the slider, not the panel)', { skip: !JSDOM }, async () => {
  const { before } = await panel(FORM(''));
  assert.equal(before.pill, 'Ready to submit');
});

test('an optional slider is not counted', { skip: !JSDOM }, async () => {
  const { before } = await panel(FORM(SLIDER.replace('aria-required="true"', '').replace(' *</div>', '</div>')));
  assert.equal(before.pill, 'Ready to submit');
});

test('once the person moves the slider it counts as answered', { skip: !JSDOM }, async () => {
  const { before, after } = await panel(FORM(SLIDER), (doc) => doc.getElementById('skill').setAttribute('aria-valuenow', '4'));
  assert.equal(before.pill, '1 left');
  assert.equal(after.pill, 'Ready to submit');
});

// Ashby titles a radio group with a <label> inside the <fieldset> and marks it required only by a CSS "*" (class _required_):
// the panel listed neither of two such questions (Colonist, 5 Oct 2026).
const ASHBY_RADIOS = `<fieldset><label class="_heading _required_f7cvd_91" for="nowhere">How much has AI increased your speed?</label>
  <div><input type="radio" id="r0" name="speed"><label for="r0">20%</label></div>
  <div><input type="radio" id="r1" name="speed"><label for="r1">2x</label></div></fieldset>`;

test('a required Ashby radio group (titled by a label, "*" drawn by CSS) is one left until answered', { skip: !JSDOM }, async () => {
  const { before, after } = await panel(FORM(ASHBY_RADIOS), (document) => document.getElementById('r1').click());
  assert.equal(before.pill, '1 left');
  assert.equal(after.pill, 'Ready to submit');
});

// Ashby's yes/no: two toggle buttons (aria-pressed) with a visually hidden checkbox inside the same box (flow-checks' replay checks, #531, 13 Oct 2026: the panel listed each such
// question twice, the fill's record once). One question, one row: the checkbox inside the pair is the same control.
const YES_NO = `<div class="field"><label class="_required_x" for="q-work">Are you allowed to work in Switzerland without a visa?</label>
  <div class="yesno"><button type="button" aria-pressed="false">Yes</button><button type="button" aria-pressed="false">No</button><input type="checkbox" tabindex="-1" name="q-work"></div></div>`;
test('a required yes/no pair with its hidden checkbox is ONE left, then answered by pressing Yes', { skip: !JSDOM }, async () => {
  const { before, after } = await panel(FORM(YES_NO), (document) => { const yes = document.querySelector('.yesno button'); yes.setAttribute('aria-pressed', 'true'); document.querySelector('.yesno input').checked = true; });
  assert.equal(before.pill, '1 left');
  assert.equal(after.pill, 'Ready to submit');
});

// Signal 3, at Submit: the panel tells the app which questions you answered yourself that the fill left or never read (labels
// and kinds only), so the product counts what each board's fill misses. A required question nothing read is listed meanwhile.
const UNREAD = `<div class="entry"><div class="question-title is-required">How many players at most?</div>
  <div><input type="radio" id="p4"><label for="p4">4</label><input type="radio" id="p6"><label for="p6">6</label></div></div>`;
test('a required question nothing read is listed; answering it yourself is reported at Submit as never read', { skip: !JSDOM }, async () => {
  const { window } = openPage(JSDOM, FORM(`${UNREAD}<button type="button" id="go">Submit application</button>`));
  const sent = [];
  window.chrome = { runtime: { id: 'test', getManifest: () => ({ version: 'test' }), sendMessage: async (message) => { sent.push(message); return message.type === 'panelAllowed' ? { ok: true } : {}; }, onMessage: { addListener() {} } } };
  window.document.documentElement.setAttribute('data-jobpilotto-page', 'form');   // judged a form by the fill flow (extension/page-mark.js)
  window.eval(read('extension/page/skeleton.js'));
  window.eval(read('extension/page/coverage.js'));
  window.eval(read('extension/page/submit-press.js'));
  evalPanel(window);
  await new Promise((resolve) => setTimeout(resolve, 50));
  const pill = () => window.document.getElementById('jobpilotto-review-host').shadowRoot.querySelector('.pill b').textContent;
  assert.equal(pill(), '1 left');
  const trusted = (el, type) => { const event = new window.MouseEvent(type, { bubbles: true }); event.__jpTrusted = true; el.dispatchEvent(event); };
  window.document.getElementById('p6').checked = true;
  trusted(window.document.getElementById('p6'), 'click');
  trusted(window.document.getElementById('go'), 'click');
  await new Promise((resolve) => setTimeout(resolve, 50));
  window.close();
  const learning = sent.find((m) => m.type === 'formLearning');
  assert.deepEqual(JSON.parse(JSON.stringify(learning?.byYou)), [{ label: 'How many players at most?', kind: 'unread', unread: true }]);
  assert.ok(!JSON.stringify(learning).includes('"6"'), 'never the answer');
});

// A type-to-search picklist that keeps its choice in a hidden input its label points to (SuccessFactors; seen on Coop's form in the live-test twin,
// 8 Oct 2026: a chosen "Monsieur", hidden value 688, stayed "left for you" and in the app's Needs your attention). The shape, not the site.
const PICKLIST = (code, typed = 'Monsieur') => `<label for="tor__anrede">Opening formula *</label>
  <div class="field"><div id="picklist_anrede"><span><div class="fd-input-group--control"><input type="text" role="combobox" aria-required="true" aria-label="Opening formula" value="${typed}"></div></span></div>
  <input type="hidden" id="tor__anrede" value="${code}"></div>`;

test('a picklist whose labelled hidden input holds the choice is filled', { skip: !JSDOM }, async () => {
  assert.equal((await panel(FORM(PICKLIST('688')))).before.pill, 'Ready to submit');
});

test('text typed into the picklist without a choice is still one left', { skip: !JSDOM }, async () => {
  assert.equal((await panel(FORM(PICKLIST('', 'Mons')))).before.pill, '1 left');
});

test('an empty combobox is not filled by a neighbouring field\'s hidden value', { skip: !JSDOM }, async () => {
  const neighbours = `<div class="row"><label for="tor__other">Country *</label><input type="hidden" id="tor__other" value="41"><select id="country"><option>CH</option></select>
    <div class="fd-input-group--control"><input type="text" role="combobox" aria-required="true" aria-label="Opening formula" value=""></div></div>`;
  assert.equal((await panel(FORM(neighbours))).before.pill, '1 left');
});

test('a small sign-in page has no panel, unless the AI says it needs the person: then the panel says what', { skip: !JSDOM }, async () => {
  const SIGN_IN = '<form><label for="e">Email</label><input id="e" type="email" value=""><label for="p">Password</label><input id="p" type="password" value=""></form>';
  assert.ok(!(await panel(SIGN_IN)).before);   // no panel at all
  const flagged = await panel(SIGN_IN, document => document.documentElement.setAttribute('data-jobpilotto-needs', 'Check the code we sent you'));
  assert.match(flagged.after?.pill || '', /^Needs you: Check the code we sent you/);
});

// Owner, 16 Oct 2026, "I'd expect to see the button in the extension panel. ALWAYS", "a small icon that will trigger Report this form": the panel's header carries ⚑ in every state.
test('the panel shows its ⚑ "Report this form" icon in every state: reading, posting, opening, form left, form ready, account page', { skip: !JSDOM }, async () => {
  const states = [['reading', '', FORM(SLIDER)], ['posting', 'posting', FORM('')], ['opening', 'opening', FORM('')], ['form, a field left', 'form', FORM(SLIDER)],
    ['form, ready', 'form', FORM('')], ['account page', 'account', FORM('<label>Password <input type="password" required></label>')]];
  for (const [name, mark, html] of states) {
    const { window } = openPage(JSDOM, html);
    if (mark) window.document.documentElement.setAttribute('data-jobpilotto-page', mark);
    window.chrome = { runtime: { id: 'test', getManifest: () => ({ version: 'test' }), sendMessage: async (message) => (message.type === 'panelAllowed' ? { ok: true } : {}), onMessage: { addListener() {} } } };
    window.eval(read('extension/page/skeleton.js'));
    evalPanel(window);
    await new Promise((resolve) => setTimeout(resolve, 50));
    const root = window.document.getElementById('jobpilotto-review-host')?.shadowRoot;
    root?.querySelector('.pill')?.click();   // opened, as a person does
    const icon = root?.querySelector('.foot .report-btn');
    const seen = { name, there: !!icon && !icon.hidden && icon.getAttribute('aria-label') === 'Report this form' && icon.textContent.trim() === 'Report' && !root.querySelector('.head .report-flag') };
    window.close();
    assert.deepEqual(seen, { name, there: true });
  }
  const panel = read('extension/review.js');
  assert.match(panel, /\$\('\.report-btn'\)\.onclick = event => \{[^]*if \(!event\.isTrusted\) return;[^]*window\.__jobPilottoReport\.open\(\);/);
  assert.match(read('extension/panel-report.js'), /window\.__jobPilottoReport = \{mount, open, words: WORDS, sentence: refusal\};/, 'the popup the footer\'s Report opens');
});
