// A written question we drafted (owner, 16 Oct 2026): the panel never says "Ready to submit" over a draft nobody read, "Review my answer" sits beside its box and
// never overwrites what the person typed without the press (extension/panel-written.js, panel-form.js, review.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadJsdom, openPage } from './helpers/page.js';
import { evalPanel } from './helpers/panel.js';

const read = (path) => fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const JSDOM = await loadJsdom();
const QUESTIONS = ['What is your hands-on experience operating container-orchestrated infrastructure?', 'Describe cloud infrastructure you have built.',
  'Walk us through how you make a change to production safely.', 'Describe a production incident you personally root-caused.'];
const FORM = (draftKind = 'draft') => `<form>
  <label for="a">First name *</label><input id="a" required value="Ada">
  <label for="b">Last name *</label><input id="b" required value="Tester">
  <label for="c">Email *</label><input id="c" type="email" required value="ada@example.test">
  ${QUESTIONS.map((q, i) => `<label for="q${i}">${q} *</label><textarea id="q${i}" required data-jobpilotto-category="written" ${draftKind ? `data-jobpilotto-draft="${draftKind}"` : ''}>${i === 3 && draftKind === 'outline' ? '• Add: which incident' : `Draft ${i}`}</textarea>`).join('')}</form>`;

async function panel(html, onSend = async () => ({})) {
  const { window } = openPage(JSDOM, html);
  const sent = [];
  window.chrome = { runtime: { id: 'test', getManifest: () => ({ version: 'test' }), sendMessage: async (message) => { sent.push(message); return message.type === 'panelAllowed' ? { ok: true } : onSend(message); }, onMessage: { addListener() {} } } };
  window.eval(read('extension/page/skeleton.js'));
  window.document.documentElement.setAttribute('data-jobpilotto-page', 'form');   // judged a form by the fill flow (extension/page-mark.js): only then may the panel count or say Ready
  evalPanel(window);
  await new Promise((resolve) => setTimeout(resolve, 60));
  const root = () => window.document.getElementById('jobpilotto-review-host')?.shadowRoot;
  return { window, sent, pill: () => root()?.querySelector('.pill b').textContent, close: () => window.close() };
}
const hostOf = (window, id) => window.document.getElementById(id).nextElementSibling;

test('an unreviewed draft is a "left" item: the panel is never Ready over it; Keep as is makes it done', { skip: !JSDOM }, async () => {
  const { window, pill, close } = await panel(FORM());
  assert.equal(pill(), '4 left');
  const keep = [...hostOf(window, 'q0').shadowRoot.querySelectorAll('button')].find((b) => b.textContent === 'Keep as is');
  keep.click();
  await new Promise((resolve) => setTimeout(resolve, 3000));
  assert.equal(pill(), '3 left', 'only the one the person kept is done');
  close();
});

test('with no draft marks the same filled boxes are Ready (the mark is what holds it back)', { skip: !JSDOM }, async () => {
  const { pill, close } = await panel(FORM(''));
  assert.equal(pill(), 'Ready to submit');
  close();
});

test('every written box gets its Review my answer, drafted ones are tagged; an outline says so and is not kept as is', { skip: !JSDOM }, async () => {
  const { window, close } = await panel(FORM('outline'));
  for (let i = 0; i < QUESTIONS.length; i++) {
    const root = hostOf(window, `q${i}`).shadowRoot;
    assert.ok([...root.querySelectorAll('button')].some((b) => b.textContent === 'Review my answer'), `q${i}`);
    assert.match(root.querySelector('.tag').textContent, /Outline/);
    assert.ok(![...root.querySelectorAll('button')].some((b) => b.textContent === 'Keep as is'), 'an outline is only done by completing it');
  }
  close();
});

test('Review my answer asks once, shows the result, and types nothing until "Use this version" is pressed; a changed box is never overwritten', { skip: !JSDOM }, async () => {
  const { window, sent, close } = await panel(FORM(), async (message) => (message.type === 'panelReviewAnswer'
    ? { ok: true, answers_it: false, verdict: 'No incident named.', missing: ['one incident'], improved: 'Improved text', usd: 0 } : {}));
  const box = window.document.getElementById('q3'), root = () => hostOf(window, 'q3').shadowRoot;
  const press = (label) => [...root().querySelectorAll('button')].find((b) => b.textContent === label).click();
  press('Review my answer');
  await new Promise((resolve) => setTimeout(resolve, 100));
  const asked = sent.filter((m) => m.type === 'panelReviewAnswer');
  assert.equal(asked.length, 1);
  assert.deepEqual([asked[0].question, asked[0].text], [QUESTIONS[3], 'Draft 3']);
  assert.match(root().textContent, /No incident named/);
  assert.equal(box.value, 'Draft 3', 'nothing is typed by the review itself');
  box.value = 'Draft 3, edited by hand';   // the person kept typing: the old review must not overwrite it
  press('Use this version');
  assert.equal(box.value, 'Draft 3, edited by hand');
  assert.match(root().textContent, /review it again/);
  press('Review my answer');
  await new Promise((resolve) => setTimeout(resolve, 100));
  press('Use this version');
  assert.equal(box.value, 'Improved text', 'the press applies it');
  assert.equal(box.hasAttribute('data-jobpilotto-draft'), false, 'what the person chose is no longer an unread draft');
  close();
});

test('reminders on a written box are listed beside it, never in it (owner, 27 Oct 2026)', { skip: !JSDOM }, async () => {
  const html = FORM('').replace('<textarea id="q3" required data-jobpilotto-category="written" >Draft 3</textarea>',
    `<textarea id="q3" required data-jobpilotto-category="written" data-jobpilotto-remind='["which incident","its root cause"]'></textarea>`);
  assert.ok(html.includes('data-jobpilotto-remind'), 'the fixture placed the reminders');
  const { window, close } = await panel(html);
  const root = hostOf(window, 'q3').shadowRoot;
  assert.deepEqual([...root.querySelectorAll('.add li')].map((li) => li.textContent), ['which incident', 'its root cause']);
  assert.equal(window.document.getElementById('q3').value, '');
  close();
});
