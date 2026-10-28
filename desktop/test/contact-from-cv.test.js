// "Your details from your CV" (lib/contact-from-cv.js): Claude proposes values for empty contact fields, once per CV file; nothing is
// saved without the person's Save; a filled field is never proposed over; the log names fields, never values.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {FIELDS, cleanProposals, emptyFields, forCv, pending, sourceKey, statedText} from '../lib/contact-from-cv.js';

const memoryStorage = () => { const files = {}; return {files, readText: name => files[name] ?? null, writeText: (name, text) => { files[name] = text; }, path: name => `/x/${name}`}; };
const fakeClient = (answer, calls = []) => ({messages: {create: async request => { calls.push(request); return {stop_reason: 'end_turn', content: [{type: 'text', text: JSON.stringify(answer)}]}; }}});
const pdf = () => Buffer.from('%PDF-1.4 fake');
const coop = {first_name: 'Ilie', last_name: 'Condrea', email: 'a@b.c'};

test('only empty, known fields are asked for and kept; one per field; salutation is always "check it"', () => {
  assert.ok(!emptyFields(coop).includes('first_name') && emptyFields(coop).includes('phone') && emptyFields(coop).includes('salutation'));
  assert.ok(!FIELDS.includes('full_name'));
  const wanted = ['phone', 'postal_code', 'salutation'];
  assert.deepEqual(cleanProposals([{field: 'phone', value: ' +41 79 000 00 00 ', sure: true}, {field: 'phone', value: 'other', sure: true},
    {field: 'first_name', value: 'X', sure: true}, {field: 'postal_code', value: '', sure: true}, {field: 'salutation', value: 'Monsieur', sure: true}], wanted),
  [{field: 'phone', value: '+41 79 000 00 00', sure: true}, {field: 'salutation', value: 'Monsieur', sure: false}]);
});

test('one Claude call per CV file: the CV goes as a PDF, the answer is kept, and a field filled since drops out', async () => {
  const storage = memoryStorage(), calls = [], logged = [];
  const client = fakeClient({proposals: [{field: 'postal_code', value: '1260', sure: true}, {field: 'location', value: 'Nyon', sure: true}]}, calls);
  const first = await forCv(storage, {contact: coop, client, cvHash: 'cv1', log: (...line) => logged.push(line), read: pdf});
  assert.deepEqual(first.proposals.map(item => item.field), ['postal_code', 'location']);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].messages[0].content[0].type, 'document');
  assert.ok(calls[0].max_tokens >= 8000);
  // The log: which fields, never a value.
  assert.match(logged[0][1], /2 of \d+ proposed/);
  assert.deepEqual(logged[0][2].proposed, ['postal_code', 'location']);
  assert.ok(!JSON.stringify(logged).includes('1260') && !JSON.stringify(logged).includes('Nyon'));
  // Opening Profile again: no new call; you typed the town meanwhile, so only the postal code is still proposed.
  const again = await forCv(storage, {contact: {...coop, location: 'Genève'}, client, cvHash: 'cv1', read: pdf});
  assert.equal(calls.length, 1);
  assert.deepEqual(again.proposals.map(item => item.field), ['postal_code']);
  // A new CV is read once more; "Fill from my CV" (again) reads the same CV anew.
  await forCv(storage, {contact: coop, client, cvHash: 'cv2', read: pdf});
  await forCv(storage, {contact: coop, client, cvHash: 'cv2', read: pdf, again: true});
  assert.equal(calls.length, 3);
});

test('a failure is kept for that CV (no paying again on every open) and said; no AI or no CV: nothing asked', async () => {
  const storage = memoryStorage(), logged = [];
  const broken = {messages: {create: async () => ({stop_reason: 'max_tokens', content: [{type: 'text', text: '{"propo'}]})}};
  const failed = await forCv(storage, {contact: coop, client: broken, cvHash: 'cv1', log: (...line) => logged.push(line), read: pdf});
  assert.deepEqual([failed.proposals, /cut short/.test(failed.error)], [[], true]);
  assert.match(logged[0][1], /failed/);
  assert.equal((await forCv(storage, {contact: coop, client: broken, cvHash: 'cv1', read: pdf})).fresh, false);
  assert.deepEqual((await forCv(memoryStorage(), {contact: coop, client: null, cvHash: 'cv1'})).error, 'no AI');
  assert.deepEqual((await forCv(memoryStorage(), {contact: coop, client: broken, cvHash: ''})).proposals, []);
  assert.deepEqual(pending({cv: 'old', proposals: [{field: 'phone', value: '1'}]}, 'new', coop), []);
});

