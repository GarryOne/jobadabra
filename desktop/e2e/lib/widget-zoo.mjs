// The widget zoo (spec docs/superpowers/specs/2026-10-12-fill-ladder.md, PR 1): one small hand-made page per control SHAPE (desktop/e2e/widget-zoo/<shape>-<n>/), in the recorded-case format
// (lib/page-replay.mjs), replayed with the real extension. A MEASURE, not a gate: per page, did the fill READ the question (expect.asked) and did the value stay COMMITTED (every other
// positive check)? A page that passes moves to e2e/recorded/ (then it guards); one that fails is a found bug for the fill ladder. Run: npm run widget-zoo. Guard: e2e/test/replay/widget-zoo.test.mjs.
// Every page carries first name, last name and email in front of its widget: with fewer than 3 fields the structure rule (extension/tab-pages.js pageRole) calls a page no form and no panel comes.
import path from 'node:path';
import {E2E} from './app.mjs';
import {loadCases} from './page-replay.mjs';

export const ZOO_DIR = path.join(E2E, 'widget-zoo');
// The widget kinds of the fill ladder's repair answer (the spec's WIDGETS, closed); PR 4 moves this list into the product's rung-3 control digest and imports it here.
export const WIDGETS = ['text', 'masked_text', 'native_select', 'custom_select', 'typeahead', 'segmented_toggle', 'checkbox_group', 'radio_group', 'date_picker', 'drop_zone', 'collapsed_section', 'trusted_click_only', 'other'];
// The checks that say a value is in its control (page-replay.mjs judgeCase); `asked` says the reader saw the question.
export const COMMIT_CHECKS = ['attached', 'filled', 'kept', 'valueHas', 'pressed', 'chosen', 'present'];
// The checks that say the extension's own claims match the page (one truth per control, amendment 4): the fill's record, the panel's report, what the judge was shown.
export const TRUTH_CHECKS = ['traced', 'notTraced', 'pending', 'notPending', 'judged', 'notJudged'];
export const MAX_PAGE_BYTES = 6 * 1024;

export const loadZoo = (dir = ZOO_DIR) => loadCases(dir);

// What is wrong with a zoo case's format (empty: fine). A case names its widget, says how it misbehaves (shape), asks exactly one question and checks one commit.
export function zooProblems(item) {
  const problems = [], expect = item.expect || {};
  if (!WIDGETS.includes(item.widget)) problems.push(`widget "${item.widget}" is not one of WIDGETS`);
  if (!String(item.shape || '').trim()) problems.push('no shape sentence');
  // An upload page asks no question (the CV comes from the app): it asks none; every other page asks its one.
  if (item.widget === 'drop_zone' ? (expect.asked || []).length : (expect.asked || []).length !== 1) problems.push(item.widget === 'drop_zone' ? 'a drop_zone page asks no question (expect.asked empty)' : 'expect.asked must name the one question');
  if (!COMMIT_CHECKS.some(kind => (expect[kind] || []).length)) problems.push('no commit check');
  if (!(expect.notTold || []).includes('pressed the submit')) problems.push('notTold must hold "pressed the submit"');
  if (item.pages?.length !== 1) problems.push('one page per case');
  return problems;
}

// One replay result -> {name, widget, read, committed, safe, failures}. A failure line is "<kind>: <arg>" (judgeCase); an error or isolation line fails everything.
export function verdictOf(item, result = {}) {
  const failures = result.failures || [], kinds = failures.map(line => line.split(':')[0]);
  const broken = kinds.some(kind => kind === 'error' || kind === 'isolation');
  return {name: item.name, widget: item.widget, read: !broken && !kinds.includes('asked'), committed: !broken && !kinds.some(kind => COMMIT_CHECKS.includes(kind)),
    truthful: !broken && !kinds.some(kind => TRUTH_CHECKS.includes(kind)), bounded: !broken && !kinds.includes('atMost'), safe: !kinds.includes('notTold'), failures};
}

// The NOT RUN rule for the zoo (12 Oct 2026: the CI job died on a missing staged file and printed nothing a reader could tell from a finding): a run that replayed no page says so
// first, and fails. verdicts: what came back; total: the pages asked for. -> the line, or '' when at least one page replayed.
export function harnessLine(verdicts, total, error = '') {
  const replayed = (verdicts || []).filter(one => !one.failures.some(line => /^(error|isolation)\b/.test(line))).length;
  return replayed ? '' : `harness error: replayed 0 of ${total} pages${error ? ` (${String(error).replace(/\s+/g, ' ').slice(0, 200)})` : ''}`;
}

// -> {total, read, committed, unsafe: [names], byWidget: {widget: {total, committed}}}
export function summarizeZoo(verdicts) {
  const byWidget = {};
  for (const one of verdicts) { const entry = byWidget[one.widget] ||= {total: 0, committed: 0}; entry.total++; if (one.committed) entry.committed++; }
  return {total: verdicts.length, read: verdicts.filter(one => one.read).length, committed: verdicts.filter(one => one.committed).length, truthful: verdicts.filter(one => one.truthful).length,
    unsafe: verdicts.filter(one => !one.safe).map(one => one.name), byWidget};
}
