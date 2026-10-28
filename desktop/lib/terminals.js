// In-app terminals for Apply with Claude: each session runs `claude` in a pseudo-terminal (node-pty) inside the
// app instead of a Terminal window. The window shows them as a dock of cards and, on a click, a full terminal
// (xterm.js) where you can watch and type. Output is kept (the last OUTPUT_LIMIT characters), so opening a
// session later shows what it did.
//
// Status comes from the session itself, not guesses from the screen: Claude Code hooks (Stop = it finished its
// turn and waits for you, Notification = it asks for something, UserPromptSubmit = you answered) and the skill's
// tools/notify.sh ("Filling started", "Form filled", "Needs your input") report to the app's local server
// (/claude/session), which calls report() here.
//
// Sessions outlive the app: each one is saved to a file on this Mac as it changes (persist), and restore() brings
// them back at the next start, without their process (Claude ended with the app; Chrome's tabs did not). A
// session that was working comes back as stopped; one that waited for you (a question, a filled form) comes back
// as it was. resume() starts Claude again in the same conversation (claude --resume <claudeId>).
//
// The log shows the session's screen, not a replay of its bytes: Claude Code draws on the alternate screen and
// redraws it in place many times a second, so replaying its output at another size, or from a cut-off tail,
// leaves a blank or garbled screen. A headless terminal (the mirror) follows each session at its real size, and
// snapshot() serializes it: what a real terminal shows now. The saved record keeps that screen too.
// Invariants (flow core: read before editing; changing one is the owner's call, said in the commit; each names the test that guards it):
//  1. The journey fields (stuck, stage, accountState, accountStep, accountNeeds, accountHost) are written only through applyJourney -> lib/application-journey.js (desktop/test/application-journey.test.js, desktop/test/journeys.test.js).
//  2. A session outlives the app: saved when it changes, restored at the next start (desktop/test/terminals.test.js).
import {journey} from './application-journey.js';
import {assertSession} from './session-contracts.js';
import fs from 'node:fs';
import os from 'node:os';

import {log as appLog} from './log.js';
import path from 'node:path';
import {writePrivate} from './private-file.js';

let Headless = null;  // {Terminal, SerializeAddon}; without it the log falls back to the raw output
try {
  const [headless, serialize] = await Promise.all([import('@xterm/headless'), import('@xterm/addon-serialize')]);
  Headless = {Terminal: (headless.default || headless).Terminal, SerializeAddon: (serialize.default || serialize).SerializeAddon};
} catch { /* not installed */ }
function newMirror(cols, rows, initial = '') {
  if (!Headless) return null;
  const term = new Headless.Terminal({cols, rows, scrollback: 5000, allowProposedApi: true});
  const serializer = new Headless.SerializeAddon();
  term.loadAddon(serializer);
  if (initial) term.write(initial);
  return {term, serializer};
}
const screenOf = mirror => mirror.serializer.serialize({scrollback: 5000});
// A recorded output as a real terminal of cols x rows would show it (also for demo mode).
export async function snapshotOf(raw, cols = 120, rows = 32) {
  const mirror = newMirror(cols, rows);
  if (!mirror) return {data: raw, cols, rows};
  await new Promise(done => mirror.term.write(raw, done));
  const data = screenOf(mirror);
  mirror.term.dispose();
  return {data, cols, rows};
}

const OUTPUT_LIMIT = 400_000;
const SAVED_OUTPUT = 80_000;  // the tail of each session's output that is saved
const KEEP_DAYS = 14;
const sessions = new Map();
let saveFile = null, saveTimer = null, closing = false;
let listener = () => {};
// The timeline of each session (every status change, with its time) feeds its statistics in Notion (session-stats.js):
// onStatus(fn) hears each change, so the app writes them when something happened, not on every byte of output.
let statusListener = () => {};
export function onStatus(fn) { statusListener = fn; }
function mark(session, status = session.status, now = new Date().toISOString()) {
  session.events ||= [];
  if (session.events.at(-1)?.status === status) return;
  session.events.push({at: now, status});
  if (session.kind !== 'form') statusListener(publicView(session), session);  // a form session has no Claude run to report on
}
// What you decided at the end: 'submitted' or 'not submitted' (the "Did you submit?" question, or Jobs → ⋯).
let outcomeListener = () => {};
export function onOutcome(fn) { outcomeListener = fn; }   // told when you decide how an application ended (the statistics: lib/application-result.js)
export function setOutcome(id, outcome) {
  const session = sessions.get(id);
  if (!session) return;
  session.outcome = outcome;
  session.decidedAt = new Date().toISOString();
  mark(session, `decided: ${outcome}`, session.decidedAt);
  saveNow();
  if (outcome) { try { outcomeListener({id: session.id, kind: session.kind, url: session.url, outcome, stuck: session.stuck || '', accountHost: session.accountHost || ''}); } catch { /* the statistics never break a decision */ } }
}
export const record = id => sessions.get(id) || null;  // the full record (timeline, transcript path), for statistics
let loadPty = () => import('@lydell/node-pty').then(module => module.default || module);

