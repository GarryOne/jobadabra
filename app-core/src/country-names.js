// Whether a form's country option names the same country as the applicant's saved words, in any language, by the standard country names
// (Intl.DisplayNames, CLDR): "Suisse" on a French menu is the saved "Switzerland". No word list: the regions are the two-letter codes the runtime names,
// the languages are those the regions themselves speak (Intl.Locale maximize). Built lazily, most-spoken language first, stopping at the first that knows
// the name. Used by the identity floor (answer-facts.js floorUngrounded) for one of a form's listed options only. Guarded by test/choice-from-fact.test.js.
const plain = (text) => String(text || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const phrase = (text) => ` ${plain(text).split(/[^\p{L}\p{N}]+/u).filter(Boolean).join(' ')} `;

let cache = null;
function data() {
  if (cache) return cache;
  cache = { regions: [], languages: [], byLanguage: new Map(), names: new Map() };
  try {
    const english = new Intl.DisplayNames(['en'], { type: 'region', fallback: 'none' });
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    for (const a of letters) for (const b of letters) { try { const name = english.of(a + b); if (name && name !== a + b) cache.regions.push(a + b); } catch { /* not a region */ } }
    const counts = new Map();
    for (const region of cache.regions) {
      try { const language = new Intl.Locale(`und-${region}`).maximize().language; counts.set(language, (counts.get(language) || 0) + 1); } catch { /* no language known */ }
    }
    cache.languages = ['en', ...[...counts].sort((x, y) => y[1] - x[1]).map(([language]) => language).filter((language) => language !== 'en')];
  } catch { /* a runtime without Intl.DisplayNames: nothing is matched, the floor stays as strict as before */ }
  return cache;
}

function namesIn(language) {
  const { regions, byLanguage } = data();
  if (!byLanguage.has(language)) {
    const map = new Map();
    try {
      const names = new Intl.DisplayNames([language], { type: 'region', fallback: 'none' });
      for (const region of regions) { const name = names.of(region); if (name) map.set(phrase(name), [...(map.get(phrase(name)) || []), region]); }
    } catch { /* this language is not known here */ }
    byLanguage.set(language, map);
  }
  return byLanguage.get(language);
}

// A country's name -> its region codes (the first language that knows the name decides; [] when none does).
export function regionsOf(name) {
  const key = phrase(name);
  if (key.trim() === '') return [];
  for (const language of data().languages) { const found = namesIn(language).get(key); if (found) return found; }
  return [];
}

// Every name of a region, in each language.
function namesOf(region) {
  const { languages, names } = data();
  if (!names.has(region)) {
    const all = new Set();
    for (const language of languages) { try { const name = new Intl.DisplayNames([language], { type: 'region', fallback: 'none' }).of(region); if (name) all.add(phrase(name)); } catch { /* skip */ } }
    names.set(region, [...all]);
  }
  return names.get(region);
}

// true when value is a country's name and what was given names that same country, as whole words, in any language.
export function sameCountry(value, given) {
  const text = phrase(given);
  return regionsOf(value).some((region) => namesOf(region).some((name) => text.includes(name)));
}
