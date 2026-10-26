// The Ready to send card on Actions (private spec jobadabra-lab:docs/specs/2026-10-17-ready-to-send.md), always shown (owner, 18 Oct 2026); it works only when the site says this install is the owner's, else it says why with its buttons off: send tonight's finished jobs to be filled overnight,
// start the night now (the test), and in the morning one row per form (complete, what is left, a wall) with Done and the night's video of its fill (a popup). You press Submit; nothing here does. Built from the task-card parts the Tailor card uses (.task-card, .task-body, pill). Guard: test/ready-card.test.js.
import {el, pill, tile} from '../components.js';
import {icon} from '../icons.js';
import {costText, dollars} from '../ai-cost.js';
import {wand} from '../magic.js';
import {$} from './core.js';
import {liveOf, readyToSubmit, rowOf} from './ready-rows.js';
import {liveParts} from './ready-live.js';
import {showFillVideo} from './ready-video.js';
import {confirmFill} from './ready-confirm.js';
import {pickFill} from './ready-pick.js';
import {progressOf, strip, tickAll} from './ready-progress.js';
import {OUTDATED_LINE, errorLine, restartButton} from '../errors.js';

// state: what readyState gave. names: code -> "Title · Company" for the rows.
export function paint(card, state, names, act) {
  const body = card.querySelector('.ready-body'), jobs = (state.site?.jobs || []).filter(job => !job.cleared_at), night = state.site?.batch;
  body.textContent = '';
  const tonight = state.tonight || [];
  // The night and tonight as badges (owner, 18 Oct 2026: "these status lines should be shown as badges"); the details stay in each badge's tooltip.
  const summary = el('div', 'ready-summary');
  if (night) {
    const ready = jobs.filter(readyToSubmit).length, needs = jobs.filter(job => ['partial', 'wall'].includes(job.state)).length;
    if (night.night) summary.append(el('span', 'muted', `Night of ${night.night}`));
    summary.append(pill(`${jobs.length} form${jobs.length === 1 ? '' : 's'}`, 'neutral'));
    if (ready) summary.append(pill(`${ready} ready`, 'good'));
    if (needs) summary.append(pill(`${needs} need${needs === 1 ? 's' : ''} you`, 'warn'));
    const spent = costText(night.costUsd, usd => `${dollars(usd)} of AI and servers`);
    if (spent) summary.append(pill(spent, 'neutral'));
    if (night.aiStopped) summary.append(Object.assign(pill('AI stopped', 'warn'), {title: "Your AI stopped during the night (its limit or the night's cost cap): open questions are left for you, the rest is filled."}));
  } else summary.append(pill('Nothing sent yet', 'neutral'));
  // The forms the night works on now: how many fill and wait, and one Stop for all of them (owner, 18 Oct 2026: Stop for the whole night).
  const lives = jobs.map(job => liveOf(job, night?.state, state.pending?.has(job.job), night?.why));
  const badged = badge => lives.filter(live => live?.badge === badge).length, stuck = badged('stuck'), waiting = badged('waiting'), filling = lives.filter(live => live && !['waiting', 'stuck'].includes(live.badge)).length;
  if (filling) summary.append(pill(`${filling} filling`, 'info', {dot: true}));
  if (stuck) summary.append(pill(`${stuck} stuck`, 'warn'));
  if (waiting) summary.append(pill(`${waiting} waiting`, 'neutral'));
  if (filling + waiting + stuck) summary.append(act.stopAll());
  body.append(summary);
  // The card's own bar only for a whole night's Fill now (and its first seconds, before the rows show it); each row has its own bar.
  const progress = ['sending', 'preparing'].includes(state.phase) || state.wholeNight ? progressOf({phase: state.phase, batch: night, jobs: state.site?.jobs || [], error: state.phaseError}) : null;
  if (progress) body.append(strip(progress, state.since));
  const rows = el('div', 'ready-rows');
  jobs.forEach((job, i) => {
    const row = rowOf(job), line = el('div', 'ready-row'), live = lives[i];
    if (live) {   // waiting or filling: its badge, its Stop, and its own bar with the live line under it
      const parts = liveParts(live), buttons = el('span', 'ready-buttons');
      if (live.badge !== 'sending') buttons.append(act.stop(job.job));
      line.append(el('span', 'ready-name', names[job.job] || job.host), parts.badge, buttons, parts.line);
      rows.append(line);
      return;
    }
    const buttons = el('span', 'ready-buttons');   // icons with their names as tooltips (owner, 18 Oct 2026: the buttons were "taking too much"; "maybe we should use icons")
    if (['prepared', 'partial', 'wall'].includes(job.state)) { const pair = el('span', 'ready-open'); pair.append(act.open(job.job), act.live(job.job)); buttons.append(pair); }   // the two ways to open it, one group: your own Chrome first, the picture stream beside it
    if (job.video) buttons.append(act.watch(job.job));   // Watch the fill: every form the night opened, also one it could not fill (owner, 18 Oct 2026)
    if (!job.submitted_at) buttons.append(act.again(job.job));   // Fill again: this form from the start, after a yes (owner, 18 Oct 2026: "a button per row with fill again")
    buttons.append(act.done(job.job));
    line.append(el('span', 'ready-name', names[job.job] || job.host), pill(row.text, row.tone), buttons);
    rows.append(line);
  });
  if (jobs.length) body.append(rows);
  const next = el('div', 'ready-summary');
  next.append(el('span', 'muted', 'Tonight'));
  const count = pill(`${tonight.length} ready`, tonight.length ? 'good' : 'warn');
  count.title = tonight.length ? `Your finished jobs with fit ≥ ${state.settings.minFit}, up to ${state.settings.perNight} a night` : 'No job has its kit, CV and cover letter ready yet: Fill now makes them for your best matches.';
  next.append(count);
  if (state.sent) next.append(Object.assign(pill(`Sent ${state.sent.count} · ${new Date(state.sent.at).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit', hour12: false})}`, 'info'),
    {title: 'Sent again by itself when this list changes and before your Mac goes off.'}));
  if (!tonight.length) next.append(el('span', 'muted', 'Fill now makes the kit, CV and letter for your best matches first.'));
  body.append(next);
}

