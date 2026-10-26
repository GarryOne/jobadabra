// "Look around first": the app restarts on a fresh copy of the fictional demo data (demo/) and back to the user's
// own setup. A command-line flag carries the demo folder, so the restart works the same on Mac and Windows (no
// environment to pass on), and the actions that would reach outside answer "demo" instead of running.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// The folder the demo reads its fictional data from: the app's demo/, or JOB_PILOTTO_DEMO_DIR (the product media,
// recorded in the private site repo). Every demo read goes through demoPath (desktop/test/demo-dir.test.js).
export const folder = (here, env = process.env) => env.JOB_PILOTTO_DEMO_DIR || path.join(here, 'demo');
export const demoPath = (here, name) => path.join(folder(here), name);

export const FLAG = '--job-pilotto-demo';
export const PREFIX = 'job-pilotto-demo-';
export const TEXT = 'Demo mode: nothing is sent. Click "Set up my own" to use this with your own data.';

// Only a folder this module made (in the temp folder, named job-pilotto-demo-…): the flag can never point the
// demo's unencrypted store at the user's real data folder.
export function isDemoFolder(folder, tmp = os.tmpdir()) {
  if (!folder || !path.isAbsolute(folder)) return false;
  const resolved = path.resolve(folder);
  return path.dirname(resolved) === path.resolve(tmp) && path.basename(resolved).startsWith(PREFIX);
}

// The demo folder named on the command line (--job-pilotto-demo=<folder>), or null.
export function folderFrom(argv, tmp = os.tmpdir()) {
  const arg = argv.find(item => String(item).startsWith(`${FLAG}=`));
  const folder = arg ? arg.slice(FLAG.length + 1) : '';
  return isDemoFolder(folder, tmp) ? path.resolve(folder) : null;
}

// A fresh copy of demo/ in the temp folder; earlier copies go first. jobs.json stays in the app (read from there).
export function prepare(source, tmp = os.tmpdir()) {
  for (const name of fs.readdirSync(tmp)) {
    if (name.startsWith(PREFIX)) try { fs.rmSync(path.join(tmp, name), {recursive: true, force: true}); } catch { /* in use */ }
  }
  const folder = fs.mkdtempSync(path.join(tmp, PREFIX));
  // read + write, not copyFile: the packaged app's demo/ is inside app.asar.
  for (const name of fs.readdirSync(source)) {
    if (name !== 'jobs.json') fs.writeFileSync(path.join(folder, name), fs.readFileSync(path.join(source, name)));
  }
  return folder;
}

// The restart's arguments (app.relaunch({args})): this run's own, without a demo flag, plus the new one (into the
// demo) or none (back to the user's own data folder and setup).
export function restartArgs(argv, folder = null) {
  const args = argv.slice(1).filter(item => !String(item).startsWith(`${FLAG}=`));
  return folder ? [...args, `${FLAG}=${folder}`] : args;
}

// Window actions that would reach outside (Notion, Telegram, GitHub, Anthropic, Gmail, Claude, updates) or change
// this computer (keys, login item, recording): in demo mode they answer this instead of running.
export const BLOCKED = ['notionConnect', 'notionOAuth', 'saveSecret', 'startFreeAi', 'checkAnthropic', 'cloudOff',
  'telegramCloudOn', 'telegramCloudOff', 'telegramConnect', 'googleConnect', 'licenseRemove', 'applyWithClaude', 'apply',
  'applyOne', 'sessionRestart', 'sessionReopen', 'sessionsStopExtension', 'sessionResume', 'updateInstall', 'updateCheck', 'betaSet', 'testSet', 'betaRollback', 'resetProfile', 'importProfile', 'importCv', 'buildCvDraft', 'buildCvSave', 'buildCvDownload',
  'backupNow', 'checkMail', 'command', 'rescoreOutdated', 'prepareKit', 'tailorCv', 'tailorTop', 'readySend', 'readyRun', 'readyLive', 'readyOpen', 'readyVideo', 'readyDone', 'readyDeleteAll', 'readySettings', 'ivRecordStart',
  'ivTranscribe', 'ivSave', 'ivLink', 'ivReview', 'answerQuestion', 'cvApply', 'cvReview', 'cvCheckRun', 'cvCheckAi', 'matchCheck', 'saveStrategy', 'setStatus', 'setStage',
  'setAutomation', 'lookAround'];
