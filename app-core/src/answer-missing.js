// A field the AI was asked about and left out of its answer: found by code, asked once more, and if still missing marked "unanswered" (never silent).
// Used by app-core/src/extension.js answerForm. Guarded by app-core/test/extension.test.js (a dropped field is asked again, then marked).

// The asked fields that no answer names (any category, any value: an empty legal or demographic answer still counts as an answer).
export function missingFields(fields, answers) {
  const named = new Set((Array.isArray(answers) ? answers : []).map((a) => a?.field));
  return fields.filter((f) => !named.has(f.field));
}

// The follow-up note: the same task, only for the fields the first answer skipped.
export const MISSING_NOTE = 'Your first answer left these fields out. Return one answer for EACH field below: the answer if <profile>, <standard_answers> or the kit state it or you can propose one; otherwise value "" with its category (a salutation, gender or other personal-choice question with nothing stated is category "demographic" with value "").';

// What the extension gets for a field that is still missing: a kind with no value and the category "unanswered", so the panel and the pool say "the AI gave no answer".
export const unanswered = (field) => ({ field, value: '', category: 'unanswered', use: 'kind' });

// Asks once more for the skipped fields (ask(list, note) -> the AI's response) and adds what comes back to result.answers.
// -> {retried: how many were asked again, stillMissing: the field ids still unanswered}.
export async function askAgainForGaps(fields, result, ask) {
  if (!Array.isArray(result.answers) || !fields.length) return { retried: 0, stillMissing: [] };
  const gone = missingFields(fields, result.answers);
  if (!gone.length) return { retried: 0, stillMissing: [] };
  const again = await ask(gone, MISSING_NOTE).then((r) => JSON.parse(r.content.find((block) => block.type === 'text')?.text || '{}')).catch(() => ({}));
  result.answers = [...result.answers, ...(Array.isArray(again.answers) ? again.answers.filter((a) => gone.some((f) => f.field === a.field)) : [])];
  return { retried: gone.length, stillMissing: missingFields(gone, result.answers).map((f) => f.field) };
}
