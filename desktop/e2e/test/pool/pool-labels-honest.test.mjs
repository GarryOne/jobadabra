// The runner writes an honest note for each stop that is a rule, not a failure: a posting that asks for an e-mail with no address named, a closed posting (the digest's fixed "expired"),
// a menu the site gave no choices for. One loop over the cases; each has a control that must stay a failure. Owner, 15 Oct 2026: holds are never "Needs a fix".
import test from 'node:test';
import assert from 'node:assert/strict';
import {APPLY_BY_EMAIL, POSTING_CLOSED, parseLive, verdictFields} from '../../lib/record-sites.mjs';

const P = '  live +  0s: Apply pressed on https://jobs.example.com/job/1/';
const KIND = '      log 10:00:00.000Z [extension] page kind: posting {"shape":"jobs.example.com/job/*|0","by":"ai","rung":2}';
const line = text => `      log 10:00:01.000Z [extension] ${text}`;

const HOLDS = [
  {name: 'e-mail asked, no address named (the extension says "no form" with applyBy email)', lines: [line('fill: no form on this page {"host":"jobs.example.com","role":"no-form","applyBy":"email"}')], note: APPLY_BY_EMAIL},
  {name: 'closed posting: the digest\'s fixed outcome expired', lines: [line('digest: outcome=expired verb=tell_person numbers=[2] press_kind=- dropped=- {"shape":"jobs.example.com/job/*|0"}')], note: POSTING_CLOSED},
];
const CONTROLS = [
  {name: 'no form, the AI did not say e-mail', lines: [line('fill: no form on this page {"host":"jobs.example.com","role":"no-form","applyBy":"other"}')]},
  {name: 'no form, nothing said', lines: [line('fill: no form on this page {"host":"jobs.example.com","role":"no-form"}')]},
  {name: 'the digest said other', lines: [line('digest: outcome=other verb=none numbers=[] press_kind=- dropped=-')]},
];

test('a stop that is a rule gets its hold note; the controls stay unnoted', () => {
  for (const hold of HOLDS) assert.equal(parseLive([P, KIND, ...hold.lines].join('\n')).note, hold.note, hold.name);
  for (const control of CONTROLS) assert.equal(parseLive([P, KIND, ...control.lines].join('\n')).note, undefined, control.name);
});

test('a closed posting words in free text decide nothing: only the fixed outcome does', () => {
  const free = line('digest: outcome=other verb=none numbers=[] press_kind=- dropped=- {"why":"the job posting no longer exists"}');
  assert.equal(parseLive([P, KIND, free].join('\n')).note, undefined);
});

// A left field whose menu showed no choice at all is explained (the site offered nothing to pick); one the menu did offer choices for is still ours.
const FORM = (menu, reason = 'the site did not keep it after its tries: left for you') => [P,
  line('fill: filling {"page":"/apply"}'),
  ...(menu ? [line(`fill: a menu showed no choice that matched {"field":"Location","choices":${menu},"peek":""}`)] : []),
  line('fill: fields: 4 filled, 1 left {"url":"/apply"}'),
  '      field filled text "Name" required=true reason=your profile',
  `      field left text "Location" required=true reason=${reason}`].join('\n');

test('a menu that showed no choice is an explained field; with choices shown, or no menu line, it stays unexplained', () => {
  assert.deepEqual(verdictFields(parseLive(FORM('[]'))), {asked: 2, unexplained: 0});
  assert.equal(verdictFields(parseLive(FORM('["Zurich","Bern"]'))).unexplained, 1);
  assert.equal(verdictFields(parseLive(FORM(null))).unexplained, 1);
});

// The real log's shape (a pool run, 12 Oct 2026, scrubbed): choices is a joined string, empty when none, and the keys come in the app's own order.
test('the real menu line (choices as an empty string, keys in the app\'s order) explains the field; a non-empty string does not', () => {
  const real = choices => FORM('[]').replace(/.*a menu showed no choice.*\n/, line(`fill: a menu showed no choice that matched {"choices":${choices},"field":"Location","peek":" | selected","version":"0.9.229"}`) + '\n');
  assert.equal(verdictFields(parseLive(real('""'))).unexplained, 0);
  assert.equal(verdictFields(parseLive(real('"Zurich | Bern"'))).unexplained, 1);
});
