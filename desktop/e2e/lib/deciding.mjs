/* global document */
// Is the extension still deciding on this tab? Its own step line is the signal: the panel's fill button is busy (aria-busy) while a step runs, or the floating step box is on the page
// (extension/background.js progress()). A quiet window must never end a live run while this is true (12 Oct 2026, FNAC: the run ended at 31 s with "Reading this page…" still on
// screen). Guard: test/live-still.test.mjs.
export const isDeciding = page => page.evaluate(() => !!document.getElementById('jobpilotto-progress')
  || !!document.getElementById('jobpilotto-review-host')?.shadowRoot?.querySelector('.fill[aria-busy="true"]')).catch(() => false);
