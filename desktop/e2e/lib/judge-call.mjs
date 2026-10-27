// The UI loop's verdict as ONE plain AI call (owner, 27 Oct 2026: "Free AI, own key", "a combination of Free AI with Haiku 5.5 if that gives us better results"):
// a finding, its screenshot, the owner's lessons and the code excerpts it names go in; a fixed JSON answer comes out, and code checks it (CLAUDE.md "The AI decides;
// code fetches, validates and keeps safe"). Replaces the Claude Code agent session (claude-code-action, 25-30 turns) in ui-findings.yml and ui-verdict.yml.
// The rules are ui-verdict-prompt.md's own, minus its tool steps. Pure. Guarded by test/judge-call.test.mjs.
import fs from 'node:fs';

export const WORDS = ['real', 'false-positive', 'harness', 'needs-human'];
export const CAUSES = ['detector', 'probe-race', 'by-design', 'stale', 'duplicate'];
export const SURE = ['high', 'medium', 'low'];
export const SCHEMA = {type: 'object', additionalProperties: false, required: ['verdict', 'why', 'sure'], properties: {
  verdict: {enum: WORDS}, why: {type: 'string'}, cite: {type: 'string'}, cause: {enum: [...CAUSES, '']}, severity: {enum: ['high', 'medium', 'low', '']}, sure: {enum: SURE},
  need: {type: 'array', items: {type: 'string'}, maxItems: 3}}};
export const MAX_NEEDS = 3;

// ui-verdict-prompt.md, without the parts that assume tools (grep, Read, write a file): the detectors' known mistakes, the job seeker test, causes and severity.
export function rulesFrom(prompt) {
  const text = String(prompt);
  const how = text.indexOf('HOW ('), tail = text.indexOf('For a `false-positive`');
  if (how < 0 || tail < 0) throw new Error('ui-verdict-prompt.md changed shape: lib/judge-call.mjs cuts it at "HOW (" and "For a `false-positive`"');
  return `${text.slice(0, how).replace(/^You judge ONE finding[^\n]*\n/, '')}\n${text.slice(tail).replace(/\nNever invent a problem[\s\S]*$/, '')}`
    .replace(/\(\.heal\/screenshot\.png\)/g, '(the image)').trim();
}
export const loadRules = (file = new URL('../ui-verdict-prompt.md', import.meta.url)) => rulesFrom(fs.readFileSync(file, 'utf8'));

const ANSWER = `ANSWER with ONE JSON object and nothing else:
{"verdict": "real" | "false-positive" | "harness" | "needs-human", "why": "<one or two sentences>", "cite": "<path:line from the CODE EXCERPTS that shows it, or empty>",
 "cause": "<for false-positive: detector | probe-race | by-design | stale | duplicate, else empty>", "severity": "<for real and needs-human: high | medium | low, else empty>",
 "sure": "high" | "medium" | "low"}
- "real" MUST cite a path:line shown in the CODE EXCERPTS (the line numbers are printed); a real verdict without one is not trusted.
- "sure" is how certain you are: "high" only when the excerpts, logs or picture show it plainly; when the excerpts do not hold the code that decides it, say "low".
- Never invent a problem: when the code works and the finding is about timing or state, it is a false positive.`;
const ASK_MORE = `- When the excerpts do not hold the code that decides it (where a text on screen is written, what a function does), you may ask ONCE for more instead of
  guessing: answer {"need": ["<exact text or function name to search the code for>", ...at most ${MAX_NEEDS}]} and you will get those lines and decide then.`;
const LAST_ROUND = '- This is your last round: the code you asked for is in the excerpts. Decide now; do not ask again.';

const SYSTEM = (rules, last) => `You judge ONE finding of the Jobadabra UI loop (a desktop app for job seekers). You cannot open files: the finding, its screenshot (when there is one),
the code excerpts it names and the run's logs are all you get, below.\n\n${rules}\n\n${ANSWER}\n${last ? LAST_ROUND : ASK_MORE}`;

const block = (title, text) => (text ? [`### ${title}`, text] : []);
export const excerptText = excerpts => excerpts.map(item => `--- ${item.file}:${item.from}-${item.to}${item.why ? ` (${item.why})` : ''}\n${item.lines.map((line, i) => `${item.from + i}: ${line}`).join('\n')}`).join('\n\n');

