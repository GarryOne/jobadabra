/* global document, location, window, chrome, innerWidth */
// While the extension fills, the page is dimmed and the person's clicks, keys and scrolling are held back; the panel comes forward; every way the fill ends takes the overlay away
// (real extension on a fixture form, fake data). The driver's own input passes through a gap flag; the overlay is invisible to hit-tests and reads (pointer-events: none).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {startRealExtension} from '../lib/real-extension.mjs';

const FORM = `<!doctype html><title>Senior Site Reliability Engineer</title><body style="height:3000px"><form><h1>Apply</h1>
<label>Full name <input id="n" name="n" required></label><label>Email <input id="e" name="e" type="email" required></label><label>Phone <input name="p" required></label><label>City <input name="c" required></label></form>
<script>window.hits = 0; addEventListener('click', () => { window.hits += 1; });</script>`;
const URL = 'https://jobs.example.test/apply';

const open = async (answer = {}) => {
  const app = await startRealExtension({extensionDir: process.env.REAL_EXTENSION_DIR || undefined, allowAllSites: true, answer});
  await app.context.route('https://jobs.example.test/**', route => route.fulfill({status: 200, contentType: 'text/html', body: FORM}));
  await app.page.goto(URL);
  await app.page.evaluate(() => { location.hash = 'jobpilotto-fill'; });
  await app.page.waitForFunction(() => document.getElementById('jobpilotto-review-host')?.shadowRoot?.querySelector('.report-btn'), null, {timeout: 20000});
  const worker = app.context.serviceWorkers()[0];
  const step = text => worker.evaluate(async words => { const [tab] = await chrome.tabs.query({url: 'https://jobs.example.test/*'}); return chrome.tabs.sendMessage(tab.id, {type: 'panelStep', text: words}); }, text);
  const overlay = () => app.page.evaluate(() => !!document.getElementById('jobpilotto-fill-overlay'));
  const host = () => app.page.evaluate(() => { const h = document.getElementById('jobpilotto-review-host'); const box = h?.getBoundingClientRect(); return {centred: !!h && /translate/.test(h.style.cssText), right: h?.style.right, x: box && Math.round(box.x + box.width / 2), w: innerWidth}; });
  const clickInput = async () => { await app.page.mouse.click(300, 60); return app.page.evaluate(() => ({hits: window.hits, focus: document.activeElement?.id || ''})); };
  // The working look is ONE state: the dim layer and the centred panel together (owner, 27 Oct 2026). Waits until both are as asked, else says what drifted.
  const look = () => app.page.evaluate(() => { const h = document.getElementById('jobpilotto-review-host'), root = h?.shadowRoot; return {dim: !!document.getElementById('jobpilotto-fill-overlay'), centred: !!h && /translate/.test(h.style.cssText), busy: !!root?.querySelector('.fill.is-busy'), stopped: !!root && !root.querySelector('.stopped').hidden}; });
  const lookIs = async (want, what) => {
    const keys = Object.keys(want);
    await app.page.waitForFunction(([wanted, names]) => { const h = document.getElementById('jobpilotto-review-host'), root = h?.shadowRoot;
      const now = {dim: !!document.getElementById('jobpilotto-fill-overlay'), centred: !!h && /translate/.test(h.style.cssText), busy: !!root?.querySelector('.fill.is-busy'), stopped: !!root && !root.querySelector('.stopped').hidden};
      return names.every(name => now[name] === wanted[name]); }, [want, keys], {timeout: 10000}).catch(async () => assert.fail(`${what}: wanted ${JSON.stringify(want)}, the page shows ${JSON.stringify(await look())}`));
  };
  const mark = page => app.page.evaluate(word => document.documentElement.setAttribute('data-jobpilotto-page', word), page);
  return {app, step, overlay, host, clickInput, worker, look, lookIs, mark};
};

