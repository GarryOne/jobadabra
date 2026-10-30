// Apply triage (spec 2026-10-30-apply-triage): turns one form read into the highest apply mode that job can take. Pure, no AI, no I/O.

/**
 * The highest apply mode a read form allows, with the reason the chip shows.
 * Order: not eligible is skipped; a captcha, a login wall or an account to create needs the person (Standard); answers that are not
 * all saved facts go to Background (the person reviews and submits); otherwise Full automation can take it.
 * `read` = {eligible, captcha, login, accountCreation, allFactsSaved}; a missing flag counts as the unsafe answer.
 * @returns {{mode: 'auto'|'background'|'check'|'none', reason: string}}
 */
export function modeOfRead(read = {}) {
  if (read.eligible !== true) return {mode: 'none', reason: 'not eligible'};
  if (read.captcha !== false) return {mode: 'check', reason: 'captcha'};
  if (read.login !== false) return {mode: 'check', reason: 'login wall'};
  if (read.accountCreation !== false) return {mode: 'check', reason: 'asks you to create an account'};
  if (read.allFactsSaved !== true) return {mode: 'background', reason: 'answers you have not saved'};
  return {mode: 'auto', reason: 'every answer is a saved fact'};
}
