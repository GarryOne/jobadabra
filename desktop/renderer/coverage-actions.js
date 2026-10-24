// What to do after a jobs check that found few new jobs (owner, 6 Oct 2026: "buttons after the search is done"): the coverage answer's cards
// (renderer/coverage-card.js) as one list of actions, least effort first: a filter of yours to remove, a role word to add, a place to add (one
// click each), then a job source to connect (a key). Pure: the same actions the Strategy cards offer, so both say and do the same.
import {offered} from './key-sources.js';
import {coverageCard, filtersCard, placesCard, sourcesCard, visitCard} from './coverage-card.js';

export function coverageActions(verdict) {
  const out = [];
  for (const chip of filtersCard(verdict)?.chips || []) out.push({kind: chip.exclude ? 'exclude' : 'language', label: chip.label, count: chip.count || 0, title: chip.title, value: chip.exclude || chip.language});
  for (const chip of coverageCard(verdict)?.chips || []) out.push({kind: 'role', label: chip.label, count: chip.count || 0, title: chip.title, value: chip.term});
  for (const chip of placesCard(verdict)?.chips || []) out.push({kind: 'place', label: chip.label, count: chip.count || 0, title: chip.title, value: chip.place});
  for (const chip of sourcesCard(verdict)?.chips || []) out.push({kind: 'source', label: chip.label, title: chip.title, value: chip.id});
  for (const chip of visitCard(verdict)?.chips || []) out.push({kind: 'visit', label: chip.label, title: chip.title, value: chip.url});
  return out;
}

// Advice shown and taken (owner, 7 Oct 2026: "what we recommended and whether the user took it"), as a technical report: the kind of advice,
// where it was shown, and for a job source its fixed id. Never the role word, place or filter itself. Shown once per kind and place a session.
const shownOnce = new Set();
// One name per kind of advice, wherever it is shown: a Strategy card's box or an action's kind.
const KIND = {coverage: 'role', role: 'role', places: 'place', place: 'place', filters: 'filter', exclude: 'filter', language: 'filter', sources: 'source', source: 'source', explain: 'explain', employer: 'employer', visit: 'visit'};
export function adviceEvent(act, kind, where, {source = '', record = globalThis.window?.pilot?.telemetryRecord} = {}) {
  kind = KIND[kind];
  if (!record || !kind || !['shown', 'taken', 'dismissed'].includes(act)) return false;
  if (act === 'shown') {
    if (shownOnce.has(`${where}:${kind}`)) return false;
    shownOnce.add(`${where}:${kind}`);
  }
  try { record('advice', {act, advice: String(kind), where: String(where), ...(kind === 'source' && /^[a-z_]{2,30}$/.test(source) ? {source} : {})}); } catch { return false; }
  return true;
}

