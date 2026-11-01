// The Stop press waits for a pressable Stop (the panel's `.stop-btn`, or the pill's `.pill-stop` when minimised), then for the panel to show the fill stopped, and a Stop that does not halt it fails with the panel's own state.
// Why (31 Oct 2026, a8; PR #2746's harness run 41250657527): "Stop halts a fill with the panel open" failed with only "Stop did not halt the fill". A fake panel in a real Chromium plays
// a Stop that is disabled at first, one that halts late, one that never halts, one that is never pressable and the minimised pill.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {chromium} from 'playwright-core';
import {isStopped, pressBudget, pressStop, readPanel} from '../../lib/panel-stop.mjs';
import {POLL_CAP_MS} from '../../lib/wait-on-state.mjs';

// mode: 'decoy' (a control of the page itself has the class `stop-btn` too), 'late' (Stop disabled 400 ms, halts 100 ms after the press),'slow' (halts 700 ms after the press), 'never' (Stopping… and nothing else),
// 'hidden' (no Stop is ever shown), 'pill' (the card is minimised, the pill's Stop halts at once), 'dim' (the step row ends and the dim over the page stays),
// 'nocard' (the step row ends and the panel never says "Stopped by you").
const PAGE = mode => `<body><div id="jobadabra-review-host"></div><script>
  const root = document.getElementById('jobadabra-review-host').attachShadow({mode: 'open'});
  const mode = ${JSON.stringify(mode)};
  root.innerHTML = '<div class="jp working"><div class="card"' + (mode === 'pill' ? ' hidden' : '') + '><div class="stopped" hidden>Stopped by you</div>'
    + '<div class="fill-box"><button class="primary fill is-busy">Choosing dropdown answers…</button>'
    + '<button class="stop-btn" type="button" title="Stops everything"' + (mode === 'late' ? ' disabled' : '') + (mode === 'hidden' ? ' style="display:none"' : '') + (mode === 'pill' ? ' style="display:none"' : '') + '>Stop</button></div></div>'
    + '<button class="pill-stop" type="button" title="Stops everything" style="display:' + (mode === 'pill' ? 'block' : 'none') + '">Stop</button></div>';
  const halted = () => { const fill = root.querySelector('.fill'); fill.classList.remove('is-busy'); fill.textContent = 'Fill again'; if (mode !== 'nocard') root.querySelector('.stopped').hidden = false; if (mode === 'pill') root.querySelector('.card').hidden = true;
    if (mode === 'dim') for (const button of root.querySelectorAll('.stop-btn, .pill-stop')) { button.disabled = false; button.textContent = 'Stop'; } };   // the product's stoppedHere puts the labels back to Stop (extension/review.js) while the page's dim lifts later
  if (mode === 'decoy') document.body.append(Object.assign(document.createElement('button'), {className: 'stop-btn', textContent: 'Stop'}));   // the job form's own control with the same class
  if (mode === 'dim') document.body.append(Object.assign(document.createElement('div'), {id: 'jobadabra-fill-overlay'}));
  if (mode === 'late') setTimeout(() => { root.querySelector('.stop-btn').disabled = false; }, 400);
  for (const button of root.querySelectorAll('.stop-btn, .pill-stop')) button.onclick = event => {
    if (!event.isTrusted) return;
    button.disabled = true; button.textContent = 'Stopping…';
    if (mode === 'never') return;
    setTimeout(halted, mode === 'slow' ? 700 : mode === 'pill' ? 0 : 100);
  };
</script></body>`;

// Why (1 Nov 2026, a8): a limit here is a hang guard, never a budget under test. The slowest positive case took 1245 ms on CI (harness run 41265375751, browser launch included; the press itself < 800 ms), so 5000 ms is 4x; a case that must
// FAIL on a stage it can only reach once the earlier stages passed gets the same guard, so a slow click cannot end the wait before that stage is read. The budget arithmetic is tested on an injected clock (test/filling/panel-stop-verdict.test.mjs).
const HANG_GUARD_MS = 5000;

