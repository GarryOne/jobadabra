// What the extension's requests are answered with: its token, the Applied-session bookkeeping, the Apply-with-Claude tickets, the version
// check, and localEnv (the environment the shared worker code runs in) with the learning after a fill. Re-exported by server.js.
// Guarded by desktop/test/local-server.test.js, automation.test.js, app.test.js and cover-letter.test.js.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import * as claudeCode from './claude-code.js';
import * as cvlib from './cv.js';
import * as experience from './experience.js';
import * as pipeline from './pipeline.js';
import * as learn from './learn.js';
import * as notion from './notion.js';   // Notion-only: the extension's Notion calls only when Notion is the store (notionTexts); this Mac's go through env.store
import * as notionGate from './notion-gate.js';
import {openStore} from './store/index.js';
import {extensionStore} from './store/extension-store.js';
import * as questions from './questions.js';
import * as verdicts from './question-verdicts.js';
import {claudeAi} from './question-ai.js';
import * as terminals from './terminals.js';
import * as strategy from './strategy.js';
import * as knowledge from './knowledge.js';
import * as reports from './reports.js';
import {jobKey} from '../shared/worker/extension.js';
import {log as appLog} from './log.js';
import {contactOf} from './server-contact.js';
import {pageKey} from './server-pages.js';
import {devVersion} from './dev-extension-version.js';
import {captureAnswer} from './live-capture.js';
import {keptAnswerClient} from './ai/index.js';
import {nightAnswers} from './ready-handoff.js';
import {answerReporter, appliedHook, errorWatcher, formIssue, jobName, notify, proposalReporter, sharedLogger, tellWindow} from './server-hooks.js';
import {NAMES, costVisible} from './ai/names.js';
import {cvFactsText} from '../shared/worker/cv-facts.js';
import {configForPrompt} from './config-text.js';
import {factsOf} from './base-facts.js';
import {OWNER_VALUES} from './owner-guard-env.js';   // test harness only: null in a user's app

export function extensionToken(storage) {
  let token = storage.secret('EXTENSION_TOKEN');
  if (!token) {
    token = crypto.randomBytes(24).toString('hex');
    storage.setSecret('EXTENSION_TOKEN', token);
  }
  return token;
}

// The application was submitted: record that (the Agent Runs row), stop Claude, and take the session off
// Application sessions. The job stays on Jobs as Applied. A session already marked Submitted is removed too,
// so one left on screen from before this still goes away on the next job-list read.
// Every session for that job ends, not one: a job can have a Claude session and a form session at once (Reopen form, Take over with Claude).
export function sessionSubmitted(url) {
  const same = String(url || '').replace(/\/$/, '');
  const found = terminals.list().filter(session => String(session.url || '').replace(/\/$/, '') === same);
  for (const session of found) {
    if (session.outcome !== 'submitted') terminals.setOutcome(session.id, 'submitted');
    terminals.remove(session.id);
  }
  return found.length ? found[found.length - 1].id : null;
}

// Sessions whose job is already Applied (or past it) in Notion: the form was submitted — that is what Applied
// means — so they leave Application sessions, whatever state the window happens to be in.
export const APPLIED = new Set(['Applied', 'Confirmation received', 'Screening', 'Interview scheduled', 'Interviewing',
                                'Offer', 'Rejected', 'Withdrawn', 'No response']);
export function appliedSessions(jobs = []) {
  const applied = new Set((jobs || []).filter(job => APPLIED.has(job.stage)).map(job => String(job.url || '').replace(/\/$/, '')));
  return terminals.list().filter(session => applied.has(String(session.url || '').replace(/\/$/, ''))).map(session => session.url);
}
// Run on every fresh job list (main.js 'jobs'): a session for an Applied job is left over from a previous run —
// the extension's report arrived while the app was closing, or the job was marked Applied in the window itself.
// Idempotent: once the session is gone there is nothing to end, so this can run on every read.
export function reconcileAppliedSessions(jobs = []) {
  const ended = [];
  for (const url of appliedSessions(jobs)) { if (sessionSubmitted(url)) ended.push(url); }
  return ended;
}

