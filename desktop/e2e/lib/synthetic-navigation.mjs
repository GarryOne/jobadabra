// Offline hand-cut fixtures synthesize query strings and one redirect without storing captured values.
const keyOf = url => `${url.host}${url.pathname}`.replace(/\/$/, '');

/** Build one case's invented start URL and mutable, single-use redirect map. Ordinary captures stay unchanged. */
export function syntheticNavigation(item) {
  const startUrl = item.pages[0].url, spec = item.syntheticNavigation;
  if (spec == null) return {startUrl, redirects: new Map()};
  const fail = () => { throw new Error('Invalid synthetic navigation: hand-cut .example pages and query keys only'); };
  let url;
  try { url = new URL(startUrl); } catch { fail(); }
  // Invariant: metadata can name keys, never copied query values, and applies only to reserved fictional hosts.
  if (item.origin !== 'hand-cut' || url.protocol !== 'https:' || !url.hostname.endsWith('.example') || url.search || url.hash || url.username || url.password
      || !spec || typeof spec !== 'object' || Array.isArray(spec) || Object.keys(spec).some(key => !['queryKeys', 'dropQueryOnce'].includes(key))
      || !Array.isArray(spec.queryKeys) || !spec.queryKeys.length || spec.queryKeys.length > 8 || spec.queryKeys.some(key => typeof key !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(key))
      || (spec.dropQueryOnce != null && typeof spec.dropQueryOnce !== 'boolean')) fail();
  const redirects = new Map(spec.dropQueryOnce ? [[keyOf(url), url.href]] : []);
  for (const key of spec.queryKeys) url.searchParams.set(key, 'fixture-job');
  return {startUrl: url.href, redirects};
}

/** Consume the matching fictional page's first query-bearing request; restored queries then load normally. */
export function takeSyntheticRedirect(address, redirects) {
  const url = new URL(address), key = keyOf(url), target = redirects.get(key);
  if (!url.search || !target) return null;
  redirects.delete(key);
  return target;
}
