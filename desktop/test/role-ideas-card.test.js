// "Roles that fit you" (src/ai/role_ideas.py): the Profile's roles as chips, the ones set aside never shown.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {ideasCard} from '../renderer/coverage-card.js';

test('ideas become chips with their counts; set-aside roles and an empty answer show nothing', () => {
  const card = ideasCard([{role: 'Cashier', word: 'caissier', why: 'shop', count: 6}, {role: 'Retoucher', word: 'retouche', why: 'Photoshop', count: 0}], ['retouche']);
  assert.deepEqual(card.chips.map(chip => [chip.term, chip.label]), [['caissier', '+ Cashier · 6']]);
  assert.match(card.chips[0].title, /^shop\. Searched as "caissier"; 6 open jobs/);
  assert.equal(ideasCard([], []), null);
  assert.equal(ideasCard([{role: 'R', word: 'retouche', count: 1}], ['retouche']), null);
});

// Owner, 26 Oct 2026 (audit PR 6, "One AI row"): with an AI the fixed-word row is gone; this row says how much the words catch when they catch
// under a tenth (the engine's `tight`) and one idea would add 5 or more open jobs.
test('the AI role ideas say how much your words catch when the search is narrow', () => {
  const ideas = [{role: 'First officer', word: 'Erster Offizier', why: 'pilot licence', count: 9}, {role: 'Cabin crew', word: 'cabin crew', why: 'crew', count: 2}];
  const narrow = {tight: true, matched: 31, in_places: 640};
  assert.equal(ideasCard(ideas, [], narrow).narrow, 'Your role words catch 31 of 640 postings in your places');
  assert.equal(ideasCard(ideas, [], {...narrow, tight: false}).narrow, '');
  assert.equal(ideasCard(ideas.map(idea => ({...idea, count: 4})), [], narrow).narrow, '', 'no idea adds 5 or more');
  assert.equal(ideasCard(ideas, []).narrow, '', 'no coverage check yet');
});