export function build() {
  const card = el('div', 'task-card is-medium ready-card'), words = el('div', 'task-words');
  card.append(el('span', 'task-category', 'APPLICATIONS'));
  const main = el('div', 'task-body'), send = el('button', 'secondary action', 'Fill tonight on the server'), run = el('button', 'secondary action', 'Fill now');
  wand(send); wand(run);
  send.id = 'ready-send'; send.dataset.palette = 'ready'; run.id = 'ready-run';
  const hidden = el('b', '', 'Ready to send: fill tonight\'s forms on the server (nothing is submitted)'); hidden.hidden = true; send.prepend(hidden);
  words.append(el('b', '', 'Ready to send'), el('span', 'muted', 'Your finished jobs are filled on our server overnight. Nothing is submitted: in the morning you open a filled form and press Submit yourself.'));
  main.append(tile('moon'), words, send, run);
  card.append(main, el('div', 'ready-body'), el('div', 'muted ready-note'));
  return {card, send, run};
}

// Not working right now (no owner key, no token today, the site refused or is down): the card stays, says why, and its two buttons are off.
export function blocked(card, why, retry) {
  const body = card.querySelector('.ready-body'), again = el('button', 'secondary', 'Try again');
  const checked = new Date().toLocaleTimeString([], {hour: '2-digit', minute: '2-digit', second: '2-digit'});
  // Try again answers visibly (owner, 18 Oct 2026: "no feedback. No reaction"): Checking… while it asks, then the reason with the time it was checked.
  again.addEventListener('click', () => { again.disabled = true; again.textContent = 'Checking…'; retry(); });
  body.textContent = '';
  const status = el('div', 'ready-status');
  status.append(pill('Not available', 'warn'), el('span', 'muted', `${why || 'Our server did not answer.'} · checked ${checked}`), ...(why === OUTDATED_LINE ? [restartButton()] : []), again);
  body.append(status);
  for (const button of card.querySelectorAll('.task-body button')) { button.disabled = true; button.title = why || ''; }
}

