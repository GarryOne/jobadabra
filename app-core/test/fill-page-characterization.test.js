// Pins page fill values, event order, safety gates and the complete field report before splitting its stages.
import test from 'node:test';
import assert from 'node:assert/strict';
import {loadJsdom, openPage} from './helpers/page.js';
import {fakeFillPage} from '../../desktop/test/fake-fill-page.js';

const JSDOM = await loadJsdom();
const plain = value => JSON.parse(JSON.stringify(value));
const row = (field, extra = {}) => ({field, label: `Question ${field}`, type: 'text', required: true, filled: false, ...extra});
const answer = (field, value, extra = {}) => ({field, value, ...extra});

// A DOM with only local resources; upload uses the browser FileList shape absent from jsdom.
function page(html) {
  const window = openPage(JSDOM, html, {url: 'https://example.test/application'});
  window.DataTransfer = class {
    files = [];
    items = {add: file => this.files.push(file)};
  };
  Object.defineProperty(window.HTMLInputElement.prototype, 'files', {
    configurable: true, get() { return this.__files || []; }, set(value) { this.__files = value; },
  });
  return window;
}

// Controlled reader/audit rows exercise reporting while retaining real DOM controls and marks.
function scripted(rows, t) {
  const window = page(rows.map(item => `<label for="${item.field}">${item.label}</label>${item.type === 'textarea' ? `<textarea id="${item.field}"></textarea>` : `<input id="${item.field}" type="${item.type}">`}`).join(''));
  t.after(() => window.close());
  const elements = Object.fromEntries(rows.map(item => [item.field, window.document.getElementById(item.field)]));
  window.__jobPilottoDescribeForm = async () => rows.map(item => ({...item}));
  window.__jobPilottoAuditVisibleFields = () => rows.map(item => ({...item}));
  window.__jobPilottoProfileEntries = () => [];
  window.__jobPilottoFillKnownFields = () => ({filled: []});
  window.__jobPilottoCoverage = null;
  window.__jobPilottoSuggest = {lostOnBlur: async () => []};
  for (const item of rows) if (item.value) elements[item.field].value = item.value;
  return {window, elements, fill: (all, options = {}) => window.__jobPilottoExtensionFill(all, options.profile || {}, options.resume || null, options.letter || '', options.consents || false)};
}

// Record emitted DOM events and stage calls in their actual order, without changing their implementation.
function observe(window) {
  const events = [];
  for (const type of ['input', 'change', 'click', 'submit']) window.document.addEventListener(type, event => events.push(`${type}:${event.target.id}`));
  for (const name of ['__jobPilottoDescribeForm', '__jobPilottoFillKnownFields', '__jobPilottoAuditVisibleFields']) {
    const original = window[name];
    window[name] = (...args) => { events.push(name); return original(...args); };
  }
  window.__jobPilottoGate = async () => { events.push('gate'); return true; };
  return events;
}