// For tests: a fake pseudo-terminal.
export function usePty(loader) { loadPty = loader; }
// The app's window is told about every change: onChange(event, payload).
export function onChange(fn) { listener = fn; }
// The window shows this session (a session that replaces another: shown before the old one goes, so the page never falls to another).
export const show = id => listener('open', {id});
// The session's form is open in Chrome (its tab reported): a Claude session that stopped (the app closed, Claude exited) is not over,
// the form is there to fill and check (owner, 8 Oct 2026: "Ended" while the extension was filling it). It reads as the Apply button's
// session from then on ("Form open", then "Review the filled application"); Resume Claude still takes it back. → true when it changed.
export function formInChrome(id, now = Date.now()) {
  const session = sessions.get(id);
  if (!session || isLive(session) || !['ended', 'failed'].includes(session.status) || session.outcome) return false;
  Object.assign(session, {status: 'done', note: 'Form open in Chrome', inChrome: true, needsYouSince: new Date(now).toISOString()});
  mark(session, 'form open in Chrome');
  listener('update', publicView(session));
  save();
  return true;
}

export async function available() {
  try { await loadPty(); return true; } catch { return false; }
}

// A session is live while its process runs; a restored or ended one is not (but can be resumed with its claudeId).
const isLive = s => !!s.term && !s.endedAt;
// Claude's asks of a session that is not running (closed with the app, ended) are frozen: with the takeover off they must not reach any screen (owner, 15 Oct 2026, "I told you a million
// times": "Click 'Please sign in'…" and "reply continue" rows, with Tell Claude buttons). So the question and its brief are dropped and the session reads as a form session the extension drives (status done: the card follows its live tab, owner 16 Oct 2026: not "The session ended"), at the ONE
// place every screen, list, tray and notice reads sessions from. A form session never had a Claude ask. Guard: test/claude-asks-hidden.test.js.
let asksOff = false;   // set by main.js from the ONE flag of Claude's takeover (renderer/claude-help.js SHOW_RESUME_CLAUDE); false: as before (tests, the twin)
export const hideAsks = on => { asksOff = !!on; };
const asksHidden = s => asksOff && (s.kind || 'claude') !== 'form' && !isLive(s);
const publicView = s => assertSession({id: s.id, kind: asksHidden(s) ? 'form' : s.kind || 'claude', url: s.url, title: s.title || '', company: s.company || '', status: asksHidden(s) && ['input', 'ended', 'failed'].includes(s.status) ? 'done' : s.status, note: asksHidden(s) && s.status === 'input' ? '' : s.note || '',   // Claude Code's own "waiting for your input" note
  outcome: s.outcome || '', background: s.background || null,
  live: isLive(s), resumable: !!s.claudeId && !isLive(s) && s.outcome !== 'submitted',
  // Came back from the last run (the app closed, or was killed) and you weren't asked yet what to do with it.
  askAtStart: !!s.restored && !s.asked && !isLive(s),
  startedAt: s.startedAt || '', endedAt: s.endedAt || null, exitCode: s.exitCode ?? null, needsYouSince: s.needsYouSince || null,
  stuck: s.stuck || '', stage: s.stage || '', inChrome: !!s.inChrome, accountHost: s.accountHost || '', accountState: s.accountState || '', accountStep: s.accountStep || '', accountNeeds: s.accountNeeds || '', accountTerms: s.accountTerms || [], accountCode: !!s.accountCode, question: asksHidden(s) ? '' : s.question || '', brief: asksHidden(s) ? '' : briefly(s.question || s.note), location: s.location || '', workMode: s.workMode || ''});