// While the server fills (the night runs, or Fill now was just pressed), the card re-reads the night's rows, so each form's row changes as it is filled
// (live demo, 18 Oct 2026: one re-read at 30 s, then the rows stayed "waiting" with both forms filled). Only the rows: tonight's job list is a slow read.
// Every 5 s (owner, 18 Oct 2026: "some progress bar"): one small read of the site's night, so the bar and the rows move while you watch.
export const FOLLOW_MS = 5000;
const nightState = state => state?.site?.batch?.state;

export async function initReadyCard() {
  const anchor = $('tailor-top')?.closest('.task-pair');
  if (!anchor) return;
  const {card, send, run} = build(), note = card.querySelector('.ready-note'), names = {};
  send.disabled = run.disabled = true;
  card.querySelector('.ready-body').append(el('div', 'muted', 'Checking our server…'));
  anchor.after(card);   // shown at once, always (owner, 18 Oct 2026); what it can do follows
  let tonightNow = null, last = null;
  // Fill now's progress (renderer/pages/ready-progress.js): the press shows "Sending" at once, before any answer; then the site's night moves it.
  let phase = 'idle', phaseError = '', since = 0, nowStep = '', clock = null;
  let wholeNight = false;   // Fill now started the whole night: the card's own bar follows it
  const pending = new Set();   // rows whose Fill again is on its way to the server
  const keepClock = () => {
    if (!card.querySelector('[data-ready-since]:not([data-ready-since=""])')) return;
    clock ||= setInterval(() => { if (!card.isConnected || !card.querySelector('[data-ready-since]:not([data-ready-since=""])')) { clearInterval(clock); clock = null; return; } tickAll(card); }, 1000);
  };
  const sends = () => [send, run];   // a row's Fill again joins a running night (site src/ready-again.js), so it stays on
  const show = state => {
    if (!state?.owner) return blocked(card, state?.why, refresh);
    last = state;
    const unfinished = (state.site?.jobs || []).some(job => ['queued', 'filling'].includes(job.state)), running = nightState(state) === 'running' && (unfinished || !state.site?.jobs?.length);
    const busy = ['sending', 'preparing'].includes(phase) || running;   // a night being filled is never replaced by a second press
    run.textContent = busy ? 'Filling…' : 'Fill now';
    Object.assign(names, state.names || {});
    const now = progressOf({phase, batch: state.site?.batch, jobs: state.site?.jobs || []})?.steps.find(step => step.state === 'now')?.label || '';
    if (now !== nowStep) { nowStep = now; since = now ? Date.now() : 0; }   // the clock counts the step running now
    if (wholeNight && !['queued', 'running'].includes(nightState(state)) && !['sending', 'preparing'].includes(phase)) wholeNight = false;
    paint(card, {...state, tonight: tonightNow ?? state.tonight, phase, phaseError, since, wholeNight, pending}, names, act);
    // Fill tonight and Fill now are off while a night is sent or filled: a new batch would replace the one running (18 Oct 2026: a 2nd press wiped the first fill).
    for (const each of sends()) { each.disabled = busy; if (busy) each.title = 'The server is filling tonight\'s forms: wait for it to finish'; else if (each === send || each === run) each.title = ''; }
    keepClock();
  };
  const repaint = () => last && show(last);
  // The night's rows, then what tonight would send from a fresh job read (the first paint uses the last kept list).
  const read = async () => {
    const state = await window.pilot.readyState().catch(error => ({owner: false, why: errorLine(error)}));
    show(state);
    return state;
  };
  let following = null, started = false;   // started: Fill now was pressed, so a night still "queued" is about to run
  const stop = () => { clearInterval(following); following = null; started = false; };
  const keepUp = state => (nightState(state) === 'running' || (started && nightState(state) === 'queued') ? follow() : stop());
  const follow = () => {
    following ||= setInterval(async () => {
      if (!card.isConnected) return stop();
      keepUp(await read());
    }, FOLLOW_MS);
  };
  const refresh = async () => {
    const state = await read();
    keepUp(state);
    if (!state?.owner) return;
    const fresh = await window.pilot.readyTonight().catch(() => null);
    if (fresh?.ok) { tonightNow = fresh.tonight; show({...state, names: {...state.names, ...fresh.names}}); }
  };
  // Open in my browser: the real page in your own Chrome, filled as the night left it (lib/ready-handoff.js). Open live recording: the server's tab as a picture stream.
  // A row's button: its icon, its name as tooltip and for screen readers. The row's main action also shows its words (owner, 18 Oct 2026: "let's leave icons only
  // for secondary buttons"; "icons it's a bit hard to know what is what"): `words` makes it the app's icon + label button (.with-icon).
  const iconButton = (glyph, name, hint, id, words = '') => {
    const button = Object.assign(el('button', `secondary ${words ? 'with-icon' : 'icon-btn'} ready-${id}`, icon(glyph)), {type: 'button', title: `${name}: ${hint}`});
    if (words) button.append(el('span', '', words));
    button.setAttribute('aria-label', name);
    return button;
  };
  const open = code => { const button = iconButton('external', 'Open in my browser', 'the real page in your own Chrome, filled as the night left it', 'browser', 'Open in Chrome');
    button.addEventListener('click', async () => { button.disabled = true; say('Opening the filled form in your browser…');
      const result = await window.pilot.readyOpen(code).catch(error => ({ok: false, error: errorLine(error)}));
      if (result.cancelled) { button.disabled = false; return; }   // Not now in the first-Apply dialog (pages/apply-choice.js)
      button.disabled = false; say(result.ok ? 'Opened in your browser: check it, solve a bot check if there is one, and press Submit there yourself.' : (result.error || 'Could not open it.'), result.ok ? 'good' : 'bad'); });
    return button; };
  const act = {open, live: code => { const button = iconButton('pulse', 'Open live recording', 'the server\'s copy of this form, live; you finish it there', 'live'); button.addEventListener('click', async () => { const result = await window.pilot.readyLive(code).catch(error => ({ok: false, error: errorLine(error)})); if (!result.ok) say(result.error || 'Could not open it.', 'bad'); }); return button; },
    watch: code => { const button = iconButton('eye', 'Watch the fill', 'the video of the server filling this form tonight (3 minutes at most)', 'watch');
      button.addEventListener('click', () => watchFill(button, code)); return button; },
    again: code => { const button = iconButton('refresh', 'Fill again', 'the server fills this form again from the start, after your yes', 'again'); button.addEventListener('click', () => fillAgain(code)); return button; },
    stop: code => { const button = el('button', 'secondary ready-stop', 'Stop'); button.type = 'button'; button.title = 'Stop filling this form: it goes back to how it was'; button.addEventListener('click', () => { button.disabled = true; stopFill(code); }); return button; },
    stopAll: () => { const button = el('button', 'secondary ready-stop-all', 'Stop all'); button.type = 'button'; button.title = 'Stop every form the night is filling or about to fill'; button.addEventListener('click', () => { button.disabled = true; stopFill(null); }); return button; },
    done: code => { const button = iconButton('check', 'Done', 'delete this form\'s data from the server', 'done'); button.addEventListener('click', async () => { await window.pilot.readyDone(code); refresh(); }); return button; }};
  // What just happened, as a badge and its line (owner, 18 Oct 2026: the status lines "should be shown as badges").
  const LABEL = {info: 'Working', good: 'Done', warn: 'Note', bad: 'Problem'};
  const say = (text, tone = 'info') => {
    note.textContent = '';
    if (!text) return;
    const line = el('div', 'ready-status');
    line.append(pill(LABEL[tone] || LABEL.info, tone), el('span', 'muted', text), ...(text === OUTDATED_LINE ? [restartButton()] : []));
    note.append(line);
  };
  // The night's video of one form, in a popup (pages/ready-video.js).
  const watchFill = async (button, code) => {
    button.disabled = true; say('Loading the video of this form\'s fill…');
    const result = await window.pilot.readyVideo(code).catch(error => ({ok: false, error: errorLine(error)}));
    button.disabled = false;
    if (!result.ok) return say(result.error || 'Could not load the video.', 'bad');
    say(''); showFillVideo(result.bytes, names[code] || code);
  };
  // Fill tonight: sends tonight's list for the night's fill time; asks before replacing forms of this night still waiting for you.
  const sendTonight = async (options = {}) => {
    send.disabled = true; say('Handing tonight\'s jobs to the server to fill (nothing is submitted)…');
    const result = await window.pilot.readySend(options).catch(error => ({ok: false, error: errorLine(error)}));
    if (result.cancelled) { say('Not sent: nothing changed on the server.'); return refresh(); }
    if (result.ask) { if (await confirmFill(result.ask)) return sendTonight({confirmed: true}); say('Not sent: nothing changed on the server.'); return refresh(); }
    say(result.ok ? `${result.queued} job${result.queued === 1 ? '' : 's'} will be filled on the server for the night of ${result.night}, not submitted${result.skipped?.length ? ` · ${result.skipped.length} left out (${result.skipped[0].why})` : ''}.` : (result.error || 'Could not send.'),
      result.ok ? 'good' : result.nothing ? 'warn' : 'bad');
    refresh();
  };
  send.addEventListener('click', () => sendTonight());
  // Fill now (owner, 18 Oct 2026: "I'd expect it to start instantly"): the bar shows Sending at once; the app sends tonight's jobs and starts them in one press,
  // asking first (confirmFill) when it would fill opened jobs again or replace forms still waiting for you.
  const fillNow = async (options = {}, preparing = false) => {
    phase = preparing ? 'preparing' : 'sending'; phaseError = ''; say(''); repaint();
    const result = await window.pilot.readyRun(options).catch(error => ({ok: false, error: errorLine(error)}));
    if (result.cancelled) { phase = 'idle'; repaint(); return say('Not started: nothing was sent.'); }
    if (result.ask) {
      if (await confirmFill(result.ask)) return fillNow({...options, again: result.ask.again, confirmed: true}, preparing);
      phase = 'idle'; repaint(); return say('Not started: nothing was sent.');
    }
    if (!result.ok) { phase = 'idle'; repaint(); return say(result.error || 'Could not start.', result.nothing ? 'warn' : 'bad'); }
    phase = 'started'; started = true; wholeNight = true;
    say(result.queued ? `${result.queued} job${result.queued === 1 ? '' : 's'} sent: the server is filling ${result.queued === 1 ? 'it' : 'them'} now. Nothing is submitted.` : 'Filling started on the server. Nothing is submitted.', 'good');
    refresh();
  };
  // Fill now asks how many first (renderer/pages/ready-pick.js); without the popup's list (an older app, no job read yet) it fills tonight's ready jobs as before.
  run.addEventListener('click', async () => {
    if (typeof window.pilot.readyTop !== 'function') return fillNow();   // an app without the popup's call: the press answers at once
    const top = await window.pilot.readyTop().catch(() => null);
    if (!top?.ok || !top.picked?.length) return fillNow();
    const choice = await pickFill(top);
    if (choice) fillNow({top: choice.codes}, choice.prepare);
  });
  // A row's Fill again: after a yes, the server fills that form again from the night's own copy (lib/ready-handlers.js readyAgain). Its own row shows it at once
  // ("sending"), then waiting or filling with its own bar; a night already running takes it at the end of its line.
  const fillAgain = async code => {
    const name = names[code] || 'This form';
    if (!await confirmFill({again: true, jobs: [{code, name}], replaces: 0, note: 'The night\'s other forms keep what was filled; Open in my browser still works for them.'})) return say('Not started: nothing changed on the server.');
    pending.add(code); say(''); repaint();
    const result = await window.pilot.readyAgain(code).catch(error => ({ok: false, error: errorLine(error)}));
    pending.delete(code);
    if (result.cancelled) { repaint(); return say('Not started: nothing changed on the server.'); }
    if (!result.ok) { repaint(); return say(result.error || 'Could not start.', 'bad'); }
    started = true;
    say(result.joined ? `${name}: added to the night's line; it fills after the form filling now. Nothing is submitted.` : `${name}: the server is filling it again now. Nothing is submitted.`, 'good');
    refresh();
  };
  // Stop (owner, 18 Oct 2026: "a stop button once a row started"): one form, or every form of the night; each goes back to how it was before the press.
  const stopFill = async (code = null) => {
    const result = await window.pilot.readyStop(code).catch(error => ({ok: false, error: errorLine(error)}));
    say(result.ok ? `${code ? names[code] || 'This form' : `${result.stopped} form${result.stopped === 1 ? '' : 's'}`}: stopped; back to how ${code || result.stopped === 1 ? 'it was' : 'they were'} before.` : (result.error || 'Could not stop it.'), result.ok ? 'good' : 'bad');
    refresh();
  };
  await refresh();
}
