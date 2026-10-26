// The Strategy page's "your search may be too narrow" card (src/coverage.py says it; desktop/lib/strategy.js addRoles acts on it).
// Pure: the numbers in, the words and chips out. Nothing is shown for a search that catches enough, or after "Not now" for this crawl.
import {offered} from './key-sources.js';
const number = value => Number(value || 0).toLocaleString('en-US');

export function coverageCard(verdict, dismissedAt = '') {
  if (!verdict || !verdict.narrow || !Array.isArray(verdict.suggestions) || !verdict.suggestions.length) return null;
  if (dismissedAt && verdict.at && dismissedAt === verdict.at) return null;
  const percent = Math.max(1, Math.round((verdict.share || 0) * 100));
  return {
    title: verdict.local ? 'Jobs written in other languages slip past your search' : 'Your search may be too narrow',
    text: (verdict.local ? `Your role keywords are in English, but many jobs in your places are titled in German, French or another language. ` : '') +
      `Of ${number(verdict.in_places)} postings in your places, your role keywords catch ${number(verdict.matched)} (${percent}%). ` +
      'These role words appear in titles your keywords miss; adding one makes the next searches look for it:',
    chips: verdict.suggestions.slice(0, 8).map(item => ({
      term: item.term, count: item.count || 0, label: `+ ${item.term} · ${number(item.count)}`,
      // Each new posting is read and scored once (AI, once): said before the click, because a broad word brings many.
      title: `${number(item.count)} open posting${item.count === 1 ? '' : 's'}${item.examples?.length ? `, e.g. ${item.examples.join('; ')}` : ''}. Each is read and scored once.`,
    })),
    at: verdict.at || '',
  };
}

// "Your filters drop jobs" (src/coverage.py): excluded title words and ruled-out languages, each with the jobs it hid; a chip removes it.
export function filtersCard(verdict, dismissedAt = '') {
  const words = Array.isArray(verdict?.excluded) ? verdict.excluded : [], languages = Array.isArray(verdict?.languages) ? verdict.languages : [];
  if (!words.length && !languages.length) return null;
  if (dismissedAt && verdict.at && dismissedAt === verdict.at) return null;
  const sample = item => (item.examples?.length ? `, e.g. ${item.examples.join('; ')}` : '');
  return {
    title: 'Your own filters hide jobs',
    text: 'These jobs match your roles and places, but a filter of yours drops them. Remove a filter to see them in the next searches:',
    chips: [...words.map(item => ({exclude: item.fragment, count: item.count || 0, label: `− "${item.fragment.replace(/\\b/g, '')}" · ${number(item.count)}`,
      title: `${number(item.count)} job${item.count === 1 ? '' : 's'} with this excluded word in the title${sample(item)}`})),
    ...languages.map(item => ({language: item.language, count: item.count || 0, label: `− requires ${item.language} · ${number(item.count)}`,
      title: `${number(item.count)} job${item.count === 1 ? '' : 's'} hidden because they require ${item.language}${sample(item)}`}))],
    at: verdict.at || '',
  };
}

// "More places to find jobs" (src/coverage.py unused_sources): the job sources this install does not use, least effort first, each with what it
// takes (a free key, a paid plan). Shown whatever the coverage: more sources mean more jobs. A chip opens its panel in Settings → Connections.
export function sourcesCard(verdict, dismissedAt = '') {
  const sources = (Array.isArray(verdict?.sources) ? verdict.sources : []).filter(source => offered(source.id));   // the API-key sources are hidden while the flag is off (key-sources.js)
  if (!sources.length || (dismissedAt && verdict.at && dismissedAt === verdict.at)) return null;
  return {
    title: 'More places to find jobs',
    text: 'Job sources you do not use yet, easiest first. Each one adds jobs the others miss:',
    chips: sources.map(source => ({id: source.id, label: `+ ${source.name} · ${source.people || source.effort}`,
      title: `${source.effort}: ${source.gain}${source.people ? ` (${source.people})` : ''}`})),
    at: verdict.at || '',
  };
}

