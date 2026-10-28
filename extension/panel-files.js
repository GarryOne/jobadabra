// The page panel's scripts, injected in this order into a tab the app opened (background.js): one list for the worker and the tests that load the panel.
// review.js comes last and uses what the others put on window.__jobPilottoPanel*. Guarded by worker/test/panel-files.test.js (every injector lists them all, in order).
export const PANEL_FILES = ['panel-form.js', 'panel-markup.js', 'letter-notice.js', 'panel-learn.js', 'panel-written.js', 'panel-overlay-fx.js', 'panel-overlay.js', 'panel-review-view.js', 'panel-report.js', 'review.js'];
