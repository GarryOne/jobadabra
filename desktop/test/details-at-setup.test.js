// Your details filled from the CV at setup (lib/details-at-setup.js; owner, 27 Oct 2026: "in the wizard, we should extract the values from CV and put them in
// 'your details'"): what the CV states plainly is saved for an empty detail; an inferred or unsure value stays a proposal; a detail you have is never replaced; the log names fields only.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {toSave} from '../lib/details-at-setup.js';

test('only stated, sure values for empty details are saved', () => {
  const proposals = [{field: 'first_name', value: ' Ana ', sure: true}, {field: 'last_name', value: 'Lupu', sure: true}, {field: 'email', value: 'cv@x.y', sure: true},
    {field: 'location', value: 'Chisinau', sure: false, inferred: true}, {field: 'salutation', value: 'Ms', sure: false}, {field: 'postal_code', value: '1000', sure: true, source: 'profile'}];
  assert.deepEqual(toSave(proposals, {email: 'me@x.y'}), {first_name: 'Ana', last_name: 'Lupu'});
  assert.deepEqual(toSave([], {}), {});
});

test('the setup step runs after a setup save that took the Profile', async () => {
  const {detailsFromCvAtSetup} = await import('../lib/details-at-setup.js');
  const contact = await import('../lib/contact.js');
  const fromCv = await import('../lib/contact-from-cv.js');
  assert.equal(typeof detailsFromCvAtSetup, 'function');
  // The step is wired to the setup save: strategy-draft-handlers calls it after a save that took the Profile.
  const fs = await import('node:fs');
  const handlers = fs.readFileSync(new URL('../lib/strategy-draft-handlers.js', import.meta.url), 'utf8');
  assert.match(handlers, /detailsFromCvAtSetup\(storage/);
  assert.match(handlers, /take\('profile'\) \? detailsAfter\(result\)/);
  assert.ok(contact.LABELS.first_name && fromCv.FIELDS.includes('first_name'));
});

test('the save window says what the CV read gave, in counts only', async () => {
  const {detailsNote} = await import('../lib/details-at-setup.js');
  assert.equal(detailsNote({saved: ['first_name', 'last_name'], left: ['location']}), '2 filled, 1 to check in Your details');
  assert.equal(detailsNote({saved: ['phone'], left: []}), '1 filled');
  assert.equal(detailsNote({}), 'nothing more in your CV');
  const fs = await import('node:fs');
  const html = fs.readFileSync(new URL('../renderer/index.html', import.meta.url), 'utf8'), wizard = fs.readFileSync(new URL('../renderer/pages/wizard.js', import.meta.url), 'utf8');
  assert.match(html, /data-save-step="details">Reading your details from your CV/);
  assert.match(wizard, /details: 10/);
});
