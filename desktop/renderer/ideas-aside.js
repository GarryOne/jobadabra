// Role ideas an older version set aside in this window's storage (jp.ideas.aside): moved once into the store as a Not true answer that keeps
// the words (lib/suggestion-answers.js `aside`, read back by src/suggestions.py set_aside), then cleared. Why (#2350, Gitar): re-sent with every
// ask, the old list pushed newer words out of a capped copy on one Mac; the store keeps them on every Mac, Focus and Strategy alike.
const IDEAS_ASIDE = 'jp.ideas.aside';
export const MOVED_KEY = 'ideas:set-aside-before';

/** Moves this window's old list into the store, once; resolves when it is moved, or when there is nothing to move. */
export async function moveOldAside() {
  let words = [];
  try { words = JSON.parse(localStorage.getItem(IDEAS_ASIDE) || '[]'); } catch { return; }
  if (!Array.isArray(words) || !words.length) return;
  const done = await window.pilot.suggestionAnswer({key: MOVED_KEY, title: 'Roles set aside before', aside: words}, 'Not true').catch(() => null);
  if (done?.ok) try { localStorage.removeItem(IDEAS_ASIDE); } catch { /* moved again next time, onto the same answer row */ }
}