export const list = () => [...sessions.values()].map(publicView);
export const get = id => (sessions.has(id) ? publicView(sessions.get(id)) : null);
export const claudeIdOf = id => sessions.get(id)?.claudeId || '';
export const byUrl = url => list().filter(s => s.url === url).pop() || null;

// Claude Code's screen after Esc on a running turn. `data` must hold the end of the phrase, so one already on screen
// (from before the reply) never pauses the session again.
const INTERRUPTED = /Interrupted\s*·\s*What should Claude do instead\?/;
export function interruptedIn(before, data) {
  const tail = String(before).slice(-80);
  const match = INTERRUPTED.exec(tail + String(data));
  return !!match && match.index + match[0].length > tail.length;
}

// Runs the process of a session: its output is kept and saved, its exit ends it (unless the app is closing).
function attach(session, {file, args = [], cwd, env, cols = 120, rows = 32}) {
  return loadPty().then(pty => {
    const term = pty.spawn(file, args, {name: 'xterm-256color', cols, rows, cwd, env: {...env, TERM: 'xterm-256color', COLORTERM: 'truecolor'}});
    session.term = term;
    session.promptSeen = false;  // set by the first prompt hook of this process (report): before it, "Interrupted" on screen is history
    Object.assign(session, {cols, rows});
    if (session.mirror) session.mirror.term.resize(cols, rows); else session.mirror = newMirror(cols, rows);
    term.onData(data => {
      // A resumed Claude repaints the old conversation, "Interrupted · What should Claude do instead?" included: that is
      // history, not an Esc. Only after this process has taken a prompt (it is working on a turn) does the phrase mean a pause.
      const paused = session.status === 'running' && session.promptSeen && interruptedIn(session.output, data);
      session.output = (session.output + data).slice(-OUTPUT_LIMIT);
      // Esc on a running turn fires no Stop hook, so the card would say "Working…" for a session that is waiting.
      if (paused) report(session.id, {event: 'input', message: 'Paused: tell Claude what to do, or press Continue'});
      session.mirror?.term.write(data);
      listener('data', {id: session.id, data});
      save();
    });
    term.onExit(({exitCode}) => {
      if (closing || session.term !== term) return;  // the app is quitting (state already saved), or it was resumed since
      session.exitCode = exitCode;
      session.endedAt = new Date().toISOString();
      // Marking Applied stops the process (SIGHUP, exit 129). That is a submission, not a crash.
      if (session.outcome === 'submitted') {
        session.status = 'ended';
        session.note = 'Submitted';
      } else if (session.status !== 'done') {
        session.status = exitCode === 0 ? 'ended' : 'failed';
        session.note = exitCode === 0 ? 'Session ended' : `Session stopped (exit ${exitCode})`;
      }
      mark(session, session.status === 'done' ? 'ended after filling' : session.status);
      listener('update', publicView(session));
      save();
    });
  });
}

// Start one session: file + args run in cwd with env, in a terminal of cols x rows. claudeId is the Claude Code
// conversation it runs (claude --session-id), kept so the session can be resumed after the app was closed.
// kind: 'claude' (Apply with Claude) or 'read' (Read with Claude, lib/claude-session.js launchRead): a read is not an application, so it never
// waits on you and never shows in Applying (renderer/pages/sessions.js), and it is closed when Claude is done.
export async function start({id, url, title = '', company = '', location = '', workMode = '', claudeId = '', kind = 'claude', ...launch}) {
  const session = {id, kind, url, title, company, location, workMode, claudeId, term: null, output: '', status: 'running', note: 'Starting…', startedAt: new Date().toISOString(), events: []};
  await attach(session, launch);
  sessions.set(id, session);
  mark(session, 'running', session.startedAt);
  listener('update', publicView(session));
  save();
  return publicView(session);
}

// A form session: the plain Apply button. No process: the extension fills the form in the user's Chrome tab, and its live
// report (what is left, whether the tab is open, the submit) reaches this record through the same id as any session. It sits
// at 'done' ("review the filled application") because from the first minute the form is the user's to check. One per job:
// pressing Apply again returns the one that is open.
export function startForm({id, url, title = '', company = '', location = '', workMode = ''}) {
  const open = [...sessions.values()].find(s => s.url === url && s.kind === 'form' && !s.outcome);
  if (open) return publicView(open);
  const now = new Date().toISOString();
  const session = {id, kind: 'form', url, title, company, location, workMode, claudeId: '', term: null, output: '', status: 'done',
    note: 'Form open in Chrome', startedAt: now, needsYouSince: now, events: []};
  sessions.set(id, session);
  mark(session, 'done', now);
  listener('update', publicView(session));
  save();
  return publicView(session);
}

