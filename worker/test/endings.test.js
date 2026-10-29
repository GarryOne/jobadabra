// The outcome contract's fixed endings (extension/ladder/endings.js): one list every part imports (the extension's dead ends, the app, the pool's classifier desktop/e2e/lib/ending.mjs,
// the site's Resolution tile), never copied words. Pure: no chrome API, so a node test and the site can load it.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {ENDINGS, STUCK_REASONS, UNRESOLVED, endingOfStuck, isEnding, resolved} from '../../extension/ladder/endings.js';

test('the endings are a fixed list of seven, unresolved last; resolved is every ending but unresolved', () => {
  assert.deepEqual(ENDINGS, ['ready', 'told', 'handed', 'blind', 'data_missing', 'site_broken', 'unresolved']);
  assert.equal(UNRESOLVED, ENDINGS.at(-1));
  assert.deepEqual(ENDINGS.filter(resolved), ['ready', 'told', 'handed', 'blind', 'data_missing', 'site_broken']);
  for (const nope of ['', 'held by the test', 'Ready', null, undefined, 'other']) { assert.equal(isEnding(nope), false); assert.equal(resolved(nope), false); }
});

test('the list is pure: no chrome API, no storage, no import', () => {
  const source = fs.readFileSync(new URL('../../extension/ladder/endings.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\bchrome\.|localStorage|^import /m);
});

test('every "can\'t reach" reason names its ending: told for the page\'s own way, handed only for a named wall, else unresolved', () => {
  assert.deepEqual(STUCK_REASONS.map(why => endingOfStuck(why)), ['told', 'told', 'unresolved', 'unresolved', 'unresolved', 'unresolved', 'site_broken']);
  assert.equal(endingOfStuck('no-form', "This site wants a quick check: solve it, then I'll continue"), 'handed');
  assert.equal(endingOfStuck('account', 'Create the account: choose a password'), 'handed');
  assert.equal(endingOfStuck('account', '  '), 'unresolved', 'no named need: a stop with no reason');
  assert.equal(endingOfStuck('something new'), 'unresolved');
  for (const why of STUCK_REASONS) assert.ok(isEnding(endingOfStuck(why, 'x')), why);
});

// The class (owner rule: a fix covers every sibling): every reason the extension can send to the app is mapped. Read from the code that sends them, so a new reason fails here.
test('every reason the extension sends with a "can\'t reach" report is a listed reason', () => {
  const read = file => fs.readFileSync(new URL(`../../extension/${file}`, import.meta.url), 'utf8');
  const sent = new Set();
  for (const file of ['fill-flow.js', 'fill-flow-steps.js', 'account-step.js']) {   // every give-up goes through ladder/dead-end.js: deadEndHere(tab, jobUrl, host, '<why>', ...) or deadEnd({why: '<why>', ...})
    for (const call of read(file).match(/\bdeadEndHere\([^;]*\)/g) || []) for (const [, word] of call.matchAll(/'([a-z][a-z_-]*)'/g)) sent.add(word);
    for (const [, word] of read(file).matchAll(/\bwhy: '([a-z][a-z_-]*)'/g)) sent.add(word);
  }
  for (const file of ['ladder/outcomes.js', 'ladder/climb.js']) for (const [, word] of read(file).matchAll(/\bwhy: '([a-z][a-z-]*)'/g)) sent.add(word);
  assert.ok(sent.has('no-form') && sent.has('email') && sent.has('other') && sent.has('site_broken'), [...sent].join(', '));
  assert.deepEqual([...sent].filter(word => !STUCK_REASONS.includes(word)), [], 'add the new reason to STUCK_REASONS (extension/ladder/endings.js) with its ending, and to the app (desktop/lib/session-flow.js)');
});