const kinds = [
  ['text', '<label for="q">Work sample</label><input id="q" required>', 'private sample', 'private sample', ['input:q', 'change:q']],
  ['select', '<label for="q">Work style</label><select id="q" required><option value="">Choose</option><option value="remote">Remote</option></select>', 'Remote', 'remote', ['input:q', 'change:q']],
  ['date', '<label for="q">Start date</label><input type="date" id="q" required>', '2027-01-02', '2027-01-02', ['input:q', 'change:q']],
  ['textarea', '<label for="q">Work sample</label><textarea id="q" required></textarea>', 'private prose', 'private prose', ['input:q', 'change:q']],
  ['radio', '<fieldset><legend>Work style</legend><label><input type="radio" id="q" name="style" value="remote" required>Remote</label><label><input type="radio" name="style" value="office">Office</label></fieldset>', 'Remote', true, ['click:q', 'input:q', 'change:q']],
  ['checkbox', '<label for="q">Can you relocate?</label><input type="checkbox" id="q" required>', 'checked', true, ['click:q', 'input:q', 'change:q']],
  ['combobox', '<label for="q">Work style</label><input id="q" role="combobox" required>', 'Remote', '', []],
];
for (const [kind, html, value, expected, emitted] of kinds) test(`${kind}: values, events, report, Submit and unauthorized consent`, {skip: !JSDOM}, async () => {
  const window = page(`<form>${html}<label for="privacy">I agree to the privacy policy</label><input id="privacy" type="checkbox" required><button id="send" type="submit">Submit</button></form>`);
  try {
    const events = observe(window);
    const field = kind === 'radio' ? 'radio:style' : 'q';
    const result = plain(await window.__jobPilottoExtensionFill([answer(field, value)], {}, null));
    assert.equal(result.error, undefined);
    const el = window.document.getElementById('q');
    assert.equal(['radio', 'checkbox'].includes(kind) ? el.checked : el.value, expected);
    assert.deepEqual(events.filter(item => /^(input|change|click|submit):/.test(item)), emitted);
    assert.deepEqual(events.filter(item => !/^(input|change|click|submit):/.test(item)), ['__jobPilottoDescribeForm', 'gate', '__jobPilottoFillKnownFields', 'gate', 'gate', 'gate', '__jobPilottoAuditVisibleFields']);
    assert.equal(window.document.getElementById('privacy').checked, false);
    assert.equal(result.held, false);
    assert.deepEqual(result.reach, {asked: 1, matched: 1, byQuestion: 0, lost: 0});
    assert.equal(result.resumeAttached, false);
    assert.equal(result.filled, kind === 'combobox' ? 0 : 1);
    assert.equal(result.unfilledRequired, kind === 'combobox' ? 2 : 1);
    assert.deepEqual(result.trace.map(item => [item.label, item.type, item.outcome, item.reason]), [
      [kind === 'text' || kind === 'textarea' ? 'Work sample' : kind === 'date' ? 'Start date' : kind === 'checkbox' ? 'Can you relocate?' : 'Work style', kind, kind === 'combobox' ? 'left' : 'filled', kind === 'combobox' ? 'dropdown that opens only on a real click' : ''],
      ['I agree to the privacy policy', 'checkbox', 'left', 'legal/consent: always your choice'],
      ['CV', 'file', 'left', 'no CV in the app'],
    ]);
    assert.deepEqual(result.todo, [...(kind === 'combobox' ? ['Click the 1 highlighted dropdown(s); each picks its answer when opened'] : []), 'Your choice (legal): privacy I agree to the privacy policy']);
    assert.ok(!JSON.stringify(result).includes(value) || value === 'Remote', 'reports do not echo typed private values');
  } finally { window.close(); }
});

test('CV and tailored letter upload follow text and controls, before manual letter text and audit', {skip: !JSDOM}, async () => {
  const window = page('<form><label for="q">Work sample</label><input id="q"><div><label for="cv">Resume</label><input id="cv" type="file" required></div><div><label for="letterfile">Cover letter</label><input id="letterfile" type="file"></div><div><label for="letter">Cover letter</label><textarea id="letter"></textarea></div><button id="send" type="submit">Submit</button></form>');
  try {
    const events = observe(window);
    const cv = {name: 'cv.pdf', type: 'application/pdf', data: 'Y3Y='};
    const letter = {name: 'letter.pdf', type: 'application/pdf', data: 'bGV0dGVy', tailored: true};
    const result = plain(await window.__jobPilottoExtensionFill([answer('q', 'private sample')], {}, {...cv, coverLetterFile: letter}, 'private letter'));
    assert.equal(result.error, undefined);
    assert.equal(window.document.getElementById('cv').files[0]?.name, 'cv.pdf');
    assert.equal(window.document.getElementById('letterfile').files[0]?.name, 'letter.pdf');
    assert.equal(window.document.getElementById('letter').value, 'private letter');
    assert.deepEqual(events, ['__jobPilottoDescribeForm', 'gate', '__jobPilottoFillKnownFields', 'input:q', 'change:q', 'gate', 'gate', 'input:cv', 'change:cv', 'input:letterfile', 'change:letterfile', 'gate', 'input:letter', 'change:letter', '__jobPilottoAuditVisibleFields']);
    assert.equal(result.resumeAttached, true);
    assert.equal(result.filled, 3);
    assert.equal(result.unfilledRequired, 0);
    assert.deepEqual(result.todo, []);
    assert.deepEqual(result.trace.filter(item => item.type === 'file').map(item => [item.label, item.source, item.outcome, item.reason]), [['Cover letter', "this job's letter", 'filled', ''], ['CV', 'your CV', 'filled', '']]);
    assert.ok(result.operated.some(item => item.kind === 'upload' && item.ok));
    assert.ok(!/private sample|private letter/.test(JSON.stringify(result)));
  } finally { window.close(); }
});

