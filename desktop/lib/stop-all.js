// The person's Stop, the app's side (owner, 13 Oct 2026: "a way to stop"; extension/stop.js is the other): once the extension says it stopped, every live application form session says so,
// whatever step it was at, and the card offers Reopen form (the person's own Apply) to start it again; the person's start on a tab (startForm) takes its session out of "Stopped".
// Pure over the terminals' own functions. Guard: desktop/test/stop-request.test.js.

// -> how many sessions changed (0 when all already said it).
export function stopLiveForms({list, noteStopped}) {
  let changed = 0;
  for (const session of list()) if (session.kind === 'form' && !session.outcome && noteStopped(session.id)) changed++;
  return changed;
}

// The person started the extension again on one tab (the panel's Fill, Check form again, the popup's Apply on this page): that tab's session leaves "Stopped" at once, as Reopen form
// does (owner, 27 Oct 2026: the app still said "You stopped the extension" while the form filled again). Other stopped sessions stay stopped: their pages still are.
// -> the session id it started again, or '' (no session follows that tab, or it was not stopped).
export function startForm({get, clearStuck}, sessionOfTab, tab) {
  const id = sessionOfTab(Number(tab));
  if (!id || get(id)?.stuck !== 'stopped') return '';
  clearStuck(id);
  return id;
}
