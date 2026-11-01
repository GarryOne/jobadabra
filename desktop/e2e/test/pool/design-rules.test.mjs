/* global document */
// The owner's design rules (lib/design-rules.mjs) on the design-system page: every "Don't" example trips the check it shows, every "Do" and every approved
// gallery section trips none (a check that fires on approved parts would fail every journey). Also: the KNOWN_LEFT list only shrinks.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {chromium} from 'playwright-core';
import {DESIGN_RULES_ON, KNOWN_LEFT, RULE_LIMITS, designRules, judge} from '../../lib/design-rules.mjs';

const PARKED = !DESIGN_RULES_ON && 'design checks parked by the owner on 18 Oct 2026 (lib/design-rules.mjs DESIGN_RULES_ON)';
import {build} from '../../../../tools/design-system/build.mjs';
import {serve} from '../../../../tools/design-system/serve.mjs';

// The page's sections: id, status (design-status.json via design-page.js), whether it is a Don't / Do pair, and each Don't box's name + the checks it must trip.
function sectionsShown() {
  const words = el => (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
  return [...document.querySelectorAll('.g-section[id]')].map(section => ({
    id: section.id, status: section.dataset.status || '', pair: Boolean(section.closest('[data-group="Don\'t / Do"]')),
    boxes: [...section.querySelectorAll('.g-state')].map(box => ({name: words(box.querySelector('h4')).slice(0, 50), expect: box.dataset.expect || ''})),
  }));
}

test('each Don\'t trips its check; each Do and every approved section trips none', {skip: PARKED}, async () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'design-rules-'));
  build({out, commit: 'test', date: '2026-10-18'});
  const server = await serve(out);
  const browser = await chromium.launch({channel: 'chrome'});
  try {
    const page = await browser.newPage({viewport: {width: 1280, height: 900}});
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForSelector('.dp-toc a');
    const sections = await page.evaluate(sectionsShown);
    const pairs = sections.filter(section => section.pair);
    assert.equal(pairs.length, 9, 'one section per Don\'t / Do pair');
    for (const section of sections) {
      const found = judge(await page.evaluate(designRules, {view: section.id, limits: RULE_LIMITS, scope: `#${section.id}`})).filter(item => item.severity === 'severe' || section.pair);
      if (section.pair) {
        for (const box of section.boxes) {
          const own = found.filter(item => item.card === box.name);
          if (!box.expect) { assert.deepEqual(own, [], `the Do example "${box.name}" trips a check`); continue; }
          for (const kind of box.expect.split(' ')) assert.ok(own.some(item => item.kind === kind), `"${box.name}" does not trip ${kind}: ${JSON.stringify(own)}`);
        }
      } else if (!['legacy', 'proposed'].includes(section.status)) {
        assert.deepEqual(found, [], `approved section "${section.id}" trips a design rule`);
      }
    }
  } finally {
    await browser.close();
    server.close();
    fs.rmSync(out, {recursive: true, force: true});
  }
});

test('a screen listed in KNOWN_LEFT is a warning naming who fixes it; anything else stays severe; the list only shrinks', {skip: PARKED}, () => {
  const finding = {view: 'strategy', kind: 'fat-button', card: 'Review your preferences', severity: 'severe', detail: 'x'};
  assert.equal(judge([finding], {})[0].severity, 'severe');
  const known = judge([finding], {'strategy|fat-button|Review your preferences': 'session 46 (Strategy)'})[0];
  assert.equal(known.severity, 'warning');
  assert.match(known.detail, /session 46/);
  assert.equal(judge([{...finding, view: 'sessions', card: 'NA Northwind AI · Platform Engineer'}], {'sessions|fat-button|*': 'x'})[0].severity, 'warning', "'*' covers any card of the page");
  // Raise this only when a new rule lands and measures screens that broke it before it existed; lower it when a screen is fixed and its entry comes off.
  const MAX_KNOWN = 12;
  assert.ok(Object.keys(KNOWN_LEFT).length <= MAX_KNOWN, `KNOWN_LEFT has ${Object.keys(KNOWN_LEFT).length} entries, at most ${MAX_KNOWN}: fix the screen instead of listing it`);
  for (const [key, who] of Object.entries(KNOWN_LEFT)) assert.ok(/\|.+\|/.test(key) && String(who).trim(), key);
});