test('consents require saved authorization and validated agreement reading, never an attestation', {skip: !JSDOM}, async () => {
  for (const enabled of [false, true]) {
    const window = page('<form><label for="ok">I agree to the privacy policy</label><input id="ok" type="checkbox" required><label for="unread">I agree to terms</label><input id="unread" type="checkbox"><label for="attest">I certify this is true</label><input id="attest" type="checkbox"><label for="choice">Application privacy policy</label><select id="choice"><option value="">Choose</option><option value="yes">Accept</option><option value="no">Decline</option></select><button type="submit" id="send">Submit</button></form>');
    try {
      const events = observe(window);
      const all = [answer('ok', '', {category: 'legal', use: 'kind', consent: true}), answer('unread', '', {category: 'legal', use: 'kind'}), answer('attest', '', {category: 'legal', use: 'kind', consent: true}), answer('choice', 'Accept', {category: 'legal', use: 'kind', consent: true})];
      const result = plain(await window.__jobPilottoExtensionFill(all, {}, null, '', enabled));
      assert.equal(result.error, undefined);
      assert.equal(window.document.getElementById('ok').checked, enabled);
      assert.equal(window.document.getElementById('choice').value, enabled ? 'yes' : '');
      assert.equal(window.document.getElementById('unread').checked, false);
      assert.equal(window.document.getElementById('attest').checked, false);
      assert.ok(!events.includes('click:send') && !events.some(item => item.startsWith('submit:')));
      assert.deepEqual(events.filter(item => /^(input|change|click):/.test(item)), enabled ? ['input:choice', 'change:choice', 'click:ok', 'input:ok', 'change:ok'] : []);
      assert.equal(result.filled, enabled ? 2 : 0);
      assert.equal(result.trace.find(item => item.label === 'I agree to the privacy policy').reason, enabled ? '' : 'legal/consent: always your choice');
    } finally { window.close(); }
  }
});

test('trace reason precedence for every unfilled kind and proposals; no answers leak into trace', {skip: !JSDOM}, async t => {
  const rows = [row('file', {type: 'file'}), row('password', {type: 'password'}), row('legal', {legal: true}), row('written', {written: true}), row('demographic', {demographic: true}), row('unanswered', {unanswered: true}), row('unread', {unread: true}), row('no', {type: 'checkbox'}), row('proposed'), row('combo', {type: 'combobox'}), row('choice', {label: 'Option', options: ['Option']}), row('detail', {label: 'Email'}), row('empty'), row('rejected')];
  const {window, fill} = scripted(rows, t);
  const missed = [];
  window.__jobPilottoNoteNotTaken = (field, value) => missed.push([field, value]);
  const result = plain(await fill([answer('no', 'unchecked'), answer('proposed', 'private proposal', {use: 'propose', fact: 'experience', category: 'normal'}), answer('combo', 'private option'), answer('rejected', 'private rejected', {confidence: 'low', note: 'Verify it'})]));
  assert.equal(result.error, undefined);
  assert.deepEqual(result.trace.slice(0, -1).map(item => item.reason), ['upload: no file for this question', 'password: never typed, yours to set', 'legal/consent: always your choice', 'written: your own words to write', 'demographic: your own choice', 'the AI gave no answer', 'question on the page not read', 'answered no: left unchecked', 'proposed for you to confirm', 'dropdown that opens only on a real click', 'question text not found on the page', 'a detail of yours not saved yet (email)', 'no answer in the kit, Profile or your details', 'answer given, but the field did not take it']);
  assert.deepEqual(missed, [['rejected', 'private rejected']]);
  assert.equal(result.trace.find(item => item.label === 'Question rejected').low, 'Verify it');
  assert.equal(result.trace.find(item => item.label === 'Question proposed').fact, 'experience');
  assert.ok(!/private proposal|private option|private rejected/.test(JSON.stringify(result.trace)));
});

