// Lost answers (14 Oct 2026, 5afa5a8: the fill waited forever on a menu click, so Claude's answers that came after the fill started were never typed): in a row's app
// log, Claude answered with kept answers, and the extension said nothing more about the fill before "dead end: silent" or the log's end. Read on the PR replay's
// late-answer pass (the answers delayed on purpose: .github/workflows/site-replays-pr.yml), where "same as live" cannot hold; only this rule judges it. Pure.
// Guard: e2e/test/ai/lost-answers.test.mjs.
const ANSWERED = /\[fill\] Claude answered \d+ of \d+ question\(s\) \{[^\n]*"kept":(\d+)/;

// appLog -> {kept, lost, why}: kept = the last answer's kept count; lost = kept > 0 and nothing of the extension's followed it but a silent dead end.
export function lostAnswers(appLog = '') {
  const lines = String(appLog).split('\n');
  const at = lines.findLastIndex(line => ANSWERED.test(line));
  if (at < 0) return {kept: 0, lost: false, why: 'no answers from Claude'};
  const kept = Number(lines[at].match(ANSWERED)[1]) || 0;
  const next = lines.slice(at + 1).find(line => /\[extension\]/.test(line) && !/\b(checked in|worker:|panel: (mark|panel on))/.test(line));
  if (!kept) return {kept, lost: false, why: 'nothing kept'};
  if (!next) return {kept, lost: true, why: `${kept} kept answers, then nothing from the extension`};
  if (/fill: dead end: silent/.test(next)) return {kept, lost: true, why: `${kept} kept answers, then only a silent dead end`};
  return {kept, lost: false, why: ''};
}
