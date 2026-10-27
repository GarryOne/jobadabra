/* global document, location, window, chrome, innerWidth, getComputedStyle, performance */
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
  // Why-changed (27 Oct 2026, owner: one state, changed only on a verdict): a step is the worker saying the run is on (apply-state.js: `working`), an empty one its end (`done`), exactly as background.js progress() does;
  // the page draws what it is told. `verdict(state)` pushes any other state the way the worker does.
  const verdict = state => worker.evaluate(async word => { const [tab] = await chrome.tabs.query({url: 'https://jobs.example.test/*'}); return chrome.tabs.sendMessage(tab.id, {type: 'applyState', state: word}); }, state);
  const step = async text => { await verdict(text ? 'working' : 'done'); return worker.evaluate(async words => { const [tab] = await chrome.tabs.query({url: 'https://jobs.example.test/*'}); return chrome.tabs.sendMessage(tab.id, {type: 'panelStep', text: words}); }, text); };
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
  return {app, step, verdict, overlay, host, clickInput, worker, look, lookIs, mark};
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

// Why-changed: a page change inside a run is dimmed at its commit now (fill-overlay-run.test.mjs, #2221): this one ends the run first, and a page change after the run's end leaves no overlay.
test('a navigation after the run leaves no overlay', async () => {
  const t = await open();
  try {
    await fillOver(t);
    await t.step('Filling Full name…');
    await t.app.page.waitForFunction(() => !!document.getElementById('jobpilotto-fill-overlay'), null, {timeout: 5000});
    await t.worker.evaluate(async () => { const [tab] = await chrome.tabs.query({url: 'https://jobs.example.test/*'}); return chrome.tabs.sendMessage(tab.id, {type: 'panelStep', text: ''}); });
    await t.app.page.goto('https://jobs.example.test/next');
    assert.equal(await t.overlay(), false);
  } finally { await t.app.close(); }
});

test('reading or routing a page covers it too, says it once in the step row, and lifts when the page is a form', async () => {
  const t = await open();
  try {
    await t.step('');
    await t.app.page.waitForFunction(() => !document.getElementById('jobpilotto-fill-overlay'), null, {timeout: 5000});
    await t.verdict('working');   // Why-changed (27 Oct 2026): a page mark only words the step; the worker's state decides whether the page is dimmed
    await t.app.page.evaluate(() => document.documentElement.setAttribute('data-jobpilotto-page', 'reading'));
    await t.app.page.waitForFunction(() => !!document.getElementById('jobpilotto-fill-overlay'), null, {timeout: 8000}).catch(() => assert.fail('no overlay while the page is being read'));
    await t.app.page.waitForFunction(() => /Reading this page/.test(document.getElementById('jobpilotto-review-host')?.shadowRoot?.querySelector('.fill .label')?.textContent || ''), null, {timeout: 8000});
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
    await t.app.page.waitForTimeout(600);
    assert.equal(await t.overlay(), true, 'a page mark moving on never lifts the dim (Why-changed, 27 Oct 2026: only the worker\'s verdict does)');
    await t.verdict('done');
    await t.app.page.waitForFunction(() => !document.getElementById('jobpilotto-fill-overlay'), null, {timeout: 8000}).catch(() => assert.fail('the overlay stayed after the worker\'s verdict'));
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
      await t.verdict('working');
      await t.mark(page);
      await t.lookIs({dim: true, centred: true}, `page mark "${page}"`);
      await t.mark('form');
      await t.verdict('done');   // Why-changed (27 Oct 2026): the page mark moving on no longer ends the look, the worker's verdict does
      await t.lookIs({dim: false, centred: false}, `after page mark "${page}"`);
    }
  } finally { await t.app.close(); }
});