test('a fill step dims the page, holds the person\'s click, key and wheel, and centres the panel', async () => {
  const t = await open();
  try {
    await t.step('');   // the page's own fill mark may have started a first step (the overlay is rightly on then): end it, then the control
    await t.app.page.waitForFunction(() => !document.getElementById('jobpilotto-fill-overlay'), null, {timeout: 5000});
    assert.equal(await t.overlay(), false, 'control: no overlay before a fill');
    const before = await t.app.panel();
    await t.step('Filling Full name…');
    await t.app.page.waitForFunction(() => !!document.getElementById('jobpilotto-fill-overlay'), null, {timeout: 5000}).catch(() => assert.fail('no overlay while a fill step shows'));
    const hit = await t.app.page.evaluate(() => { const el = document.getElementById('n'); const b = el.getBoundingClientRect(); return document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2)?.id; });
    assert.equal(hit, 'n', 'the overlay takes no hit-test: the page reads (elementFromPoint, on-top) see the form, not a layer');
    assert.deepEqual((await t.app.panel()).pill, before.pill, 'the form read is the same with the overlay on');
    const clicked = await t.app.page.evaluate(() => { const b = document.getElementById('n').getBoundingClientRect(); return {x: b.x + 10, y: b.y + 5}; });
    await t.app.page.mouse.click(clicked.x, clicked.y);
    assert.deepEqual(await t.app.page.evaluate(() => ({hits: window.hits, focus: document.activeElement?.id || ''})), {hits: 0, focus: ''}, 'the person\'s click never reaches the page');
    await t.app.page.keyboard.press('Tab');
    assert.equal(await t.app.page.evaluate(() => document.activeElement?.tagName), 'BODY', 'Tab moves nothing');
    await t.app.page.mouse.wheel(0, 800);
    await t.app.page.waitForTimeout(200);
    assert.equal(await t.app.page.evaluate(() => window.scrollY), 0, 'the page does not scroll');
    const spot = await t.host();
    assert.equal(spot.centred, true, 'the panel is centred while filling');
    const under = await t.app.page.evaluate(() => { const h = document.getElementById('jobpilotto-review-host'); const c = h.shadowRoot.querySelector('.card').getBoundingClientRect(); return document.elementFromPoint(c.x + c.width / 2, c.y + c.height / 2)?.id; });
    assert.notEqual(under, 'jobpilotto-review-host', 'the centred panel takes no hit-test: the driver\'s clicks aimed at a field under it reach the field (recorded cases text-state-from-keys-1, menu-choices-worded-differently-2)');
    const wide = await t.app.page.evaluate(() => document.getElementById('jobpilotto-review-host').shadowRoot.querySelector('.card').getBoundingClientRect().width);
    assert.ok(wide <= 380, `the centred panel is the corner's size, not larger (${Math.round(wide)}px wide, the docked card is 372)`);
    // The driver's gap: the worker marks its own input, and it lands.
    await t.worker.evaluate(async () => { const [tab] = await chrome.tabs.query({url: 'https://jobs.example.test/*'}); await chrome.scripting.executeScript({target: {tabId: tab.id}, func: () => document.documentElement.setAttribute('data-jobpilotto-driving', '1')}); });
    await t.app.page.mouse.click(clicked.x, clicked.y);
    assert.equal(await t.app.page.evaluate(() => document.activeElement?.id), 'n', 'during the driver\'s own action the click lands');
  } finally { await t.app.close(); }
});

test('the end of the fill takes the overlay away and puts the panel back at its spot', async () => {
  const t = await open();
  try {
    await t.step('');   // the page's own fill mark may have started a step: end it, then the panel is at its spot
    await t.app.page.waitForFunction(() => !document.getElementById('jobpilotto-fill-overlay'), null, {timeout: 5000});
    const home = await t.host();
    await t.step('Filling Full name…');
    await t.app.page.waitForFunction(() => !!document.getElementById('jobpilotto-fill-overlay'), null, {timeout: 5000});
    await t.step('');
    await t.app.page.waitForFunction(() => !document.getElementById('jobpilotto-fill-overlay'), null, {timeout: 5000}).catch(() => assert.fail('the overlay stayed after the fill ended'));
    const back = await t.host();
    assert.deepEqual({centred: back.centred, right: back.right}, {centred: home.centred, right: home.right}, 'the panel is back where it was');
    const free = await t.clickInput();
    assert.ok(free.hits >= 1, 'the person\'s click reaches the page again');
  } finally { await t.app.close(); }
});

