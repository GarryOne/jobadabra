// How an answer leaves a "Needs your attention" row: through the extension into the form (sessionFillField, as "Use" does), else, with
// Claude help on, in one batch message for Claude (the footer's "Send all N answers", hidden while the takeover is off: owner, 15 Oct 2026).
// Moved out of session-needs.js on 27 Oct 2026 (pure move + sendAnswer). Guarded by test/resume-hidden.test.js, test/need-choice.test.js.
import {$, show} from './core.js';
import {shared} from './shared.js';
import {say} from './session-log.js';
import {resumeOffered} from '../claude-help.js';
import {offline} from './session-needs.js';

// Answers wait here until you send them all at once (owner, 8 Oct 2026: one answer sent at once made Claude reply, and its new
// message redrew the list, so the other questions vanished before you could answer them). Each answer names its question.
const batch = new Map();   // session id → Map(row key → {line, last})
export function queue(item, key, line, {last = false} = {}) {
  if (!batch.has(item.id)) batch.set(item.id, new Map());
  batch.get(item.id).set(key, {line, last});
  setTimeout(() => showSendBar(item));   // after the row is marked done, so the count of open ones is right
}
// One message for Claude: the answers, numbered, each with its question; a reply it asked for ("ok") last.
export function batchMessage(entries) {
  const answers = entries.filter(entry => !entry.last).map(entry => entry.line);
  const replies = entries.filter(entry => entry.last).map(entry => entry.line);
  return [answers.length ? `My answers to your list, put them in the form: ${answers.map((line, at) => `${at + 1}) ${line}`).join('; ')}.` : '', ...replies]
    .filter(Boolean).join(' Then: ');
}
export function showSendBar(item) {
  const bar = $('ss-needs-send');
  if (!bar) return;
  const waiting = [...(batch.get(item?.id)?.values() || [])];
  show(bar, resumeOffered() && waiting.length > 0 && shared.openSessionId === item?.id);   // a reply to Claude: hidden while Claude's takeover is off (owner, 15 Oct 2026)
  if (!waiting.length) return;
  const open = document.querySelectorAll('#ss-needs > .ss-need:not(.is-done)').length;
  $('ss-needs-send-text').textContent = `${waiting.length} answer${waiting.length === 1 ? '' : 's'} ready${open ? ` · ${open} still open` : ''}`;
  const button = $('ss-needs-send-btn');
  button.textContent = waiting.length === 1 ? 'Send answer' : `Send all ${waiting.length} answers`;
  button.disabled = !!offline(item);
  button.onclick = () => { say(batchMessage(waiting)); batch.delete(item.id); show(bar, false); };
}

export const clearAnswers = id => batch.delete(id);
// An answer you typed or picked: the extension puts it in the form's field `label` (owner, 27 Oct 2026: "How the user can change the value?":
// with the takeover off, a queued line for Claude reached nothing). -> {ok, outcome} for the row, or {ok: false, error}.
export async function sendAnswer(item, key, label, value, line) {
  const filled = await window.pilot.sessionFillField(item.id, label, value).catch(error => ({ok: false, error: error.message}));
  if (filled?.ok) return {ok: true, outcome: `Filled in the form: ${value}`};
  if (resumeOffered()) { queue(item, key, line); return {ok: true, outcome: `To send: ${value}`}; }
  return {ok: false, error: filled?.error || 'Couldn\'t reach the form'};
}
