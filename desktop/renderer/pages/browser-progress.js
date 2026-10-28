// Jobadabra's browser for Background automation (spec 2026-10-27-background-apply-execution, step B): offered on every spot marked
// data-browser-progress="offer" (the Applying page while the saved mode needs it, the Apply dialog after "Download Jobadabra's browser first"),
// downloaded only on the person's press, its progress with Cancel. Drawn with the LibreOffice download's block (office-progress.js drawProgress);
// fed by main's 'backgroundBrowserProgress' event (lib/background-browser-download.js). Guard: test/browser-progress.test.js.
import {Eta} from '../eta.js';
import {drawProgress} from './office-progress.js';

const MB = bytes => Math.round(bytes / 1048576);
const etas = new Map();
const etaOf = started => { if (!etas.has(started)) etas.set(started, new Eta(0)); return etas.get(started); };
const AT = {checking: 0, download: 0, unpack: 2};
const OFFER = {title: 'Background automation needs Jobadabra\'s browser', right: '', share: null, steps: [],
  fine: 'About 200 MB, only once. It fills your applications out of sight; you review each one and press Submit.', action: 'Download'};

/** One event -> what a spot shows: {hidden} or {title, right, share, steps: [{text, kind: done|now|next}], fine, action}. offer: this spot may offer the download. */
export function browserView(event = {}, {offer = false, platform = 'darwin', now = Date.now()} = {}) {
  const {step = 'none', bytes = 0, total = 0, started = now, error = ''} = event;
  if (step === 'ready') return {hidden: true};
  if (step === 'none') return offer ? OFFER : {hidden: true};
  if (step === 'failed' || step === 'cancelled') {
    return {title: step === 'failed' ? 'Jobadabra\'s browser could not be downloaded' : 'Jobadabra\'s browser download cancelled', right: '', share: null, steps: [],
      fine: `${step === 'failed' ? `${error} ` : ''}Standard automation still works in your own Chrome.`, action: 'Try again'};
  }
  const at = AT[step] ?? 0, seconds = (now - started) / 1000, speed = seconds > 2 ? bytes / seconds : 0;
  const leftText = step === 'download' && total && speed ? etaOf(started).text(seconds, bytes, total).replace(/^ · /, ', ') : '';
  const sizes = total ? `${MB(bytes)} of ${MB(total)} MB` : `${MB(bytes)} MB`;
  const share = step === 'download' ? (total ? bytes / total : null) : step === 'unpack' ? 1 : null;
  const texts = [step === 'checking' ? 'Finding the right version for your computer' : `Downloading it: ${sizes}${leftText}`,
    'Checking the download is the genuine one', `Unpacking it inside the app: nothing is installed on ${platform === 'win32' ? 'your PC' : 'your Mac'}, no password asked`];
  return {title: 'Getting Jobadabra\'s browser (Google\'s Chrome for Testing) for Background automation', right: step === 'download' ? `${share === null ? '' : `${Math.floor(share * 100)}% · `}${sizes}` : '', share,
    steps: texts.map((text, i) => ({text, kind: i < at ? 'done' : i === at ? 'now' : 'next'})), fine: 'Once only. Applications you start meanwhile wait for it.', action: 'Cancel'};
}

let last = {step: 'none'};
/** Draw the latest event on every marked spot; a spot offers the download only when it says data-browser-progress="offer". */
export function showBrowserProgress(event = last) {
  last = event;
  for (const box of document.querySelectorAll('[data-browser-progress]')) {
    box.classList.add('progress', 'office-progress'); box.setAttribute('role', 'status');
    drawProgress(box, browserView(event, {offer: box.dataset.browserProgress === 'offer', platform: window.pilot.platform}),
      {start: () => window.pilot.backgroundBrowserStart().then(showBrowserProgress), cancel: () => window.pilot.backgroundBrowserCancel()});
  }
}
/** Offer (or stop offering) the download on one spot, then draw it. */
export function offerBrowser(box, offer) {
  if (!box) return;
  box.dataset.browserProgress = offer ? 'offer' : 'quiet';
  showBrowserProgress();
}
export async function startBrowserProgress() {
  window.pilot.onBackgroundBrowserProgress(showBrowserProgress);
  showBrowserProgress(await window.pilot.backgroundBrowserState());
}
