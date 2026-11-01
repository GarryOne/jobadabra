// The one-time transcription setup banner at the top of Interviews (the add-on and speech models download once): drawn from the main process's progress events.
// Why (1 Nov 2026, tier 2 leaves e2e): split out of interviews.js (a pure move) so the integration test can send it the app's progress steps from the window; a test run never starts the real setup.
// Guard: desktop/integration/app/screen-interviews.test.js.
import {$, show} from './core.js';

/**
 * Draws the setup banner for one progress step. Takes the step the main process sends ({id, percent, text, setup}); only a `setup` step shows the banner, any other hides it.
 * Shows the text with its percent, and the bar only when a percent is known.
 */
export function showSetupProgress({percent, text, setup}) {
  show($('iv-setup'), !!setup);
  if (!setup) return;
  $('iv-setup-text').textContent = `${text}${percent == null ? '' : ` ${percent}%`}`;
  show($('iv-setup-bar'), percent != null);
  if (percent != null) $('iv-setup-fill').style.width = `${Math.max(2, percent)}%`;
}
