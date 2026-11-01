// Varied starting data for the apply fixtures (lib/forms.mjs varyForms): other answers, other field order, other timing, and the fixed path unchanged.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {FORMS, startForms, varyForms} from '../../lib/forms.mjs';
import {createVariation} from '../../lib/variation.mjs';

const kitOf = () => JSON.stringify(Object.fromEntries(Object.entries(FORMS).map(([name, form]) => [name, form.kit])));
const FIXED = (() => { varyForms(null); return kitOf(); })();

test('no seed leaves the forms exactly as written, and says nothing', () => {
  assert.equal(varyForms(null), '');
  assert.equal(varyForms(createVariation({})), '');
  assert.equal(kitOf(), FIXED);
});

test('a seed changes the data, replays the same with the same seed, and never builds on an earlier pick', () => {
  const first = varyForms(createVariation({E2E_SEED: '4242'})), kitA = kitOf();
  assert.notEqual(kitA, FIXED);
  assert.match(first, /late field after \d+ ms, greenhouse questions in order [1-4]{4}, answers /);
  varyForms(createVariation({E2E_SEED: '99'}));
  assert.notEqual(kitOf(), kitA);
  assert.equal(varyForms(createVariation({E2E_SEED: '4242'})), first, 'the same seed, the same data');
  assert.equal(kitOf(), kitA);
  varyForms(null);
  assert.equal(kitOf(), FIXED, 'back to the fixed path: nothing carried over');
});

test('whatever the seed, short answers stay short and the long one stays long, and the legal box is never touched', () => {
  const lengths = new Set();
  for (let seed = 1; seed <= 60; seed++) {
    varyForms(createVariation({E2E_SEED: String(seed)}));
    const answer = field => FORMS.greenhouse.kit.find(item => item.field === field).answer;
    assert.ok(answer('question_1001').length < 20 && answer('question_1003').length < 40, `short answers, seed ${seed}`);
    assert.ok(answer('question_1004').length >= 100, `the long answer is flagged for a read-through only if it is long, seed ${seed}`);
    assert.equal(answer('consent_privacy'), 'checked');
    lengths.add(answer('question_1004'));
  }
  assert.ok(lengths.size >= 4, 'the long answer really varies');
  varyForms(null);
});

test('the served pages follow the pick: the questions in the chosen order, the late field after the chosen delay', async () => {
  const seeded = await startForms({vary: createVariation({E2E_SEED: '31337'})});
  try {
    const html = seeded.html('greenhouse');
    const ids = ['question_1001', 'question_1002', 'question_1003', 'question_1004'];
    const order = ids.map(id => html.indexOf(`id="${id}"`));
    assert.ok(order.every(at => at > 0), 'all four questions are on the page');
    const wanted = /questions in order (\d{4})/.exec(seeded.variation)[1].split('').map(Number);
    assert.deepEqual([...order.keys()].sort((a, b) => order[a] - order[b]).map(i => i + 1), wanted);
    const late = /late field after (\d+) ms/.exec(seeded.variation)[1];
    assert.match(seeded.html('lever'), new RegExp(`}, ${late}\\);`));
    assert.match(seeded.variation, /answers .*question_1004=/);
  } finally { await seeded.close(); varyForms(null); }
});

test('a real form from the fill log renders each failed field as its kind, after the person\'s details', async () => {
  const {realPage} = await import('../../lib/forms.mjs');
  const html = realPage({title: 'Engineer', company: 'E2E Real x', real: {id: 'x', ats: 'greenhouse', fields: [
    {label: 'How did you hear about us?', kind: 'widget'}, {label: 'Visa status', kind: 'select'}, {label: 'Describe a system you scaled', kind: 'textarea'}]}});
  assert.match(html, /id="first_name"[\s\S]*id="email"/);
  assert.match(html, /role="combobox"[^>]*aria-labelledby="lbl-real_0_how_did_you_hear_about_us_"/);
  assert.match(html, /<select id="real_1_visa_status"/);
  assert.match(html, /<textarea id="real_2_describe_a_system_you_scaled"/);
  assert.match(html, /type="submit"/);
});
