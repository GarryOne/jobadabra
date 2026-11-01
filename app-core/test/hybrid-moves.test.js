// The hybrid fill's three control moves (owner, 26 Oct 2026; widget zoo chips-no-aria-1, collapsed-section-1, custom-select-1, radio-trusted-only-1): a group named only by a
// label link is READ, a choice a scripted click did not take is pressed again for real (the page says where, the worker presses through the debugger), and a closed section
// whose body sits hidden right after its head is opened, then closed again when nothing to fill appeared. Control mechanics only: the answer is the fill's own.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadJsdom, openPage } from './helpers/page.js';
import { openClosedSections } from '../../extension/sections.js';
import { pressNotTakenForReal } from '../../extension/press-real.js';

const JSDOM = await loadJsdom();
const NAMES = `<label for="first">First name</label> <input id="first" type="text">
<label for="last">Last name</label> <input id="last" type="text">`;
const trustedClick = (window, el) => { const event = new window.MouseEvent('click', { bubbles: true }); event.__jpTrusted = true; el.dispatchEvent(event); };
const trustedDown = (window, el) => { const event = new window.MouseEvent('mousedown', { bubbles: true, cancelable: true }); event.__jpTrusted = true; el.dispatchEvent(event); };
const fill = (window, answers) => window.__jobPilottoExtensionFill(answers, {}, null, '', false);

const CHIPS = `<form>${NAMES}<label id="model-label">Work model</label>
<div class="chips" aria-labelledby="model-label"><span class="chip" data-v="office" tabindex="0">Office</span><span class="chip" data-v="hybrid" tabindex="0">Hybrid</span><span class="chip" data-v="remote" tabindex="0">Remote</span></div></form>`;
const wireChips = (window) => { for (const chip of window.document.querySelectorAll('.chip')) chip.addEventListener('click', () => chip.classList.toggle('is-on')); };

test('move 1: a group of choices named only by aria-labelledby (no role, no aria state) is read as one question with its options', { skip: !JSDOM }, async () => {
  const window = openPage(JSDOM, CHIPS);
  const fields = await window.__jobPilottoDescribeForm();
  const model = fields.find((field) => field.label === 'Work model');
  assert.ok(model, `the group is a field: ${JSON.stringify(fields.map((f) => f.label))}`);
  assert.equal(model.type, 'radio');
  assert.deepEqual(Array.from(model.options), ['Office', 'Hybrid', 'Remote']);
});

test('move 1: its answer is pressed once, and a press that only changes the option\'s class counts as taken (never pressed again, which would undo it)', { skip: !JSDOM }, async () => {
  const window = openPage(JSDOM, CHIPS);
  wireChips(window);
  const field = (await window.__jobPilottoDescribeForm()).find((row) => row.label === 'Work model').field;
  const summary = await fill(window, [{ field, value: 'Remote', source: 'kit' }]);
  assert.ok(window.document.querySelector('.chip.is-on[data-v=remote]'), 'Remote is on');
  assert.equal(window.document.querySelectorAll('.chip.is-on').length, 1);
  assert.equal(Array.from(summary.trace).find((row) => row.label === 'Work model')?.outcome, 'filled');
});

test('move 1 floor: a list of links, or a group holding a text box, named the same way is no question', { skip: !JSDOM }, async () => {
  const window = openPage(JSDOM, `<form>${NAMES}<span id="more">More</span><div aria-labelledby="more"><a href="/a" tabindex="0">One</a><a href="/b" tabindex="0">Two</a></div>
    <span id="mix">Mixed</span><div aria-labelledby="mix"><span tabindex="0">A</span><span tabindex="0">B</span><input id="other"></div></form>`);
  const labels = (await window.__jobPilottoDescribeForm()).map((row) => row.label);
  assert.ok(!labels.includes('More') && !labels.includes('Mixed'), JSON.stringify(labels));
});

const RADIOS = `<form>${NAMES}<label id="reloc-label">Are you willing to relocate?</label>
<div role="radiogroup" aria-labelledby="reloc-label"><div role="radio" aria-checked="false" tabindex="0" data-v="yes">Yes</div><div role="radio" aria-checked="false" tabindex="0" data-v="no">No</div></div></form>`;
const wireTrustedRadios = (window) => { for (const r of window.document.querySelectorAll('[role=radio]')) r.addEventListener('click', (e) => { if (!e.isTrusted) return; for (const o of r.parentElement.children) o.setAttribute('aria-checked', 'false'); r.setAttribute('aria-checked', 'true'); }); };

test('move 2: a radio group that ignores a scripted click lists its answer\'s option as a spot to press for real, then reads as taken', { skip: !JSDOM }, async () => {
  const window = openPage(JSDOM, RADIOS);
  wireTrustedRadios(window);
  const field = (await window.__jobPilottoDescribeForm()).find((row) => row.label === 'Are you willing to relocate?').field;
  await fill(window, [{ field, value: 'No', source: 'kit' }]);
  const no = window.document.querySelector('[data-v=no]');
  assert.equal(no.getAttribute('aria-checked'), 'false', 'the scripted press did not take');
  const spots = Array.from(window.__jobPilottoPressSpots());
  assert.deepEqual(spots.map(({ field: f, step }) => ({ f, step })), [{ f: field, step: 'option' }]);
  assert.ok(Number.isFinite(spots[0].x) && Number.isFinite(spots[0].y));
  trustedClick(window, no);   // what the worker's debugger click does at that spot
  assert.equal(window.__jobPilottoPressedNow(field), true);
  assert.deepEqual(Array.from(window.__jobPilottoPressSpots()), [], 'taken: never pressed again');
});