export function blocked(name) {
  if (name === 'saveSecret') throw new Error(TEXT);  // its callers expect the keys back, or an error
  return {ok: false, error: TEXT, text: TEXT};
}
// ipcMain.handle, answering BLOCKED actions with blocked(name) (demo mode).
export const guard = handle => (name, listener) => handle(name, BLOCKED.includes(name) ? () => blocked(name) : listener);

// Whether background jobs go to the person's GitHub repo (Always on). Never in the demo: its settings name a repo (so the app shows Always on), but a press on Find jobs
// must run here, on the script (lib/demo-search.js), and send nothing anywhere. Every handler asks this through main.js `cloud()`.
export const cloudRuns = (settings, demo) => !demo && !!settings?.cloud?.repo;

// Which demo sessions' forms count as open in Chrome (the formsOpen check): those with a form state in review.json. No extension reports in the demo, so
// the Applying card said "Checking Chrome for this application…" and then "Chrome isn't reporting" on every demo screen (owner, 24 Oct 2026: "Let it
// show a more real/relevant status as form opened"). Guard: desktop/test/demo-forms-open.test.js.
export const demoFormsOpen = states => ({known: true, ids: (Array.isArray(states) ? states : []).map(state => String(state.id)), unsure: []});

// Python jobs in demo mode: only the ones that read the demo folder (the Strategy page, a job's posting).
const LOCAL = ['src.desktop strategy', 'src.desktop posting'];
export const pipelineAllowed = args => LOCAL.some(prefix => args.join(' ').startsWith(prefix));

// The Log box's confirmation step in demo mode: a fictional reading, nothing read. The default is the 30 Sep 2026
// case (a LinkedIn chat screenshot without a year, a call mentioned without a date: both asked, the kind to check);
// JOB_PILOTTO_DEMO_LEAD=existing shows a job already tracked (no company or "first contact" questions); =unclear a new
// recruiter pitch whose reply leaves open whether you agreed to talk (asked: "Did you agree to talk to the recruiter?");
// =which a message Claude couldn't place among two jobs from the same agency (asked: "Which job is this?").
export function leadProposal(target = '', kind = process.env.JOB_PILOTTO_DEMO_LEAD) {
  const existing = kind === 'existing' || kind === 'origin' || (target && target !== 'new');
  const kinds = ['Recruiter outreach', 'Applied', 'Confirmation received', 'Reply received', 'Interview scheduled', 'Rejected', 'Offer', 'Feedback received'];
  const fields = {
    kind: {value: 'Interview scheduled', state: 'check', options: kinds},
    channel: {value: existing ? '' : 'LinkedIn', state: existing ? 'ask' : 'check', guess: existing ? 'Other' : 'LinkedIn'},
    started: {value: '', state: 'ask', month_day: '09-21', years: [2026, 2025], question: 'Which year was "Sep 21"?'},
    interview: {value: '', state: 'ask', required: true, question: 'When is the call?', as_written: 'Friday at 3pm'},
    ...(existing ? {} : {company: {value: 'Example Robotics', state: 'check', required: false},
      agency: {value: 'Example Talent', state: 'ok', required: false}}),
    ...(kind === 'unclear' && !existing ? {agree: {value: '', state: 'ask', question: 'Did you agree to talk to the recruiter?'}} : {}),
    ...(kind === 'which' && !target ? {job: {value: '', state: 'ask', question: 'Which job is this?', candidates: [
      {url: 'https://demo.example/jobs/1', label: 'Example Talent · Senior SRE', stage: 'Recruiter lead'},
      {url: 'https://demo.example/jobs/2', label: 'Example Talent · Platform Engineer', stage: 'Applied'}]}} : {}),
  };
  if (kind === 'origin') {  // a tracked Outbound job whose LinkedIn chat began before its first contact (asks who reached out first)
    const first = '2026-09-26T15:00:00+00:00';
    return {ok: true, kind: 'Update on this job', new: false, stage: 'Rejected', label: 'Northwind AI — Platform Engineer', first_known: first,
      current: {Origin: 'Outbound', Source: 'Manual', 'Reached via': '', Stage: 'Rejected'}, item: {platform: 'LinkedIn', summary: 'Fictional demo reading'}, job: null, stats: {},
      fields: {kind: {value: 'Update on this job', state: 'ok', options: ['Update on this job', ...kinds]}, channel: {value: 'LinkedIn', state: 'ok', guess: 'LinkedIn'},
        started: {value: '2026-09-11', state: 'ok'}, origin: {value: '', state: 'ask', required: false, question: 'Who reached out first?', current: 'Outbound', first_known: first}}};
  }
  return {ok: true, kind: 'Interview scheduled', new: !existing, stage: existing ? 'Applied' : '',
    label: existing ? 'Northwind AI — Platform Engineer' : 'Example Robotics — Senior SRE',
    item: {platform: 'LinkedIn', summary: 'Fictional demo reading'}, job: null, fields, stats: {}};
}