// finding: {source, kind, severity, view, title, detail, impact?, also?}; excerpts from lib/judge-excerpts.mjs; logs: text; png: base64 or ''.
export function judgeRequest({finding, rules, lessons = '', excerpts = [], logs = '', png = '', model, maxTokens = 900, last = false}) {
  const text = [`Detector: ${finding.source} · kind: ${finding.kind} · severity said by the detector: ${finding.severity} · page: ${finding.view}`, `Title: ${finding.title}`,
    ...block('What was found', finding.detail), ...block('Why it matters (the detector\'s words)', finding.impact),
    ...(finding.also?.length ? block('Failed after it (probably consequences)', finding.also.slice(0, 5).join('; ')) : []),
    png ? 'The screenshot is attached.' : 'No screenshot.', ...block('Logs (last lines)', String(logs).slice(-4000)),
    ...block('CODE EXCERPTS (from the tested build)', excerptText(excerpts) || 'none found'), ...block('Corrections a person made to earlier verdicts', lessons)].join('\n\n');
  return {model, max_tokens: maxTokens, temperature: 0, system: [{type: 'text', text: SYSTEM(rules, last)}],
    messages: [{role: 'user', content: [...(png ? [{type: 'image', source: {type: 'base64', media_type: 'image/png', data: png}}] : []), {type: 'text', text}]}]};
}

// The model's text -> {word, why, cite, cause, severity, sure, note}. Code decides what is trusted: an unknown word, a broken answer or a `real` whose cite is not a
// line it was shown all become needs-human (unsure), never a guess.
export function readJudge(text, {excerpts = []} = {}) {
  const raw = String(text || '').replace(/<think>[\s\S]*?<\/think>/g, '');
  let data = null;
  try { data = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)); } catch { /* below */ }
  if (!data || typeof data !== 'object') return {word: 'needs-human', why: '', cite: '', cause: '', severity: '', sure: 'low', note: 'The answer was not the JSON asked for.'};
  const need = Array.isArray(data.need) ? data.need.map(item => String(item).trim()).filter(item => item.length >= 3 && item.length <= 120).slice(0, MAX_NEEDS) : [];
  if (need.length && !data.verdict) return {word: 'needs-human', why: '', cite: '', cause: '', severity: '', sure: 'low', note: 'It asked for more code.', need};
  const word = WORDS.includes(data.verdict) ? data.verdict : 'needs-human';
  const out = {word, why: String(data.why || '').trim().slice(0, 600), cite: String(data.cite || '').trim(), cause: CAUSES.includes(data.cause) ? data.cause : '',
    severity: ['high', 'medium', 'low'].includes(data.severity) ? data.severity : '', sure: SURE.includes(data.sure) ? data.sure : 'low', note: word === data.verdict ? '' : `Unknown verdict "${data.verdict}".`};
  if (word === 'real' && !shown(out.cite, excerpts)) return {...out, word: 'needs-human', sure: 'low', note: out.cite ? `Its cite (${out.cite}) is not a line it was shown, so the verdict was not trusted.` : 'It cited no line, so the verdict was not trusted.'};
  return out;
}
const shown = (cite, excerpts) => {
  const m = /^([\w./-]+\.\w+):(\d+)/.exec(cite || '');
  return !!m && excerpts.some(item => item.file === m[1] && Number(m[2]) >= item.from && Number(m[2]) <= item.to);
};

// The verdict as the text the loop already reads (lib/verdict-comment.mjs parse, apply-verdict.sh): the word, then labelled lines.
export function verdictText(judged, by = '') {
  return [judged.word, `Why: ${judged.why}${judged.cite ? ` (${judged.cite})` : ''}${by ? ` [${by}]` : ''}`, ...(judged.word === 'needs-human' ? [`Check: ${judged.note || judged.why}`] : []),
    ...(judged.word === 'false-positive' && judged.cause ? [`Cause: ${judged.cause}`] : []), ...(['real', 'needs-human'].includes(judged.word) && judged.severity ? [`Severity: ${judged.severity}`] : [])].join('\n');
}
// A finding is dropped (never filed) only when the judge is sure it is false: measured 27 Oct 2026 on 58 settled findings, Haiku's less-than-sure
// "false" verdicts dismissed 4 real bugs; filed for a person instead, none was lost (judge-eval.mjs). Guarded by test/judge-call.test.mjs.
export const safeToDrop = judged => judged.word === 'needs-human' || !['false-positive', 'harness'].includes(judged.word) || judged.sure === 'high'
  ? judged : {...judged, word: 'needs-human', note: `It said ${judged.word}, but not sure enough to drop a finding.`};
// Unsure = worth a second opinion: a needs-human, or anything said with less than high certainty.
export const unsure = judged => judged.word === 'needs-human' || judged.sure !== 'high';
