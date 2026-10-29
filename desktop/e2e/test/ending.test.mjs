// The outcome contract's classifier (lib/ending.mjs; spec docs/superpowers/specs/2026-10-12-one-next-move.md, phase 1a): one ending per pool row, from the row's EXISTING report
// (reached, the notes the run parser wrote, each required field's outcome and reason), never from page text. A row that is not an application outcome (a harness that did not finish,
// the privacy tripwire, a refused AI) is not counted.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {ENDINGS} from '../../../extension/ladder/endings.js';
import {ACCOUNT_HELD, APPLY_BY_EMAIL, LOGIN_WALL, PAGE_TELLS, SITE_REFUSED} from '../lib/record-sites.mjs';
import {HELD_BY_TEST, REASONS, RUN_ERRORS, STOP_LINES, STOP_STUCK, endingOf, fieldEnding, tally} from '../lib/ending.mjs';
import {STUCK_REASONS, endingOfStuck} from '../../../extension/ladder/endings.js';
import {seenDeadEnd} from '../../../extension/ladder/dead-end.js';

const field = (reason, extra = {}) => ({outcome: 'left', type: 'text', label: 'Q', required: true, reason, ...extra});
const form = (fieldList, extra = {}) => ({reached: 'form', filled: 3, left: fieldList.length, fieldList, errors: [], exit: 0, ...extra});

test('a required two-state control answered "no" and left unchecked is an answer kept: the form is ready, never a missed field', () => {
  // 15 Oct 2026, Migros group site (Umantis): "Ich bin/war Mitarbeiter in der Migros-Gruppe", answered no by the AI, held unchecked; its reason "answered no: left unchecked" fell to
  // "something new" -> unresolved, so the row sat on Needs a fix although every field left was an answer or the person's own (record-sites verdictOf already counts it filled).
  const answeredNo = field('answered no: left unchecked', {type: 'checkbox'});
  assert.equal(fieldEnding(answeredNo), 'ready');
  assert.equal(endingOf(form([answeredNo, field('proposed for you to confirm', {type: 'radio'}), field('demographic: your own choice', {type: 'radio'})])).ending, 'ready');
  assert.equal(endingOf(form([answeredNo, field('something new')])).ending, 'unresolved', 'a real miss beside it still counts');
});

test('a required upload slot with no file to give is a document only the person has: data_missing, never a missed field', () => {
  // 15 Oct 2026, Recruitee form (Channable): "Can you please attach your motivational letter?" (a required file slot), reason "upload: no file for this question": the app has no such file,
  // so it is ours to leave, not a control we missed; it fell to "something new" -> unresolved and kept the row on Needs a fix.
  const noFile = field('upload: no file for this question', {type: 'file'});
  assert.equal(fieldEnding(noFile), 'data_missing');
  assert.equal(endingOf(form([noFile, field('proposed for you to confirm', {type: 'radio'})])).ending, 'data_missing');
  assert.equal(endingOf(form([noFile, field('something new')])).ending, 'unresolved', 'a real miss beside it still counts');
});

test('a form whose required fields left are all the person\'s (proposals, consent, own words, demographics, a password) is ready', () => {
  const rows = [field('proposed for you to confirm'), field('legal/consent: always your choice', {type: 'checkbox'}), field('written: your own words to write', {type: 'textarea'}),
    field('demographic: your own choice', {type: 'radio'}), field('no answer in the kit, Profile or your details', {type: 'password'})];
  assert.equal(endingOf(form(rows)).ending, 'ready');
  assert.equal(endingOf({reached: 'ready', filled: 9, left: 0, fieldList: [], errors: [], exit: 0}).ending, 'ready');
  assert.equal(endingOf(form([field('proposed for you to confirm'), {...field('x'), required: false, reason: 'answer given, but the field did not take it'}])).ending, 'ready', 'an optional field never decides');
});

test('the worst required field decides: a field we missed (unresolved) > a control not seen (blind) > an answer only the person has (data_missing)', () => {
  const missing = field('no answer in the kit, Profile or your details'), notSaved = field('a detail of yours not saved yet (postal_code)');
  const blind = field('no place to attach it was found on this page', {type: 'file'}), unread = field('question on the page not read');
  const missed = [field('answer given, but the field did not take it', {type: 'radio'}), field('dropdown clicked, but no option matched (9.8 s)', {type: 'combobox'}), field('dropdown that opens only on a real click', {type: 'combobox'})];
  assert.equal(endingOf(form([missing, notSaved, field('proposed for you to confirm')])).ending, 'data_missing');
  assert.equal(endingOf(form([missing, blind])).ending, 'blind');
  assert.equal(endingOf(form([unread])).ending, 'blind');
  for (const one of missed) assert.equal(endingOf(form([missing, blind, one])).ending, 'unresolved', one.reason);
  assert.deepEqual(['proposed for you to confirm', 'no answer in the kit, Profile or your details', 'question text not found', 'something new'].map(reason => fieldEnding(field(reason))), ['ready', 'data_missing', 'blind', 'unresolved']);
});