// Sites only you can open (src/sources/visits.py): employers whose site refuses automated visitors and portals with no API. A chip opens the
// page in your Chrome with a read mark; there the extension reads it by itself (owner, 7 Oct 2026). Pure like the others.
export function visitCard(verdict, dismissedAt = '') {
  const list = Array.isArray(verdict?.visits) ? verdict.visits : [];
  if (!list.length || (dismissedAt && verdict.at && dismissedAt === verdict.at)) return null;
  return {
    title: 'Sites only you can open',
    text: 'These refuse automated visitors or have no other way in. Open one: Jobadabra reads its jobs in Chrome by itself:',
    chips: list.map(item => ({url: item.url, label: `Open ${item.name}`, note: item.note || '',
      title: `${item.kind === 'portal' ? `${item.name}: ${item.why}` : `${item.name} ${item.why}`}${item.last_read ? `; last read ${item.last_read.slice(0, 10)}` : ''}${item.note ? `. ${item.note}` : ''}`})),
    at: verdict.at || '',
  };
}

// Employers where people doing the same kind of work got interviews (src/coverage.py employers_for_you, from the shared pool, 7 Oct 2026).
// A chip shows that employer's jobs. Pure like the others.
export function employersCard(verdict, dismissedAt = '') {
  const list = Array.isArray(verdict?.for_you) ? verdict.for_you : [];
  if (!list.length || (dismissedAt && verdict.at && dismissedAt === verdict.at)) return null;
  return {
    title: 'Where people like you get interviews',
    text: 'From the shared list: employers where people doing your kind of work applied and got interviews. See their jobs:',
    chips: list.map(item => ({company: item.company, label: `${item.company} · ${item.interview ? `${item.interview} interview${item.interview === 1 ? '' : 's'}` : `${item.applied} applied`}`,
      title: `People like you (same ${item.why}) applied ${item.applied} times and got ${item.interview} interview${item.interview === 1 ? '' : 's'} here`})),
    at: verdict.at || '',
  };
}

// The same card for places (src/coverage.py): roles the keywords already catch, but in places you did not list. Pure like the one above.
export function placesCard(verdict, dismissedAt = '') {
  const places = verdict?.places;
  if (!places || !Array.isArray(places.options) || !places.options.length) return null;
  if (dismissedAt && verdict.at && dismissedAt === verdict.at) return null;
  const extra = places.options.reduce((sum, option) => sum + (option.count || 0), 0);
  const elsewhere = places.elsewhere ? ` ${number(places.elsewhere)} more are in places that need a visa (US, Asia), so they are left out.` : '';
  return {
    title: 'Matching roles sit just outside your places',
    text: `Your role keywords match ${number(places.title_hits)} open roles; ${number(places.matched)} are in your places. ${number(extra)} more are in these places:` + elsewhere,
    chips: places.options.slice(0, 8).map(option => ({
      place: option.place, count: option.count || 0, label: `+ ${option.place} · ${number(option.count)}`,
      title: `${number(option.count)} open role${option.count === 1 ? '' : 's'}${option.examples?.length ? `, e.g. ${option.examples.join('; ')}` : ''}. Each is read and scored once.`,
    })),
    at: verdict.at || '',
  };
}

// "Roles that fit you" (src/ai/role_ideas.py): the Profile's roles as chips, with the open jobs each would add; the ones set aside never shown.
// With an AI this is the one row of role suggestions (owner, 26 Oct 2026, audit PR 6): `narrow` says how much the role words catch when the
// coverage check found them tight (under a tenth, src/coverage.py) and one idea adds 5 or more open jobs.
export function ideasCard(ideas, setAside = [], verdict = null) {
  const hidden = new Set(setAside.map(word => String(word).toLowerCase()));
  const shown = (ideas || []).filter(idea => idea?.word && !hidden.has(idea.word.toLowerCase())).slice(0, 8);
  if (!shown.length) return null;
  const narrow = verdict?.tight && shown.some(idea => (idea.count || 0) >= 5)
    ? `Your role words catch ${number(verdict.matched)} of ${number(verdict.in_places)} postings in your places` : '';
  return {narrow, title: 'Roles that fit you', text: 'From your Profile: roles you could do but do not search for yet, with the open jobs each would add in your places. Adding one makes the next searches look for it:',
    chips: shown.map(idea => ({term: idea.word, count: idea.count || 0, role: idea.role, why: idea.why, label: `+ ${idea.role} · ${idea.count || 0}`, title: `${idea.why}. Searched as "${idea.word}"; ${idea.count || 0} open job${idea.count === 1 ? '' : 's'} in your places now.`})),
    at: shown.map(idea => idea.word).join('|')};
}
