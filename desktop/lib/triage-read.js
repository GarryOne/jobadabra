// Apply triage read (spec 2026-10-30-apply-triage, PR C): turns the form judge's answer into the flags the mode table reads (renderer/apply-triage-mode.js).
// The judge gives a robot check (captcha), a login wall and an account to create (prompt change in lib/form-judge.js). "Every answer is a saved fact" is not a page
// judgment (the page sketch holds no saved facts): the caller passes it from the fill plan. A flag nobody gave stays unknown (null), which the mode table reads as the unsafe answer. Pure: no AI, no I/O.

/**
 * The read flags from one judge answer: {eligible, captcha, login, accountCreation, allFactsSaved}. Unknown flags are null, never false.
 * `judged` is judgeForm's result ({answer, botCheck, loginWall, accountCreation, ...} or {error}); a failed judge is a read with no page flags.
 * `allFactsSaved` comes from the fill plan (true / false / unknown), not from the judge.
 */
export function readFromJudge(judged, {eligible = true, allFactsSaved = null} = {}) {
  const facts = typeof allFactsSaved === 'boolean' ? allFactsSaved : null;
  if (!judged || judged.error) return {eligible, captcha: null, login: null, accountCreation: null, allFactsSaved: facts};   // words-ok: the read's own flag names, not a page word list
  return {
    eligible,
    captcha: typeof judged.botCheck === 'boolean' ? judged.botCheck : null,   // words-ok: the read's own flag names, not a page word list
    login: typeof judged.loginWall === 'boolean' ? judged.loginWall : null,   // words-ok: the read's own flag names, not a page word list
    accountCreation: typeof judged.accountCreation === 'boolean' ? judged.accountCreation : null,
    allFactsSaved: facts,
  };
}
