// The live card's pure parts (renderer/pages/session-live.js draws them): what a hidden-browser session's Applying card says in each of its four
// states, and how a press or a key on the page's picture becomes the page's own. No DOM here. Guard: test/session-live.test.js.
import {backgroundStatus} from './background-status.js';
const FILLING = new Set(['preflight', 'filling']);
const HANDOFF = new Set(['needs_user_handoff', 'manual_submit_required']);
const clock = ms => (ms ? new Date(ms).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'}) : '');
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * Pure: what the card says for a session's background state and the page's latest facts (null until read).
 * -> {kind: waiting|filling|check|review|ready, live (the page exists: draw its picture), title, meta, pill: [text, tone], tone, frame: ''|'warn'|'good', note, input, filling, submit: {on, hint}|null, marks}
 * Invariant: Submit is on only in Ready to submit: the form judge's ready stands AND the page has no required field empty (main checks both again at the press).
 */
export function liveCard(background = {}, facts = null, {note = '', at = clock} = {}) {
  const left = facts ? facts.left.length : null, filled = at(background.readyAt);
  // Why (2026-10-28, owner screenshot: Air France, queued behind GLOCK, drew "Filling" and a broken picture): one job fills at a time; a queued one has no page yet, so no picture is asked for.
  if (background.state === 'queued') {
    return {kind: 'waiting', live: false, title: 'Waiting for its turn', meta: '· in Jobadabra\'s browser, hidden', pill: backgroundStatus({background}), tone: 'neutral', frame: '',
      note: 'Jobadabra fills one application at a time. This one starts when the one before it is done.', input: false, filling: '', submit: null, marks: false};
  }
  if (FILLING.has(background.state)) {
    return {kind: 'filling', live: true, title: 'Filling the application', meta: '· in Jobadabra\'s browser, hidden', pill: backgroundStatus({background}, {fields: facts?.fields ? {done: facts.filled, of: facts.fields} : null}),
      tone: 'info', frame: '', note: 'You can watch. Clicks and typing wait until the fill stops.', input: false, filling: facts?.active || '', submit: null, marks: false};
  }
  if (HANDOFF.has(background.state) && /^captcha_/.test(background.reason || '')) {   // words-ok: our own hand-off reason id, not page knowledge
    return {kind: 'check', live: true, title: 'A bot check needs you', meta: filled ? `· filled at ${filled}, then the page asked` : '· the page asked', pill: backgroundStatus({background}), tone: 'warn', frame: 'warn',
      note: 'Solve the check in the page below. Jobadabra never solves bot checks.', input: true, filling: '', submit: {on: false, hint: 'After the check, use the page\'s own Submit'}, marks: true};
  }
  if (background.state === 'ready_for_review' && left === 0) {
    return {kind: 'ready', live: true, title: 'Ready to submit', meta: '· every required field is filled', pill: backgroundStatus({background}, {ready: true}), tone: 'good', frame: 'good',
      note: 'Pressing Submit is you submitting. Jobadabra then reads the confirmation page.', input: true, filling: '', submit: {on: true, hint: ''}, marks: false};
  }
  const judged = background.state === 'ready_for_review';
  return {kind: 'review', live: true, title: 'Review the filled application', meta: filled ? `· filled at ${filled} in Jobadabra's browser` : '· in Jobadabra\'s browser', pill: backgroundStatus({background}) || ['Needs you', 'warn'],
    tone: 'warn', frame: '', note: judged ? 'This is the live page: click and type in it, or use "Fill it in" below.' : note || 'This application needs you. Review the live page and submit it yourself.',
    input: true, filling: '', marks: true, submit: {on: false, hint: !judged ? 'Use the page\'s own Submit' : left === null ? 'Reading the page…' : `${plural(left, 'required field')} left`}};
}

/** Pure: a press at (x, y) on a picture drawn at `box` ({left, top, width, height}) -> the page's own CSS pixels, for a viewport of w × h. */
export const toPage = (x, y, box, w, h) => ({x: Math.round(((x - box.left) / box.width) * w), y: Math.round(((y - box.top) / box.height) * h)});
/** Pure: a key event -> the live view's key message ({t: 'key', key, text, code, up}); text only for what types a character. */
export const keyMessage = (event, up = false) => ({t: 'key', key: event.key, code: event.keyCode || undefined, up,
  text: up ? undefined : event.key === 'Enter' ? '\r' : event.key.length === 1 ? event.key : undefined});
