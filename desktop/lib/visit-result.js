// What a "Find jobs using your browser" run says when it ends, as the card reads it (moved out of visits.js, 16 Oct 2026, a pure move to keep that file
// under its size limit). Pure: no state. Guards: desktop/test/visits-run.test.js (the card parses exactly this).
const key = url => String(url || '').split('#')[0].replace(/\/$/, '');   // the same as visits.js key

// Why a site read in part stopped, worth saying beside its jobs; a list read to its end is not (extension/visit.js readSite's own words).
export const cutShort = why => !!why && !/end of the list|^no next page$/.test(String(why));
// The result as the app shows it (renderer/visits-card.js parseVisits reads exactly this).
// `added`: jobs the run's scoring wrote to the Jobs list (null when it did not score), said on the head line.
export function resultMessage(results, {added: listed = null, postings = null} = {}) {
  const read = results.filter(result => result.ok);
  const jobs = read.reduce((sum, result) => sum + result.jobs, 0), added = read.reduce((sum, result) => sum + result.added, 0);
  const fits = read.reduce((sum, result) => sum + (result.fits || 0), 0);
  const fit = n => `${n} matching your search`;
  const clean = text => String(text || '').replace(/\s*·\s*/g, ', ').replace(/\n/g, ' ').slice(0, 120);
  return ['🌐 Sites read', `Read ${read.length} of ${results.length} site${results.length === 1 ? '' : 's'} · ${jobs} job${jobs === 1 ? '' : 's'} (${added} new) · ${fit(fits)}${listed === null ? '' : ` · ${listed} added to your Jobs`}`,
    ...results.map(result => result.ok ? `✓ ${clean(result.name)} · ${result.jobs} job${result.jobs === 1 ? '' : 's'} (${result.added} new), ${fit(result.fits || 0)}${cutShort(result.why) ? `; ${clean(result.why)}` : ''} · ${key(result.url)}`
      : `✗ ${clean(result.name)} · ${clean(result.why) || 'nothing read'} · ${key(result.url)}`),
    ...(postings ? [`📄 Read ${postings.read} of ${postings.asked} job${postings.asked === 1 ? '' : 's'} we couldn't read`] : [])].join('\n');
}

// The page kind the extension judged ('login' | 'check'), kept so a step reads it, not the words of `why` (LinkedIn jobs 2/3).
export const blockedOf = state => (['login', 'check'].includes(state.blocked) ? state.blocked : '');