// cv/cv.json → the <cv_facts> text; '' (logged once per fill) when the CV was not imported yet.
export function cvFactsOf(storage) {
  const base = cvlib.baseCv(storage);
  const withBank = () => { try { return base && experience.withExtras(storage, base); } catch { return base; } };   // a bank that cannot be read leaves the main CV as it was
  const text = cvFactsText(withBank());   // the experience bank's extra bullets and skills too (other CV versions, LinkedIn export): a written answer may rest on them (16 Oct 2026)
  if (!text) appLog('extension', 'cv facts: none (CV not imported yet)');
  return text;
}

export function localEnv(storage, submitted = sessionSubmitted, {find: injected} = {}) {
  const settings = storage.settings();
  const summary = job => ({title: job.title, company: job.company, stage: job.status, url: job.url, notion_url: ''});
  const find = injected || (async url => {
    const {jobs} = await pipeline.jobs(storage);
    const key = jobKey(url);
    return jobs.find(job => job.url === url || (key && job.url.includes(key)));
  });
  // Notion only when it is the store (lib/store): with the data on this Mac nothing reaches a Notion still connected.
  const notionTexts = notionGate.notionInUse(storage);
  const notionToken = notionTexts ? storage.secret('NOTION_TOKEN') : '';
  const ids = notionTexts ? settings.notionIds || {} : {};
  // extension.js calls Notion through the app's paced, retrying call(), and reads the Profile, standard answers and
  // 🧠 Form knowledge from the kept pages (lib/notion.js), or this Mac's files: only when a request needs them (getters), not on every poll.
  const text = name => openStore(storage).page(name).text();
  const kept = (name, id) => (!notionTexts ? text(name) : id ? notion.pageText(notionToken, id) : Promise.resolve(''));
  return {
    // With the data on this Mac: the job, its kit and the fill's record from the store (worker/src/extension.js env.store).
    ...(!notionTexts && notionGate.tracking(storage) ? {store: extensionStore(storage)} : {}),
    notionCall: (route, method = 'GET', body) => notion.call(notionToken, method, route, body),
    get PROFILE_TEXT() { return kept('profile', ids.NOTION_PROFILE_PAGE_ID); },
    get ANSWERS_TEXT() { return kept('answers', ids.NOTION_ANSWERS_PAGE_ID); },
    // The imported CV's jobs and schools (cv/cv.json) for the form AI. Never imported by a fill: no cv.json, no block, no AI call (cc, 11 Oct 2026).
    get CV_FACTS_TEXT() { return Promise.resolve(cvFactsOf(storage)); },
    get SEARCH_TEXT() { return Promise.resolve(configForPrompt(storage, 'search.json')); },   // the strategy's search settings: what the user is aiming for (no note: lib/config-text.js)
    get KNOWLEDGE_TEXT() { return kept('knowledge', ids.NOTION_KNOWLEDGE_PAGE).catch(() => ''); },
    EXTENSION_TOKEN: extensionToken(storage),
    ANTHROPIC_API_KEY: storage.secret('ANTHROPIC_API_KEY'),
    // The user's own Claude Code answers the form when they chose it (Settings → Connections → AI); the API key otherwise.
    get aiClient() { return claudeCode.client(storage, {lane: 'page'}) || keptAnswerClient(storage); },   // the page lane: ahead of side work
    NOTION_TOKEN: notionToken,
    NOTION_APPLICATIONS_DB: ids.NOTION_APPLICATIONS_DB || '',
    NOTION_AGENT_RUNS_DB: ids.NOTION_AGENT_RUNS_DB || '',
    NOTION_PROFILE_PAGE_ID: ids.NOTION_PROFILE_PAGE_ID || '',
    NOTION_ANSWERS_PAGE_ID: ids.NOTION_ANSWERS_PAGE_ID || '',
    // extension.js reads the Profile, standard answers and 🧠 Form knowledge pages from Notion.
    JOB_PILOTTO_KIT_MODEL: pipeline.MODELS.kit,
    markApplied: async (url, decision = '') => {
      const job = await find(url);
      // Irreversible, so what decided it and on what evidence goes to the app's log (grep 'extension' logs/app.log):
      // for a month the app could not answer "why is this Applied?" after the fact (1 Oct 2026).
      appLog('extension', `mark Applied: ${job ? job.url : url} — ${decision || 'no reason given (older extension)'}`);
      if (!job) return {ok: false, error: 'This job isn\'t in your list'};
      const result = await pipeline.setStatus(storage, job.url, 'applied');
      if (!result.ok) return {ok: false, error: result.error || 'Could not mark it Applied'};
      // The confirmation page is the submission (the extension only reports one): the session that filled that
      // form is over too, not left in Application sessions as if Claude were still on it. The "I submitted it"
      // button's own end, without pressing anything.
      submitted(job.url);
      appliedHook({how: 'extension'});
      const where = notionGate.notionInUse(storage) ? 'in your Notion' : 'in Jobadabra';   // about Notion
      notify('Marked Applied ✓', `${jobName(job)}. Saved ${where}.`, {view: 'jobs', job: job.code || job.url});
      return {ok: true, message: `Marked Applied ${where}.`};
    },
    NOTION_KNOWLEDGE_PAGE: ids.NOTION_KNOWLEDGE_PAGE || '',
    localJob: async url => { const job = await find(url); return job ? summary(job) : null; },
    // The extension's own decisions (worker /extension/log), cleaned at that boundary: written here so a decision made
    // in Chrome is in the app's log with everything else (1 Oct 2026: nothing recorded why a job went Applied).
    onLog: entries => {
      errorWatcher(entries);
      for (const entry of Array.isArray(entries) ? entries : []) {
        appLog('extension', `${entry?.kind || 'note'}: ${entry?.text || ''}`, entry?.fields || {});
      }
    },
    // Each AI answer for a form's questions (worker/src/extension.js answerForm): counts and field ids only, in the log; counts only to the site.
    ownerValues: OWNER_VALUES,   // the e2e harness's list of the owner's own values (answers matching it are never typed); null outside the harness
    onAnswerCall: call => { captureAnswer(call); },
    nightAnswers: (url, fields) => nightAnswers(url, fields),   // Ready to send's Open in Chrome: the night's answers for the page it filled (lib/ready-handoff.js)
    onNightAnswers: counts => { appLog('fill', `answered ${counts.fromNight} of ${counts.fields} question(s) from last night's fill`, counts); },   // written only under the e2e harness (lib/live-capture.js): the asked fields and answer kinds, no values
    onAnswer: trace => {
      appLog('fill', `${NAMES[trace.engine] || 'The AI'} answered ${trace.kept} of ${trace.fields} question(s)`, trace);
      if (trace.withheld?.length) appLog('privacy', `owner's own value kept out of ${trace.withheld.length} field(s): ${trace.withheld.map(w => `${w.field} (${w.kind})`).join(', ')}`);   // field ids and kinds, never the value
      answerReporter(trace);
    },
    onReviewAnswer: call => { appLog('fill', `Reviewed one written answer (${call.chars} characters)`, call); },   // counts and cost only, never the text (worker/src/written-answer.js)
    onRun: async run => {
      // A running count of forms the extension filled (technical reports' daily health line: how much it helps).
      storage.saveSettings({formsFilled: (storage.settings().formsFilled || 0) + 1});
      const job = await find(run.url).catch(() => null);
      const added = await questions.collect(storage, run, job?.company || '', undefined, async labels => verdicts.judge(storage, labels, {facts: await factsOf(storage), answered: await verdicts.answeredOf(storage, await questions.standardAnswers(storage)),
        company: job?.company || '', url: run.url, host: learn.siteOf(run.url), ai: claudeAi(storage)}),
        labels => verdicts.record(storage, labels, {url: run.url, company: job?.company || ''}),
        labels => notify('Remembered for future forms', `${labels.length} answer${labels.length > 1 ? 's' : ''} you gave before, asked again by ${job?.company || 'a second employer'}: kept as standard answers. Undo in the job's drawer.`, {view: 'jobs'})).catch(error => {
        console.error('Open questions:', error.message);
        return 0;
      });
      if (added) tellWindow('moved', ['open questions']);   // the Jobs page reads the answers page again (it is not re-read on every reload, 6 Oct 2026)
      if (added) notify('New question to answer once', `${added} question${added > 1 ? 's' : ''} from ${job?.company || 'a form'} had no standard answer. Answer in Jobadabra → Jobs.`, {view: 'jobs'});
      learnFromRun(storage, run, job).catch(error => console.error('Form knowledge:', error.message));
      reports.send(storage, run, undefined, sharedLogger, {latest: latestExtension()}).then(report => {  // each field also shows in the app reports (/telemetry)
        // A fill that failed while Chrome ran an older copy than this app ships is explained first, as its own
        // report: otherwise the fields read as "the extension can't fill these", and the cause stays invisible
        // (1 Oct 2026: a Claude session hit exactly that and filled the whole form by hand).
        const stale = staleExtension(run.debug?.version || '', latestExtension());   // the version Chrome said, not the report's "-dev" build name
        if (stale) formIssue({site: report.site, label: 'Jobadabra extension', type: 'version', reason: stale, version: report.version});
        for (const field of report?.fields || []) formIssue({site: report.site, label: field.label, type: field.type, reason: field.reason, version: report.version});
      }).catch(error => console.error('Fill report:', error.message));
    },
  };
}

