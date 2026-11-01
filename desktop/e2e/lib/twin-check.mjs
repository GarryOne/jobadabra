// The post-merge live check's pure parts (npm run twin-check): which pool row stands for each platform, what makes a row red (a fill error, a press the safety floor refuses,
// a drop vs that row's last check) and the one table it reports. The runner is e2e/twin-check.mjs; guard: e2e/test/twin-check.test.mjs.
import {livePresses} from './replay-candidate.mjs';
import {rank} from './record-sites.mjs';

// One pool row per platform people use most: the first posting of the shape (the same one each check, so a row compares with its own last check).
export const PLATFORMS = [
  {name: 'Ashby', shape: /^Ashby form in an embedded app/},
  {name: 'SuccessFactors', shape: /^SuccessFactors: account and form/},
  {name: 'Greenhouse', shape: /^Greenhouse board form/},
  {name: 'Workday', shape: /^Workday: an account inside the system/},
  {name: 'Lever', shape: /^Lever: single page/},
];

export function pickRows(shapes, platforms = PLATFORMS) {
  return platforms.map(platform => { const row = shapes.find(item => platform.shape.test(item.shape) && item.urls?.length); return row ? {platform: platform.name, shape: row.shape, url: row.urls[0]} : {platform: platform.name, shape: '', url: ''}; });
}

// The safety floor's own words (extension/page/submit-press.js SUBMIT_WORDS) and the words of a press that says no to something the person was asked (a privacy or consent dialog).
// A floor on the harness side only: it ANDs with nothing and decides no page; it only names a press that should never have been made.
const SUBMIT_FLOOR = /\b(submit|send application)\b/i;
const SAYS_NO = /\b(decline|reject|deny|refuse|disagree|no thanks|do not accept)\b/i;   // words-ok: a harness floor over our own press log, not page meaning
const ERROR_LINE = /(TypeError|ReferenceError|RangeError|Cannot read propert|is not a function|is not defined|Uncaught)/;

// -> {bad: [text], popups: [text]}: presses of the run that the floor refuses (red) and popup closes that say no (looked at, not red: a cookie layer's "reject" is by design).
export function pressProblems(appLog) {
  const bad = [], popups = [];
  for (const press of livePresses(appLog)) {
    const text = `${press.what}${press.label ? ` "${press.label}"` : ''}`;
    if (SUBMIT_FLOOR.test(press.label) || SUBMIT_FLOOR.test(press.what)) bad.push(text);
    else if (SAYS_NO.test(press.label)) (/^closed a popup/.test(press.what) ? popups : bad).push(text);
  }
  return {bad, popups};
}

// Fill errors: the run's own error lines (parseLive) plus thrown errors in the app log and the extension's own console.
export function fillErrors(result, ...logs) {
  const found = [...(result.errors || [])];
  for (const log of logs) for (const line of String(log || '').split('\n')) if (ERROR_LINE.test(line) && found.length < 8) found.push(line.trim().slice(0, 200));
  return [...new Set(found)];
}

// A row's check, from its parsed run: what the table shows. -> {reached, filled, left, panel, errors, presses, popups, tripped}
export function checkOf({row, result, appLog = '', consoleLog = '', panel = ''}) {
  const {bad, popups} = pressProblems(appLog);
  return {platform: row.platform, shape: row.shape, url: row.url, reached: result.reached, filled: result.filled ?? null, left: result.left ?? null, note: result.note || '', rung: result.rung ?? null,
    panel, errors: fillErrors(result, appLog, consoleLog), presses: bad, popups, tripped: !!result.tripped};
}

// A drop vs the row's last check: a step reached less, or fewer fields filled (the same posting, the same applicant).
export function dropVs(last, now) {
  if (!last) return '';
  if (rank(now.reached) < rank(last.reached)) return `reached ${now.reached}, was ${last.reached}`;
  if (last.filled != null && now.filled != null && now.filled < last.filled) return `filled ${now.filled}, was ${last.filled}`;
  return '';
}

export function verdictOf(check, last) {
  const why = [];
  if (check.tripped) why.push('privacy tripwire');
  if (check.errors.length) why.push(`fill error: ${check.errors[0]}`);
  if (check.presses.length) why.push(`refused press: ${check.presses[0]}`);
  const drop = dropVs(last, check);
  if (drop) why.push(drop);
  return {red: why.length > 0, why};
}

const cell = text => String(text ?? '').replace(/\|/g, '/').replace(/\s+/g, ' ').trim().slice(0, 90);

// One table: a row per platform, each cell a few words.
export function tableOf(rows, {sha = '', applicant = 'grown'} = {}) {
  const head = `Post-merge check on main ${sha.slice(0, 9)} (applicant: ${applicant})`;
  const lines = ['| Platform | Reached | Filled / left | Errors | Presses | vs last | Panel |', '|---|---|---|---|---|---|---|'];
  for (const item of rows) {
    if (item.skipped) { lines.push(`| ${item.platform} | skipped: ${cell(item.skipped)} | | | | | |`); continue; }
    const {check, verdict, last} = item;
    const fields = check.filled == null ? 'n/a' : `${check.filled} / ${check.left}`;
    lines.push(`| ${item.platform} | ${check.reached}${check.note ? ` (${cell(check.note)})` : ''} | ${fields} | ${check.errors.length ? `🔴 ${cell(check.errors[0])}` : '🟢 none'} | ${check.presses.length ? `🔴 ${cell(check.presses[0])}` : check.popups.length ? `🟡 ${cell(check.popups[0])}` : '🟢 ok'} | ${verdict.red && verdict.why.some(w => /^(reached|filled)/.test(w)) ? `🔴 ${cell(verdict.why.find(w => /^(reached|filled)/.test(w)))}` : last ? '🟢 same or better' : '⚪ first check'} | ${check.panel ? `${cell(check.platform.toLowerCase())}/end.png` : 'no picture'} |`);
  }
  const red = rows.filter(item => item.verdict?.red).length;
  return `${head}\n\n${lines.join('\n')}\n\n${red ? `🔴 ${red} of ${rows.length} red` : `🟢 no red (${rows.filter(item => !item.skipped).length} of ${rows.length} ran)`}\n`;
}
