// The answers the person gave for ONE job only (the review drawer's "Reuse for matching questions" off, owner 17 Oct 2026): a section of that job's
// record, on every store (src/stores/base.py JOB_ANSWERS_SECTION), one "- question — answer" line each. No imports: the desktop app (lib/job-answers.js),
// the extension's routes and the Worker read it the same way. Guarded by test/job-answers.test.js (the sample tests/fixtures/stores/job-answers.md).
export const JOB_ANSWERS_SECTION = '💬 Answers for this job only';
const SEP = ' — ';
const same = (a, b) => String(a || '').replace(/\s+/g, ' ').trim().toLowerCase() === String(b || '').replace(/\s+/g, ' ').trim().toLowerCase();
const oneLine = (text) => String(text ?? '').replace(/\s+/g, ' ').trim();

// The section's text -> [{question, answer}]. A line is "- question — answer"; the bullet and bold are optional (Notion hands lines back plain); only the first dash splits.
export function jobAnswersOf(text) {
  const out = [];
  for (const raw of String(text || '').split('\n')) {
    const line = raw.replace(/^\s*[-*•]\s+/, '').replace(/\*\*/g, '').trim();
    const at = line.indexOf(SEP);
    if (at > 0 && line.slice(at + SEP.length).trim()) out.push({ question: line.slice(0, at).trim(), answer: line.slice(at + SEP.length).trim() });
  }
  return out;
}
const write = (list) => list.map(({ question, answer }) => `- ${question}${SEP}${answer}`).join('\n');

// The section's text with this question's answer set (the same question is replaced; a dash in a question is kept readable as a hyphen).
export function withJobAnswer(text, question, answer) {
  const asked = oneLine(question).split(SEP).join(' - ');
  const list = jobAnswersOf(text), at = list.findIndex((each) => same(each.question, asked)), next = { question: at < 0 ? asked : list[at].question, answer: oneLine(answer) };
  return write(at < 0 ? [...list, next] : list.map((each, index) => (index === at ? next : each)));
}
export const withoutJobAnswer = (text, question) => write(jobAnswersOf(text).filter((each) => !same(each.question, oneLine(question).split(SEP).join(' - '))));

// The kit the fill reads, with this job's own answers first (a drafted answer to the same question is replaced); null when there is nothing to add.
export function asKitAnswers(kit, list) {
  if (!list?.length) return kit;
  const rest = (kit?.answers || []).filter((each) => !list.some((mine) => same(mine.question, each.question)));
  return { ...(kit || {}), answers: [...list.map(({ question, answer }) => ({ question, answer })), ...rest] };
}
