// A pop-up's kind, shown by its colour and icon (owner, 27 Oct 2026: "warning=yellow, success=green, error=red, info=light blue"; the coloured background).
// Pure: main (lib/app-notify.js) and the window both read it. The colours are the shared .tone-* classes (components.css); the look: style.css .toast.tone-*.
// Guard: test/toast-targets.test.js (every pop-up call names one of these).
import {runStatus, runWarned} from './run-status.js';

// tone -> its icon (renderer/icons.js)
export const TONES = Object.freeze({bad: 'bang-circle', warn: 'alert', good: 'check-circle', info: 'info'});

// A tone as sent from main or a caller: one of TONES, else info (a pop-up is never drawn without a kind).
export const toneOf = tone => (Object.hasOwn(TONES, tone) ? tone : 'info');

// A finished run's pop-up takes its status pill's tone (Failed red, Not checked or With warnings yellow, Completed green); queued or no result: info.
export const runTone = run => toneOf(runStatus(run, runWarned(run))[1]);
