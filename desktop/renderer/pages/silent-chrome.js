// The buttons of a "Chrome isn't reporting" card (renderer/pages/session-next-step.js): a job URL offers the reopen first; Open Chrome, the connect step, always stays.
// Pure, so test/silent-chrome-buttons.test.js runs it without a window.

/** The button kinds, in order: 'reopen' (Open it again) only with a job URL, then 'connect' (Open Chrome). */
export function silentChromeButtons(item) {
  return item?.url ? ['reopen', 'connect'] : ['connect'];
}