// onError: the port can be taken (another copy of the app, a test run); the app keeps working without
// the extension connection instead of crashing.
// After a fill that left fields: learn reusable notes from its record (one small Claude call), keep them for
// the extension and mirror them to the user's 🧠 Form knowledge page in Notion (kits read that page).
async function learnFromRun(storage, run, job) {
  if (!notionGate.tracking(storage)) return;  // the notes live in the store (Notion, or this Mac): none while trying
  const known = await judgeNotes(storage, run, await knowledge.notes(storage));
  const apiKey = storage.secret('ANTHROPIC_API_KEY'), client = claudeCode.client(storage);  // Claude Code when the user chose it
  if (!apiKey && !client) return;
  const version = latestExtension(), settings = storage.settings();
  const studied = learn.studiedFor(settings, version);
  const fresh = learn.newFields(run, studied, known);
  if (!fresh.length) return;  // this site's fields were already studied: no AI call
  const {profile, answers} = await strategy.profileTexts(storage).catch(() => ({profile: '', answers: ''}));
  const {notes, usd} = await learn.learn({run, profile, answers, contact: await contactOf(storage), known, studied, apiKey, client});
  const site = learn.siteOf(run.url);
  // Remember what was studied, learned or not (a cache on the Mac: a missing personal fact isn't retried; it's in Answer once).
  storage.saveSettings({formKnowledgeVersion: version, formKnowledgeStudied: {...studied, [site]: [...new Set([...(studied[site] || []), ...fresh.map(f => learn.labelKey(f.label))])]}});
  if (!notes.length) return;
  await knowledge.add(storage, notes);
  proposalReporter(learn.proposalsOf(notes));  // label wording + profile field only, counted by the site (3+ people) before it is even a candidate
  notify('Learned from this form', `${notes.length} note${notes.length > 1 ? 's' : ''} saved in ${notionGate.notionInUse(storage) ? 'your Notion → Form knowledge' : 'your form knowledge'} (${job?.company || 'this form'}${costVisible(storage) && usd > 0 ? `, $${usd.toFixed(3)}` : ''}). Only you can see them.`);   // about Notion
}