test('Stop (in the panel step row) takes the overlay away and is pressable above it', async () => {
  const t = await open();
  try {
    await t.step('Filling Full name…');
    await t.app.page.waitForFunction(() => !!document.getElementById('jobpilotto-fill-overlay'), null, {timeout: 5000});
    const stop = await t.app.page.evaluate(() => { const b = document.getElementById('jobpilotto-review-host').shadowRoot.querySelector('.stop-btn').getBoundingClientRect(); return {x: b.x + b.width / 2, y: b.y + b.height / 2}; });
    await t.app.page.mouse.click(stop.x, stop.y);   // the panel's own Stop, above the dim layer
    await t.app.page.waitForFunction(() => !document.getElementById('jobpilotto-fill-overlay'), null, {timeout: 8000}).catch(() => assert.fail('Stop did not take the overlay away'));
  } finally { await t.app.close(); }
});

test('a page that needs the person (a captcha left) takes the overlay away', async () => {
  const t = await open();
  try {
    await t.step('Filling Full name…');
    await t.app.page.waitForFunction(() => !!document.getElementById('jobpilotto-fill-overlay'), null, {timeout: 5000});
    await t.app.page.evaluate(() => document.documentElement.setAttribute('data-jobpilotto-needs', 'a captcha'));
    await t.app.page.waitForFunction(() => !document.getElementById('jobpilotto-fill-overlay'), null, {timeout: 15000}).catch(() => assert.fail('"needs you" kept the overlay on: the person could not do the captcha'));
    assert.ok((await t.clickInput()).hits >= 1, 'the person is free to click');
  } finally { await t.app.close(); }
});

test('the app saying stuck after a step ends the working look; a newer step brings it back', async () => {
  let stuck = false;   // the app's word changes mid-way, as it does when the extension hands a page over and then goes on (owner, 27 Oct 2026)
  const t = await open({'/extension/review': () => ({matched: true, session: {id: 's1', status: 'input', live: false, kind: 'form', stuck: stuck ? 'no-form' : ''}})});
  try {
    // The fill mark starts the worker's own fill here; its end ("fill over") would end any step later in this test: wait for it first.
    await t.app.page.waitForFunction(() => /"state":"(done|error|no-form|account)"/.test(document.documentElement.dataset.jobpilottoFill || ''), null, {timeout: 30000}).catch(() => {});
    await t.step('Filling Full name…');
    await t.lookIs({dim: true, centred: true}, 'a fill step');
    stuck = true;
    await t.lookIs({dim: false, centred: false, busy: false}, 'the app says stuck after the step');
    assert.ok((await t.clickInput()).hits >= 1, 'the person is free to click on a stuck page');
    await t.step('Reading this page…');
    await t.lookIs({dim: true, centred: true, busy: true}, 'the extension goes on after the app said stuck: its newer step wins');
    await t.app.page.waitForTimeout(4500);   // two of the panel's syncs (2 s each): the app's older "stuck" must not take the look away again
    await t.lookIs({dim: true, centred: true, busy: true}, 'still working after the panel synced with the app');
  } finally { await t.app.close(); }
});

test('a navigation leaves no overlay', async () => {
  const t = await open();
  try {
    await t.step('Filling Full name…');
    await t.app.page.waitForFunction(() => !!document.getElementById('jobpilotto-fill-overlay'), null, {timeout: 5000});
    await t.app.page.goto('https://jobs.example.test/next');
    assert.equal(await t.overlay(), false);
  } finally { await t.app.close(); }
});