test('data_missing is only a fact we truly lack; the AI declining is our miss: unresolved, counted apart (cc review, 12 Oct 2026)', () => {
  const declined = field('the AI gave no answer (asked twice)');
  assert.equal(fieldEnding(declined), 'unresolved');
  assert.deepEqual(endingOf(form([declined, field('no answer in the kit, Profile or your details')])), {ending: 'unresolved', why: '2 required left; the first unresolved: text, the AI gave no answer (asked twice)', cause: 'ai-miss', aiMiss: true});
  assert.equal(endingOf(form([declined, field('answer given, but the field did not take it')])).aiMiss, undefined, 'a mechanism miss beside it: not only the AI');
  assert.equal(endingOf(form([field('a detail of yours not saved yet (postal_code)')])).ending, 'data_missing');
  assert.equal(tally([endingOf(form([declined]))]).aiMiss, 1);
});

test('a form the run could not count, or left covered, is unresolved', () => {
  assert.equal(endingOf(form([], {filled: null, left: null, errors: ['form fill did not report: /apply']})).ending, 'unresolved');
  for (const error of ['a dialog was left open over the form', 'held: a dialog covers the form (nothing was typed)', 'form judge: the page is blocked after the fill (overlay)'])
    assert.equal(endingOf(form([field('proposed for you to confirm')], {errors: [error]})).ending, 'unresolved', error);
  assert.equal(endingOf(form([field('proposed for you to confirm')], {errors: ['cookie layer still open at the end: OK']})).ending, 'ready', 'a cookie bar left under a reached form is its own miss, not the ending');
});

test('the run parser\'s notes name the ending before the page', () => {
  const at = (reached, note) => endingOf({reached, note, fieldList: [], errors: [], exit: 0}).ending;
  assert.equal(at('posting', APPLY_BY_EMAIL), 'told');
  assert.equal(at('posting', PAGE_TELLS), 'told');
  assert.equal(at('form', 'eligibility stop: the job needs a Swiss work permit'), 'told');
  assert.equal(at('posting', LOGIN_WALL), 'handed', 'a sign-in to an existing account: the person\'s');
  assert.equal(at('code/bot', ''), 'handed', 'a bot check on a person\'s address');
  assert.equal(at('none', 'posting gone (HTTP 404)'), 'site_broken');
  assert.equal(at('posting', SITE_REFUSED), 'site_broken');
  assert.equal(at('posting', ''), 'unresolved', 'a stop with no reason is a counted bug');
  assert.equal(at('account', ''), 'unresolved');
});

test('with the row\'s app log, a stop line the extension wrote refines a stop the parser left without a note; the last one counts', () => {
  const log = lines => lines.map(text => `10:00:00 [extension] fill: ${text} {"host":"x.example"}`).join('\n');
  const posting = {reached: 'posting', fieldList: [], errors: [], exit: 0};
  assert.equal(endingOf(posting, log([STOP_LINES.email])).ending, 'told');
  assert.equal(endingOf(posting, log([STOP_LINES.told])).ending, 'told');
  assert.equal(endingOf(posting, log([STOP_LINES.botCheck])).ending, 'handed');
  assert.equal(endingOf(posting, log([STOP_LINES.unreadable])).ending, 'site_broken');
  assert.equal(endingOf(posting, log([STOP_LINES.broken])).ending, 'site_broken');
  assert.equal(endingOf(posting, log([STOP_LINES.email, STOP_LINES.other])).ending, 'unresolved', 'the last stop counts');
  assert.equal(endingOf(posting, '10:00:00 [review] fill: a bot check in front of the page {}').ending, 'unresolved', 'only the extension\'s own lines');
});

