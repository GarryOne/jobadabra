// Owns: the command lines the app gives the engine: dailyArgs (the workflow's own command), mailArgs, visitsArgs, syncMatchesArgs,
// the search and scout budgets, and triggerEnv.
// Guarded by: test/pipeline-run.test.js, test/mail-report.test.js, test/run-kinds.test.js, test/tune.test.js, test/notion-trying.test.js.
// Split out of pipeline.js (a pure move); pipeline.js re-exports everything.
import * as claudeCode from './claude-code.js';
import {cadence} from './cadence.js';
import {deliveryReady, telegramReady} from './notify-channel.js';

export {deliveryReady, telegramReady};

// The same command .github/workflows/daily.yml runs for these inputs (mode, job, action, page, seed,
// file, note), so Telegram buttons and commands work the same from the app as from the cloud.
// A run is asked to send (--send) only when the person has a channel besides the app: Telegram set up, or e-mail chosen (lib/notify-channel.js). Without one the app shows the message itself. Guard: test/telegram-send.test.js.
export function dailyArgs(storage, inputs = {}) {
  const mode = inputs.mode || 'scheduled';
  const ai = claudeCode.aiReady(storage.settings(), !!storage.secret('ANTHROPIC_API_KEY'), !!storage.secret('OPENAI_API_KEY'));
  const telegram = deliveryReady(storage);
  // --log-run: every run from the app gets a row in Notion ⏰ Search runs (Notion is where the details live).
  const args = ['src', 'daily', '--mode', mode, ...(telegram ? ['--send'] : []), '--log-run'];
  if (inputs.job) args.push('--job', String(inputs.job), '--action', String(inputs.action || 'applied'));
  if (inputs.talking) args.push('--action', 'talking');
  if (inputs.target) args.push('--target', String(inputs.target));
  if (inputs.jobTitle) args.push('--job-title', String(inputs.jobTitle));
  if (inputs.jobCompany) args.push('--job-company', String(inputs.jobCompany));
  if (inputs.jobText) args.push('--job-text', String(inputs.jobText));
  if (inputs.page) args.push('--page', String(inputs.page));
  if (inputs.seed) args.push('--seed', String(inputs.seed));
  if (inputs.file) args.push('--file', String(inputs.file));
  if (inputs.note) args.push('--note', String(inputs.note));
  if (inputs.origin) args.push('--origin', String(inputs.origin));
  if (inputs.interview) args.push('--interview', String(inputs.interview));
  if (inputs.firstJobs) args.push('--first-jobs');   // a small slice of fast feeds is read and 3 jobs scored first (src/first_jobs.py)
  if (ai && AI_MODES.includes(mode)) args.push('--enrich-max', '100', '--score-max', '60');
  // A search's AI steps stop at 3 minutes (owner, 7 Oct 2026: "never more than 2-3 minutes"); what is left waits for the next search (src/budget.py).
  // Every mode that runs AI steps has it: the first run's follow-up (mode today) had none from 16 Oct, so on a big market it sorted 600 titles and
  // placed 277 places for 15 minutes before the first jobs were scored (Cluj, 18 Oct 2026: first 70+ match after 23 minutes).
  // budget: the seconds a Find jobs press gives this run (lib/search-steps.js: one deadline for the press), with or without AI.
  if (inputs.budget) args.push('--budget', String(inputs.budget));
  else if (ai && AI_MODES.includes(mode)) args.push('--budget', String(SEARCH_BUDGET_S));
  const {insights, kits} = cadence(storage.settings());
  if (ai && mode === 'scheduled' && insights !== 'off') args.push('--insight');
  if (ai && kits > 0 && AI_MODES.includes(mode)) args.push('--auto-kit-max', String(kits));
  return args;
}
// Notion just connected after a time of trying: one run that spends no AI (every cap at 0), so the Job Matches sync
// (src/notion/matches.py, hash-keyed over every scored job in the cache) puts what was scored before Notion there.
// `--mode today` is the no-AI path that reaches that sync; it also reads the feeds, which is free.
const AI_MODES = ['scheduled', 'run', 'today'];   // the modes that read, score and enrich with AI
/** Whether an engine run may draft an application kit (src/daily_modes.py prepare and kits, a search's --auto-kit-max): it then gets About you's kit bundle. */
export function draftsKits(args) {
  const valueOf = flag => (args.includes(flag) ? String(args[args.indexOf(flag) + 1] ?? '') : '');
  return ['prepare', 'kits'].includes(valueOf('--mode')) || Number(valueOf('--auto-kit-max')) > 0;
}
export const SEARCH_BUDGET_S = 180;
// Find new employers starts no new check after 3 minutes (owner, 7 Oct 2026: "runs for too long"); each check is saved as it ends (src/scout.py).
export const SCOUT_BUDGET_S = 180;
export const syncMatchesArgs = () => ['src', 'daily', '--mode', 'today', '--log-run', '--enrich-max', '0', '--score-max', '0', '--auto-kit-max', '0'];
// Gmail and Calendar check (src/ai/mail.py): confirmations, replies, rejections and interviews -> Notion.
// `updates` = what it recorded (the lines it prints under "Updates:"), shown in the app and the notification.
export function mailArgs(storage, now = Date.now()) {
  const settings = storage.settings();
  const telegram = deliveryReady(storage);
  // Look back far enough to cover the time since the last check (the Mac may have been off), 2 to 14 days.
  const since = settings.lastMailOkAt ? (now - Date.parse(settings.lastMailOkAt)) / 86400000 : 0;
  const days = Math.min(14, Math.max(2, Math.ceil(since) + 1));
  return ['src.ai.mail', '--days', String(days), ...(telegram ? ['--send'] : []), '--log-run'];
}
// What started a run, for its Notion ⏰ Search runs row (GitHub runs say Schedule or Manual).
export const triggerEnv = trigger => ({JOB_PILOTTO_TRIGGER: trigger === 'schedule' ? 'Mac schedule' : 'Mac (you)'});
// The jobs read in Chrome, scored at once after a read (Always on or not: those pages stay on this Mac). A run here that reads
// only those pages (src/daily.py --only-visits, mode today: it closes nothing, no Telegram digest), scores what matches and writes it to Notion.
// The light run after Find jobs using your browser scores the jobs it found that match, and nothing else (7 Oct 2026: it read 41 other
// jobs with AI first, 2 minutes, and the 1 match waited behind them): no reading, no kits, as many scores as matches.
export function visitsArgs(storage, fits = 60) {
  const args = [...dailyArgs(storage, {mode: 'today'}).filter(arg => arg !== '--send'), '--only-visits'];
  const set = (flag, value) => { const at = args.indexOf(flag); if (at >= 0) args[at + 1] = String(value); };
  set('--enrich-max', 0);
  set('--auto-kit-max', 0);
  set('--score-max', Math.max(1, Math.min(60, Number(fits) || 60)));
  return args;
}
