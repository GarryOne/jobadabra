// The words and states of Always on "on our servers" (owner, 17 Oct 2026: one name everywhere; ON by default for a trial install until it presses Skip). Pure: renderer/pages/hosted.js draws it.
// States: on with an e-mail, on without one (asks for it first), off (Skip or turned off), paused (14 days idle, budget, limit), trial over. Guard: test/hosted-words.test.js.
import {promise} from './pro-promise.js';
export const NAME = 'Always on: on our servers';
export const SUBTITLE = 'New matches every morning, even when your Mac is off';
export const STORED = 'Your profile is stored encrypted on our servers. Turn it off anytime = deleted.';
export const NEWS = 'Also send me product news and the Pro launch offer (unsubscribe in one click)';
// Demo jobs only, always marked "Example": the person sees what arrives, never a claim about their own matches.
export const EXAMPLE_JOBS = [['Platform Engineer · Zurich', '86'], ['Cloud Engineer · Remote, EU', '81'], ['Site Reliability Engineer · Berlin', '78']];

export const NEWS_HINT = 'Separate from your matches.';
export const HELPER = 'We send the daily matches here. Unsubscribe in one click.';

const two = n => String(n).padStart(2, '0');
// "today ~7:00" / "tomorrow ~7:00" / "Mon ~7:00" in the person's own time.
export function when(iso, now = new Date()) {
  const at = new Date(iso);
  if (!(at.getTime() > 0)) return '';
  const day = d => Math.floor(new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() / 86400000);
  const gap = day(at) - day(now), clock = `${at.getHours()}:${two(at.getMinutes())}`;
  return `${gap <= 0 ? 'today' : gap === 1 ? 'tomorrow' : at.toLocaleDateString('en', {weekday: 'short'})} ~${clock}`;
}

// "today at 9:14" / "26 Oct at 10:02": when the profile was last copied to our servers, or deleted from them.
export function stamp(iso, now = new Date()) {
  const at = new Date(iso);
  if (!(at.getTime() > 0)) return '';
  const same = at.toDateString() === now.toDateString(), clock = `${at.getHours()}:${two(at.getMinutes())}`;
  return `${same ? 'today' : `${at.getDate()} ${at.toLocaleDateString('en', {month: 'short'})}`} at ${clock}`;
}
// What our servers hold, in one line: the last copy while it is on, the deletion once it is off (owner, 27 Oct 2026).
function heldLine(mine, now) {
  if (mine.on) return mine.copiedAt ? `Your profile was last copied to our servers ${stamp(mine.copiedAt, now)}.` : '';
  return mine.deletedAt ? `Nothing of yours is on our servers (deleted ${stamp(mine.deletedAt, now)}).` : '';
}

// -> {state, pill: [text, tone], line, held, asksEmail, button: 'on' | 'email' | 'resume' | null, off, download, erase, note}
//   held: when the profile was last copied to our servers, or deleted from them. erase: "Delete my data from our servers" shows (every state that is not on;
//   while on, "Turn off and delete" does it).
//   mine: the app's own record {on, skipped, email}; schedule: the server's {state, pause_reason, next_run_at, email_channel} or null;
//   shared: the address Settings → Notifications keeps, the one Always on uses (#1711, owner 27 Oct 2026: one shared e-mail). asksEmail: there is none yet,
//   and the button goes to Notifications to add it.
export function model(mine = {}, schedule = null, now = new Date(), shared = '') {
  return {...view(mine, schedule, now, shared), held: heldLine(mine, now), erase: !mine.on};
}
function view(mine, schedule, now, shared) {
  const email = mine.email || shared || '', skipped = !!mine.skipped && !mine.on;
  if (!email && (skipped || !mine.on)) return {state: 'needs-email', pill: skipped ? ['Off', 'neutral'] : ['On', 'good'], line: 'Add your e-mail in Notifications to get the matches. Then turn it on here.', asksEmail: true, button: 'email', off: false, download: false};
  if (skipped) return {state: 'off', pill: ['Off', 'neutral'], line: `Turn it on to get new matches every morning at ${email}, even when your Mac is off.`, asksEmail: false, button: 'on', off: false, download: false};
  if (!mine.on) return {state: 'ready', pill: ['On', 'good'], line: `Searches start as soon as you turn it on. Matches go to ${email}.`, asksEmail: false, button: 'on', off: false, download: false};
  if (schedule?.state === 'paused') {
    const why = {
      'inactive': ['Paused: you have not opened Jobadabra for 14 days. Resume to get matches again.', 'resume'],
      'trial-over': [`Your free trial is over. Pro is a ${promise()}. Always on keeps running on your AI credit; top-ups are one-time too.`, null],
      'budget': [`Paused: the free AI in your trial is used up. Pro is a ${promise()}. Always on keeps running on your AI credit; top-ups are one-time too.`, null],
      'guard': ['Paused: it reached this month\'s limit. It continues next month.', null],
    }[schedule.pause_reason] || ['Paused. Resume to get matches again.', 'resume'];
    return {state: `paused-${schedule.pause_reason || 'other'}`, pill: ['Paused', 'warn'], line: why[0], asksEmail: false, button: why[1], off: true, download: true};
  }
  const next = schedule?.next_run_at ? ` Next search: ${when(schedule.next_run_at, now)}.` : '';
  const mail = schedule && schedule.email_channel === 0 ? ' E-mail is off for this address; matches still appear here.' : '';
  return {state: 'on', pill: ['On', 'good'], line: `Searches every day and e-mails ${email}.${next}${mail}`, asksEmail: false, button: null, off: true, download: true};
}
