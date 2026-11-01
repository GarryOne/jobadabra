// Sets the app's silence limit for an engine step that prints nothing (the journey's JOB_PILOTTO_E2E_IDLE_MS) BEFORE any app module is loaded: lib/pipeline-run.js reads it once, at import.
// Import this file first in a test file that waits for the watchdog (run-silence.test.mjs); ES modules evaluate their imports in order.
// Job: serve stored answers
process.env.JOB_PILOTTO_E2E = '1';
process.env.JOB_PILOTTO_E2E_IDLE_MS = '5000';
