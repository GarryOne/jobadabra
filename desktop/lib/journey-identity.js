// Which application an extension report is about, decided ONE way for every handler (spec: docs/superpowers/specs/2026-10-10-application-journey.md, step 2).
// The extension sends its tab's identity with every report: {session, job, url} (extension/tab-identity.js). The session it carries wins while it is a live
// form session; else the form session whose posting is the tab's job (the posting the tab was opened for), else the page's own address; else none.
// The handler answers the id it used, and the extension binds it to the tab, so the next report carries it (10 Oct 2026: a sign-in tab carried no id,
// and the Gmail check's "enter the code" never reached the card). Guards: test/journey-identity.test.js, test/journeys.test.js.
//
// Invariants: 1. a carried id of a live form session is never overridden by a job match (two applications on one board stay apart);
//             2. a finished session (outcome set) is never matched; 3. no id, no job, no address: '' (never a guess);
//             4. a job or address match never takes a session whose tab is in another browser run that still reports (`boot`: the run the report comes from; a hidden-browser
//                read of the same job carries a read id that is no session: #43, #2747, #2753). Guard: test/tab-match-class.test.js.

/** The services every handler hands resolveSession, built in ONE place so none can forget the browser-run check. */
export function identityServices({terminals, review, isFormOf}) {
  return {get: id => terminals.get(id), list: () => terminals.list(), isFormOf, heldElsewhere: review.heldElsewhere};
}

export function resolveSession({session, job, url, boot = ''} = {}, {get, list, isFormOf, heldElsewhere = () => false}) {
  const live = item => item && item.kind === 'form' && !item.outcome;
  const own = session ? get(String(session)) : null;
  if (live(own)) return own.id;
  for (const address of [job, url]) {
    if (!address) continue;
    const found = list().find(item => live(item) && isFormOf(address, item.url) && !heldElsewhere(item.id, String(boot || '')));
    if (found) return found.id;
  }
  return '';
}
