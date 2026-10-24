// Controlled randomness for the end-to-end suites: each scheduled run takes a different path through the same app (page order, control order, window size), so repeated
// runs find different bugs. The seed is printed, written to seed.json and shown in every issue, so a finding can be replayed: E2E_SEED=<n> node suite.mjs <suite>.
// No E2E_SEED (or 0) = FIXED: the same order every time. The release gate runs fixed (e2e.yml), so a build is judged on a path that does not move under it.

// mulberry32: small, fast, good enough to shuffle a menu.
export function generator(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// The window sizes a person really has: the app's smallest (lib/main-window.js MIN_WIDTH x minHeight: the rail, and the height at which the sidebar once cut off its last icon, #118), just under the
// rail limit, the default, a big screen. The first one must stay the app's own minimum (test/variation.test.mjs reads main.js).
export const WINDOW_SIZES = [[640, 640], [1024, 640], [1100, 720], [1179, 760], [1280, 820], [1440, 900], [1680, 1000]];   // 640: the app's minimum since 886c923 (Jobadabra beside Chrome)

export function createVariation(env = process.env) {
  const raw = String(env.E2E_SEED ?? '').trim();
  const seed = /^\d+$/.test(raw) ? Number(raw) % 4294967296 : 0;
  const fixed = seed === 0;
  const next = generator(seed || 1);
  const shuffle = list => {
    const out = [...list];
    if (fixed) return out;
    for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(next() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
    return out;
  };
  const pick = list => (fixed ? list.find(item => Array.isArray(item) && item[0] === 1280) || list[0] : list[Math.floor(next() * list.length)]);
  return {seed, fixed, shuffle, pick};
}

// Where the person lives (5 Oct 2026): a seeded run of a suite that opts in (`export const variesPlace = true`) starts the app in another time zone and
// language, because date and number bugs hide there (the calendar lost Sunday 4 October in one zone, #120 and #122). The fixed path stays in Zurich, in the
// system language. Its own generator: it never shifts the suite's other picks.
export const ZONES = ['Europe/Zurich', 'America/Los_Angeles', 'Pacific/Honolulu', 'Asia/Tokyo', 'Australia/Sydney', 'America/Sao_Paulo', 'Asia/Kolkata', 'Pacific/Auckland'];
export const LOCALES = ['en-US', 'en-GB', 'de-CH', 'fr-FR', 'ja-JP', 'pt-BR', 'hi-IN'];
export function placeOf(env = process.env) {
  const {seed, fixed} = createVariation(env);
  if (fixed) return null;
  const next = generator((seed * 2654435761) % 4294967296 || 7);
  return {zone: ZONES[Math.floor(next() * ZONES.length)], locale: LOCALES[Math.floor(next() * LOCALES.length)]};
}