// A note that has left its field empty three fills in a row is not working: drop it from the Notion page and let the field be studied again.
// Logged by site and field wording only, never the note's value.
async function judgeNotes(storage, run, known) {
  const verdict = learn.judge(run, known, storage.settings().formKnowledgeStats || {});
  if (verdict.changed) storage.saveSettings({formKnowledgeStats: verdict.stats});
  if (!verdict.drop.length) return known;
  const studied = {...(storage.settings().formKnowledgeStudied || {})};
  const gone = new Set();
  for (const {note, misses, site} of knowledge.lastFirst(verdict.drop)) {
    try { await knowledge.remove(storage, note); } catch (error) { appLog('knowledge', `could not drop a note: ${error.message}`, {site, field: note.field}); continue; }
    gone.add(note);
    studied[site] = (studied[site] || []).filter(key => key !== learn.labelKey(note.field));
    appLog('knowledge', `dropped a note: its field stayed empty ${misses} fills in a row`, {site, scope: note.scope, field: note.field, kind: note.kind});
  }
  storage.saveSettings({formKnowledgeStudied: studied});
  return known.filter(note => !gone.has(note));
}

// The extension version in the app's folder (the one Chrome loads unpacked): an older one in Chrome reloads itself.
export function latestExtension(read = fs.readFileSync) {
  try {
    const version = JSON.parse(read(`${pipeline.REPO}/extension/manifest.json`, 'utf8')).version || '';
    // A development copy keeps the base version in its manifest and is told the stamped one, so it reloads itself after a pull (extension/tab-report.js).
    return version && developmentCopy() ? devVersion(pipeline.REPO, version) : version;
  } catch { return ''; }
}