test('reminders, question rematching, CV grounding, drafts and proposal matching retain their mutations', {skip: !JSDOM}, async t => {
  const {window, elements, fill} = scripted([row('new'), row('draft', {filled: true, type: 'textarea', value: 'private draft'}), row('cv', {filled: true}), row('only')], t);
  const all = [answer('old', 'private text\n• Add: evidence', {question: 'Question new', draft: 'draft'}), answer('draft', 'private draft', {draft: 'draft'}), answer('only', '• Add: proof'), answer('lost', 'unknown'), answer('old-proposal', 'private proposal', {question: 'Question new', use: 'propose'})];
  window.__jobPilottoProfileEntries = () => [{field: 'cv', value: 'private cv fact', fromCv: true}];
  const result = plain(await fill(all));
  assert.equal(result.error, undefined);
  assert.deepEqual(plain(all[0]), {field: 'new', value: 'private text', question: 'Question new', draft: 'outline', remind: ['evidence']});
  assert.equal(all[2].use, 'kind');
  assert.deepEqual(result.reach, {asked: 4, matched: 1, byQuestion: 1, lost: 2});
  assert.equal(result.trace.find(item => item.label === 'Question cv').reason, 'from your CV: check it');
  assert.equal(result.trace.find(item => item.label === 'Question draft').reason, 'drafted: review it');
  assert.equal(elements.draft.dataset.jobpilottoDraft, 'draft');
  assert.ok(result.todo.includes('Review: Question draft (drafted for you)'));
});

test('gate holds controls, upload and letter while preserving the original plain-fill ordering', {skip: !JSDOM}, async t => {
  const {window, fill} = scripted([row('q')], t);
  const calls = [];
  window.__jobPilottoGate = async () => { calls.push('gate'); return false; };
  window.__jobPilottoFillKnownFields = () => { calls.push('plain'); return {filled: ['q']}; };
  window.__jobPilottoControls = {fill: async () => { calls.push('controls'); return []; }};
  window.__jobPilottoUpload.fill = async () => { calls.push('upload'); return []; };
  const result = plain(await fill([answer('q', 'private')], {letter: 'private letter'}));
  assert.equal(result.error, undefined);
  assert.deepEqual(calls, ['gate', 'plain']);
  assert.equal(result.held, true);
  assert.equal(result.filled, 1);
});

test('operators, lost-on-blur menus, uploads and coverage contribute in their original order', {skip: !JSDOM}, async () => {
  const window = page('<form><label for="q">Work sample</label><input id="q"><label for="other">Other sample</label><input id="other" required><button id="send" type="submit">Submit</button></form>');
  try {
    const calls = [];
    window.__jobPilottoSuggest = {lostOnBlur: async () => { calls.push('blur'); return [{field: 'q', value: 'private sample'}]; }};
    window.__jobPilottoControls = {fill: async (answers, {skip}) => { calls.push('controls'); assert.equal(skip('I agree to privacy policy'), true); return [{kind: 'date', fp: 'date-shape', ok: true, question: 'Chosen date'}, {kind: 'toggle', fp: 'toggle-shape', ok: false, value: 'No', question: 'Toggle', why: 'not kept'}, {kind: 'other', unmatched: true}]; }};
    window.__jobPilottoUpload.fill = async () => { calls.push('upload'); return [{meaning: 'resume', label: 'Resume', ok: true, fp: 'upload-shape'}, {meaning: 'unknown', label: 'Additional document', why: 'wording unknown'}]; };
    window.__jobPilottoCoverage = {unread: () => { calls.push('coverage'); return [{area: window.document.getElementById('other'), question: 'other Other sample', kinds: ['text'], shared: true}]; }, answered: () => false};
    const result = plain(await window.__jobPilottoExtensionFill([answer('q', 'private sample')], {}, null));
    assert.equal(result.error, undefined);
    assert.deepEqual(calls, ['blur', 'controls', 'upload', 'coverage']);
    assert.equal(result.filled, 1);
    assert.equal(result.resumeAttached, true);
    assert.deepEqual(result.unknownUploads, ['Additional document']);
    assert.deepEqual(plain(window.__jobPilottoOperatedQuestions), ['Chosen date', 'Toggle']);
    assert.equal(result.trace.find(item => item.label === 'Other sample').reason, 'question on the page not read');
    assert.deepEqual(result.todo, ['Click the 1 highlighted dropdown(s); each picks its answer when opened', 'Pick "No" for: Toggle (not kept)', 'Answer: Other sample']);
  } finally { window.close(); }
});

test('early guards leave the page untouched', {skip: !JSDOM}, async () => {
  const {window, elements, fill} = fakeFillPage([row('q')]);
  delete window.__jobPilottoGuardActive;
  assert.deepEqual(plain(await fill([])), {error: 'The page helpers did not load; nothing was filled.'});
  window.__jobPilottoGuardActive = true;
  window.__jobPilottoStopped = true;
  assert.deepEqual(plain(await fill([])), {error: 'Stopped by you.', stopped: true});
  assert.equal(elements.q.value, '');
});


