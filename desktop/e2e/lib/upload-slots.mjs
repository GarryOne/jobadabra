// Optional upload slots a fill lists but leaves (type file, not required, "upload: no file for this question") are not left fields: they need no file from the applicant (Valora, 15 Oct 2026).
// Pure. Used by replay-net.mjs and lib/verify-records.mjs to put `slotsLeft` in an outcome, and by lib/verify-judge.mjs compare(). Guard: e2e/test/verify-judge.test.mjs.
export const slotsLeftOf = fieldList => (Array.isArray(fieldList) ? fieldList : []).filter(item => item.outcome === 'left' && item.type === 'file' && item.required !== true).length;
