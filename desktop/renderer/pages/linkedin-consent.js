// LinkedIn jobs on every Find jobs (owner, 31 Oct 2026, spec docs/superpowers/specs/2026-10-31-linkedin-headless-design.md): the ONE consent dialog behind every door (the Settings row, the ask on
// the 1st and 2nd Find jobs press, the Suggestions entry, ⌘K) and the window's copy of the switch's state. "Turn on" opens the extension's own consent page in Chrome (Chrome asks for its
// permission only there, on a click); the app learns the answer when the extension posts the session (lib/linkedin-handlers.js), which this module watches for. The window never holds a cookie.
// Invariants: one dialog at a time; the ask is counted when shown, "Not now" only from the ask; the words are renderer/linkedin-words.js. Guard: test/linkedin-consent.test.js.
import {$} from './core.js';
import {CONSENT, askOnPress} from '../linkedin-words.js';
import {NO_PLACE} from '../targets.js';

export const view = {loaded: false, on: false, asked: 0, declined: 0, ask: false, hasSession: false};
// Why (31 Oct 2026, push gate no-circular): startup.js imports the pages that import this module, so it hands its toast in (bindToast) instead of being imported here.
let toast = () => {};
/** Startup gives this module its toast function once; before that a message is dropped, never thrown. */
export const bindToast = fn => { toast = fn; };

/** Read the switch's state from the app; tells the pages (Settings row, Suggestions) when it changed. */
export async function refreshLinkedin() {
  const before = view.on;
  Object.assign(view, await window.pilot.linkedinJobsState(), {loaded: true});
  if (before !== view.on) window.dispatchEvent(new Event('linkedin-changed'));
  return view;
}
const WATCH_MS = 2000, WATCH_FOR_MS = 150000;
let watching = false;
// The person finishes in Chrome: look every few seconds, for a couple of minutes, until the app has the session.
async function watchUntilOn() {
  if (watching) return;
  watching = true;
  const until = Date.now() + WATCH_FOR_MS;
  try {
    while (Date.now() < until && !view.on) {
      await new Promise(done => setTimeout(done, WATCH_MS));
      await refreshLinkedin().catch(() => {});
    }
  } finally { watching = false; }
  if (view.on) toast('LinkedIn jobs is on', 'Every Find jobs now also reads your LinkedIn job searches, in the background.', NO_PLACE.itself, 'good');
}

async function turnOn() {
  const opened = await window.pilot.linkedinJobsConnect().catch(() => null);
  if (opened?.opened) {
    toast('Finish in Chrome', 'A Jobadabra page opened in Chrome: press "Allow and turn on LinkedIn jobs" there. This window notices by itself.', NO_PLACE.itself, 'info');
    watchUntilOn();
  } else toast('Chrome extension needed', 'LinkedIn jobs uses the Jobadabra Chrome extension. Connect it in Settings → Connections → Chrome extension, then try again.', NO_PLACE.itself, 'warn');
}
async function turnOff() {
  await window.pilot.linkedinJobsOff();
  await refreshLinkedin();
  toast('LinkedIn jobs is off', 'Your LinkedIn sign-in was deleted from this Mac.', NO_PLACE.itself, 'info');
}

/**
 * Show the consent. mode: 'ask' (Find jobs press), 'turn-on' (Settings, Suggestions, ⌘K) or 'manage' (it is on: Keep on / Turn off). counts: "Not now" counts as an answer (the ask only).
 * Resolves when the dialog closed and what it chose did its first step.
 */
export function openLinkedinConsent({mode = 'turn-on', counts = false} = {}) {
  const dialog = $('linkedin-dialog');
  if (dialog.open) return Promise.resolve(false);
  const words = CONSENT[mode] || CONSENT['turn-on'];
  $('linkedin-title').textContent = words.title;
  $('linkedin-lead').textContent = words.lead;
  $('linkedin-line').textContent = words.line;
  $('linkedin-line-box').hidden = !words.line;
  $('linkedin-yes').textContent = words.yes;
  $('linkedin-no').textContent = words.no;
  dialog.returnValue = '';
  return new Promise(resolve => {
    dialog.addEventListener('close', async () => {
      const yes = dialog.returnValue === 'default';
      if (yes) await (mode === 'manage' ? turnOff() : turnOn());
      else if (counts) await window.pilot.linkedinJobsAnswer('not-now').catch(() => {});
      resolve(yes);
    }, {once: true});
    dialog.showModal();
  });
}

/** Every Find jobs press calls this (pages/jobs.js startSearch): on the 1st and 2nd press while off, one dialog. Never blocks the search. */
export async function askLinkedinOnPress(why) {
  const mine = await refreshLinkedin().catch(() => null);
  if (!askOnPress(mine, why) || $('linkedin-dialog').open) return false;
  await window.pilot.linkedinJobsAsked();
  await openLinkedinConsent({mode: 'ask', counts: true});
  await refreshLinkedin().catch(() => {});
  return true;
}
