// Which of the extension's decision lines belong to one replayed case, for the printout of a failed case (page-replay.mjs judgeCase).
// In a shared browser the lines of every tab arrive in the same pushes, so the case's name used to sit on other cases' lines (14 Oct 2026: a work-permit
// dropdown of another case under combo-never-opens-late-answers-1). A line is the case's when it names the case's host, or sits on a tab that did;
// it is dropped when it names another case's host or a tab that did; a line that names neither is counted, never printed under a case's name.
// Guard: e2e/test/replay/replay-lines.test.mjs.
const tabOf = entry => { const tab = entry?.fields?.tab ?? entry?.fields?.tabId; return tab == null || tab === '' ? null : String(tab); };
const names = (entry, hosts) => { const text = `${entry.text} ${JSON.stringify(entry.fields || {})}`; return hosts.some(host => text.includes(host)); };

// -> {mine: [entry], unplaced: n}. entries: every pushed line of the run since the case began; own / others: hosts of this case / of every other case.
export function linesOfCase(entries, {own, others}) {
  const seen = new Set(), list = [];
  for (const entry of entries) { const key = `${entry.at}|${entry.text}`; if (!seen.has(key)) { seen.add(key); list.push(entry); } }   // a push that failed is sent again with the next one
  const ownTabs = new Set(), otherTabs = new Set();
  for (const entry of list) {
    const tab = tabOf(entry), mine = names(entry, own), theirs = names(entry, others);
    if (tab && mine && !theirs) ownTabs.add(tab);
    if (tab && theirs && !mine) otherTabs.add(tab);
  }
  for (const tab of ownTabs) otherTabs.delete(tab);   // a tab that served both (hosts shared) stays the case's
  const mine = [];
  let unplaced = 0;
  for (const entry of list) {
    const tab = tabOf(entry), own1 = names(entry, own), other1 = names(entry, others);
    if (own1 && !other1) mine.push(entry);
    else if (other1 && !own1) continue;
    else if (tab && ownTabs.has(tab)) mine.push(entry);
    else if (tab && otherTabs.has(tab)) continue;
    else if (own1 && other1) mine.push(entry);   // names both: kept, the case's host is in it
    else unplaced += 1;
  }
  return {mine, unplaced};
}

// Does one of the (placed) lines say the word: in its text or its fields. A "told" word on a line placed on the case's own tab needs no re-run alone.
export const saysWord = (lines, word) => lines.some(entry => `${entry.text} ${JSON.stringify(entry.fields || {})}`.includes(word));
