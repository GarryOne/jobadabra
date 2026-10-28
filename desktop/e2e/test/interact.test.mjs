/* global window */
// The interaction probe: it clicks the safe controls of a page and says which ones did nothing, which expandables did not expand, which actions took long with no sign of
// work, and which clicks threw. Run on a fixture page with one of each (a real Chrome, no network).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {chromium} from 'playwright-core';
import {classify, isSafe, probePage} from '../lib/interact.mjs';

const PAGE = `<body><section class="view" data-view="fixture"><h1>Fixture</h1><div id="out"></div>
<button id="dead">Does nothing</button>
<button id="works" onclick="document.getElementById('out').textContent='done'">Works</button>
<button id="expDead" aria-expanded="false" aria-controls="p1">Expand (broken)</button><div id="p1" hidden>one</div>
<button id="expOk" aria-expanded="false" aria-controls="p2" onclick="const p=document.getElementById('p2'); p.hidden=!p.hidden; this.setAttribute('aria-expanded', String(!p.hidden))">Expand (works)</button><div id="p2" hidden>two</div>
<button id="slow" onclick="window.fake(900)">Slow without loading</button>
<button id="slowOk" onclick="this.disabled=true; window.fake(900).then(() => { this.disabled = false; })">Slow with loading</button>
<button id="slowText" onclick="document.getElementById('out').textContent='Updating…'; window.fake(900)">Slow with a status line</button>
<button id="boom" onclick="throw new Error('handler failed')">Throws</button>
<button id="del" onclick="window.clicked = true">Delete everything</button>
<button id="toggle" aria-pressed="false" onclick="this.setAttribute('aria-pressed', String(this.getAttribute('aria-pressed') !== 'true'))">Toggle filter</button>
<div id="row">Target <input id="target" value="10"></div><a href="#" id="focusOnly" onclick="event.preventDefault(); document.getElementById('target').focus()">Edit target</a>
<button id="opener" onclick="window.fake(900, 'openExternal')">Open guide</button>
<button id="stale" onclick="if (window.staleSeen) document.getElementById('out').textContent='stale ok'; window.staleSeen = true">Stale once</button>
<button id="leaves" onclick="window.fake(900, 'openPrivacy')">Open Settings</button>
<div id="bar" hidden><span id="barMsg" class="message"></span></div>
<button id="silent" onclick="const m = document.getElementById('barMsg'); m.className = 'message error'; m.textContent = 'Could not read it'; window.fake(200)">Answers out of sight</button>

</section><script>
window.fakeIpc = []; window.clicked = false;
window.fake = (ms, channel = 'work') => { const rec = {channel, start: Date.now(), ms: null}; window.fakeIpc.push(rec); return new Promise(done => setTimeout(() => { rec.ms = Date.now() - rec.start; done(); }, ms)); };
// The page refreshes itself, slowly, the whole time: never a click's call (#65).
setInterval(() => window.fake(900, 'poll'), 700);
</script></body>`;

const ipcOf = page => ({mark: () => page.evaluate(() => window.fakeIpc.length), since: mark => page.evaluate(count => window.fakeIpc.slice(count), mark)});

test('the safe controls are the ones that cannot delete, send, quit or leave the app', () => {
  for (const text of ['Today', 'Settings', 'Show more', 'History']) assert.equal(isSafe({text}), true, text);
  for (const text of ['Delete everything', 'Remove job', 'Quit', 'Send to Telegram', 'Apply', 'Submit', 'Sign in with Google', 'Open in Notion ↗', 'Run', 'Record interview', 'Replace CV', 'Check for new jobs', 'Refresh', 'Rebuild from CV…']) assert.equal(isSafe({text}), false, text);
  assert.equal(isSafe({text: 'Details', cls: 'danger'}), false);
  assert.equal(isSafe({text: 'Link', href: 'https://example.com/x'}), false, 'an external link leaves the app');
  assert.equal(isSafe({text: 'Read Indeed', wand: true}), false, 'a press that starts AI work (data-wand) spends credit (#2350)');
});