test('the window shows proposals in the Your details boxes and Save is the only way they are kept', () => {
  const page = fs.readFileSync(new URL('../renderer/pages/contact-proposals.js', import.meta.url), 'utf8');
  const profile = fs.readFileSync(new URL('../renderer/pages/profile.js', import.meta.url), 'utf8');
  const html = fs.readFileSync(new URL('../renderer/index.html', import.meta.url), 'utf8');
  assert.ok(!/saveContact/.test(page), 'proposals never save by themselves');
  assert.match(profile, /loadProposals\(\);/);
  assert.match(fs.readFileSync(new URL('../renderer/pages/profile-menu.js', import.meta.url), 'utf8'), /label: 'Fill empty details from my CV', run: \(\) => fillFromCv/, 'Fill from my CV lives in the Profile ⋯ menu');
  assert.match(html, /data-contact="salutation"/);
  assert.match(page, /pill\(`\$\{left\} from CV · check`, 'warn'\)/, 'how many proposals are left shows as a badge in the Contact title (mockup 05)');
  assert.doesNotMatch(page, /filled in from your CV: check/, 'never a lone line under the card');
  const show = page.slice(page.indexOf('export function showProposals'));
  assert.doesNotMatch(show.slice(0, show.indexOf('for (const')), /clearProposals\(\)/, 'a second run (the tab opened again) never wipes the marks while keeping their values (18 Oct 2026)');
  assert.match(show, /if \(input\?\.dataset\.proposed\) \{ shown\+\+; continue; \}/, 'a still-marked box stays marked and counted');
});

// 9 Oct 2026, the twin: Coop's "Localité" stayed empty with no proposal; the town was in the Profile, not in the CV or Your details.
test('the Profile goes beside the CV: a detail only it states is proposed to check, and a changed Profile is read again', async () => {
  const storage = memoryStorage(), calls = [], logged = [];
  const client = fakeClient({proposals: [{field: 'location', value: 'Nyon', sure: true, source: 'profile'}, {field: 'phone', value: '+41 79 1', sure: true, source: 'cv'}]}, calls);
  const first = await forCv(storage, {contact: coop, client, cvHash: 'cv1', profile: 'Lives in Nyon, VD.', log: (...line) => logged.push(line), read: pdf});
  assert.deepEqual(first.proposals, [{field: 'location', value: 'Nyon', sure: false, source: 'profile'}, {field: 'phone', value: '+41 79 1', sure: true}]);
  assert.match(calls[0].messages[0].content[1].text, /^<profile>\nLives in Nyon/);
  assert.deepEqual(logged[0][2].fromProfile, ['location']);
  await forCv(storage, {contact: coop, client, cvHash: 'cv1', profile: 'Lives in Nyon, VD.', read: pdf});
  assert.equal(calls.length, 1);                                               // the same CV and Profile: kept
  await forCv(storage, {contact: coop, client, cvHash: 'cv1', profile: 'Moved to Gland.', read: pdf});
  assert.equal(calls.length, 2);                                               // the Profile changed: asked again
  await forCv(memoryStorage(), {contact: coop, client, cvHash: 'cv1', read: pdf});
  assert.equal(calls[2].messages[0].content.length, 2);                        // no Profile: the CV and the fields only, as before
  assert.equal(sourceKey('cv1', ''), 'cv1');
});

// 9 Oct 2026, the twin: the town was stated only in a text the form AI read and this call did not; both read the same texts (Profile, Answers).
test('what you stated: Profile and Answers, each named; empty ones left out', () => {
  assert.equal(statedText({profile: 'Retail.', answers: "Candidate's location: Nyon."}), "## Profile\nRetail.\n\n## Standard answers\nCandidate's location: Nyon.");
  assert.equal(statedText({}), '');
});

// Owner, 27 Oct 2026: a Greenhouse form stayed without First/Last Name; the CV read had proposed both, nobody pressed Save, and the fill reads saved details only.
test('cvFallback: the CV\'s sure values fill the empty details for a form; never an unsure, inferred, Profile-only or another CV\'s value', async () => {
  const {cvFallback} = await import('../lib/contact-from-cv.js');
  const saved = {cv: 'cv1+abc123', proposals: [{field: 'first_name', value: 'Ana', sure: true}, {field: 'last_name', value: 'Lupu', sure: true},
    {field: 'location', value: 'Somewhere', sure: false, inferred: true}, {field: 'website', value: 'x.example', sure: false, source: 'profile'}, {field: 'email', value: 'old@x.y', sure: true}]};
  assert.deepEqual(cvFallback(saved, 'cv1', {email: 'me@x.y'}), {details: {first_name: 'Ana', last_name: 'Lupu'}, keys: ['first_name', 'last_name']});
  assert.deepEqual(cvFallback(saved, 'cv2', {}).keys, [], 'another CV file: nothing');
  assert.deepEqual(cvFallback(null, 'cv1', {}).keys, []);
});

test('an inferred value is kept as a proposal to check; a contact channel is never inferred', () => {
  const wanted = ['location', 'phone', 'first_name'];
  assert.deepEqual(cleanProposals([{field: 'location', value: 'Chisinau', sure: true, how: 'inferred'}, {field: 'phone', value: '+1 555', sure: false, how: 'inferred'},
    {field: 'first_name', value: 'Ana', sure: true, how: 'stated'}], wanted),
  [{field: 'location', value: 'Chisinau', sure: false, inferred: true}, {field: 'first_name', value: 'Ana', sure: true}]);
});

test('the CV read copies the applicant\'s own name even when it matches a signed-in account', async () => {
  const {MODEL} = await import('../lib/contact-from-cv.js');
  const calls = [];
  await forCv(memoryStorage(), {contact: {}, client: fakeClient({proposals: []}, calls), cvHash: 'cv9', read: pdf});
  assert.match(calls[0].system, /copy it even when it is the same as the name of an account you are signed in with/);
  assert.ok(MODEL);
});