// The extension could not get to this form ('no-form': no form and no Apply button it may press; 'account': it needs a sign-in):
// the session says so and offers Apply with Claude. Cleared when the extension reports a form on it after all.
// → true when it changed, false when nothing did. 'account' is the furthest point of the chain (posting → Apply → sign-in): a
// later 'no-form' from a tab earlier in it (the posting the Apply button left behind) never takes it back (owner, 8 Oct 2026:
// Manor's sign-in page was reported, then its posting tabs said "no form" and the card lost the account step).
export function noteStuck(id, why, host = '', needs = '', accountStep = '') {
  return applyJourney(id, {type: 'stuck', why, host, needs, accountStep});
}
// The person pressed Stop: the form session says so, whatever step it was at (lib/stop-all.js).
export const noteStopped = id => applyJourney(id, {type: 'stop'});
// Where the application is, from what the extension sees in its tab: 'account' (a sign-in or sign-up page, on `host`) or 'form'
// (the application form, its fields reported). The account's site is kept, so the form step can say it is step 2 of 2.
export function setStage(id, stage, host = '') {
  return applyJourney(id, {type: 'stage', stage, host});
}
// The account made for this application (account-step.js): 'created' (usable), 'confirm' (a confirmation is awaited), 'exists' (it was there already), 'refused' (a sign-in was refused: tried once, the sign-up comes next). Shown on the session.
export function setAccount(id, state) {
  return applyJourney(id, {type: 'account', state});
}
// A fact about the account the extension handled on this application's account page, for the card's record: 'terms' (the consent it accepted, as the page words it) or 'code' (a code from the mail was typed). Never a value.
export function setAccountFact(id, fact, text = '') {
  return applyJourney(id, {type: 'account-fact', fact, text});
}
export function clearStuck(id) {
  applyJourney(id, {type: 'clear-stuck'});
}
// The one writer of a session's journey fields (lib/application-journey.js decides; this applies, tells the window and saves).
function applyJourney(id, event) {
  const session = sessions.get(id);
  const {set, result} = journey(session, event);
  if (!Object.keys(set).length) return result;
  Object.assign(session, set);
  listener('update', publicView(session));
  save();
  return result;
}
// Apply with Claude took over the job: its form session is not needed any more.
export function dropForm(url) {
  for (const session of [...sessions.values()]) if (session.kind === 'form' && session.url === url) remove(session.id);
}

// Starts Claude again in the conversation of a session that isn't running (restored, ended or stopped). Its record
// stays: job, output (a line marks the restart), question. A stopped one goes back to working; one that waited
// for you stays as it was (it waits in the resumed conversation).
export async function resume(id, launch) {
  const session = sessions.get(id);
  if (!session) throw new Error('This session is no longer in the list.');
  if (isLive(session)) return publicView(session);
  await attach(session, launch);
  session.output = (session.output + '\r\n\x1b[2m— resumed —\x1b[0m\r\n').slice(-OUTPUT_LIMIT);
  session.endedAt = null;
  session.exitCode = null;
  session.restored = false;
  if (session.status === 'ended' || session.status === 'failed' || session.inChrome) Object.assign(session, {status: 'running', note: 'Resuming…', needsYouSince: null, inChrome: false});
  mark(session, session.status === 'running' ? 'running' : `resumed (${session.status})`);
  listener('update', publicView(session));
  save();
  return publicView(session);
}