// A development copy (npm start from a checkout) has Chrome load the repo's extension/ itself, and since 13 Oct 2026 its version stays the base ("0.9"):
// the build stamps the rest (desktop/scripts/extension-stamp.mjs), so after a pull the extension cannot tell it changed. Said once per extension start,
// when a file there is newer than that start. A packaged app's copy never changes while it runs (an update brings a new stamped version).
export const developmentCopy = () => fs.existsSync(path.join(pipeline.REPO, '.git'));
export function newestExtensionFile(dir = path.join(pipeline.REPO, 'extension')) {
  let newest = 0;
  const walk = at => { for (const entry of fs.readdirSync(at, {withFileTypes: true})) {
    const file = path.join(at, entry.name);
    if (entry.isDirectory()) walk(file); else newest = Math.max(newest, fs.statSync(file).mtimeMs);
  } };
  try { walk(dir); } catch { return 0; }
  return newest;
}
export const EXTENSION_CHANGED = 'extension changed: reload it (chrome://extensions → ↻ on Jobadabra); a development copy does not reload itself';
export function extensionChangedNote({boot, version, at}, state, {latest, newest}) {
  const next = state && state.boot === boot ? state : {boot, at, told: false};
  if (next.told || !version || version !== latest || !(newest() > next.at)) return {state: next, note: ''};
  return {state: {...next, told: true}, note: EXTENSION_CHANGED};
}

// The sentence a stale copy deserves, or '' when the two agree (or either is unknown). One wording for the two
// places that need it: the fill failure the app records, and the sessions page's "likely cause" line.
export function staleExtension(version, latest) {
  if (!version || !latest || version === latest) return '';
  return `Chrome runs Jobadabra extension ${version}, older than this app's ${latest}: reload it once `
    + '(chrome://extensions → ↻ on Jobadabra); from then on it updates itself.';
}
// Apply with Claude → extension hand-off (extension/hook.js). The launcher (tools/apply-batch-claude.sh) asks
// for a ticket per job (POST /claude/ticket, from this computer, with a header web pages can't send without a
// CORS preflight this server never grants); the Claude session hands it to the extension on the form page, and
// the extension checks it here (POST /extension/ticket, with its token) before filling. Valid for 3 hours.
const tickets = new Map();
const TICKET_HOURS = 3;
export function issueTicket(job, now = Date.now()) {
  for (const [key, entry] of tickets) if (entry.expires < now) tickets.delete(key);
  const ticket = crypto.randomBytes(16).toString('hex');
  tickets.set(ticket, {job: pageKey(job), expires: now + TICKET_HOURS * 3600 * 1000});
  return ticket;
}
export function checkTicket(ticket, job, now = Date.now()) {
  const entry = tickets.get(String(ticket || ''));
  return !!entry && entry.expires > now && entry.job === pageKey(job);
}
