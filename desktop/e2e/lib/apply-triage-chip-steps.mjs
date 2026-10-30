// The apply suite reads fixture forms in the hidden browser and checks every reachable triage verdict's chip against the renderer's own words.
/* global document */
// Job: wait on state
import assert from 'node:assert/strict';
import {modeOfRead} from '../../renderer/apply-triage-mode.js';
import {CHIPS, chipOf} from '../../renderer/apply-triage-pick.js';
import {readFromJudge} from '../../lib/triage-read.js';
import {FORMS, ONEPAGE, SIGNIN} from './forms.mjs';
import {POSTING} from './apply-fixtures.mjs';
import {CHIP_VALUE} from './apply-triage-steps.mjs';
import {HIDDEN_NEED, autoFormOf, closeHiddenBrowser, evaluateOn, hiddenTargets, kitSeeder, linkRuntime, sessionOf, skipJob, withAccountReadJudge} from './background-proof.mjs';
import {removeJobsByUrl} from './seed-data.mjs';
import {pollUntil, stepTimeLeft} from './wait-on-state.mjs';

const keyOf = read => JSON.stringify(modeOfRead(read));
const plain = {botCheck: false, loginWall: false, accountCreation: false};
const FILLED = `[...document.querySelectorAll('input,textarea,select')].filter(item => !['hidden','submit','button'].includes(item.type) && (['checkbox','radio'].includes(item.type) ? item.checked : item.type === 'file' ? item.files.length : item.value)).map(item => item.id || item.name || item.type)`;

/** Derives all verdicts over the reader's boolean/unknown flags; every distinct mode AND reason needs a fixture or an explicit unreachable explanation. */
function coverage(cases) {
  const flags = Object.keys(readFromJudge(plain));
  const reads = flags.reduce((rows, flag) => rows.flatMap(row => [true, false, null, undefined].map(value => ({...row, [flag]: value}))), [{}]);
  const verdicts = new Set(reads.map(keyOf));
  const saved = readFromJudge(plain, {allFactsSaved: true});
  const unreachable = new Map([
    [keyOf({...saved, eligible: false}), 'triage-reader.report hardcodes eligible: true; apply-triage-mode.test.js covers an ineligible job'],
  ]);
  const covered = cases.map(item => keyOf(item.read));
  assert.equal(new Set(covered).size, cases.length, 'each fixture must cover a different reason');
  assert.deepEqual(new Set([...covered, ...unreachable.keys()]), verdicts, 'a verdict needs a fixture or a documented reader limitation');
  assert.deepEqual(new Set(reads.map(read => modeOfRead(read).mode)), new Set(Object.keys(CHIPS)), 'every chip mode needs a verdict');
  for (const [verdict, why] of unreachable) console.log(`  not reachable by a page read: ${verdict}: ${why}`);
}

/** Waits on state; only the suite's named hang cap ends a hang, and seen keeps its last observation for hangError. */
async function waitOn(seen, what, read, accepts) {
  seen.what = what;
  const {value} = await pollUntil(async () => (seen.state = await read()), accepts, {capMs: stepTimeLeft(), log: () => {}});
  if (!accepts(value)) throw new Error(`${what}; last state: ${JSON.stringify(value)}`);
  return value;
}

/** The fixture job pages still held by the hidden browser; a browser not started yet holds none. */
const pagesOf = async (ctx, cases) => (await hiddenTargets(ctx.profile).catch(() => [])).filter(target => target.type === 'page' && cases.some(item => target.url.split('#')[0] === item.form.url));

/** Samples each live fixture form before its judge responds and during progress waits; any typed value, selected answer or upload fails immediately. */
async function inspectForms(ctx, cases, samples) {
  const pages = await pagesOf(ctx, cases);
  for (const target of pages) {
    const filled = await evaluateOn(target.webSocketDebuggerUrl, FILLED);
    if (!Array.isArray(filled)) continue;   // the read may have closed this target between listing and inspection
    samples.add(target.url.split('#')[0]);
    assert.deepEqual(filled, [], `the read filled controls on ${target.url}`);
  }
  return pages.map(target => target.url.split('#')[0]);
}

/** Reads the Jobs rows' chip value and reason, and the popup's progress, from the real renderer. */
const screenOf = (page, cases) => page.evaluate(({urls, selector}) => ({
  rows: urls.map(url => {
    const row = [...document.querySelectorAll('article.job-row')].find(item => item.dataset.url === url);
    const value = row?.querySelector(selector);
    return {url, label: value?.textContent.trim() || '', reason: value?.closest('.chip-tag')?.getAttribute('title') || ''};
  }),
  progress: document.getElementById('triage-progress-text')?.textContent.trim() || '',
  idle: document.getElementById('triage-progress')?.hidden === true,
}), {urls: cases.map(item => item.form.url), selector: CHIP_VALUE});

