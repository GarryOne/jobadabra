// A menu left empty carries the reason the pick OBSERVED (extension/menu-reason.js), never the fixed "needs a real click" label
// (9 Oct 2026: the digest ranked real_click first, while on Migros the menu opened and the option was found, but a scripted click did not select).
import test from 'node:test';
import assert from 'node:assert/strict';
import { MENU_REASONS, OLD_MENU_REASON, SETTLE_REASONS, menuCause, menuReason } from '../../extension/menu-reason.js';
import { CAUSES, causeOf, cleanCard, fillCard } from '../../extension/fill-card.js';

test('each observation of the pick gives its own reason', () => {
  const cases = [
    [{ opened: false, found: null, selectedAfter: null }, 'menu_not_opened'],
    [{ opened: true, found: false, selectedAfter: null }, 'no_option'],
    [{ opened: true, found: true, selectedAfter: false }, 'menu_not_selected'],
    [{ opened: true, found: true, selectedAfter: true }, 'menu_not_read'],
    [{ opened: null, found: null, selectedAfter: null }, 'no_option'],   // nothing observed: as before this change
  ];
  for (const [combo, cause] of cases) assert.equal(menuCause(`${menuReason(combo)} (2.1 s)`), cause, JSON.stringify(combo));
  assert.equal(menuCause('dropdown not clicked: "Fill drop-down menus too" is off'), 'menu_not_clicked');
  assert.equal(menuCause(OLD_MENU_REASON), 'real_click');
  assert.equal(menuCause('answer given, but the field did not take it'), '');
});

// The class: every menu reason is a cause the fill card counts and the site keeps (a new one without them fails here).
test('every menu reason is counted by the fill card and kept by the site', () => {
  for (const { text, cause } of MENU_REASONS) {
    assert.ok(CAUSES.includes(cause), cause);
    assert.equal(causeOf({ field: 'f', reason: `${text} (1.0 s)` }), cause);
  }
  const card = fillCard({ id: 'fill-0002-abc', trace: MENU_REASONS.map(({ text }, i) => ({ label: `M${i}`, field: `m${i}`, type: 'combobox', required: true, outcome: 'left', reason: `${text} (1.0 s)` })) });
  assert.deepEqual(Object.keys(cleanCard(card).causes).sort(), MENU_REASONS.map(item => item.cause).sort());
});

// The class: every pass that clicks menus writes what the click observed onto its rows (Ocado, 11 Oct 2026: the later pass left the page's old label).
test('applyCombos replaces the page label by what the click observed, for the latest row of each menu', async () => {
  const { applyCombos } = await import('../../extension/menu-reason.js');
  const trace = [
    { label: 'Right to work', outcome: 'left', source: '', reason: 'proposed for you to confirm' },
    { label: 'Right to work', outcome: 'left', source: 'Claude (on the page)', reason: OLD_MENU_REASON },
    { label: 'Country', outcome: 'left', source: 'Claude (on the page)', reason: OLD_MENU_REASON },
    { label: 'City', outcome: 'left', source: 'Claude (on the page)', reason: OLD_MENU_REASON },
  ];
  applyCombos(trace, [
    { label: 'Right to work', picked: false, ms: 2100, opened: false },
    { label: 'Country', picked: true, matched: true, ms: 900 },
    { label: 'City', picked: true, matched: false, ms: 900 },
  ]);
  assert.equal(trace[0].reason, 'proposed for you to confirm');
  assert.equal(menuCause(trace[1].reason), 'menu_not_opened');
  assert.deepEqual([trace[2].outcome, trace[3].outcome], ['filled', 'left']);
  for (const row of trace) assert.notEqual(row.reason, OLD_MENU_REASON);
});

test('both passes of the fill flow write the clicks\' observations onto the rows', async () => {
  const { readFileSync } = await import('node:fs');
  const source = readFileSync(new URL('../../extension/fill-tab-finish.js', import.meta.url), 'utf8');
  assert.equal(source.split('applyCombos(summary.trace, combos)').length - 1, 2);
});

// The class: a reason the fill's end writes for any control (not only a menu) is a cause the card counts, the site keeps and the endings read, like a menu's (13 Oct 2026: "selected another
// choice" and "did not keep it after its tries" fell to 'other' and were the pool's biggest unnamed cause).
test('every settle-time reason is counted by the fill card, and the one the fill writes is the one that is named', async () => {
  const { CAUSE_REASON } = await import('../../extension/ladder/control-ending.js');
  for (const { text, cause } of SETTLE_REASONS) {
    assert.ok(CAUSES.includes(cause), cause);
    assert.equal(causeOf({ field: 'f', reason: `${text}: left for you` }), cause);
    assert.ok(cause in CAUSE_REASON, `control-ending.js CAUSE_REASON names ${cause}`);
  }
  assert.equal(causeOf({ field: 'f', reason: 'dropdown clicked, but it selected another choice (0.9 s)' }), 'menu_other_choice');
});
