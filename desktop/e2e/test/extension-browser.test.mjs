// E2E_BROWSER=msedge runs the extension in Edge; anything else keeps Playwright's Chromium.
import test from 'node:test';
import assert from 'node:assert/strict';
import {browserChannel, formTab} from '../lib/extension.mjs';

test('the apply suite uses Edge only when asked', () => {
  assert.deepEqual(browserChannel({E2E_BROWSER: 'msedge'}), {channel: 'msedge'});
  assert.deepEqual(browserChannel({}), {});
  assert.deepEqual(browserChannel({E2E_BROWSER: 'chrome'}), {});
});

// A fixture browser's addresses resolve to the local fixture server: they are not live visits and never reach the per-site ledger
// (12 Oct 2026: local apply runs filled jobs.lever.co's daily 3 and the next run's Lever step was refused). A real browser's are counted.
test('only a real browser counts its visits in the site ledger', async () => {
  const fs = await import('node:fs'), os = await import('node:os'), path = await import('node:path');
  const {visitGuard} = await import('../lib/extension.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-ledger-'));
  const env = {JOB_PILOTTO_SITE_LEDGER_DIR: dir, JOB_PILOTTO_SITE_LIMIT: '1'};
  try {
    for (let i = 0; i < 3; i++) visitGuard(false)('https://jobs.lever.co/e2e/1/apply', {env, who: 'browser'});
    assert.equal(fs.existsSync(path.join(dir, 'ledger.json')) ? Object.keys(JSON.parse(fs.readFileSync(path.join(dir, 'ledger.json'), 'utf8'))).length : 0, 0, 'a fixture visit was written to the ledger');
    visitGuard(true)('https://jobs.lever.co/e2e/1/apply', {env, who: 'twin'});
    const days = Object.values(JSON.parse(fs.readFileSync(path.join(dir, 'ledger.json'), 'utf8')));
    assert.equal(days[0]?.['jobs.lever.co']?.visits?.length, 1, 'a real browser\'s visit was not counted');
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});

// Beta 40281407461 (26 Oct 2026), Windows apply-1of2 in Edge: the extension's install opened its settings tab while the harness reused a blank tab for the
// app's first form; the form loaded in another tab (319271653, opened from the first) and the test watched the first pick for 90 s ("state: null").
test('the form tab is the one that shows the form\'s address, not the harness\'s first pick', () => {
  const page = url => ({url: () => url, isClosed: () => false});
  const url = 'https://boards.greenhouse.io/e2e/jobs/4001001#jobpilotto-fill=2ce1ef73';
  const picked = page('about:blank'), real = page(url);
  const browser = {pages: {'https://boards.greenhouse.io/e2e/jobs/4001001': picked}, context: {pages: () => [picked, real]}};
  assert.equal(formTab(browser, url), real);
  const shown = {pages: {'https://boards.greenhouse.io/e2e/jobs/4001001': real}, context: {pages: () => [page(url), real]}};
  assert.equal(formTab(shown, url), real, 'the first pick wins while it shows the form');
  const loading = {pages: {'https://boards.greenhouse.io/e2e/jobs/4001001': picked}, context: {pages: () => [picked]}};
  assert.equal(formTab(loading, url), picked, 'nothing shows it yet: the first pick, still loading');
});
