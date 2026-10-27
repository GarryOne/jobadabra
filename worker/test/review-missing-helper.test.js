// The panel (extension/review.js) survives a tab where one of its helper scripts did not run (an extension reload with the tab open, a frame that missed a file): no uncaught error,
// whichever helper is missing (14 Oct 2026: "Cannot read properties of undefined (reading 'groupOf')" at review.js:63 on a page the app had marked). One loop over every window.__jobPilotto* helper it names.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadJsdom, openPage } from './helpers/page.js';
import { readPanel } from './helpers/panel.js';
import { PANEL_FILES } from '../../extension/panel-files.js';

const read = (path) => fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const JSDOM = await loadJsdom();
const SOURCE = readPanel();
const HELPERS = [...new Set([...SOURCE.matchAll(/__jobPilotto(\w+)/g)].map((match) => match[1]))].filter((name) => name !== 'ReviewAlive');
const FORM = `<form><label for="a">First name *</label><input id="a" required value="Ada"><fieldset><legend>Pick *</legend><input type="checkbox" name="q[]"><input type="checkbox" name="q[]"></fieldset></form>`;

async function run(missing) {
  const { window } = openPage(JSDOM, FORM);
  const errors = [];
  window.addEventListener('error', (event) => errors.push(event.message));
  const caught = (reason) => errors.push(String(reason));
  process.on('unhandledRejection', caught);
  window.chrome = { runtime: { id: 'test', getManifest: () => ({ version: 'test' }), sendMessage: async (message) => (message.type === 'panelAllowed' ? { ok: true } : {}), onMessage: { addListener() {} } } };
  window.eval(read('extension/page/skeleton.js'));
  window.__jobPilottoReviewPayload ||= () => ({});
  delete window[`__jobPilotto${missing}`];
  const warned = [];
  window.console.warn = (...args) => warned.push(args.join(' '));
  try {
    if (missing === 'CoverLetterNotice') {
      for (const file of PANEL_FILES.filter(name => name !== 'letter-notice.js')) window.eval(read(`extension/${file}`));
      window.eval(read('extension/review.js'));
    } else window.eval(SOURCE);
  } catch (error) { errors.push(String(error)); }
  await new Promise((resolve) => setTimeout(resolve, 100));
  const drawn = !!window.document.getElementById('jobpilotto-review-host');
  window.close();
  process.off('unhandledRejection', caught);
  return { errors, warned, drawn };
}

test('the list of helpers review.js names is not empty (the loop below tests something)', () => assert.ok(HELPERS.includes('OptionGroups') && HELPERS.includes('ReadBack')));

for (const name of HELPERS) {
  test(`review.js with __jobPilotto${name} missing: no uncaught error`, { skip: !JSDOM }, async () => {
    const { errors } = await run(name);
    assert.deepEqual(errors, []);
  });
}

test('without the option grouping the panel still draws (each box its own row); without a hard helper it draws nothing and says which', { skip: !JSDOM }, async () => {
  assert.equal((await run('OptionGroups')).drawn, true);
  const gone = await run('ReadBack');
  assert.equal(gone.drawn, false);
  assert.match(gone.warned.join('\n'), /ReadBack/);
});

test('without the cover-letter notice helper the panel draws nothing and names the missing helper', { skip: !JSDOM }, async () => {
  const result = await run('CoverLetterNotice');
  assert.equal(result.drawn, false);
  assert.match(result.warned.join('\n'), /CoverLetterNotice/);
});
