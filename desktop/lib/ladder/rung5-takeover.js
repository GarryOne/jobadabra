// "Let Claude finish this page" from the form panel (spec docs/superpowers/specs/2026-10-10-claude-finishes-stuck-pages.md): the app's side of the panel's take-over event.
// Owns: the panel's "Continue" being the consent, and the floor "at most ONE takeover per application" (a second request, a second page or the countdown firing again, is
// refused and logged; a start that failed gives the claim back). Guarded by test/take-over.test.js. Starting itself is main.js startClaude (passed in).
const keyOf = url => String(url || '').split('#')[0].replace(/\/+$/, '').toLowerCase();

export function createTakeOver({startClaude, storage, appLog, toWindow, onStarted = () => {}, enabled = false}) {   // enabled: the ONE flag of Claude's takeover, passed in by apply-handlers.js (off for now)
  const took = new Set();   // applications Claude was started on from a panel this run
  return async function takeOver(event) {
    const job = event.job, key = keyOf(event.url);
    if (!enabled) { appLog('extension', 'take over with Claude refused: the takeover is off (renderer/claude-help.js SHOW_RESUME_CLAUDE)', {host: event.host}); return {ok: false, off: true}; }   // never from an old extension or a stale window
    appLog('extension', 'take over with Claude asked from the page', {host: event.host, known: !!job, consent: !!event.consent});
    if (event.consent && !storage.settings().claudeConsent) storage.saveSettings({claudeConsent: new Date().toISOString()});   // the panel's "Continue" line is the consent
    if (took.has(key)) {
      appLog('extension', 'take over with Claude refused: Claude already took over this application (one per application)', {host: event.host});
      toWindow('toast', {title: 'Claude already worked on this application', body: 'Open its session to continue, or finish the page yourself.', target: {view: 'sessions'}});
      return {ok: false, refused: true};
    }
    took.add(key);
    const result = await startClaude(String(event.url || ''), job ? {title: job.title, company: job.company, location: job.location, workMode: job.work_mode} : null);
    if (result?.ok) { onStarted(String(event.url || '')); if (result.session?.id) toWindow('session', 'open', {id: result.session.id}); } else {
      took.delete(key);   // it did not start: the person may ask again
      toWindow('toast', {title: 'Claude could not start', body: result?.error || 'Try again from the Applying page.', target: {view: 'sessions'}});
    }
    return result;
  };
}
