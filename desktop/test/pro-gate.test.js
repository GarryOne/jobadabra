// The one rule for every Pro-gated feature (owner, 25 Oct 2026): licensed works, not licensed with paying off shows a Pro label + the Upgrade dialog (waitlist, promo), not licensed with paying on
// sends to Settings → Plan. Loops over every gated feature; fails when a page decides Pro by itself. Guards renderer/pro-gate.js, pages/pro-upgrade-dialog.js.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {GATED_FEATURES, exportState, payingOn, proGate} from '../renderer/pro-gate.js';

const STATES = {open: [{licensed: true}, {licensed: true, proMode: 'live'}], waitlist: [{}, {proMode: undefined}, {proMode: 'off'}], buy: [{proMode: 'test'}, {proMode: 'live'}]};
const read = rel => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');

test('three states from the licence state alone', () => {
  for (const [gate, states] of Object.entries(STATES)) for (const state of states) assert.equal(proGate(state), gate, JSON.stringify(state));
  assert.equal(payingOn({proMode: 'live'}), true);
  assert.equal(payingOn({}), false);
});

test('every gated feature: licensed works, free has the Pro label or the promo link, never hidden by the paying switch', () => {
  assert.deepEqual(Object.keys(GATED_FEATURES).sort(), ['export', 'promo'], 'a new gated feature is added here and below');
  for (const [name, feature] of Object.entries(GATED_FEATURES)) {
    assert.equal(feature('open').label, false, `${name}: licensed has no Pro label`);
    for (const gate of ['waitlist', 'buy']) assert.equal(feature(gate).shown, true, `${name} is shown to a free person (${gate})`);
  }
  assert.equal(GATED_FEATURES.export('open').press, 'run');
  assert.equal(GATED_FEATURES.export('waitlist').press, 'dialog');
  assert.equal(GATED_FEATURES.export('buy').press, 'plan');
  assert.equal(GATED_FEATURES.export('waitlist').label && GATED_FEATURES.export('buy').label, true);
  assert.equal(GATED_FEATURES.promo('open').shown, false, 'a Pro person has no promo link');
});

test('Export follows the rule: locked (Pro label) for every free state, open for a licensed one, never hidden', () => {
  for (const [gate, states] of Object.entries(STATES)) for (const state of states) assert.equal(exportState(state), gate === 'open' ? 'open' : 'locked', JSON.stringify(state));
});

test('no page decides Pro by the paying switch on its own; the Export button, ⌘K and the main process use the shared rule', () => {
  const allowed = new Set(['plan-line.js', 'pro-gate.js']);
  for (const dir of ['../renderer/', '../renderer/pages/']) for (const file of fs.readdirSync(new URL(dir, import.meta.url)).filter(name => name.endsWith('.js') && !allowed.has(name))) {
    const code = read(dir + file).split('\n').filter(line => !line.trim().startsWith('//')).join('\n');
    if (/\bproMode\b/.test(code)) assert.fail(`${file} reads proMode: use proGate (renderer/pro-gate.js)`);
  }
  const nav = read('../renderer/pages/nav.js');
  assert.match(nav, /GATED_FEATURES\.promo\(proGate\(/);
  assert.match(nav, /exporting === 'locked'\) return openProGate\(\)/);
  assert.match(read('../renderer/pages/jobs-export.js'), /if \(answer\?\.pro\) openProGate\(\)/);
  assert.match(read('../lib/jobs-export-handlers.js'), /if \(!canExport\(licenseState\(\)\)\) return \{ok: false, pro: true/, 'the main process stays the real check');
});

test('the Upgrade dialog offers the waitlist and the promo code, and no price or buy button', () => {
  const code = read('../renderer/pages/pro-upgrade-dialog.js');
  assert.match(code, /Join the Pro waitlist/);
  assert.match(code, /promoLink\(/);
  assert.doesNotMatch(code, /planCheckout|Stripe|€/);
  assert.match(read('../renderer/pages/plan-waitlist.js'), /promoLink\(reloadPlan\)/, 'the Plan card keeps its waitlist button and adds the promo link under it');
});
