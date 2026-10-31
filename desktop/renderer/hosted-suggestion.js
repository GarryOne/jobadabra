// Always on's first-matches Suggestions entry and its inline activation controls.
import {el} from './components.js';
import {SUBTITLE} from './hosted-words.js';
import {jobCounts} from './jobs-view.js';

const KEY = 'hosted:first-matches';
const validEmail = email => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

/** One Focus entry after a finished search has matches; jobCounts is the Jobs view's definition (excludes applications and inbound). */
export function hostedEntries({hosted, jobs, runs = {}, hidden = new Set(), held = new Set()} = {}) {
  const finished = runs.lastSearchAt || runs.runs?.some(run => (run.kind || 'search') === 'search' && run.ok !== false);
  if (!hosted?.available || hosted.on || hosted.skipped || !finished || !jobCounts(jobs).total || hidden.has(KEY) || held.has(KEY)) return [];
  const email = hosted.email || hosted.shared || '';
  return [{kind: 'hosted', home: 'focus', topic: 'profile', key: KEY, title: SUBTITLE, source: '',
    detail: email ? `A short list of what is new, by e-mail to ${email}.` : 'A short list of what is new, by e-mail.', email,
    evidence: [], answers: ['Not now', 'Not true'], actions: [{label: 'Turn on Always on', do: 'turn_on_hosted'}]}];
}

/** Reuses the shared field in a Suggestions row. Invariants: only an explicit press turns it on; news stays off; a shared draft paints replies into the latest row. */
export function bindHostedOffer({body, button, email, emailField, turnOn, onSuccess, draft = {}}) {
  let input = null;
  if (!email) {
    const field = emailField();
    input = field.querySelector('input');
    input.value = draft.value || '';
    body.append(field);
  }
  const note = el('p', 'message'); note.setAttribute('role', 'status');
  body.append(el('div', 'step-field', note));
  const address = () => String(email || draft.value || '').trim();
  // Why (#2658, Gitar, 31 Oct 2026): question/bank refreshes rebuild the row during activation; its draft and reply must outlive detached DOM.
  draft.paint = () => {
    button.disabled = !!draft.busy || !validEmail(address());
    note.className = draft.bad ? 'message bad' : 'message';
    note.textContent = draft.note || '';
  };
  input?.addEventListener('input', () => { draft.value = input.value; draft.paint(); });
  draft.paint();
  return async () => {
    if (draft.busy || !validEmail(address())) return;
    const sentTo = address();
    Object.assign(draft, {busy: true, bad: false, note: 'Turning on…'}); draft.paint();
    try {
      const result = await turnOn({email: sentTo, marketing: false});
      if (result?.ok) { draft.note = ''; onSuccess(sentTo); return; }
      Object.assign(draft, {bad: true, note: result?.error || 'Could not turn it on just now.'});
    } catch (error) {
      Object.assign(draft, {bad: true, note: error.message || 'Could not turn it on just now.'});
    } finally { draft.busy = false; draft.paint(); }
  };
}
