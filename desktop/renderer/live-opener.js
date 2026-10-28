// One owner of "is this session's hidden page open in main for its live view": none -> opening -> open, changed only by main's answer to liveOpen. Guard: test/live-opener.test.js.

/**
 * open() -> Promise<{ok, error?}> (window.pilot.liveOpen for the session); onResult(result) tells the view what to show (the picture comes by its own events, a refusal's reason is drawn).
 * ensure() is called on every redraw of the card: it asks only while not open and not already asking, so a card drawn before the hidden form exists asks again when the session's state moves on.
 * Why (2026-10-28, owner screenshot "Filling the application" with a broken picture): the view asked once at mount; the hidden form was not open yet (queued), main said so, and nothing asked again.
 * Invariants: at most one ask in flight; a refusal or a thrown call leaves `none` (asked again next time); `open` is never asked again for this opener (a new session draws a new opener).
 */
export function createLiveOpener(open, onResult = () => {}) {
  let state = 'none';
  return {
    get state() { return state; },
    ensure() {
      if (state !== 'none') return;
      state = 'opening';
      let asked; try { asked = Promise.resolve(open()); } catch (error) { asked = Promise.reject(error); }   // asked now, not a tick later
      asked.then(result => result || {ok: false}, () => ({ok: false, error: 'The hidden form is not open.'})).then(result => {
        state = result.ok ? 'open' : 'none';
        onResult({ok: !!result.ok, error: result.ok ? '' : result.error || 'The hidden form is not open.'});
      });
    },
  };
}