test('every end of a working state takes the dim and the centring away together, never one of them', async () => {
  const t = await open();
  const ends = [
    ['done', () => t.step('')],
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
    await t.lookIs({dim: true, centred: true}, 'before the wipe');
    await t.app.page.evaluate(() => { document.getElementById('jobpilotto-fill-overlay')?.remove(); document.getElementById('jobpilotto-review-host')?.remove(); });   // Why-changed (27 Oct 2026): a layer and panel the page deletes are put back, the state stays
    await t.app.page.waitForTimeout(300);
    await t.lookIs({dim: true, centred: true}, 'a page that deletes the layer and the panel gets them back');
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

// The fill's own first run on the page (its mark) ends before a test drives its own steps: its end would cut into them.
const fillOver = t => t.app.page.waitForFunction(() => /"state":"(done|error|no-form|account)"/.test(document.documentElement.dataset.jobpilottoFill || ''), null, {timeout: 30000}).catch(() => {});
// The look, sampled in the page every 16 ms (a frame) from now on: what the person sees, including a flash between two calls of the test.
const sampleLook = t => t.app.page.evaluate(() => { window.__looks = []; window.__sampler = setInterval(() => { const h = document.getElementById('jobpilotto-review-host');
  window.__looks.push({dim: !!document.getElementById('jobpilotto-fill-overlay'), centred: !!h && /translate/.test(h.style.cssText), at: performance.now()}); }, 16); });
const sampled = t => t.app.page.evaluate(() => { clearInterval(window.__sampler); return window.__looks; });

// Owner, 27 Oct 2026: "there are flashes (very short moments) when the extension panel moves from center to bottom right, and removes the background, then comes back again". Causes: the page's
// mark moving on mid-fill ended the whole step, and a step's end with the next one a moment later dropped the look in between.
test('back-to-back steps keep the dim and the centring at every frame: the mark moving on mid-fill, an end with the next step a moment later', async () => {
  const t = await open();
  try {
    await fillOver(t);
    await t.step('Reading the form…');
    await t.lookIs({dim: true, centred: true}, 'the first step');
    await sampleLook(t);
    await t.mark('reading');   // the worker reads the page under its own step (fill-flow.js "Reading this page…" + the mark)
    await t.app.page.waitForTimeout(300);
    await t.step('Filling the form…');
    await t.mark('form');   // the page is judged a form: the mark's row ends, the fill's own goes on
    await t.app.page.waitForTimeout(400);
    // Why-changed (27 Oct 2026, owner: one verdict at the real end, nothing pending): "one fill ends, the next starts a moment later" is no longer a gap the page bridges with a timer; a run has no end between its steps.
    await t.step('Choosing the drop-down answers…');
    await t.app.page.waitForTimeout(300);
    await t.step('Uploading your CV…');
    await t.app.page.waitForTimeout(300);
    const looks = await sampled(t);
    assert.ok(looks.length >= 40, `positive control: the look was sampled every frame (${looks.length} samples)`);
    const broken = looks.filter(look => !look.dim || !look.centred);
    assert.equal(broken.length, 0, `the look broke for ${broken.length} frame(s) between steps, first at ${Math.round(broken[0]?.at - looks[0].at)} ms: ${JSON.stringify(broken.slice(0, 3))}`);
    await t.step('');
    await t.lookIs({dim: false, centred: false, busy: false}, 'the last step ended: the look goes within a moment');
  } finally { await t.app.close(); }
});

// Owner, 27 Oct 2026: "at the time the webpage loads, can we instantly show the overlay dark/glowing background? Right now there is a 0.5 second until it appears".
test('a page the app opened to fill is dimmed at load: the dim is on 50 ms after DOMContentLoaded, and the panel takes it over centred', async () => {
  const t = await open();
  try {
    await fillOver(t);
    // Like most application pages, the form is drawn by the page's script a moment after load (an empty shell first).
    const LATE = `<!doctype html><title>Apply</title><body><div id="app">Loading…</div><script>setTimeout(() => { document.getElementById('app').innerHTML = ${JSON.stringify(FORM.replace(/^<!doctype html><title>[^<]*<\/title>/, ''))}; }, 1200);</script>`;
    await t.app.context.route('https://jobs.example.test/late**', route => route.fulfill({status: 200, contentType: 'text/html', body: LATE}));
    await t.app.page.addInitScript(() => document.addEventListener('DOMContentLoaded', () => { window.__dims = []; for (const ms of [50, 400, 900]) setTimeout(() => window.__dims.push(!!document.getElementById('jobpilotto-fill-overlay')), ms); }));
    await t.app.page.goto('https://jobs.example.test/late#jobpilotto-fill');   // a fresh document with the mark, as the app opens it
    await t.app.page.waitForFunction(() => window.__dims?.length === 3, null, {timeout: 10000});
    assert.deepEqual(await t.app.page.evaluate(() => window.__dims), [true, true, true], 'the dim at 50, 400 and 900 ms after DOMContentLoaded, before the form is drawn');
    await t.lookIs({dim: true, centred: true}, 'the panel takes the early dim over, centred');
    assert.equal(await t.app.page.evaluate(() => document.querySelectorAll('#jobpilotto-fill-overlay').length), 1, 'one dim layer, the early one and the panel\'s are the same');
  } finally { await t.app.close(); }
});

test('a page opened without the fill mark is never dimmed at load', async () => {
  const t = await open();
  try {
    await fillOver(t);
    const page = await t.app.context.newPage();   // a tab the person opened: never the app's (that one is followed to its next pages, rightly)
    await page.addInitScript(() => document.addEventListener('DOMContentLoaded', () => setTimeout(() => { window.__dimAtLoad = !!document.getElementById('jobpilotto-fill-overlay'); }, 50)));
    await page.goto('https://jobs.example.test/apply?other=1');
    await page.waitForFunction(() => window.__dimAtLoad !== undefined, null, {timeout: 10000});
    await page.waitForTimeout(1500);
    assert.deepEqual(await page.evaluate(() => ({atLoad: window.__dimAtLoad, later: !!document.getElementById('jobpilotto-fill-overlay')})), {atLoad: false, later: false}, 'a page the app did not open got the dim');
  } finally { await t.app.close(); }
});

// Owner, 27 Oct 2026: "this should not be 2 rows. It's ugly, make it look nicer. Align the text better."
test('the working status row is one line: spinner, the step left-aligned and cut with … , Stop at the right; the hint below', async () => {
  const t = await open();
  try {
    await fillOver(t);
    await t.step('Choosing the drop-down answers for the questions this employer asks about your work permit…');
    await t.lookIs({dim: true, centred: true, busy: true}, 'a long step');
    const row = await t.app.page.evaluate(() => {
      const root = document.getElementById('jobpilotto-review-host').shadowRoot, box = el => root.querySelector(el).getBoundingClientRect(), label = root.querySelector('.fill .label');
      const style = getComputedStyle(label);
      return {label: box('.fill .label'), spin: box('.fill .spin'), stop: box('.stop-btn'), hint: box('.step-hint'), lineHeight: parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.3, align: style.textAlign, cut: label.scrollWidth > label.clientWidth, title: root.querySelector('.fill').title};
    });
    assert.ok(row.label.height <= row.lineHeight * 1.5, `the step wraps onto ${Math.round(row.label.height / row.lineHeight)} rows`);
    assert.equal(row.align, 'left', 'the step reads from the left, beside the spinner');
    assert.ok(row.label.left - row.spin.right < 16, 'the step starts right after the spinner');
    assert.ok(row.stop.left >= row.label.right, 'Stop sits at the right of the step');
    assert.ok(Math.abs((row.label.top + row.label.bottom) / 2 - (row.stop.top + row.stop.bottom) / 2) < 6, 'the step and Stop share one row');
    assert.ok(row.hint.top >= row.label.bottom, '"Counts update as new fields appear." stays on its own line below');
    assert.equal(row.cut, true, 'positive control: this step is too long for the row, so it is cut');
    assert.match(row.title, /work permit/, 'the whole step stays readable in its tooltip');
  } finally { await t.app.close(); }
});

// Owner, 27 Oct 2026: "I cannot click on "Tailor CV" even though it looks like a button", "same for the cross", "same for report"; "let's not display at all the buttons ... if they're not
// available during the extension work". The class: every button of the panel, while working, is hidden or does what it says.
test('while working, every panel button is hidden or works: Stop, minimise and the pill act, nothing else is drawn', async () => {
  const t = await open({'/extension/kit': () => ({job: {code: 'J1', title: 'Senior SRE', company: 'Example'}, kit: {answers: []}}),
    '/extension/review': () => ({matched: 's1', session: {id: 's1', url: URL, status: 'input', live: false, kind: 'form', stuck: ''}, watch: [], commands: [], cv: {tailored: false, working: false}})});
  const shown = () => t.app.page.evaluate(() => { const root = document.getElementById('jobpilotto-review-host').shadowRoot;
    return [...root.querySelectorAll('button')].filter(button => button.getClientRects().length > 0).map(button => button.className.split(' ').filter(name => !['primary', 'secondary', 'link', 'is-busy'].includes(name)).join('.')); });
  const hits = selector => t.app.page.evaluate(which => { const host = document.getElementById('jobpilotto-review-host'), b = host.shadowRoot.querySelector(which).getBoundingClientRect();
    return host.shadowRoot.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2)?.closest(which) === host.shadowRoot.querySelector(which); }, selector);
  const press = async selector => { const b = await t.app.page.evaluate(which => { const r = document.getElementById('jobpilotto-review-host').shadowRoot.querySelector(which).getBoundingClientRect(); return {x: r.x + r.width / 2, y: r.y + r.height / 2}; }, selector); await t.app.page.mouse.click(b.x, b.y); };
  try {
    await fillOver(t);
    await t.step('');
    await t.lookIs({dim: false, centred: false, busy: false}, 'control: not working');
    await t.app.page.waitForFunction(() => !document.getElementById('jobpilotto-review-host').shadowRoot.querySelector('.tailor').hidden, null, {timeout: 15000}).catch(() => {});
    const idle = await shown();
    for (const name of ['x', 'min', 'report-btn']) assert.ok(idle.includes(name), `positive control: "${name}" is drawn when the panel is not working (${idle})`);
    await t.step('Filling the form…');
    await t.lookIs({dim: true, centred: true, busy: true}, 'working');
    const working = await shown();
    const ACTS = ['stop-btn', 'min', 'fill'];   // the step row's own label (aria-busy, not a button to press), Stop, minimise
    assert.deepEqual(working.filter(name => !ACTS.includes(name)), [], `buttons drawn while working that cannot act: ${working}`);
    assert.equal(await t.app.page.evaluate(() => document.getElementById('jobpilotto-review-host').shadowRoot.querySelector('.fill').getAttribute('aria-busy')), 'true', 'the step row says it is busy, it is not a button to press');
    for (const name of ['stop-btn', 'min']) assert.ok(await hits(`.${name}`), `"${name}" is drawn but takes no click`);
    await press('.min');
    await t.app.page.waitForFunction(() => document.getElementById('jobpilotto-review-host').shadowRoot.querySelector('.card').hidden, null, {timeout: 3000}).catch(() => assert.fail('minimise did nothing while working'));
    assert.ok(await hits('.pill'), 'minimised while working, the pill takes the click that opens the panel again');
    await press('.pill');
    await t.app.page.waitForFunction(() => !document.getElementById('jobpilotto-review-host').shadowRoot.querySelector('.card').hidden, null, {timeout: 3000}).catch(() => assert.fail('the pill did not open the panel again'));
    await t.step('');
    await t.lookIs({dim: false, centred: false, busy: false}, 'the work ended');
    const after = await shown();
    for (const name of ['x', 'report-btn']) assert.ok(after.includes(name), `"${name}" comes back when the work ends (${after})`);
  } finally { await t.app.close(); }
});

// Owner, 27 Oct 2026: "clicking "check again" does nothing right now" (and "Check form again is not working" the same day). The class: every button on the panel that reads the form again.
const AGAIN = [['.v-again', 'Check again (Your action is needed)'], ['.recheck', 'Check form again (Stopped by you)'], ['.fill', 'Fill again'], ['.anyway', 'Fill anyway']];
test('every "again" button on the panel is one this file presses (a new one fails here until it is tested)', () => {
  const markup = fs.readFileSync(new globalThis.URL('../../../extension/panel-markup.js', import.meta.url), 'utf8');
  const found = [...markup.matchAll(/<button class="([^"]+)"[^>]*>([^<]*)<\/button>/g)].filter(([, , label]) => /again|anyway/i.test(label)).map(([, names]) => `.${names.split(' ').at(-1)}`);
  assert.ok(found.length >= 3, `positive control: the again buttons are read from the markup (${found})`);
  for (const selector of found) assert.ok(AGAIN.some(([tested]) => tested === selector), `${selector} reads the form again but no test presses it`);
});

test('Check again on "Your action is needed" reads the form again and the AI judges it anew: the card goes when the page no longer needs you', async () => {
  let judged = 0, verdict = {answer: 'needs_person', needs: 'the captcha'};   // the AI says the page waits for the person, until they dealt with it
  const t = await open({'/extension/account-judge': body => { if (/"phase":"form"/.test(body)) judged += 1; return verdict; }});
  try {
    await fillOver(t);
    await t.app.page.evaluate(() => document.documentElement.setAttribute('data-jobpilotto-needs', 'the captcha'));
    await t.app.page.waitForFunction(() => !document.getElementById('jobpilotto-review-host').shadowRoot.querySelector('.verify').hidden, null, {timeout: 8000});
    verdict = {answer: 'ready'};   // the person solved it on the page…
    const before = judged;
    const b = await t.app.page.evaluate(() => { const r = document.getElementById('jobpilotto-review-host').shadowRoot.querySelector('.v-again').getBoundingClientRect(); return {x: r.x + r.width / 2, y: r.y + r.height / 2}; });
    await t.app.page.mouse.click(b.x, b.y);   // …then pressed Check again
    for (let waited = 0; waited < 30000 && judged <= before; waited += 250) await t.app.page.waitForTimeout(250);
    assert.ok(judged > before, 'Check again did nothing: the AI was not asked about the page again');
    await t.app.page.waitForFunction(() => !document.documentElement.hasAttribute('data-jobpilotto-needs'), null, {timeout: 15000}).catch(() => assert.fail('the page still says it needs you after the AI said it is ready'));
    await t.app.page.waitForFunction(() => document.getElementById('jobpilotto-review-host').shadowRoot.querySelector('.verify').hidden, null, {timeout: 8000}).catch(() => assert.fail('"Your action is needed" stayed after the AI said the page is ready'));
  } finally { await t.app.close(); }
});

test('Check again keeps "Your action is needed" when the AI still says the page needs the person', async () => {
  const t = await open({'/extension/account-judge': () => ({answer: 'needs_person', needs: 'the captcha'})});
  try {
    await fillOver(t);
    await t.app.page.evaluate(() => document.documentElement.setAttribute('data-jobpilotto-needs', 'the captcha'));
    await t.app.page.waitForFunction(() => !document.getElementById('jobpilotto-review-host').shadowRoot.querySelector('.verify').hidden, null, {timeout: 8000});
    await t.app.page.evaluate(() => document.getElementById('jobpilotto-review-host').shadowRoot.querySelector('.v-again').click());
    await t.lookIs({busy: true}, 'Check again reads the form (the step row shows)');
    await t.lookIs({busy: false}, 'the read is over');
    await t.app.page.waitForFunction(() => !document.getElementById('jobpilotto-review-host').shadowRoot.querySelector('.verify').hidden && document.documentElement.getAttribute('data-jobpilotto-needs') === 'the captcha', null, {timeout: 15000})
      .catch(() => assert.fail('the card went though the AI still says the page needs the person'));
  } finally { await t.app.close(); }
});

// #2221's red apply suite (27 Oct 2026): the fill writes "done" on the page, then does its bookkeeping (reports, notes, dialogs) before it clears its step. The panel kept the dim for
// that time and its 0.7 s gap, and held the person's first click after "done": the multi-step form's Next and the submitter's Submit were swallowed.
test('the fill writing its end on the page frees it at once: the person\'s first click after "done" lands, before the worker clears its step', async () => {
  const t = await open();
  try {
    await t.step('Choosing the drop-down answers…');
    await t.lookIs({dim: true, busy: true}, 'a fill step');
    await t.app.page.evaluate(() => { document.documentElement.dataset.jobpilottoFill = JSON.stringify({state: 'running'}); });
    await t.app.page.waitForTimeout(300);
    await t.lookIs({dim: true, busy: true}, 'a running fill keeps the look');   // positive control: "running" changes nothing
    const before = await t.app.page.evaluate(() => window.hits || 0);
    await t.app.page.evaluate(() => { document.documentElement.dataset.jobpilottoFill = JSON.stringify({state: 'done', filled: 3, left: 0}); });
    await t.verdict('done');   // Why-changed (27 Oct 2026): the worker's writeState says the verdict as it writes the end (fill-flow.js); the page no longer watches the attribute
    await t.app.page.waitForTimeout(50);
    const free = await t.clickInput();
    assert.ok(free.hits > before, `the first click 50 ms after "done" reaches the page (the page shows ${JSON.stringify(await t.look())})`);
    await t.lookIs({dim: false, centred: false, busy: false}, 'the fill is over');
  } finally { await t.app.close(); }
});
