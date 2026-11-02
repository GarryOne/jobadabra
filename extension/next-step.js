// The next step of a multi-step application (owner, 10 Oct 2026: always on, the setting was dropped; the floors below are what keep it safe). When the form judge (form-ready.js) says THIS page state is
// ready and names the control that goes on to the next step (desktop/lib/form-judge.js: a middle step, one of the page's own buttons), the extension presses it: once per page state per tab, kept in
// session storage so a reload or a restarted worker never presses twice. Hard floor, by structure: never a control that submits a form, never one that reads
// like Submit, never the last step. Logged with the control's own wording, never a value. Guarded by app-core/test/next-step.test.js.
import {plainWhy} from './ai-reply.js';
import {decide} from './log.js';
import {notePress} from './tabs.js';
import {mayAct} from './stop-state.js';

// In the page: find the named control among the visible buttons and links and press it, unless it would submit. Exported for the tests.
export function pressInPage(text) {
  const norm = value => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const wanted = norm(text);
  const el = wanted && [...document.querySelectorAll('button, a, [role=button], input[type=button]')]
    .find(item => item.getClientRects().length > 0 && norm(item.textContent || item.value) === wanted);
  if (!el) return {pressed: false, why: 'not on the page'};
  if ((el.tagName === 'INPUT' && el.type === 'submit') || (el.tagName === 'BUTTON' && el.type === 'submit' && el.form)) return {pressed: false, why: 'it submits a form'};
  if (/(^|\b)(submit|send application|apply now|complete application|finish application)(\b|$)/i.test(el.textContent || el.value || '')) return {pressed: false, why: 'it reads like Submit'};
  (globalThis.__jobadabraPress?.(el) || el.click());
  return {pressed: true};
}

export async function pressNext(tab, frameId, answer, sig) {
  if (answer?.answer !== 'ready' || answer.step !== 'middle' || !answer.nextControl) return false;
  const key = `next:${tab.id}`;
  const done = (await chrome.storage.session.get(key).catch(() => ({})))[key] || [];
  if (done.includes(sig)) return false;   // this page state was pressed on already
  await chrome.storage.session.set({[key]: [...done, sig].slice(-20)}).catch(() => {});
  if (!mayAct()) return false;   // stopped by the person (stop.js)
  notePress(tab.id, tab.url);   // a press of ours: a tab it opens joins the application (tabs.js followOpener)
  const result = await chrome.scripting.executeScript({target: {tabId: tab.id, frameIds: [frameId ?? 0]}, world: 'MAIN', func: pressInPage, args: [answer.nextControl]})
    .then(rows => rows?.[0]?.result || {pressed: false, why: 'no answer from the page'}).catch(error => ({pressed: false, why: plainWhy(error).slice(0, 80)}));
  let host = ''; try { host = new URL(tab.url).hostname; } catch { /* no address */ }
  decide('fill', result.pressed ? 'next step: pressed' : `next step: not pressed (${result.why})`, {host, control: String(answer.nextControl).slice(0, 40)});
  return result.pressed;
}