async function withPanel(mode, run) {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(PAGE(mode));
    return await run(page);
  } finally { await browser.close(); }
}

test('a Stop that is disabled at first is pressed once it is enabled, and the panel is waited on until it shows stopped', async () => {
  await withPanel('late', async page => {
    const {state} = await pressStop(page, {capMs: HANG_GUARD_MS});
    assert.equal(isStopped(state), true);
    assert.deepEqual(state.stopButtons, ['Stopping… (disabled)', 'Stop'], 'it pressed the open panel\'s Stop, not the hidden pill');
  });
});

test('a panel that halts the fill late is waited for, not judged once right after the press', async () => {
  await withPanel('slow', async page => {
    const {state, ms} = await pressStop(page, {capMs: HANG_GUARD_MS});
    assert.equal(isStopped(state), true);
    assert.ok(ms >= 500, `the verdict came after the panel changed (${ms} ms)`);
  });
});

test('a Stop that never halts the fill fails with the panel\'s last state in the message', async () => {
  await withPanel('never', async page => {
    await assert.rejects(pressStop(page, {capMs: 800}), error => {
      assert.match(error.message, /^Stop did not halt the fill: the fill's step row ended \(no busy step\) did not finish within 0\.8 s/);
      assert.match(error.message, /"busy":true/);
      assert.match(error.message, /Stopping… \(disabled\)/);
      return true;
    });
  });
});

test('each thing a Stop should change is waited for on its own and named: the dim that stays, the stopped card that never shows', async () => {
  await withPanel('dim', async page => {
    await assert.rejects(pressStop(page, {capMs: HANG_GUARD_MS}), error => /^Stop did not halt the fill: the dim over the page lifted did not finish/.test(error.message) && /"overlay":true/.test(error.message) && /"busy":false/.test(error.message));
  });
  await withPanel('nocard', async page => {
    await assert.rejects(pressStop(page, {capMs: HANG_GUARD_MS}), error => /^Stop did not halt the fill: the panel showed "Stopped by you" \(or stayed minimised\) did not finish/.test(error.message) && /"stoppedShown":false/.test(error.message));
  });
});

test('a press outside a runner step still has one budget: the step\'s time, else the test\'s cap, else pollUntil\'s default', () => {
  assert.equal(pressBudget({stepLeft: 7000, capMs: 900}), 7000);
  assert.equal(pressBudget({stepLeft: undefined, capMs: 900}), 900);
  assert.equal(pressBudget({stepLeft: undefined, capMs: undefined}), POLL_CAP_MS, 'panel-theme-stop.test.mjs is a plain node:test: its failing Stop must not take 30 s + 3 x 45 s');
});

test('only the panel\'s own Stop is pressed, not a control of the job form that has the same class', async () => {
  await withPanel('decoy', async page => {
    const {state} = await pressStop(page, {capMs: HANG_GUARD_MS});
    assert.equal(isStopped(state), true);
  });
});

test('a Stop that is never pressable fails naming the control and the panel, not as a timeout of the page', async () => {
  await withPanel('hidden', async page => {
    await assert.rejects(pressStop(page, {capMs: 800}), error => {
      assert.match(error.message, /^Stop was never pressable/);
      assert.match(error.message, /"busy":true/);
      return true;
    });
  });
});

test('the minimised panel\'s pill Stop is pressed with the minimised option', async () => {
  await withPanel('pill', async page => {
    const {state} = await pressStop(page, {capMs: HANG_GUARD_MS, minimised: true});
    assert.equal(state.cardHidden, true);
    assert.equal(isStopped(state), true);
  });
});

test('a page without the panel reads as not stopped, never as stopped', async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent('<body>nothing here</body>');
    assert.deepEqual(await readPanel(page), {panel: 'absent'});
    assert.equal(isStopped({panel: 'absent'}), false);
  } finally { await browser.close(); }
});
