// One message surface per page (owner, 15 Oct 2026: "why do we see both panels, top-right and bottom-left?"): every note goes into the panel's note line while the panel is on the page,
// the floating box only for a page without one; and a page with no form never says Ready or counts (the panel reads the page mark the fill flow sets).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';

const read = name => fs.readFileSync(new URL(`../../extension/${name}`, import.meta.url), 'utf8');

test('a note reaches the panel first: shown means no toast, no answer means the fallback box', async () => {
  const sent = [];
  globalThis.chrome = {tabs: {sendMessage: async (tab, message) => { sent.push([tab, message]); return tab === 1 ? {shown: true} : tab === 2 ? {shown: false} : Promise.reject(new Error('no receiver')); }}};
  const {tellPanel} = await import('../../extension/page-notes.js');
  assert.equal(await tellPanel(1, 'A dialog is in the way', false), true);
  assert.equal(await tellPanel(2, 'x'), false);        // the panel is not on the page
  assert.equal(await tellPanel(3, 'x'), false);        // no panel script at all
  assert.deepEqual(sent[0], [1, {type: 'panelNote', text: 'A dialog is in the way', anyway: false}]);
});

test('class: every toast the worker draws asks the panel first, and the panel answers panelNote', () => {
  const background = read('background.js');
  const toasts = [...background.matchAll(/^async function (\w+)\(([^)]*)\) \{[^\n]*\n([\s\S]*?)^\}/gm)].filter(([, , , body]) => /top:12px;right:12px/.test(body));
  assert.deepEqual(toasts.map(([, name]) => name).sort(), ['ineligibleNote', 'note']);   // the only two note toasts of background.js (the step box is the panel's already, progress())
  for (const [, name, , body] of toasts) assert.ok(body.indexOf('tellPanel(') > -1 && body.indexOf('tellPanel(') < body.indexOf('top:12px'), `${name} draws before asking the panel`);
  assert.match(read('review.js'), /message\?\.type !== 'panelNote'[\s\S]*note\(String\(message\.text/);
  // dialog-after-fill.js and submit-watch.js reach the screen only through note() (their own box would be a second surface).
  for (const file of ['dialog-after-fill.js', 'submit-watch.js', 'fill-flow.js', 'flow.js']) assert.doesNotMatch(read(file), /top:12px;right:12px/, `${file} draws its own box`);
});

test('a page mark of posting or opening is never Ready and never counts; the fill flow sets it from the AI\'s kind', async () => {
  const panel = read('review.js');
  assert.match(panel, /ready = !moved && !pageMark && total > 0 && left === 0/);
  assert.match(panel, /pageMark \? \(MARK_WORDS\[pageMark\] \|\| 'Apply button detected\. Redirecting…'\)/g);   // the owner's own words for a posting; a page not judged yet is only being read
  assert.match(panel, /pageMark = \(m => \(\['form', 'account', 'sign-up'\]\.includes\(m\) \? '' : m \|\| 'reading'\)\)\(document\.documentElement\.getAttribute\('data-jobpilotto-page'\) \|\| ''\)/, 'default-deny: Ready only on a page judged to be a form');
  assert.match(panel, /!account && !pageMark;/, 'no CV tip on a page that is not a form');
  assert.match(read('page/review-payload.js'), /page: \(mark => mark \|\| 'reading'\)/, 'the app hears the same: an unjudged page reports no counts');
  assert.match(['fill-flow.js', 'fill-flow-read.js', 'fill-flow-steps.js'].map(read).join('\n'), /markPage\(tab\.id, role, false, kind, \{working: true\}\);/, 'set while the read goes on: no verdict yet (extension/working-mark.js)');
  assert.match(['fill-flow.js', 'fill-flow-read.js', 'fill-flow-steps.js'].map(read).join('\n'), /markPage\(tab\.id, role, pressed, kind, \{working: !!watching\}\);/, 'the end: a verdict, or working while a field watch may judge again (working-mark.js)');
  const {markOf} = await import('../../extension/tab-pages.js');
  assert.deepEqual([markOf('no-form'), markOf('no-form', true), markOf('form'), markOf('account'), markOf('account', false, 'sign_up'), markOf('reading'), markOf('signing-in'), markOf('other')],
    ['posting', 'opening', 'form', 'account', 'sign-up', 'reading', 'signing-in', '']);
});