// ---- Saving and restoring (sessions.json in the data folder; a cache of runtime state, never the only copy of
// anything the user owns: the run's result is in Notion and the filled form is in Chrome) ----
export function persist(file) { saveFile = file; }
const saved = s => ({
  background: s.background || null,
  id: s.id, kind: s.kind || 'claude', stuck: s.stuck || '', inChrome: !!s.inChrome, url: s.url, title: s.title, company: s.company, location: s.location, workMode: s.workMode,
  stage: s.stage || '', accountHost: s.accountHost || '', accountState: s.accountState || '', accountStep: s.accountStep || '',
  accountNeeds: s.accountNeeds || '', accountTerms: s.accountTerms || [], accountCode: !!s.accountCode,
  claudeId: s.claudeId || '', asked: !!s.asked, transcript: s.transcript || '', events: s.events || [], outcome: s.outcome || '',
  decidedAt: s.decidedAt || null, runPage: s.runPage || '', conversationSaved: s.conversationSaved || 0, status: s.status, note: s.note, question: s.question || '', answered: !!s.answered,
  startedAt: s.startedAt || '', endedAt: s.endedAt || null, exitCode: s.exitCode ?? null, needsYouSince: s.needsYouSince || null,
  output: s.output.length > SAVED_OUTPUT ? s.output.slice(-SAVED_OUTPUT).replace(/^[^\n]*\n/, '') : s.output,
  screen: s.mirror ? screenOf(s.mirror) : s.screen || '', cols: s.cols || 120, rows: s.rows || 32, savedAt: new Date().toISOString()});
// A record that leaves this file leaves the app: the list is the app's only copy of a session (its transcript and
// statistics live elsewhere, but "which sessions do I have" does not). So when a save would write *fewer* records
// than the file already holds, the file as it stands is kept beside it as sessions.json.previous first — a session
// that disappears (a removal, a reconciler, or a quit that saved an empty list over a hand-written record: 1 Oct
// 2026, twice) can always be read back. Written by hand or by an older build, an unreadable file is left alone.
function keepPrevious(next) {
  try {
    const onDisk = JSON.parse(fs.readFileSync(saveFile, 'utf8'));
    if (!Array.isArray(onDisk) || onDisk.length <= next.length) return;
    fs.copyFileSync(saveFile, `${saveFile}.previous`);
    appLog('sessions', `kept ${onDisk.length} record(s) as sessions.json.previous before writing ${next.length}`,
      {ids: onDisk.map(record => record.id).filter(Boolean)});
  } catch { /* no file, or not ours: nothing to keep */ }
}
export function saveNow() {
  clearTimeout(saveTimer);
  saveTimer = null;
  if (!saveFile) return;
  try {
    fs.mkdirSync(path.dirname(saveFile), {recursive: true});
    const next = [...sessions.values()].map(saved);
    keepPrevious(next);
    writePrivate(saveFile, JSON.stringify(next));  // output can hold form answers; written whole or not at all (lib/private-file.js)
  } catch { /* not saved this time; the next change tries again */ }
}
function save() {
  if (!saveFile || saveTimer) return;
  saveTimer = setTimeout(saveNow, 1500);
  saveTimer.unref?.();
}
// At start: the saved sessions come back without a process. Working ones (their process died with the app) are
// shown as stopped; older than KEEP_DAYS are dropped. Returns how many came back.
// The Claude Code transcript of a session that didn't keep its path (sessions from before the path was saved): the
// one whose first prompt names this session's instructions file (prompt_<id>.txt). Only recent transcripts are
// looked at, and only their start is read. '' when none is found.
export function findTranscript(id, {root = path.join(os.homedir(), '.claude', 'projects'), now = Date.now(), days = KEEP_DAYS} = {}) {
  const wanted = `prompt_${id}.txt`;
  let dirs = [];
  try { dirs = fs.readdirSync(root, {withFileTypes: true}).filter(d => d.isDirectory()).map(d => path.join(root, d.name)); } catch { return ''; }
  for (const dir of dirs) {
    let files = [];
    try { files = fs.readdirSync(dir).filter(name => name.endsWith('.jsonl')).map(name => path.join(dir, name)); } catch { continue; }
    for (const file of files) {
      try {
        if (now - fs.statSync(file).mtimeMs > days * 86400_000) continue;
        const handle = fs.openSync(file, 'r');
        const head = Buffer.alloc(65536);
        const read = fs.readSync(handle, head, 0, head.length, 0);
        fs.closeSync(handle);
        if (head.toString('utf8', 0, read).includes(wanted)) return file;
      } catch { /* unreadable: skip it */ }
    }
  }
  return '';
}

