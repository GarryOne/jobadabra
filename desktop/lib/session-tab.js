// The ONE place that says which of Chrome's tabs is a session's: the tab id it is bound to in the current browser run, else a tab whose own address
// names the session (#jobpilotto-fill=<id>, what Chrome restores after a restart). Nothing else picks a tab: no score, no address or title match, no
// "the only armed one" (owner, 12 Oct 2026; spec docs/superpowers/specs/2026-10-12-tab-owned.md). No owned tab means null: the card says "reopen?",
// and nothing here opens or takes another tab. Guards: test/session-tab.test.js (the matrix, and a scan that fails when another file picks a tab by guess).
//
// Invariants: 1. a tab with no id of its own and no mark naming the session is never returned (the person's own tab of the same job, an unowned sign-in tab);
//             2. a bound tab id counts only inside the browser run it was bound in (Chrome reuses ids across restarts and browsers).

// The session a tab address names; the same rule as extension/tab-pages.js parseMark (a test keeps the two equal).
export const markedSession = url => (/#jobpilotto-fill(?:=([A-Za-z0-9_-]{1,64}))?$/.exec(String(url || '')) || [])[1] || '';

// tabs: [{id, url, ...}] from Chrome's scripting. boundTab: the id the extension reported for this session in this run ('' when none or another run).
export function tabOfSession(id, tabs, boundTab = '') {
  const want = String(boundTab ?? '');
  const byId = want !== '' && (tabs || []).find(tab => String(tab.id) === want);
  return byId || (tabs || []).find(tab => markedSession(tab.url) === String(id)) || null;
}

// The address a session's tab is opened with: its own id in the fill mark, so it is owned from its first page (the ONE place that builds it).
export const sessionTabUrl = (url, id) => `${String(url || '').split('#')[0]}#jobpilotto-fill=${id}`;

// Which sessions have a tab in Chrome's own list right now (the Mac's scripting): by the tab id bound to them in this run, or the id in the address.
// Chrome's list can only ADD evidence that a tab is open: an empty or missing list says nothing (a stray background Chrome hides the person's tabs).
export function sessionsWithTab(sessions, tabs, boundOf = () => '') {
  return new Set((sessions || []).filter(session => tabOfSession(session.id, tabs || [], boundOf(session.id))).map(session => session.id));
}

// Which of these sessions have a tab named in the extension's reported addresses (a restored tab not yet re-bound): a set of session ids.
export function sessionsNamedIn(sessions, urls) {
  const named = new Set((urls || []).map(markedSession).filter(Boolean));
  return new Set((sessions || []).filter(session => named.has(String(session.id))).map(session => session.id));
}