const MENU = `<form>${NAMES}<label id="lang-label">Preferred language</label>
<div class="select" role="combobox" aria-labelledby="lang-label" aria-expanded="false" aria-haspopup="listbox" tabindex="0"><span class="select-value">Select...</span></div>
<ul class="menu" role="listbox" hidden></ul><input type="hidden" id="lang" name="lang"></form>`;
const wireMenu = (window) => {
  const doc = window.document, box = doc.querySelector('.select'), menu = doc.querySelector('.menu');
  box.addEventListener('mousedown', (e) => { if (!e.isTrusted) return; menu.innerHTML = ['English', 'German', 'French'].map((t) => `<li role="option">${t}</li>`).join(''); menu.hidden = false; });
  menu.addEventListener('mousedown', (e) => { const li = e.target.closest('[role=option]'); if (!li) return; doc.getElementById('lang').value = li.textContent; box.querySelector('.select-value').textContent = li.textContent; menu.hidden = true; });
};

test('move 1: a custom dropdown named by aria-labelledby in a form with other boxes is read as its question', { skip: !JSDOM }, async () => {
  const window = openPage(JSDOM, MENU);
  const row = (await window.__jobPilottoDescribeForm()).find((item) => item.label === 'Preferred language');
  assert.ok(row, 'read');
  assert.equal(row.type, 'select');
});

test('move 2: a custom dropdown that opens only on a real press: the opener is the spot, then its answer\'s option, then it reads as taken', { skip: !JSDOM }, async () => {
  const window = openPage(JSDOM, MENU);
  wireMenu(window);
  const field = (await window.__jobPilottoDescribeForm()).find((item) => item.label === 'Preferred language').field;
  await fill(window, [{ field, value: 'German', source: 'kit' }]);
  assert.equal(window.document.getElementById('lang').value, '', 'the scripted press did not open it');
  const [spot] = Array.from(window.__jobPilottoPressSpots());
  assert.equal(spot?.step, 'opener');
  assert.equal(window.__jobPilottoPressOptionSpot(field), null, 'nothing to pick before the list opens');
  trustedDown(window, window.document.querySelector('.select'));
  assert.ok(window.__jobPilottoPressOptionSpot(field), 'the answer\'s option, once the list is open');
  trustedDown(window, [...window.document.querySelectorAll('[role=option]')].find((li) => li.textContent === 'German'));
  assert.equal(window.__jobPilottoPressedNow(field), true);
  assert.equal(window.document.getElementById('lang').value, 'German');
});

test('move 2, the worker: presses each spot for real (the opener, then the option it is shown), checks the press floor first, counts what took', async () => {
  const calls = [];
  const answers = {
    spots: [{ field: 'menu', step: 'opener', x: 10, y: 20 }, { field: 'aria:g1', step: 'option', x: 30, y: 40 }],
    option: { x: 11, y: 60 },
  };
  const page = async (func, args = []) => {
    const source = String(func);
    if (source.includes('__jobPilottoPressSpots')) return answers.spots;
    if (source.includes('markAt')) { calls.push(`mark ${args.join(',')}`); return true; }
    if (source.includes('__jobPilottoPressOptionSpot')) return answers.option;
    if (source.includes('__jobPilottoPressedNow')) return args[0] === 'menu';
    return null;
  };
  const mouse = async (x, y) => { calls.push(`press ${x},${y}`); };
  const result = await pressNotTakenForReal({ page, mouse, wait: async () => {} });
  assert.deepEqual(result, { tried: 2, taken: 1 });
  assert.deepEqual(calls, ['mark 10,20', 'press 10,20', 'mark 11,60', 'press 11,60', 'mark 30,40', 'press 30,40']);
});

test('move 2, the worker: a point the press floor refuses (a submit drawn there) is never pressed', async () => {
  const calls = [];
  const page = async (func) => { const source = String(func); if (source.includes('__jobPilottoPressSpots')) return [{ field: 'aria:g1', step: 'option', x: 1, y: 2 }]; if (source.includes('markAt')) return false; return false; };
  const result = await pressNotTakenForReal({ page, mouse: async (x, y) => calls.push(`${x},${y}`), wait: async () => {} });
  assert.deepEqual(calls, []);
  assert.deepEqual(result, { tried: 1, taken: 0 });
});

const SECTION = `<form>${NAMES}<section class="acc"><button type="button" class="acc-head" aria-expanded="false">Skills</button><div class="acc-body" hidden></div></section>
  <button type="button" id="tip" aria-expanded="false">Tip</button><div id="tip-body" hidden><p>Only words here</p></div></form>`;
const WIRE_SECTION = `for (const head of document.querySelectorAll('[aria-expanded]')) head.addEventListener('click', () => { const open = head.getAttribute('aria-expanded') !== 'true';
  head.setAttribute('aria-expanded', String(open)); head.nextElementSibling.hidden = !open;
  if (open && head.classList.contains('acc-head') && !head.nextElementSibling.children.length) head.nextElementSibling.innerHTML = '<label for="skill">Main programming language</label><input id="skill">'; });`;

test('move 3: a closed head with its body hidden right after it (no heading, no aria-controls) is opened; one that showed nothing to fill is closed again', { skip: !JSDOM }, () => {
  const window = openPage(JSDOM, SECTION);
  window.eval(WIRE_SECTION);
  const run = () => window.eval(`(${openClosedSections.toString()})()`);
  assert.equal(run(), 2, 'both heads look like disclosures');
  assert.ok(window.document.getElementById('skill'), 'the section drew its question');
  run();   // the next round looks again
  assert.equal(window.document.querySelector('.acc-head').getAttribute('aria-expanded'), 'true', 'kept open: it holds a box');
  assert.equal(window.document.getElementById('tip').getAttribute('aria-expanded'), 'false', 'closed again: nothing to fill appeared');
  assert.equal(run(), 0, 'each head once');
});
