// Decide whether every required form answer rests on saved facts, without reading page wording or changing the page.

/**
 * Takes a described form, the profile's contact field ids and the answer plan; returns true, false or unknown (null).
 * Invariants: only required non-file fields count; a missing form or failed/dropped answer plan never becomes a saved-facts verdict.
 */
export function allFactsSavedOf({form, contactFields = [], answers} = {}) {
  if (!Array.isArray(form) || !form.length || !Array.isArray(answers)) return null;
  const contact = new Set(contactFields);
  // Why (30 Oct 2026, owner): automation readiness requires saved provenance for every required answer, never a proposal or an own-words draft.
  const saved = new Set(answers.filter(answer => answer.use === 'fill' && !answer.guess
    && typeof answer.fact === 'string' && answer.fact && answer.fact !== 'none'
    && !['written', 'legal', 'demographic'].includes(answer.category)).map(answer => answer.field));
  return form.filter(field => field.required === true && field.type !== 'file').every(field => contact.has(field.field) || saved.has(field.field));
}
