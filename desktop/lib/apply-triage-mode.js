// Apply triage: turns one form read into the highest apply mode that job can take. Pure, no AI, no I/O.

/**
 * The highest apply mode a read form allows, with the reason the chip shows.
 * Order: not eligible is skipped; a captcha, a login wall or an account to create needs the person (Standard); answers that are not
 * all saved facts go to fill (Background automation: the person reviews and submits); otherwise Full automation can take it.
 * `read` = {eligible, captcha, login, accountCreation, allFactsSaved}; a missing flag counts as the unsafe answer.
 * @returns {{mode: 'auto'|'fill'|'check'|'none', reason: string}}
 */
export function modeOfRead(read) {
  read = read || {};   // a failed read (null) is a missing read, so it takes the unsafe answer too
  if (read.eligible !== true) return {mode: 'none', reason: 'not eligible'};
  if (read.captcha !== false) return {mode: 'check', reason: 'captcha'}; // words-ok: the read's own flag, not a page word list
  if (read.login !== false) return {mode: 'check', reason: 'login wall'}; // words-ok: the read's own flag, not a page word list
  if (read.accountCreation !== false) return {mode: 'check', reason: 'asks you to create an account'};
  if (read.allFactsSaved !== true) return {mode: 'fill', reason: 'answers you have not saved'};
  return {mode: 'auto', reason: 'every answer is a saved fact'};
}