// The Profile → CV check as it looks with a real result (fictional CV): the parser check and the content review.
export const cvCheck = {hash: 'demo', at: '2026-10-02T09:00:00.000Z',
  ats: {score: 82, verdict: 'Mostly readable', pages: 3, text: 'Alex Morgan\nPlatform engineer\nExperience\nSenior Platform Engineer\nMar 2023 – Present',
    checks: [
      {id: 'text', label: 'Real, selectable text', status: 'pass', detail: '2,310 characters of text a parser can read.', fix: '', penalty: 0},
      {id: 'columns', label: 'One column of text', status: 'pass', detail: 'Sentences run down one column, in reading order.', fix: '', penalty: 0},
      {id: 'experience', label: 'An "Experience" heading', status: 'pass', detail: 'Parsers use it to find your jobs.', fix: '', penalty: 0},
      {id: 'education', label: 'An "Education" heading', status: 'warn', detail: 'No Education heading. Some systems leave the education field empty without one.', fix: 'Add an Education section, even a short one.', penalty: 5},
      {id: 'images', label: 'Pictures are ignored by parsers', status: 'warn', detail: 'a photo and a full-width banner: invisible to a parser, so keep nothing important in them.', fix: 'Check that your target market expects a photo; otherwise remove it.', penalty: 6},
      {id: 'length', label: 'Length', status: 'warn', detail: '3 pages. Recruiters spend about a minute on a first look; the top of page 1 has to carry it.', fix: 'Trim to 2 pages, or make sure page 1 stands alone.', penalty: 5}]},
  ai: {score: 74, usd: 0.05, components: [{name: 'Keywords for your target roles', score: 70, note: 'Kubernetes and Terraform are clear; SLOs and incident response are only implied.'},
      {name: 'Evidence', score: 78, note: 'Several bullets carry numbers; the first two roles list duties only.'}, {name: 'Clarity', score: 80, note: 'Short bullets that start with a verb.'},
      {name: 'Seniority signal', score: 68, note: 'Team size and ownership are visible in only one role.'}],
    strengths: ['Concrete platform results with numbers', 'Consistent, short bullets'],
    fixes: [{where: 'Experience · first role', issue: 'A search for "incident response" would not find you.', suggestion: 'State the on-call and incident work you did in plain words (only if true).', impact: 'high'},
      {where: 'Summary', issue: 'It does not name the roles you want.', suggestion: 'Start with the title you are applying for.', impact: 'medium'}],
    missing_keywords: ['SLO', 'incident response', 'Prometheus']}};

// The uploaded CV's facts for the CV tab's document row (fictional).
export const cvFile = {size: 335872, addedAt: '2026-10-12T08:30:00.000Z'};

// The Documents tab's cover letter (fictional job; the drawer shows it for a tailored job).
export const jobLetter = {text: 'Dear Helvetic Cloud team,\n\nI run reliability for a platform of 400 services and cut its incident hours by a third.\n\nI would like to talk about the role.', source: 'ai', pdf: true, warnings: []};

// The CV match dialog with a real answer (fictional job and CV).
export const matchSaved = {at: '2026-10-02T09:00:00.000Z', stale: false, job: {title: 'Platform Engineer', company: 'Northwind Robotics'}, result: {grade: 'B', usd: 0.06,
  summary: 'Most of the platform work is stated; observability and the on-site days need a look.',
  musts: [{term: 'Kubernetes', status: 'found', evidence: 'Moved 40 services to Kubernetes'}, {term: 'Terraform', status: 'found', evidence: 'Skills: Kubernetes, Terraform'},
    {term: 'Prometheus', status: 'implied', evidence: 'Built alerting on the platform'}, {term: 'SLOs', status: 'missing', evidence: ''}],
  knockouts: [{requirement: 'Right to work in Switzerland', status: 'ok', note: 'The Profile says you hold a Swiss permit.'}, {requirement: 'Three days a week on site in Zurich', status: 'check', note: 'Neither the CV nor the Profile says if that suits you.'},
    {requirement: 'Fluent German', status: 'conflict', note: 'The CV lists German as basic.'}],
  advice: ['Say SLOs plainly in the role where you owned them, only if it is true.', 'Confirm the on-site days before you answer that question.']}};