test('classify names each kind of bug and says nothing for a working control', () => {
  const control = {label: 'button#b', text: 'Go', expandable: false};
  assert.equal(classify({view: 'v', control, effects: [], calls: [], errors: []})[0].kind, 'dead-control');
  assert.deepEqual(classify({view: 'v', control, effects: ['text changed'], calls: [], errors: []}), []);
  assert.deepEqual(classify({view: 'v', control, effects: [], calls: [{channel: 'x', ms: 20}], errors: []}), []);
  assert.equal(classify({view: 'v', control: {...control, expandable: true}, effects: ['text changed'], calls: [], errors: []})[0].kind, 'expand-broken', 'something changed but not the expandable');
  assert.equal(classify({view: 'v', control, effects: ['text changed'], calls: [{channel: 'x', ms: 900}], loading: false, errors: []})[0].kind, 'no-loading-state');
  assert.deepEqual(classify({view: 'v', control, effects: ['text changed'], calls: [{channel: 'x', ms: 900}], loading: true, errors: []}), []);
  assert.deepEqual(classify({view: 'v', control: {...control, expandable: true}, effects: ['control removed'], calls: [], errors: []}), [], 'the page drew itself again');
  assert.equal(classify({view: 'v', control, effects: ['x'], calls: [], errors: ['TypeError: nope']})[0].kind, 'console-error');
  assert.equal(classify({view: 'v', control, effects: ['structure changed'], calls: [{channel: 'contactProposals', ms: 168}], errors: []})[0].kind, 'silent-control', 'only hidden parts changed (#409)');
  assert.deepEqual(classify({view: 'v', control, effects: ['structure changed', 'visible structure changed'], calls: [{channel: 'x', ms: 20}], errors: []}), [], 'a visible change is an answer');
});

test('on a page with one of each, the probe flags exactly the broken controls and clicks nothing destructive', async () => {
  const browser = await chromium.launch({channel: 'chrome'});
  try {
    const page = await browser.newPage({viewport: {width: 1000, height: 700}});
    await page.setContent(PAGE);
    const {results, findings, skipped} = await probePage({page, view: 'fixture', ipc: ipcOf(page), settleMs: 1200, idleMs: 1500, reset: () => page.keyboard.press('Escape')});
    const by = kind => findings.filter(item => item.kind === kind).map(item => item.control);
    assert.deepEqual(by('dead-control'), ['Does nothing'], JSON.stringify(findings));
    assert.deepEqual(by('silent-control'), ['Answers out of sight'], 'a press whose only change is hidden (#409)');
    assert.deepEqual(by('expand-broken'), ['Expand (broken)']);
    assert.deepEqual(by('no-loading-state'), ['Slow without loading']);
    assert.deepEqual(by('console-error'), ['Throws']);
    assert.equal(await page.evaluate(() => window.clicked), false, 'the destructive button was left alone');
    assert.ok(results.some(item => item.control === 'Works' && item.effects.length), 'a working control is recorded as working');
    assert.ok(results.every(item => item.control !== 'Delete everything'));
    // The ways a working control can look dead, none of them filed (#81/#82 toggle, #87 focus, #90 outside program, #65 background refresh, a state left by an earlier press).
    for (const name of ['Toggle filter', 'Edit target', 'Open guide', 'Stale once', 'Works']) assert.ok(!findings.some(item => item.control === name), `${name}: ${JSON.stringify(findings.filter(item => item.control === name))}`);
    assert.ok(skipped.includes('Open Settings'), 'system settings are another program: never pressed');
    assert.ok(results.find(item => item.control === 'Does nothing').rechecked, 'a dead control is pressed twice before it is filed');
  } finally { await browser.close(); }
});

test('"Restart" is never pressed by the probe (it relaunches the app: Windows interactions run, 3 Oct 2026)', async () => {
  const {isSafe} = await import('../lib/interact.mjs');
  assert.equal(isSafe({text: 'Restart'}), false);
  assert.equal(isSafe({text: 'Relaunch now'}), false);
  assert.equal(isSafe({text: 'Details'}), true);
});

