// Every documented hold keeps its note on a REAL pool log, whose summary reprints the digest line after the fill lines (pool-batch, 11 Oct 2026).
import test from 'node:test';
import assert from 'node:assert/strict';
import {parseLive, ACCOUNT_HELD, SITE_REFUSED, LOGIN_WALL, APPLY_BY_EMAIL, PAGE_TELLS} from '../../lib/record-sites.mjs';

const P = 'Apply pressed on https://example.org/job/1';
const log = (digest, fill) => [
  `  live +  0s: ${P}`,
  `      log 18:46:43.341Z [extension] page kind: posting {"shape":"example.org/job|0","by":"digest","rung":3,"confidence":0.9}`,
  `      log 18:46:46.940Z [extension] digest: outcome=${digest} verb=tell_person numbers=[1] press_kind=- dropped=- {"shape":"example.org/job|0"}`,
  ...(fill ? [`      log 18:46:46.977Z [extension] fill: ${fill} {"host":"example.org","role":"no-form","version":"0.9.209"}`] : []),
  'page kinds:',
  '  18:46:46 [extension] page kind: posting {"shape":"example.org/job|0","by":"digest","rung":3}',
  'digest:',
  `  18:46:46 [extension] digest: outcome=${digest} verb=tell_person numbers=[1] press_kind=- dropped=- {"shape":"example.org/job|0"}`,
].join('\n');

const HOLDS = [
  {name: 'refused', output: log('refused'), note: SITE_REFUSED},
  {name: 'login wall', output: log('login_wall'), note: LOGIN_WALL},
  {name: 'e-mail', output: log('email', 'the posting asks for the application by email: reported to the app'), note: APPLY_BY_EMAIL},
  {name: 'page tells', output: log('tell_person', 'the page tells what to do: reported to the app'), note: PAGE_TELLS},
  {name: 'eligibility', output: log('none', 'did not fill: not eligible, needs a work permit {"host":"example.org"}'), note: 'eligibility stop: not eligible, needs a work permit'},
  {name: 'account first', output: ['page kind: account {"host":"example.org"}', 'fill: "a form came" after the press'].join('\n'), note: ACCOUNT_HELD},
];
// A page that never loads (the site's own 5xx, "Error 500 – Technical issue"): the extension's fixed line is all the run has, no page kind was decided (Digitec, 13 Oct 2026: the pool said "Unclear").
const BROKEN = [`  live +  0s: ${P}`,
  '      log 23:09:36.600Z [extension] fill: the page could not be read {"host":"example.org","version":"0.9.468"}',
  '      log 23:09:47.098Z [extension] fill: a broken page: reported as site_broken {"fromForm":false,"host":"example.org","kind":"unreadable","status":0,"tries":1,"version":"0.9.468"}',
  'pageKind:', '  (none in the app log)'].join('\n');
HOLDS.push({name: 'site error (a page that never loads)', output: BROKEN, note: SITE_REFUSED});
test('every documented hold keeps its note when the summary reprints the digest line', () => {
  for (const hold of HOLDS) assert.equal(parseLive(hold.output).note, hold.note, hold.name);
});
