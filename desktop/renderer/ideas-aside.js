// Role ideas set aside with a Not true, on Strategy or Focus (src/suggestions_search.py entry `aside`): the engine keeps them (src/ai/role_ideas.py
// put_aside), so the AI never proposes them and Focus never shows them again. Why (#2350, Gitar): this window's storage held them, and Focus read the engine.
const IDEAS_ASIDE = 'jp.ideas.aside';

/** The words an older version set aside in this window's storage: sent with the next ask, which keeps them in the engine. */
export const aside = () => { try { return JSON.parse(localStorage.getItem(IDEAS_ASIDE) || '[]'); } catch { return []; } };

/** Sets these words aside in the engine. */
export function setAside(words) {
  window.pilot.roleIdeasAside?.(words)?.catch(() => { /* proposed again next time */ });
}
