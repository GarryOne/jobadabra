// What an unanswered required field was about, as one fixed word, and whether it was left on purpose: counts for the fill card ("Missing answers", 15 Oct 2026).
// Never the question's wording or a value: the word comes from the AI's own fixed answer (app-core/src/answer-facts.js FACT_KEYS, its category) or from the
// meaning the built-in words or the pack gave the label; the site checks the same list again (extension/fill-card.js cleanCard). Guarded by desktop/test/fill-meaning.test.js.
export const MEANINGS = ['work_permit', 'sponsorship', 'home_location', 'relocation', 'work_mode', 'languages', 'salary', 'notice_period', 'start_date',
  'years_experience', 'employment_history', 'education', 'links', 'referral_source', 'employee_of_this_company', 'relatives_at_this_company', 'contact',
  'legal', 'demographic', 'written', 'password', 'file', 'unread', 'other', 'unknown'];
// A saved-detail key of the built-in words (page/fill-read.js PROFILE_LABELS) or a pack meaning, in the words above.
const OF_KEY = {first_name: 'contact', last_name: 'contact', full_name: 'contact', email: 'contact', phone: 'contact', street: 'contact', postal_code: 'contact',
  place_of_origin: 'contact', birth_date: 'contact', location: 'home_location', linkedin: 'links', github: 'links', website: 'links'};
// Left on purpose: the person's own choice or words (a written question is drafted since 16 Oct 2026; only one the AI could give no text for stays 'written' here), a secret, or a knockout / contact / low-confidence guess kept as a proposal (worker typeGuess).
const BY_DESIGN = new Set(['legal', 'demographic', 'written', 'password']);

// row: a fill trace row ({reason, type, fact?, category?, known?, low?}). -> one word of MEANINGS.
export function meaningOf(row = {}) {
  const reason = String(row.reason || '');
  if (reason.startsWith('legal')) return 'legal';
  if (reason.startsWith('demographic')) return 'demographic';
  if (reason.startsWith('written')) return 'written';
  if (reason.startsWith('password') || row.type === 'password') return 'password';
  if (row.type === 'file' || reason.startsWith('upload')) return 'file';
  if (/^question (on the page not read|text not found)/.test(reason)) return 'unread';
  if (MEANINGS.includes(row.fact) && !['unread', 'unknown', 'other', 'file', 'password'].includes(row.fact)) return row.fact;
  if (['legal', 'demographic', 'written'].includes(row.category)) return row.category;
  if (row.category === 'contact') return 'contact';
  const key = String(row.known || '');
  return OF_KEY[key] || (MEANINGS.includes(key) ? key : '') || 'unknown';
}

// -> 'design' (left on purpose) or 'gap' (an answer we could have given or asked for).
export function designOf(row, meaning, cause) {
  if (BY_DESIGN.has(meaning) || meaning === 'file') return 'design';
  if (cause === 'proposed' && (row.category === 'knockout' || row.category === 'contact' || row.category === 'preference' || row.low || ['contact', 'links', 'home_location'].includes(meaning))) return 'design';
  return 'gap';
}

// Keys "meaning:cause:design|gap" -> count, only the kinds a card may carry (the site's cleanCard accepts these and no other).
export const gapKey = (meaning, cause, design) => `${meaning}:${cause}:${design}`;
export function validGapKey(key, causes) {
  const [meaning, cause, design, extra] = String(key).split(':');
  return extra === undefined && MEANINGS.includes(meaning) && causes.includes(cause) && (design === 'design' || design === 'gap');
}