test('unanswered menus arm demographics, phone country and profile in order, excluding required salutations', {skip: !JSDOM}, async t => {
  const {window, fill} = scripted([row('demo', {type: 'combobox', label: 'Gender'}), row('title', {type: 'combobox', label: 'Title', demographic: true}), row('phone', {type: 'tel', label: 'Phone'}), row('country', {type: 'combobox', label: 'Country'}), row('city', {type: 'combobox', label: 'Location'})], t);
  const result = plain(await fill([], {profile: {phone: '+41 791234567', location: 'Zurich'}}));
  assert.equal(result.error, undefined);
  assert.deepEqual([...window.document.querySelectorAll('[data-jobpilotto-armed]')].sort((a, b) => a.dataset.jobpilottoArmedId - b.dataset.jobpilottoArmedId).map(el => el.id), ['demo', 'country', 'city']);
  assert.match(window.document.querySelector('.job-pilotto-badge').textContent, /I don't wish to answer/);
  assert.deepEqual(plain(window.__jobPilottoPhone), {field: 'phone', national: '791234567'});
  assert.equal(result.trace.find(item => item.label === 'Gender').source, 'standard answer (demographics)');
  assert.equal(result.trace.find(item => item.label === 'Country').source, 'your details (phone prefix)');
});

test('checkbox groups rematch by question and audit as one row; failed radio choice stays actionable', {skip: !JSDOM}, async () => {
  const window = page('<form><fieldset><legend>How did you hear?</legend><label><input id="site" name="heard" type="checkbox">Careers website</label><label><input id="friend" name="heard" type="checkbox">Friend</label></fieldset><fieldset><legend>Work style</legend><label><input id="remote" type="radio" name="style" value="remote" required>Remote</label><label><input type="radio" name="style" value="office">Office</label></fieldset><button id="send" type="submit">Submit</button></form>');
  try {
    const events = observe(window);
    const all = [answer('stale', 'Friend', {question: 'How did you hear?'}), answer('radio:style', 'Not offered')];
    const result = plain(await window.__jobPilottoExtensionFill(all, {}, null));
    assert.equal(result.error, undefined);
    assert.equal(all[0].field, 'group:How did you hear?');
    assert.equal(window.document.getElementById('friend').checked, true);
    assert.equal(window.document.getElementById('site').checked, false);
    assert.deepEqual(result.trace.map(item => [item.label, item.outcome]), [['How did you hear?', 'filled'], ['Work style', 'left'], ['CV', 'left']]);
    assert.deepEqual(events.filter(item => /^(click|input|change|submit):/.test(item)), ['click:friend', 'input:friend', 'change:friend']);
    assert.ok(result.todo.includes('Pick "Not offered" for: Work style'));
  } finally { window.close(); }
});

test('manual letter reveal fills once; a rejected letter and missing setup retain their urgent messages', {skip: !JSDOM}, async () => {
  for (const reject of [false, true]) {
    const window = page('<form><div><label>Cover letter</label><button id="manual" type="button">Enter manually</button></div><button id="send" type="submit">Submit</button></form>');
    try {
      window.document.getElementById('manual').addEventListener('click', () => {
        const box = window.document.createElement('textarea'); box.id = 'letter'; box.setAttribute('aria-label', 'Cover letter');
        if (reject) box.addEventListener('change', () => { box.value = ''; });
        window.document.getElementById('manual').parentElement.append(box);
      });
      const status = {ready: false, reason: 'Needs setup.', action: 'Write it'};
      const result = plain(await window.__jobPilottoExtensionFill([], {}, {coverLetterStatus: status}, 'private letter'));
      assert.equal(result.error, undefined);
      assert.equal(window.document.getElementById('letter').value, reject ? '' : 'private letter');
      assert.equal(result.filled, 1, 'the original fill counts delivery even if change clears the box');
      assert.equal(result.coverLetterStatus.reason, 'Needs setup.');
      assert.equal(result.todo.some(item => item.startsWith('Important: cover letter was available')), reject);
      assert.equal(result.todo.some(item => item.startsWith('Important: cover letter — Needs setup.')), reject);
    } finally { window.close(); }
  }
});
