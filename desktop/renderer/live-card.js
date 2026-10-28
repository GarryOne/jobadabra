// The live card's pure parts (renderer/pages/session-live.js draws them): what a hidden-browser session's Applying card says in each of its four
// states, and how a press or a key on the page's picture becomes the page's own. No DOM here. Guard: test/session-live.test.js.
const FILLING = new Set(['queued', 'preflight', 'filling']);
const HANDOFF = new Set(['needs_user_handoff', 'manual_submit_required']);
const clock = ms => (ms ? new Date(ms).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'}) : '');
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * Pure: what the card says for a session's background state and the page's latest facts (null until read).
 * -> {kind: filling|check|review|ready, title, meta, pill: [text, tone], tone, frame: ''|'warn'|'good', note, input, filling, submit: {on, hint}|null, marks}
 * Invariant: Submit is on only in Ready to submit: the form judge's ready stands AND the page has no required field empty (main checks both again at the press).
 */
export function liveCard(background = {}, facts = null, {note = '', at = clock} = {}) {
  const left = facts ? facts.left.length : null, filled = at(background.readyAt);
  if (FILLING.has(background.state)) {
    return {kind: 'filling', title: 'Filling the application', meta: '· in Jobadabra\'s browser, hidden', pill: [facts?.fields ? `Filling · ${facts.filled} of ${facts.fields} fields` : 'Filling', 'info'],
      tone: 'info', frame: '', note: 'You can watch. Clicks and typing wait until the fill stops.', input: false, filling: facts?.active || '', submit: null, marks: false};
  }
  if (HANDOFF.has(background.state) && /^captcha_/.test(background.reason || '')) {   // words-ok: our own hand-off reason id, not page knowledge
    return {kind: 'check', title: 'A bot check needs you', meta: filled ? `· filled at ${filled}, then the page asked` : '· the page asked', pill: ['Needs you', 'warn'], tone: 'warn', frame: 'warn',
      note: 'Solve the check in the page below. Jobadabra never solves bot checks.', input: true, filling: '', submit: {on: false, hint: 'After the check, use the page\'s own Submit'}, marks: true};
  }
  if (background.state === 'ready_for_review' && left === 0) {
    return {kind: 'ready', title: 'Ready to submit', meta: '· every required field is filled', pill: ['Ready to submit', 'good'], tone: 'good', frame: 'good',
      note: 'Pressing Submit is you submitting. Jobadabra then reads the confirmation page.', input: true, filling: '', submit: {on: true, hint: ''}, marks: false};
  }
  const judged = background.state === 'ready_for_review';
  return {kind: 'review', title: 'Review the filled application', meta: filled ? `· filled at ${filled} in Jobadabra's browser` : '· in Jobadabra\'s browser', pill: [judged ? 'Ready for review' : 'Needs you', 'warn'],
    tone: 'warn', frame: '', note: judged ? 'This is the live page: click and type in it, or use "Fill it in" below.' : note || 'This application needs you. Review the live page and submit it yourself.',
    input: true, filling: '', marks: true, submit: {on: false, hint: !judged ? 'Use the page\'s own Submit' : left === null ? 'Reading the page…' : `${plural(left, 'required field')} left`}};
}

/** Pure: a press at (x, y) on a picture drawn at `box` ({left, top, width, height}) -> the page's own CSS pixels, for a viewport of w × h. */
export const toPage = (x, y, box, w, h) => ({x: Math.round(((x - box.left) / box.width) * w), y: Math.round(((y - box.top) / box.height) * h)});
/** Pure: a key event -> the live view's key message ({t: 'key', key, text, code, up}); text only for what types a character. */
export const keyMessage = (event, up = false) => ({t: 'key', key: event.key, code: event.keyCode || undefined, up,
  text: up ? undefined : event.key === 'Enter' ? '\r' : event.key.length === 1 ? event.key : undefined});
