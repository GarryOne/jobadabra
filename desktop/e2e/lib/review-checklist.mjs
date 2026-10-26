// The 10-point checklist prompt for a screenshot review: the model answers every check yes/no with quoted evidence, and only a "yes" with evidence becomes a
// finding. Built for the Free AI review (#2046, 26 Oct 2026: 71-79% of the judged bugs); here so a Claude model can be scored with it too (review-eval.mjs
// "claude-haiku-5-5+checklist"). Guarded by test/review-checklist.test.mjs.
import {expectedFor} from './vision.mjs';

export const CHECKS = [
  ['contradiction', 'Two parts of the screen state opposite things about the same item (a pill vs its own text, a header vs a card, a toast vs the detail, a step list vs the run status, a green "nothing new" vs a failed run).'],
  ['count-mismatch', 'A number or count disagrees with another number, with the items actually listed, or with the FACTS (for example "6 recent" with 3 rows, "Applying 10" beside "Applying 0").'],
  ['facts-contradiction', 'Something on screen claims a state the FACTS deny (a service shown as working or checking while it is not connected, results claimed while the app holds 0 jobs, a red error telling you to switch to what is already chosen).'],
  ['raw-technical', 'Raw technical text is shown to the person: an error class or code (ProgrammingError, HTTPError, AiLimit, HTTP 502), HTML, JSON, a stack trace, an internal name or id, or text formatted for another app (a chat message pasted raw).'],
  ['no-reason-or-fix', 'A failure, warning or error that gives no plain reason, or no way to fix it (no button, link or next step), or a vague reason ("stopped unexpectedly", "couldn\'t load").'],
  ['cut-off', 'Text or an icon cut off, sliced or truncated so the meaning is lost (a chip showing only "E…", a headline ending in "…", a box cutting its text in half, an icon half outside its rail).'],
  ['broken-layout', 'Layout broken: a missing cell or day in a grid, stray scrollbars, a list squeezed into a tiny box while space is free, overlapping elements.'],
  ['empty-or-placeholder', 'Dashes, "❓", "–" or an empty heading where data should be, or an empty section offered with a link as if it had content.'],
  ['duplicated-or-inconsistent', 'The same message shown twice, or two lines describing the same rule differently.'],
  ['missing-key-info', 'A list row or card lacks what a person needs to act (no time, no outcome, no reason) where the page shows it elsewhere.'],
];
export const CHECK_SYSTEM = `You check ONE screenshot of the Jobadabra desktop app (a job-search app) for real bugs a person would hit. Test data is made up (company names, round numbers, today's dates, a "not connected" Notion, Gmail or AI key are normal): never report the data itself.
A toast, tooltip, spinner or a text ticker caught mid-scroll is never a bug. Go through EVERY check below and answer each one:
${CHECKS.map(([id, text], i) => `${i + 1}. ${id}: ${text}`).join('\n')}
Reply with ONE JSON object: {"checks":[{"id":"<check id>","answer":"yes|no","where":"<the element>","evidence":"<quote the exact words or numbers you see, both sides of a contradiction>"}]} with all ${CHECKS.length} checks in order. Answer "yes" only with evidence you can quote from the screen (or the FACTS); otherwise "no".`;

// A checklist answer -> [{title, detail}] for the checks answered yes with evidence; tolerant of the shapes the models use ({id, answer}, {type, findings}).
export function checksToFindings(text) {
  let data;
  try { data = JSON.parse(String(text).slice(String(text).indexOf('{'), String(text).lastIndexOf('}') + 1)); } catch { return []; }
  const found = [];
  for (const check of Array.isArray(data?.checks) ? data.checks : []) {
    const id = check.id || check.check || check.type || check.name || '', answer = String(check.answer ?? check.result ?? check.found ?? '').toLowerCase();
    const said = [check.evidence, check.detail, check.details, ...(Array.isArray(check.findings) ? check.findings : [check.findings])].filter(v => typeof v === 'string' && v.trim()).join(' | ');
    if ((['yes', 'true'].includes(answer) || (!answer && said.length > 8)) && said.length > 8) found.push({title: `${id}: ${check.where || ''}`.slice(0, 100), detail: said.slice(0, 600)});
  }
  return found;
}

// One Claude request asking the checklist about one screenshot (lessons: the by-design lessons of this kind of page, as text).
export function checklistRequest({view, pngBase64, facts = null, lessons = '', model, effort = ''}) {
  return {model, max_tokens: ['high', 'xhigh', 'max'].includes(effort) ? 12000 : 4000, ...(effort ? {output_config: {effort}} : {}),
    system: [{type: 'text', text: CHECK_SYSTEM, cache_control: {type: 'ephemeral'}}],
    messages: [{role: 'user', content: [{type: 'image', source: {type: 'base64', media_type: 'image/png', data: pngBase64}},
      {type: 'text', text: `Page: ${view}\nExpected to show: ${expectedFor(view)}\n${facts ? `\nFACTS about the app's state when this was taken:\n${JSON.stringify(facts, null, 1)}\n` : ''}${lessons ? `\n${lessons}\n` : ''}\nGo through every check.`}]}]};
}

// What each check means for a person, in the review's findings shape (lib/vision.mjs parseFindingsDetailed: kind, severity, title, detail, impact).
export const CHECK_SHAPE = {
  'contradiction': {kind: 'consistency', impact: 'The person cannot tell which of the two statements is true and may act on the wrong one.'},
  'count-mismatch': {kind: 'wrong-result', impact: 'The person is shown a number that does not match what is there, so they misjudge their search.'},
  'facts-contradiction': {kind: 'wrong-result', impact: 'The screen claims a state the app is not in, so the person trusts something that is not so.'},
  'raw-technical': {kind: 'text', impact: 'The person sees technical text they cannot understand or act on.'},
  'no-reason-or-fix': {kind: 'error-shown', impact: 'The person is told something failed but not why or what to do next.'},
  'cut-off': {kind: 'layout', impact: 'Part of the text is lost, so the person cannot read what it says.'},
  'broken-layout': {kind: 'layout', impact: 'The page looks broken, which hides content and costs the person trust.'},
  'empty-or-placeholder': {kind: 'empty-state', impact: 'The person sees placeholders where real information should be.'},
  'duplicated-or-inconsistent': {kind: 'consistency', impact: 'The same thing is said twice or two ways, which confuses the person.'},
  'missing-key-info': {kind: 'functionality', impact: 'The person lacks what they need to act on this item.'},
};

// A checklist answer -> the review's own JSON answer ({"findings": [...]}), so the cache, the issue filer and the block check read it as before.
// Severity is medium: the checklist asks whether, not how bad; at most 6 per page, as parseFindingsDetailed keeps.
export function checklistAsFindingsText(text) {
  const findings = checksToFindings(text).map(found => {
    const shape = CHECK_SHAPE[found.title.split(':')[0]] || {kind: 'consistency', impact: 'The person may be misled by what this part of the screen shows.'};
    return {severity: 'medium', kind: shape.kind, title: found.title.slice(0, 80), detail: found.detail.slice(0, 400), impact: shape.impact, suggestion: ''};
  });
  return JSON.stringify({findings: findings.slice(0, 6)});
}