test('reading or routing a page covers it too, says it once in the step row, and lifts when the page is a form', async () => {
  const t = await open();
  try {
    await t.step('');
    await t.app.page.waitForFunction(() => !document.getElementById('jobpilotto-fill-overlay'), null, {timeout: 5000});
    await t.app.page.evaluate(() => document.documentElement.setAttribute('data-jobpilotto-page', 'reading'));
    await t.app.page.waitForFunction(() => !!document.getElementById('jobpilotto-fill-overlay'), null, {timeout: 8000}).catch(() => assert.fail('no overlay while the page is being read'));
    const seen = await t.app.page.evaluate(() => {
      const root = document.getElementById('jobpilotto-review-host').shadowRoot, shown = el => !!el && el.getClientRects().length > 0;   // drawn (an ancestor with display:none draws nothing)
      const count = [...root.querySelectorAll('.progress-line b, .step-line, .fill .label, .pill b')].filter(el => shown(el) && /Reading this page/.test(el.textContent)).length;
      return {count, which: [...root.querySelectorAll('.progress-line b, .step-line, .fill .label, .pill b')].filter(el => shown(el) && /Reading this page/.test(el.textContent)).map(el => el.className + '/' + el.tagName), hint: root.querySelector('.step-hint')?.textContent, pill: shown(root.querySelector('.pill'))};
    });
    assert.equal(seen.count, 1, 'Reading this page shows once while the layer is on: ' + seen.which);
    assert.equal(seen.pill, false, 'the pill is hidden while the panel is centred');
    assert.doesNotMatch(seen.hint, /Counts update/, 'reading has its own sub-line');
    assert.equal((await t.host()).centred, true);
    await t.app.page.evaluate(() => document.documentElement.setAttribute('data-jobpilotto-page', 'form'));
    await t.app.page.waitForFunction(() => !document.getElementById('jobpilotto-fill-overlay'), null, {timeout: 8000}).catch(() => assert.fail('the overlay stayed after the page became a form'));
    assert.equal((await t.host()).centred, false, 'the panel is back in its corner');
  } finally { await t.app.close(); }
});

