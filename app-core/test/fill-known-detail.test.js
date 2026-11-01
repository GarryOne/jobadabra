// easytemp, twin, 9 Oct 2026: "Lieu d'origine" was left as "no answer in the kit" although the built-in words know it (place of origin): only
// the value was missing. That sent its wording to the wording learner (nothing to learn) instead of to the person (a detail to give once).
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadJsdom, openPage } from './helpers/page.js';
import { causeOf } from '../../extension/fill-card.js';

const JSDOM = await loadJsdom();
const FORM = `<form>
  <label for="o">Lieu d'origine</label><input id="o" name="origin" required>
  <label for="q">Combien d'années d'expérience en logistique ?</label><input id="q" name="years" required>
</form>`;

test('a known detail with no saved value says so (no_data); an unknown question stays a wording to learn', { skip: !JSDOM }, async () => {
  const window = openPage(JSDOM, FORM);
  const summary = await window.__jobPilottoExtensionFill([], {}, null, '', false);
  const rows = Array.from(summary.trace);
  const origin = rows.find((r) => /origine/i.test(r.label)), years = rows.find((r) => /expérience/i.test(r.label));
  assert.match(origin.reason, /^a detail of yours not saved yet \(place_of_origin\)$/);
  assert.equal(causeOf(origin), 'no_data');
  assert.equal(years.reason, 'no answer in the kit, Profile or your details');   // what the learner should see
});