// #86 / #89: the real ⋯ menu (components.js + the app's CSS) below the fold. A click that scrolls the page itself delivers its scroll event just after the press, and the menu
// closes on any scroll, so the probe saw "More actions" do nothing. The probe now scrolls the control into view and lets it settle first.
// Why (3fc251e, 18 Oct 2026): the menu's styles moved to ui-menu.css; without it the menu opened unstyled and the probe filed it as broken (harness-daily red until 27 Oct).
test('a real ⋯ menu below the fold is opened by the probe, not filed as broken', async () => {
  const http = await import('node:http'), fs = await import('node:fs'), path = await import('node:path');
  const root = new URL('../../renderer/', import.meta.url).pathname;
  const types = {'.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml'};
  const server = http.createServer((req, res) => {
    const url = req.url.split('?')[0];
    if (url === '/t.html') { res.setHeader('content-type', 'text/html'); return res.end(`<link rel="stylesheet" href="/tokens.css"><link rel="stylesheet" href="/components.css"><link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/ui-menu.css"><body style="margin:0"><section class="view" data-view="t"><div style="height:1800px">filler</div><div id="host"></div><div style="height:1200px"></div></section><script type="module">import {moreButton} from '/components.js'; document.getElementById('host').append(moreButton([{label: 'Dismiss', run() {}}], 'More'));</script></body>`); }
    if (url === '/favicon.ico') { res.statusCode = 204; return res.end(); }   // the CI browser asks for it; a 404 would be filed as a console error
    const file = path.join(root, url);
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.statusCode = 404; return res.end(); }
    res.setHeader('content-type', types[path.extname(file)] || 'application/octet-stream'); res.end(fs.readFileSync(file));
  }).listen(0);
  let browser;
  try {
    browser = await chromium.launch({channel: 'chrome'});
    const page = await browser.newPage({viewport: {width: 1024, height: 700}});
    await page.goto(`http://127.0.0.1:${server.address().port}/t.html`);
    await page.waitForSelector('.ui-more');
    const ipc = {mark: async () => 0, since: async () => []};
    const {findings, results} = await probePage({page, view: 't', ipc, scope: '.view[data-view="t"]', settleMs: 800, idleMs: 0});
    assert.deepEqual(findings, [], JSON.stringify(results));
    assert.ok(results.some(item => item.effects.includes('expanded toggled')), 'the menu opened');
  } finally { await browser?.close(); server.close(); }
});

test('every control that restarts the app is never pressed by a probe', async () => {
  // The class: each button whose handler ends in a restart (main.js restartApp: demo in and out, reset, import, the permission restart).
  const fs = await import('node:fs');
  const html = fs.readFileSync(new URL('../../renderer/index.html', import.meta.url), 'utf8');
  const RESTARTS = ['data-look-around', 'id="demo-leave"', 'id="reset-go"', 'id="import-data"', 'id="welcome-import"', 'id="iv-permission-restart"'];
  for (const marker of RESTARTS) {
    const found = [...html.matchAll(new RegExp(`<button[^>]*${marker}[^>]*>([\\s\\S]*?)</button>`, 'g'))];
    assert.ok(found.length, `${marker} is in index.html`);
    for (const [tag, text] of found) {
      const cls = (tag.match(/class="([^"]*)"/) || [])[1] || '';
      assert.equal(isSafe({text: text.replace(/<[^>]+>/g, ' ').trim(), cls}), false, `a probe would press ${marker}: "${text.trim()}"`);
    }
  }
});

test('a press lands on the control the probe vetted, not on whatever carries its old tag after the page drew itself again (wander red on main, 28 Oct 2026)', async () => {
  // "Redraw" draws the section again with an unsafe control where "Third" sat: the tags handed out before the redraw now point at other controls, and a press by
  // tag alone clicked "Look around first (demo data)" in the real wander run, which restarts the app.
  let browser;
  try {
    browser = await chromium.launch({channel: 'chrome'});
    const page = await browser.newPage();
    await page.setContent(`<body><section class="view" data-view="shift"><div id="box"></div><div id="out"></div></section><script>
      window.fakeIpc = []; window.clicked = false; window.pressed = [];
      const draw = names => { box.innerHTML = names.map(name => '<button>' + name + '</button>').join(''); };
      box.onclick = event => {
        const name = event.target.textContent; window.pressed.push(name); out.textContent = name;
        if (name === 'Redraw') draw(['Redraw', 'Second', 'Third', 'Delete everything']);
        if (name === 'Delete everything') window.clicked = true;
      };
      draw(['Redraw', 'Delete everything', 'Second', 'Third']);
    </script></body>`);
    await probePage({page, view: 'shift', ipc: ipcOf(page), settleMs: 400, idleMs: 0, scope: '.view[data-view="shift"]'});
    assert.equal(await page.evaluate(() => window.clicked), false, 'the probe pressed "Delete everything"');
    assert.deepEqual(await page.evaluate(() => window.pressed), ['Redraw', 'Second', 'Third'], 'each vetted control is pressed, in the page as it is now');
  } finally { await browser?.close(); }
});
