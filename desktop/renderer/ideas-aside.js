// Role ideas set aside (src/ai/role_ideas.py set_aside): kept on this Mac and sent with every ask, so the AI never proposes them again.
// Written by a Not true on role ideas, on Strategy or Focus (src/suggestions_search.py entry `aside`); read by Strategy's ideas row.
const IDEAS_ASIDE = 'jp.ideas.aside';
const KEPT = 60;

/** The words set aside so far. */
export const aside = () => { try { return JSON.parse(localStorage.getItem(IDEAS_ASIDE) || '[]'); } catch { return []; } };

/** Sets these words aside too (the newest KEPT are kept). */
export function setAside(words) {
  try { localStorage.setItem(IDEAS_ASIDE, JSON.stringify([...new Set([...aside(), ...words])].slice(-KEPT))); } catch { /* proposed again next time */ }
}