// The "Few new jobs" box in groups (owner's approved layout, 7 Oct 2026): the employers meter with the one recommended action, words to add
// as chips, job sources and sites as rows with their own button. Pure: the box draws exactly this.
export const QUIET_SHARE = 0.3;   // under this share of employers with a match, the employer list is running dry: Find new employers
// How long your employers last (src/sources/feeds.py runway): one with nothing for you REST_AFTER searches in a row rests REST_DAYS days.
// Owner, 7 Oct 2026: "how many turns until I exhaust all my employers and am forced to run Find new employers".
export function runwayWords(runway, read) {
  if (!runway || !read) return '';
  const total = Number(read) || 0, resting = Number(runway.resting) || 0;
  const day = until => new Date(until).toLocaleDateString('en-GB', {day: 'numeric', month: 'short'});
  if (resting && resting * 2 >= total) return `${resting} of ${total} employers resting until ${day(runway.until)}: Find jobs again to keep searching`;
  const soon = runway.soon;
  if (!soon?.count) return resting ? `${resting} of ${total} employers resting until ${day(runway.until)}` : '';
  // Said as a condition: nobody rests yet (owner, 7 Oct 2026: "don't imply those employers are already paused").
  return `If the next ${soon.runs === 1 ? 'search finds' : `${soon.runs} searches find`} nothing new for them, ${soon.count} of ${total} employers rest for ${runway.rest_days} days.`
    + ` An employer rests after ${runway.rest_after} searches in a row with nothing for you.`;
}
export function fewJobsGroups(verdict) {
  const actions = coverageActions(verdict);
  const e = verdict?.employers || {};
  let employers = null;
  if (Number.isFinite(e.read) && e.read > 0) {
    const matched = Number(e.matched) || 0, pending = Number(e.pending) || 0;
    const share = matched / e.read;
    const dry = share < QUIET_SHARE;
    employers = {read: e.read, matched, pending, fill: Math.max(2, Math.round(share * 100)), dry,
      advice: dry ? 'Most have nothing new for you' : 'They still bring jobs',
      runway: runwayWords(e.runway, e.read),
      // Ideas the Find new employers task has not tried yet: a job search never touches them (owner, 7 Oct 2026: "why didn't 410 go down?").
      explore: pending > 0 ? `Checks up to ${Number(e.batch) || 40} employer ideas per run · About 3 min` : 'Every idea tried: Find jobs looks for new names'};
  }
  const sources = (Array.isArray(verdict?.sources) ? verdict.sources : []).filter(source => offered(source.id)).map(source => ({id: source.id, name: source.name, sub: source.people || source.effort, title: `${source.effort}: ${source.gain}`}));
  const visits = (Array.isArray(verdict?.visits) ? verdict.visits : []).map(site => ({url: site.url, name: site.name,
    sub: site.kind === 'portal' ? 'your search' : `${site.why}${site.last_read ? ` · read ${site.last_read.slice(0, 10)}` : ''}`, title: site.note || ''}));
  // A company with two pages (Tiffany & Co. on tiffany.com and tiffanycareers.com) is one site to the reader; both pages are still read.
  const siteNames = [...new Set(visits.map(site => site.name))];
  return {employers, words: actions.filter(action => !['source', 'visit'].includes(action.kind)).map(action => ({...action, row: wordRow(action)})), sources, visits, siteNames};
}
// A word action as a row (owner mockup, 7 Oct 2026: "Germany — 30 matching roles" and Review location, not a "+ Germany · 30" chip). Review opens
// that suggestion on Strategy (its row id there), where the change is previewed before it is made.
const n = value => Number(value || 0).toLocaleString('en-US');
export function wordRow(action) {
  const jobs = (count, what) => `${n(count)} ${what}${count === 1 ? '' : 's'}`;
  if (action.kind === 'place') return {glyph: 'pin', title: `Include ${action.value}`, sub: `${jobs(action.count, 'matching role')} outside your selected locations`, button: 'Review location', review: 'places'};
  if (action.kind === 'role') return {glyph: 'search', title: `Add "${action.value}" to your role words`, sub: `${jobs(action.count, 'posting')} in your places your role words miss`, button: 'Review role word', review: 'coverage'};
  const what = action.kind === 'exclude' ? `Stop leaving out titles with "${String(action.value).replace(/\\b/g, '')}"` : `Stop hiding jobs that require ${String(action.value).replace(/^./, letter => letter.toUpperCase())}`;
  return {glyph: 'sliders', title: what, sub: `${jobs(action.count, 'matching job')} hidden by this filter`, button: 'Review filter', review: 'filters'};
}

// Open on a "Browse sites manually" card (owner, 13 Oct 2026: opening a site did not read it): the tracked "Find jobs using your browser" task for that
// one site (its tab, banner, Recent activity row, scoring). A site the task cannot take, or no answer, is opened plain, as before.
export async function readSiteInChrome(pilot, url) {
  const run = await pilot.visitsRun({urls: [url], atOnce: 1, filter: true}).catch(error => ({text: error.message}));
  if (run?.started) return {ok: true, started: true};
  const opened = await pilot.openVisit(url).catch(error => ({ok: false, error: error.message}));
  return {...opened, started: false, why: run?.text || ''};
}

// One action, done: the same calls the Strategy cards make (lib/strategy.js through main.js), or the source's panel in Settings.
export function runAction(action, {pilot, openSetting}) {
  if (action.kind === 'source') { openSetting(action.value); return Promise.resolve({ok: true, opened: true}); }
  if (action.kind === 'visit') return readSiteInChrome(pilot, action.value).then(result => ({...result, opened: !!result?.ok}));
  if (action.kind === 'role') return pilot.addRoles([action.value]);
  if (action.kind === 'place') return pilot.addPlaces([action.value]);
  return pilot.loosenSearch(action.kind === 'exclude' ? {excludes: [action.value]} : {languages: [action.value]});
}
