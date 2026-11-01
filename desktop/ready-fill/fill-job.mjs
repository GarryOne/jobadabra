// One job of the night (private spec jobadabra-lab:docs/specs/2026-10-17-ready-to-send.md): open the job's form (the address the app's Apply opens, lib/form-address.js) in a tab of the night's browser, ask the real extension to fill it the way the app's "Apply" does (the address hash, then the panel's Fill
// button), and read what it reported to the stand-in. The tab stays open, filled, for the morning. Nothing here presses Submit or an account button: the extension copy holds the account press and no-submit.mjs refuses a submission.
// -> {state, filled, left, humanCheck, wall, ms}, never a field value. Guard: desktop/test/ready-fill.test.js (classify) and the one-night image check (hosted/ready-fill/image-check.mjs in jobadabra-web).
import {formUrl} from '../../desktop/lib/form-address.js';   // in the image: /desktop/lib, reached by the same path from /night
import {startFillVideo} from './fill-video.mjs';

const FILL_BUTTON = /^(fill anyway|fill this form|fill again)$/i;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

// Pure: the outcome word from what the extension reported. `outcome` is the stand-in's {filled, left, role} or null; `panel` says whether the extension's panel appeared and offered Fill.
// The extension's own fixed sentence for a posting that is closed or gone (extension/ladder/site-broken.js brokenNeed; desktop/test/ready-fill.test.js keeps the two in step).
export const CLOSED_NEED = /^This posting is (closed|gone)/;
export function classify({outcome, panel, role, stuck = null}) {
  if (!outcome?.filled && stuck?.why === 'site_broken' && CLOSED_NEED.test(stuck.needs || '')) return {state: 'closed', wall: ''};   // the AI said the posting is closed: not "no form"
  if (outcome && (outcome.role || role) === 'account') return {state: 'wall', wall: 'account'};   // a sign-in or sign-up page: phase 1 makes no account
  if (!outcome) return panel ? {state: 'failed', wall: 'no-record'} : {state: role === 'account' ? 'wall' : 'no-form', wall: role === 'account' ? 'account' : ''};
  if (!outcome.filled) return {state: 'no-form', wall: ''};
  return {state: outcome.left === 0 ? 'prepared' : 'partial', wall: ''};
}

// A human check on the page, by structure (a widget iframe or a site key box): reported so the morning page says "a check waits for you". Never solved here.
export const humanCheckIn = page => page.evaluate(() => !!document.querySelector('iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[src*="turnstile"], iframe[src*="challenges.cloudflare"], [data-sitekey], .g-recaptcha, .h-captcha, .cf-turnstile')).catch(() => false);

// The app's "Apply" marks the tab with the address hash; the extension may start the fill by itself, and the person's click on Fill is the other way. Never both: a second pass only repeats the first.
async function pressFill(page, standIn, address, seconds = 25) {
  await page.evaluate(() => { location.hash = 'jobadabra-fill'; }).catch(() => {});
  for (let waited = 0; waited < 8 && !standIn.started(address); waited++) await wait(1000);
  if (standIn.started(address)) return true;   // it started on its own
  const ready = await page.waitForFunction(() => document.getElementById('jobadabra-review-host')?.shadowRoot?.querySelector('button'), null, {timeout: seconds * 1000}).then(() => true, () => false);
  if (!ready) return false;
  await wait(3000);   // the panel settles its buttons
  return page.evaluate(pattern => {
    const buttons = [...(document.getElementById('jobadabra-review-host')?.shadowRoot?.querySelectorAll('button') || [])].filter(button => !button.disabled);
    const pick = buttons.find(button => new RegExp(pattern, 'i').test((button.textContent || '').trim()));
    if (pick) pick.click();
    return !!pick;
  }, FILL_BUTTON.source).catch(() => false);
}

// context: the night's Playwright context; standIn: createStandIn(); job: {id, url}. -> the outcome plus the tab and the fill's video ({path, bytes, secs} or null).
// record(page): starts the fill's video (Watch the fill, owner 18 Oct 2026: every form the night opens, 3 minutes at most); it stops once the outcome is read, before the tab is held.
// onStep(step, n): the live line (site src/ready-line.js STEPS); it answers true when the owner stopped this form: the fill ends at once with {stopped}, its tab closed by the caller.
export async function fillJob({context, standIn, job, fillSeconds = 120, record = page => startFillVideo(page), onStep = async () => false}) {
  const started = Date.now(), page = await context.newPage();
  const recording = await Promise.resolve().then(() => record(page)).catch(() => null), video = async () => (await recording?.stop().catch(() => null)) || null;
  const stopped = async () => ({page, stopped: true, state: 'stopped', filled: 0, left: 0, humanCheck: false, ms: Date.now() - started, video: await video()});
  if (await onStep('opening')) return stopped();
  try { await page.goto(formUrl(job.url), {waitUntil: 'domcontentloaded', timeout: 30000}); } catch { return {page, state: 'failed', wall: 'unreachable', filled: 0, left: 0, humanCheck: false, ms: Date.now() - started, video: await video()}; }
  if (await onStep('form')) return stopped();
  const panel = await pressFill(page, standIn, job.url);
  for (let waited = 0; panel && waited < fillSeconds && !standIn.outcome(job.url); waited++) {
    await wait(1000);
    const asked = standIn.answered?.() || 0;
    if (waited % 5 === 4 && await onStep(asked ? 'answering' : 'filling', asked || null)) return stopped();   // every 5 s: the line moves, and a Stop is heard
  }
  if (await onStep('reading')) return stopped();
  await wait(3000);   // the record is written once, at the fill's end; the page settles and a later pass or update may follow
  const outcome = standIn.outcome(job.url), verdict = classify({outcome, panel, role: standIn.role(job.url), stuck: standIn.stuck?.(job.url) ?? null});
  return {page, ...verdict, filled: outcome?.filled || 0, left: outcome?.left || 0, humanCheck: await humanCheckIn(page), ms: Date.now() - started, video: await video()};
}