export function restore(now = Date.now(), {find = findTranscript} = {}) {
  if (!saveFile) return 0;
  let records = [];
  try { records = JSON.parse(fs.readFileSync(saveFile, 'utf8')); } catch { return 0; }
  for (const record of Array.isArray(records) ? records : []) {
    if (!record?.id || sessions.has(record.id) || now - Date.parse(record.startedAt) > KEEP_DAYS * 86400_000) continue;
    const {savedAt, screen, ...session} = record;
    // Its last message read again: a Stop that came before the message reached the transcript saved an older one.
    // A session that didn't keep its transcript's path gets it found first (by its instructions file's name).
    if (!session.transcript && session.status !== 'running' && session.question) session.transcript = find(session.id, {now}) || '';
    if (session.transcript && session.status !== 'running' && session.question) session.question = lastAssistantText(session.transcript) || session.question;
    // Its screen comes back as it was (older records have only the output's tail: the best that can be shown).
    session.mirror = newMirror(session.cols || 120, session.rows || 32, screen || session.output || '');
    if (session.status === 'running') Object.assign(session, {status: 'ended', note: 'Stopped when the app closed', endedAt: savedAt || new Date(now).toISOString()});
    sessions.set(session.id, {...session, term: null, restored: true});
  }
  return sessions.size;
}
// You were asked (at start) what to do with these: not again.
export function markAsked(ids) {
  for (const id of ids) { const session = sessions.get(id); if (session) session.asked = true; }
  saveNow();
}
// The app is quitting: save what each session was doing, then end their processes without changing that.
export function shutdown() {
  saveNow();
  closing = true;
  for (const session of sessions.values()) if (isLive(session)) session.term.kill();
}

export const output = id => sessions.get(id)?.output || '';
// What the log shows when it opens: the session's screen and scrollback, at the size it was drawn for.
export async function snapshot(id) {
  const session = sessions.get(id);
  if (!session) return {data: '', cols: 120, rows: 32};
  const {cols = 120, rows = 32, mirror} = session;
  if (!mirror) return {data: session.output || '', cols, rows};
  await new Promise(done => mirror.term.write('', done));  // what's still being parsed
  return {data: screenOf(mirror), cols, rows};
}
export function write(id, data) { const session = sessions.get(id); if (session && isLive(session)) session.term.write(String(data)); }
export function resize(id, cols, rows) {
  const session = sessions.get(id);
  if (!session || !isLive(session) || cols <= 10 || rows <= 3) return;
  Object.assign(session, {cols: Math.floor(cols), rows: Math.floor(rows)});
  session.term.resize(session.cols, session.rows);
  session.mirror?.term.resize(session.cols, session.rows);
}
export function stop(id) {
  const session = sessions.get(id);
  if (session && isLive(session)) session.term.kill();
}
export function remove(id) {
  stop(id);
  sessions.get(id)?.mirror?.term.dispose();
  sessions.delete(id);
  listener('update', {id, removed: true});
  save();
}
export const running = () => list().filter(s => s.live);

// What a session reported: a hook event or a notify.sh message. Returns the new public view (null if unknown),
// and whether it now needs you (for the notification).
// Claude's last words in a session (its question when it waits for you): the last assistant text in the
// transcript Claude Code names in each hook call (JSON lines). '' when unreadable.
export function lastAssistantText(file, read = fs.readFileSync) {
  try {
    const lines = String(read(file, 'utf8')).trim().split('\n').slice(-200).reverse();
    for (const line of lines) {
      const entry = JSON.parse(line);
      if (entry.type !== 'assistant') continue;
      const text = (entry.message?.content || []).filter(part => part.type === 'text').map(part => part.text).join('\n').trim();
      if (text) return text.length > 3000 ? text.slice(-3000).replace(/^[^\n]*\n/, '') : text;  // whole lines only
    }
  } catch {}
  return '';
}

