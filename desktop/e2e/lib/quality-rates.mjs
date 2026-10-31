// Build the versioned plain-data quality rates artifact without retaining private inputs.
// Job: run tolerant suites as rates

/** Project reached measurements onto the v1 contract; unreached parts stay null. */
export function qualityRates({facts, flags, cv, steady, ranking, caps, mail} = {}) {
  return {v: 1,
    facts: facts == null ? null : {exact: facts.exact, total: facts.total},
    flags: flags == null ? null : {judged: flags.judged, flagged: flags.flagged},
    cv: cv == null ? null : {found: cv.found, expected: cv.expected, corrected: cv.corrected},
    steady: steady == null ? null : {pairs: steady.pairs, within8: steady.within8},
    ranking: ranking ?? null, caps: caps ?? null,
    mail: mail == null ? null : {right: mail.right, total: mail.total, strictFailed: mail.strictFailed}};
}
