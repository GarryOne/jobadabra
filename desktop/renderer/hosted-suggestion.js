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

/** Reuses the supplied e-mail builder in an ordinary Suggestions row. Invariant: only a valid address and an explicit press turn it on; news is never opted in. */
export function bindHostedOffer({body, button, email, emailField, turnOn, onSuccess}) {
  let input = null, busy = false;
  if (!email) {
    const field = emailField();
    input = field.querySelector('input');
    body.append(field);
  }
  const note = el('p', 'message'); note.setAttribute('role', 'status');
  body.append(el('div', 'step-field', note));
  const address = () => String(input ? input.value : email).trim();
  const update = () => { button.disabled = busy || !validEmail(address()); };
  input?.addEventListener('input', update);
  update();
  return async () => {
    if (busy || !validEmail(address())) return;
    busy = true; update();
    note.className = 'message'; note.textContent = 'Turning on…';
    try {
      const result = await turnOn({email: address(), marketing: false});
      if (result?.ok) { onSuccess(); return; }
      note.className = 'message bad'; note.textContent = result?.error || 'Could not turn it on just now.';
    } catch (error) {
      note.className = 'message bad'; note.textContent = error.message || 'Could not turn it on just now.';
    } finally { busy = false; update(); }
  };
}