test('the test\'s own holds are not outcomes: the pool\'s account hold and a bot wall on a CI runner\'s address are held by the test, out of the denominator', () => {
  assert.deepEqual(endingOf({reached: 'account', note: ACCOUNT_HELD, fieldList: [], errors: [], exit: 0}), {ending: null, why: HELD_BY_TEST, held: 'account-first', cause: 'account-first'});
  assert.deepEqual(endingOf({reached: 'code/bot', fieldList: [], errors: [], exit: 0}, '', {ci: true}), {ending: null, why: HELD_BY_TEST, held: 'bot wall on the CI address', cause: 'bot-wall'});
  const createAccount = form([{outcome: 'filled', type: 'text', required: true, reason: 'your details'}, field('no answer in the kit, Profile or your details', {type: 'password'}),
    field('no answer in the kit, Profile or your details', {type: 'password'}), field('no place to attach it was found on this page', {type: 'file'})], {path: [{kind: 'posting'}, {kind: 'account-form'}]});
  assert.deepEqual(endingOf(createAccount), {ending: null, why: HELD_BY_TEST, held: 'account step', cause: 'account-step'}, 'a sign-up page the AI called account-form: the account step');
  const applicationWithPassword = form([...createAccount.fieldList, field('proposed for you to confirm', {type: 'radio'})], {path: [{kind: 'account-form'}]});
  assert.notEqual(endingOf(applicationWithPassword).ending, null, 'an application question beside the password: the form is measured');
  assert.notEqual(endingOf({...createAccount, path: [{kind: 'form'}]}).ending, null, 'a form page is measured');
  const sum = tally([{ending: 'ready'}, {ending: null, why: HELD_BY_TEST}, {ending: null, why: 'the run did not finish'}]);
  assert.deepEqual([sum.counted, sum.held, sum.uncounted, sum.resolution], [1, 1, 1, 1]);
});

test('a row that is not an application outcome is not counted, and says why', () => {
  assert.deepEqual(endingOf({reached: 'form', tripped: true, fieldList: [], errors: []}), {ending: null, why: 'the privacy tripwire'});
  assert.equal(endingOf({reached: 'none', aiRefused: {calls: 3, why: 'no credit'}, fieldList: [], errors: []}).why, 'the AI was refused');
  assert.equal(endingOf({reached: 'none', exit: 1, fieldList: [], errors: ['Error: boom']}).why, 'the run did not finish');
  assert.equal(endingOf(null).why, 'no result');
});

test('every ending is one of the fixed list; the tally counts each and the resolution share leaves the uncounted out', () => {
  const rows = [form([field('proposed for you to confirm')]), {reached: 'posting', fieldList: [], errors: [], exit: 0}, {reached: 'code/bot', fieldList: [], errors: [], exit: 0}, {reached: 'form', tripped: true, fieldList: [], errors: []}];
  const sum = tally(rows.map(row => endingOf(row)));
  assert.deepEqual(sum, {counted: 3, held: 0, uncounted: 1, aiMiss: 0, endings: {ready: 1, told: 0, handed: 1, blind: 0, data_missing: 0, site_broken: 0, unresolved: 1}, resolution: 2 / 3});
  assert.deepEqual(Object.keys(sum.endings), ENDINGS);
});

test('every trace word the classifier reads is still written by the code that writes it: a reworded reason fails here, never silently moving rows', () => {
  const fill = fs.readFileSync(new URL('../../../extension/page/fill.js', import.meta.url), 'utf8'), smoke = fs.readFileSync(new URL('../lib/record-sites.mjs', import.meta.url), 'utf8');
  for (const [name, words] of Object.entries(REASONS)) assert.ok(fill.includes(`'${words}'`), `${name}: "${words}" is no longer written by extension/page/fill.js`);
  for (const [name, words] of Object.entries(RUN_ERRORS)) assert.ok(smoke.includes(words), `${name}: "${words}" is no longer written by desktop/e2e/lib/record-sites.mjs`);
});

test('the stop lines the classifier reads are the extension\'s own words: a rename in fill-flow.js fails here, never silently', () => {
  const flow = ['fill-flow.js', 'fill-flow-read.js', 'fill-flow-steps.js', 'ladder/site-broken.js'].map(file => fs.readFileSync(new URL(`../../../extension/${file}`, import.meta.url), 'utf8')).join('\n');
  for (const [name, words] of Object.entries(STOP_LINES)) assert.ok(flow.includes(words), `${name}: "${words}" is no longer a line of extension/fill-flow.js or ladder/site-broken.js`);
});