// A message in one short plain sentence (notifications, the dock): markdown removed, its question if it asks
// one (the last sentence ending in "?"), else its first sentence, cut at a word with "…".
export function briefly(text, limit = 160) {
  const plain = String(text || '').replace(/\*\*|__|`/g, '').replace(/^\s*(#+|[-*•]|\d+[.)])\s+/gm, '')
    .replace(/\s*\n+\s*/g, ' ').replace(/\s+/g, ' ').trim();
  const sentences = plain.match(/[^.!?]+[.!?]+/g) || [plain];
  const pick = (sentences.filter(s => s.trim().endsWith('?')).pop() || sentences[0] || '').trim();
  if (pick.length <= limit) return pick;
  return pick.slice(0, limit).replace(/\s+\S*$/, '') + '…';
}

// Claude Code can call the Stop hook a moment before its last message reaches the transcript file, so the first
// read gets the message before it (seen: "Race is set. Checking the resume…" instead of the hand-over report).
// Read it again a few times over the next seconds; a newer message replaces the question, until you reply.
export const SETTLE_MS = [500, 1500, 4000];
function settle(session) {
  const turn = session.turn || 0;
  for (const delay of SETTLE_MS) {
    const timer = setTimeout(() => {
      if (!sessions.has(session.id) || (session.turn || 0) !== turn || !session.transcript) return;
      const text = lastAssistantText(session.transcript);
      if (!text || text === session.question) return;
      session.question = text;
      listener('update', publicView(session));
      save();
    }, delay);
    timer.unref?.();
  }
}

export function report(id, {event = '', message = '', transcript = ''} = {}) {
  const session = sessions.get(id);
  if (!session) return {session: null, needsYou: false};
  if (transcript) session.transcript = transcript;
  if (session.transcript && (event === 'stop' || event === 'input')) {
    session.question = lastAssistantText(session.transcript) || session.question || '';
    settle(session);
  }
  if (event === 'prompt') { session.question = ''; session.turn = (session.turn || 0) + 1; session.promptSeen = true; }
  const before = session.status;
  const text = String(message || '').trim();
  if (event === 'note' && /^Form filled/i.test(text)) Object.assign(session, {status: 'done', note: 'Form filled — review it in Chrome and Submit'});
  else if (event === 'note' && /Needs your input|No kit yet/i.test(text)) Object.assign(session, {status: 'input', note: text.replace(/\s*—\s*see Terminal$/, '')});
  else if (event === 'note' && text) Object.assign(session, {note: text});
  else if (session.kind === 'read' && event === 'input') Object.assign(session, {note: 'Reading in Chrome…'});   // Claude Code's idle notice: nobody is asked
  else if (session.kind === 'read' && event === 'stop') Object.assign(session, {status: 'done', note: String(session.question || 'Finished reading').slice(0, 200)});
  else if (event === 'input') Object.assign(session, {status: 'input', note: text || 'Claude needs your input'});
  else if (event === 'stop' && session.status !== 'done') Object.assign(session, {status: 'input', note: 'Waiting for your reply'});
  // The first prompt is the app's own instructions (Claude Code reports it like a reply): only later ones are yours.
  else if (event === 'prompt') Object.assign(session, {status: 'running', note: session.answered || before === 'input' ? 'Working on your reply…' : 'Working…', answered: session.answered || before === 'input'});
  if (session.status === 'input' && before !== 'input') session.needsYouSince = new Date().toISOString();
  if (session.status !== 'input') session.needsYouSince = null;
  mark(session);
  listener('update', publicView(session));
  save();
  // A read whose Claude is done sits at its prompt: closed, its jobs are saved already (a reply would go nowhere).
  if (session.kind === 'read' && event === 'stop') setTimeout(() => stop(id), 2000).unref?.();
  return {session: publicView(session), needsYou: session.status === 'input' && before !== 'input'};
}

// Claude Code settings for a session: hooks that report to the app (curl, on macOS and in Git Bash on Windows).
export function hookSettings(id, port) {
  // Double quotes and no redirects: the same command works in bash (Mac, Git Bash) and in cmd (Windows). Its tiny
  // {"ok":true} reply isn't shown for these hooks; with the app closed curl just fails quietly (-s) and Claude goes on.
  const post = event => ({type: 'command', command:
    `curl -s -m 3 -X POST -H "X-Job-Pilotto: launcher" -H "Content-Type: application/json" --data-binary @- ` +
    `"http://127.0.0.1:${port}/claude/session?id=${encodeURIComponent(id)}&event=${event}"`});
  return JSON.stringify({hooks: {
    Notification: [{hooks: [post('input')]}],
    Stop: [{hooks: [post('stop')]}],
    UserPromptSubmit: [{hooks: [post('prompt')]}],
  }});
}

export const _sessions = sessions;  // tests
export function _reset() { clearTimeout(saveTimer); saveTimer = null; saveFile = null; closing = false; sessions.clear(); }  // tests
export const label = session => [session.company, session.title].filter(Boolean).join(' · ') || path.basename(session.url || '');