// The class (owner, 27 Oct 2026: "everytime when the extension is working... it should be centered and there should be dark/glowing background"; "that dark/glowing background
// sometimes disappears"): every working state the panel draws dims AND centres; every end does neither. A new working mark in review.js joins this loop by itself.
const WORKING_MARKS = JSON.parse(fs.readFileSync(new globalThis.URL('../../../extension/review.js', import.meta.url), 'utf8').match(/WORKING_MARKS = (\[[^\]]*\])/)[1].replace(/'/g, '"'));
const FILL_STEPS = ['Reading the form…', 'Filling the form…', 'Choosing the drop-down answers…', 'Uploading your CV…', 'Checking the form…'];

test('every working state dims the page and centres the panel, together; its end does neither', async () => {
  assert.ok(WORKING_MARKS.length >= 5, 'positive control: the working page marks are read from review.js');
  const t = await open();
  try {
    await t.step('');
    await t.lookIs({dim: false, centred: false}, 'control: nothing works yet');
    for (const words of FILL_STEPS) {
      await t.step(words);
      await t.lookIs({dim: true, centred: true}, `fill step "${words}"`);
      await t.step('');
      await t.lookIs({dim: false, centred: false}, `after fill step "${words}"`);
    }
    for (const page of WORKING_MARKS) {
      await t.mark(page);
      await t.lookIs({dim: true, centred: true}, `page mark "${page}"`);
      await t.mark('form');
      await t.lookIs({dim: false, centred: false}, `after page mark "${page}"`);
    }
  } finally { await t.app.close(); }
});

test('every end of a working state takes the dim and the centring away together, never one of them', async () => {
  const t = await open();
  const ends = [
    ['done', () => t.step('')],
    ['the layer removed from outside (a settle, Stop on another path)', () => t.app.page.evaluate(() => document.getElementById('jobpilotto-fill-overlay')?.remove())],
    ['needs you', () => t.app.page.evaluate(() => document.documentElement.setAttribute('data-jobpilotto-needs', 'a captcha'))],
  ];
  try {
    for (const [name, end] of ends) {
      await t.app.page.evaluate(() => document.documentElement.removeAttribute('data-jobpilotto-needs'));
      await t.step('Filling Full name…');
      await t.lookIs({dim: true, centred: true, busy: true}, `before "${name}"`);
      await end();
      await t.lookIs({dim: false, centred: false, busy: false}, `end "${name}"`);
    }
    await t.app.page.evaluate(() => document.documentElement.removeAttribute('data-jobpilotto-needs'));
    await t.step('Filling Full name…');
    await t.lookIs({dim: true, centred: true}, 'before the close');
    await t.app.page.evaluate(() => document.getElementById('jobpilotto-review-host').shadowRoot.querySelector('.x').click());
    await t.lookIs({dim: false, centred: false}, 'end "closed"');
    await t.step('Filling Email…');
    await t.app.page.waitForTimeout(500);
    assert.deepEqual((({dim, centred}) => ({dim, centred}))(await t.look()), {dim: false, centred: false}, 'a step on a closed panel brings neither back (#1558)');
  } finally { await t.app.close(); }
});

// Stop, then the person starts again on the same page (owner, 27 Oct 2026: "I stopped the extension, then said fill again and then it still stays stopped"; ""Check form again" is
// not working"): every restart path clears the page's Stop, the panel's "Stopped by you" and tells the app, and the fill runs instead of answering "Stopped by you." at once.
test('after Stop, every restart on the page works again: Check form again, Fill again, Fill anyway, the popup\'s Apply on this page', async () => {
  const t = await open();
  const press = selector => () => t.app.page.evaluate(which => document.getElementById('jobpilotto-review-host').shadowRoot.querySelector(which).click(), selector);
  const popupApply = async () => {
    const id = new globalThis.URL(t.worker.url()).host;
    const popup = await t.app.context.newPage();
    await popup.goto(`chrome-extension://${id}/popup.html`);
    const answer = await popup.evaluate(async () => { const [tab] = await chrome.tabs.query({url: 'https://jobs.example.test/*'}); return chrome.runtime.sendMessage({type: 'applyHere', tabId: tab.id}); });
    await popup.close();
    assert.equal(answer?.ok, true, `the popup's Apply on this page is refused after Stop: ${answer?.why}`);
  };
  const paths = [['Check form again', press('.recheck')], ['Fill again', press('.fill')], ['Fill anyway', press('.anyway')], ['the popup\'s Apply on this page', popupApply]];
  try {
    for (const [name, restart] of paths) {
      await t.app.page.evaluate(() => { for (const box of document.querySelectorAll('input')) box.value = ''; document.querySelector('input').dispatchEvent(new Event('input', {bubbles: true})); });   // the last round filled the form: empty again, so Fill and Stop show
      await t.app.page.waitForTimeout(600);
      await t.step('Reading this page…');
      await t.lookIs({dim: true, centred: true, busy: true}, `working before Stop (${name})`);
      const stop = await t.app.page.evaluate(() => { const b = document.getElementById('jobpilotto-review-host').shadowRoot.querySelector('.stop-btn').getBoundingClientRect(); return {x: b.x + b.width / 2, y: b.y + b.height / 2}; });
      await t.app.page.mouse.click(stop.x, stop.y);
      await t.lookIs({dim: false, centred: false, busy: false, stopped: true}, `Stop pressed (${name})`);
      assert.equal(await t.app.page.evaluate(() => document.getElementById('jobpilotto-note')), null, 'no second box beside the panel: the panel says it is stopped');
      const sent = t.app.requests.length;
      await restart();
      await t.app.page.waitForFunction(() => !window.__jobPilottoStopped, null, {timeout: 10000}).catch(() => assert.fail(`${name}: the page kept its Stop`));
      await t.lookIs({stopped: false}, `${name}: the panel leaves "Stopped by you"`);
      await t.app.page.waitForFunction(() => !document.getElementById('jobpilotto-review-host').shadowRoot.querySelector('.fill.is-busy'), null, {timeout: 60000}).catch(() => {});
      assert.equal((await t.look()).stopped, false, `${name}: the fill ran instead of answering "Stopped by you." at once`);
      assert.ok(t.app.requests.slice(sent).some(request => request.route === '/extension/event' && /"type":"started"/.test(request.body)), `${name}: the app is told, so its session leaves "Stopped"`);
    }
  } finally { await t.app.close(); }
});
