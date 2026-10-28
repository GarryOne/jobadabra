// One question asked in several wordings is one item (renderer/question-filter.js: the first row carries the others in .also), and an answer to it is saved
// for EVERY wording, wherever it is given (owner, 17 Oct 2026): the drawer sends the keys (alsoKeys), the one place an open question is answered (28 Oct 2026).
// Pure, no DOM. Guarded by test/question-wordings.test.js, which loops over both places and fails on a new one that skips this file.
export const wordings = row => [row, ...(row.also || [])];

// The drawer: the keys of the other wordings, for lib/questions.js answerAll (the first key is the question's own).
export const alsoKeys = row => wordings(row).slice(1).map(each => each.key);
