// The ending and the reason class of one control the fill left (spec fill-ladder, E): every left control names one fixed ending (the list is next-move's, extension/ladder/endings.js) and one
// reason class the person card says in plain words. Pure (no chrome API, no import): the panel (review.js), the app (lib/review.js) and the test harness read the same list. Guard: app-core/test/control-ending.test.js.
//   no_answer   nothing in the kit, Profile or details answers it (or the AI's answer is only proposed): the person gives it once          -> data_missing
//   unread      the question on the page was not read, so no answer was looked for                                                       -> blind
//   tries       the control used its tries and the page did not keep the answer (the attempt log gave it up)                            -> unresolved (a counted bug)
//   not_kept    the field or menu did not take the answer                                                                               -> unresolved
//   unknown     left with no reason the fill could name                                                                                  -> unresolved

export const REASON_ENDING = {no_answer: 'data_missing', unread: 'blind', tries: 'unresolved', not_kept: 'unresolved', unknown: 'unresolved'};
export const REASONS = Object.keys(REASON_ENDING);
// Each fill cause (fill-card.js CAUSES) lands in one reason class; a cause added there without a line here fails the test. No import: the app stages this file beside endings.js (desktop/scripts/stage.mjs).
export const CAUSE_REASON = {proposed: 'no_answer', no_data: 'no_answer', ai_declined: 'no_answer', ai_unsure: 'no_answer', ai_off: 'no_answer', ai_error: 'no_answer',
  not_taken: 'not_kept', no_option: 'not_kept', menu_not_clicked: 'not_kept', menu_not_opened: 'not_kept', menu_not_selected: 'not_kept', menu_not_read: 'not_kept', menu_other_choice: 'not_kept', not_kept_after_tries: 'not_kept', real_click: 'not_kept',
  unread: 'unread', other: 'unknown'};
export const isReason = value => REASONS.includes(value);
// entry: what the panel knows of one control: the fill's cause (data-jobadabra-cause), the attempt log's give-up (data-jobadabra-gaveup), the page's unread mark, a proposal or a contact key.
export function controlReason({cause = '', gaveUp = '', unread = false, suggested = '', wants = ''} = {}) {
  const reason = gaveUp ? 'tries' : unread ? 'unread' : CAUSE_REASON[cause] || (suggested || wants ? 'no_answer' : 'unknown');
  return {reason, ending: REASON_ENDING[reason]};
}
