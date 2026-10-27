// /extension/me with a detail left empty that the CV states (lib/server-contact.js withCvFallback; owner, 27 Oct 2026: "Empty saved detail → the fill types the
// CV's sure value and marks it 'from your CV: check it'; the Profile is not changed"): the form gets it, named in contact._fromCv; nothing else changes.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {withCvFallback} from '../lib/server-contact.js';
import {FILE} from '../lib/contact-from-cv.js';
import {INSTRUCTIONS as STRATEGY_PROMPT} from '../lib/strategy.js';

const storageWith = saved => ({readText: name => (name === FILE ? JSON.stringify(saved) : null), writeText: () => { throw new Error('nothing is written'); }, path: name => `/x/${name}`});

test('an empty name comes from the CV, marked; a saved detail is never replaced', () => {
  const storage = storageWith({cv: 'cv1+p', proposals: [{field: 'first_name', value: 'Ana', sure: true}, {field: 'last_name', value: 'Lupu', sure: true}, {field: 'email', value: 'cv@x.y', sure: true}]});
  const out = withCvFallback(storage, {contact: {email: 'me@x.y', phone: '+1'}, contactSource: 'notion'}, 'cv1');
  assert.deepEqual(out.contact, {email: 'me@x.y', phone: '+1', first_name: 'Ana', last_name: 'Lupu', full_name: 'Ana Lupu', _fromCv: ['first_name', 'last_name', 'full_name']});
  assert.equal(out.contactSource, 'notion');
});

test('nothing from the CV: the details go as they were', () => {
  const details = {contact: {first_name: 'Ana'}};
  assert.equal(withCvFallback(storageWith(null), details, 'cv1'), details);
  assert.equal(withCvFallback(storageWith({cv: 'other', proposals: [{field: 'last_name', value: 'X', sure: true}]}), details, 'cv1'), details);
});

test('the setup draft keeps the CV\'s name even when it matches a signed-in account', () => {
  assert.match(STRATEGY_PROMPT, /copied even when it is the same as the name of an account you are signed in with; never empty when the CV shows a name/);
});
