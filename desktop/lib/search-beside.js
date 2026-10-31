// LinkedIn jobs on every Find jobs, PR 2/3 (spec docs/superpowers/specs/2026-10-31-linkedin-headless-design.md): the engine's search and the LinkedIn step run side by side
// on the press's ONE clock (lib/search-steps.js). Design: the step never changes or delays the engine's result; Stop, a failing search or the press's deadline ends it; its verdict is
// recorded once (lib/linkedin-session.js noteRun); the jobs it found are scored by the existing light run (visitsArgs) only when the press has time left.
// The step is registered once by the visits handlers (it needs visits.js, which imports pipeline.js: registering here keeps the imports one-way). Guard: test/search-beside.test.js.
import {noteRun} from './linkedin-session.js';

let registered = null, registeredScore = null;
/** Register the LinkedIn step: (signal, onLine) -> Promise<{state, jobs, fits?, ...}>, and the light scoring (fits, onLine). null removes them (tests, tools). */
export const setLinkedinStep = (fn, score = null) => { registered = fn; registeredScore = score; };

/**
 * True for a person's own Find jobs press (the button, Telegram's run, a resumed press, the first press): the only runs that read LinkedIn.
 * Why (31 Oct 2026, Gitar on #2699 + spec: "scheduling LinkedIn outside Find jobs" is parked): the timer, a re-score and "Find more employers" also pass through the search task,
 * and the session must not be used with nobody at the keyboard (owner, 26 Oct 2026: not started automatically in the background).
 */
export const ownPress = ({mode, trigger, employers = false, note = ''}) => mode === 'run' && ['you', 'first'].includes(trigger) && !employers && !note;

const SCORE_NEEDS_MS = 40000;   // under this much of the press left, the jobs wait for the next search (an engine step needs a few seconds to start)
/**
 * Run `main` (the engine's steps) with the LinkedIn step beside it. -> main's result, whatever the step does.
 * signal: Stop. deadlineMs: when the step must end (the press's end, less a margin, so its session has left the browser before the press does).
 */
export async function withLinkedin(storage, onLine, signal, main, {step = registered, score = registeredScore, deadlineMs = 170000, budgetMs = 180000, now = Date.now, record = noteRun} = {}) {
  if (!step) return main();
  const startedAt = now(), own = new AbortController(), stop = () => own.abort();
  if (signal?.aborted) stop(); else signal?.addEventListener('abort', stop, {once: true});
  const timer = setTimeout(stop, deadlineMs);
  const aside = Promise.resolve().then(() => step(own.signal, onLine)).catch(() => null);
  let outcome;
  try { outcome = await main(); } catch (error) { stop(); await aside; clearTimeout(timer); signal?.removeEventListener('abort', stop); throw error; }   // Stop stays wired until the step ends: it can come after the engine's steps
  const result = await aside;
  clearTimeout(timer);
  signal?.removeEventListener('abort', stop);
  if (result && result.state !== 'off') record(storage, {...result, at: new Date(now()).toISOString()});
  if (result?.fits && score && !own.signal.aborted && now() - startedAt < budgetMs - SCORE_NEEDS_MS) await score(result.fits, onLine).catch(() => {});
  return outcome;
}