/** Runs one real-read chip step. Invariants: only fixture jobs, canned judges, no application session, no fill or POST, and no fixture tab left after a read. */
export async function runTriageChipSteps(ctx, {urls}) {
  const seen = {what: '', state: null};
  await ctx.run('each read verdict gives its own chip on Jobs after Check, with no fill, session or hidden page left', async () => {
    const {page, proxy, forms} = ctx;
    const cases = [
      // Why (30 Oct 2026, owner): C2b plans the details-only form entirely from the profile; the extra required question has no canned saved answer.
      {form: autoFormOf(FORMS.submitter, '?triage-chip=plain'), judged: plain, allFactsSaved: true},
      {form: {...FORMS.submitter, url: `${FORMS.submitter.url}?triage-chip=unsaved`}, judged: plain, allFactsSaved: false},
      {form: autoFormOf(FORMS.submitter, '?check=triage-chip'), judged: {...plain, botCheck: true}},
      {form: {...SIGNIN, url: `${SIGNIN.accountUrl}?triage-chip=login`}, judged: {...plain, loginWall: true}},
      {form: {...ONEPAGE, url: `${ONEPAGE.url}?triage-chip=account`}, judged: {...plain, accountCreation: true}},
    ].map(item => ({...item, read: readFromJudge(item.judged, {allFactsSaved: item.allFactsSaved})}));
    coverage(cases);
    const unlinked = linkRuntime(ctx.profile);
    if (unlinked) throw new Error(unlinked);
    const previous = proxy.canned(), samples = new Set(), judged = new Set();
    const standIn = withAccountReadJudge(previous, 'Submit Application', async () => {
      for (const url of await inspectForms(ctx, cases, samples)) judged.add(url);
    });
    proxy.setCanned(standIn);
    const posted = forms.posts.length, fired = forms.fired.length, signedIn = forms.signinPosts.length;
    try {
      // Clear once; subsequent seeds retain the other verdict fixtures, so one Check reads all of them.
      await removeJobsByUrl(ctx, cases.map(item => item.form.url));
      for (const {form} of cases) await kitSeeder(ctx, urls, POSTING)({...form, company: 'Triage chip fixtures'});
      await page.reload();
      await waitOn(seen, 'Jobs navigation', () => page.locator('.nav[data-view="jobs"]').isVisible(), Boolean);
      await page.click('.nav[data-view="jobs"]');
      await page.fill('#filter-text', 'Triage chip fixtures');
      await waitOn(seen, 'the unread fixture rows', () => screenOf(page, cases), screen => screen.rows.every(row => row.label === chipOf(null).label));
      await page.click('#triage-open');
      await waitOn(seen, 'the Check popup', () => page.locator('#triage-dialog').evaluate(dialog => dialog.open), Boolean);
      await page.fill('#triage-n', String(cases.length));
      await page.click('#triage-start');
      const finished = await waitOn(seen, 'all reads complete and Jobs redraws their chips', async () => {
        const open = await inspectForms(ctx, cases, samples);
        return {...await screenOf(page, cases), open};
      }, screen => screen.idle && screen.progress === `${cases.length} of ${cases.length}` && screen.rows.every(row => row.label && row.label !== chipOf(null).label));
      for (const item of cases) {
        const row = finished.rows.find(row => row.url === item.form.url), expected = chipOf(item.read);
        assert.equal(row.label, CHIPS[modeOfRead(item.read).mode].label, `${item.form.url}: wrong chip`);
        assert.equal(row.reason, expected.detail, `${item.form.url}: wrong verdict reason`);
        assert.ok(samples.has(item.form.url), `never inspected the hidden form: ${item.form.url}`);
        assert.ok(judged.has(item.form.url), `no form judge saw ${item.form.url}`);
        assert.equal(await sessionOf(page, item.form.url), '', 'a read left an application session');
        console.log(`  ${JSON.stringify(modeOfRead(item.read))} via ${item.form.url}`);
      }
      await waitOn(seen, 'all read tabs close', () => pagesOf(ctx, cases), pages => pages.length === 0);
      assert.equal(forms.posts.length, posted, 'a read posted a form');
      assert.equal(forms.fired.length, fired, 'a read pressed a sending control');
      assert.equal(forms.signinPosts.length, signedIn, 'a read signed in');
    } finally {
      await page.click('#triage-cancel').catch(() => {});   // a run still going would read on into the next hidden-browser step
      await page.waitForSelector('#triage-progress', {state: 'hidden'}).catch(() => {});
      proxy.setCanned(previous);
      for (const {form} of cases) await skipJob(page, form);
      await closeHiddenBrowser(ctx.profile);
      await page.locator('#triage-close').click().catch(() => {});
      await page.fill('#filter-text', '').catch(() => {});
      await removeJobsByUrl(ctx, cases.map(item => item.form.url));
    }
  }, {needs: [...ctx.needs, HIDDEN_NEED], hangError: ms => new Error(`the chip step hung within ${ms / 1000} s: ${seen.what}; last state: ${JSON.stringify(seen.state)}`)});
}