test('the baseline CLI: unresolved first with its cause, the test\'s holds apart, a CI artifact counts only its own run\'s rows', async () => {
  const {execFileSync} = await import('node:child_process');
  const os = await import('node:os'), path = await import('node:path');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-endings-')), mac = path.join(root, 'mac'), ci = path.join(root, 'ci-123', 'smoke-reports');
  fs.mkdirSync(mac, {recursive: true}); fs.mkdirSync(ci, {recursive: true});
  const row = extra => ({fieldList: [], errors: [], exit: 0, ...extra});
  fs.writeFileSync(path.join(mac, '2026-10-12.json'), JSON.stringify({day: '2026-10-12', results: {
    'A form': row({reached: 'form', fieldList: [field('dropdown clicked, but no option matched (9.8 s)', {type: 'combobox'})]}), 'A sign-up': row({reached: 'account', note: ACCOUNT_HELD})}}));
  fs.writeFileSync(path.join(ci, '2026-10-12.json'), JSON.stringify({day: '2026-10-12', thisRun: {ran: ['A wall']}, results: {'A wall': row({reached: 'code/bot'}), 'Not this run': row({reached: 'ready'})}}));
  const out = execFileSync(process.execPath, [new URL('../endings-baseline.mjs', import.meta.url).pathname, mac, ci], {encoding: 'utf8'});
  assert.match(out.split('\n')[0], /^UNRESOLVED \(the work list, newest run per row\): 1$/);
  assert.match(out, /- A form \[Custom, mac 2026-10-12\]: 1 required left; the first unresolved: combobox, dropdown clicked, but no option matched/);
  assert.match(out, /HELD BY THE TEST, not measured: 2 \(1 account-first, 1 bot wall on the CI address\)/);
  assert.match(out, /resolution, raw: 0% of 1 rows/);
  assert.doesNotMatch(out, /Not this run/);
});

// ONE ending rule (cc's review, 12 Oct 2026): the replays (lib/page-replay.mjs: endingOfStuck on the report) and the pool's classifier (this file: the row's app log) get the same
// stops and must give the same ending, so the Resolution score and the replays cannot drift.
test('the same stop gives the same ending to the replays and to the pool classifier: the door\'s line, and every older stop line', () => {
  const posting = {reached: 'posting', fieldList: [], errors: [], exit: 0};
  const line = (why, named) => `10:00:00 [extension] fill: dead end: ${why} ${JSON.stringify({host: 'x.example', ending: endingOfStuck(why, named ? 'a need' : ''), named, rung: 2})}`;
  for (const why of STUCK_REASONS) for (const named of [true, false]) {
    assert.equal(endingOf(posting, line(why, named)).ending, endingOfStuck(why, named ? 'Sign in with your password for this site' : ''), `${why}, need named: ${named}`);
  }
  for (const [name, [why, named]] of Object.entries(STOP_STUCK)) {
    assert.ok(STUCK_REASONS.includes(why), `${name}: a reason the extension sends`);
    assert.equal(endingOf(posting, `10:00:00 [extension] fill: ${STOP_LINES[name]} {}`).ending, endingOfStuck(why, named ? 'a need' : ''), name);
  }
  assert.deepEqual(Object.keys(STOP_STUCK).sort(), Object.keys(STOP_LINES).sort(), 'every stop line is read as a stop');
  const both = `10:00:00 [extension] fill: ${STOP_LINES.noForm} {}\n${line('account', true)}\n10:00:02 [extension] fill: ${STOP_LINES.other} {}`;
  assert.equal(endingOf(posting, both).ending, 'handed', 'the door\'s line wins over an older stop line, whatever their order');
});

test('a dead end seen in shadow (the silent rule) never moves an ending: the door\'s line is skipped by its shadow field', () => {
  const posting = {reached: 'posting', fieldList: [], errors: [], exit: 0};
  const lines = [];
  assert.equal(seenDeadEnd('silent', 'x.example', {kind: 'navigated', silentMs: 31000}, (area, what, data) => lines.push(`10:00:05 [extension] ${area}: ${what} ${JSON.stringify(data)}`)), true);
  const stop = `10:00:00 [extension] fill: dead end: account ${JSON.stringify({host: 'x.example', ending: 'handed', named: true})}`;
  assert.equal(endingOf(posting, `${stop}\n${lines[0]}`).ending, 'handed', 'a shadow line after the stop leaves the stop');
  assert.deepEqual(endingOf(posting, lines[0]), endingOf(posting, ''), 'a shadow line alone is as no line');
  assert.equal(endingOf(form([field(REASONS.legal)]), lines[0]).ending, 'ready');
});
