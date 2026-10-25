// Employers & Sources, without a window (pages/employers.js draws it): the filter, a feed status's tone, the stats line, an employer's
// research links and detail lines. Field names: src/stores/base.py EMPLOYER_FIELDS. Guarded by test/employers-view.test.js.
import {shortDay} from './date.js';

// Feed status (the 🏢 Employers & Sources select) → tone: found good, nothing open info, weak warn, watched by hand bad, no feed neutral.
export const FEED_TONES = {'Feed found': 'good', 'No open jobs': 'info', 'Low relevance': 'warn', 'Manual watch': 'bad', 'No public feed': 'neutral'};
export const feedTone = status => FEED_TONES[status] || 'neutral';

// What each status means and what happens next (the scout's check: src/scout.py check_one, src/scout_notion.py employer_record).
export const FEED_HELP = {
  'Feed found': 'We read its job list and some jobs are in your places. It starts Active: every search reads it.',
  'Low relevance': 'We read its job list, but none of its jobs are in your places. It starts paused; checked again in 3 weeks. Switch it on to read it anyway.',
  'No open jobs': 'Its careers page or job list had no postings when we looked. It starts paused; checked again every week.',
  'Manual watch': 'Listed with a careers page, but no job list a program can read. You watch it by hand: searches skip it.',
  'No public feed': 'We found no job list a program can read. It is not searched; checked again in 3 months.',
};
export const feedHelp = status => FEED_HELP[status] || '';

// Quality column: the scale and what it adds up (src/scout_probe.py quality). A row's own counts follow in its notes.
export const QUALITY_HELP = 'How well its jobs fit your search, 0 to 100. Up to 20 for jobs matching your roles, 40 for jobs in your places, 10 each for a match in your top places, '
  + 'overlap with your CV’s skills, postings under 90 days old and a published salary. 60 or more is a good fit; under 30 means little in your places. – means no job list was read.';
export const qualityHelp = row => [`Quality ${row.quality} of 100.`, row.notes].filter(Boolean).join(' ');

const words = row => [row.name, row.website, row.cities, row.relevant_roles, row.ats, row.slug, row.notes, row.origin, row.kind, row.size]
  .filter(Boolean).join(' ').toLowerCase();

// {text, kind, feed, active: '' | 'on' | 'off'}
export function filterEmployers(rows, {text = '', kind = '', feed = '', active = ''} = {}) {
  const needle = text.trim().toLowerCase();
  return (rows || []).filter(row => (!needle || words(row).includes(needle)) && (!kind || (row.kind || 'Employer') === kind)
    && (!feed || row.feed_status === feed) && (!active || !!row.active === (active === 'on')));
}

// The feed statuses present, in the select's order, then any other value the store holds.
export function feedStatuses(rows) {
  const present = new Set((rows || []).map(row => row.feed_status).filter(Boolean));
  return [...Object.keys(FEED_TONES).filter(status => present.has(status)), ...[...present].filter(status => !(status in FEED_TONES)).sort()];
}

export function statsLine(rows, shown = rows) {
  const all = rows || [], active = all.filter(row => row.active).length, boards = all.filter(row => row.kind === 'Job board').length;
  const feeds = all.filter(row => row.feed_status === 'Feed found').length;
  const head = `${all.length} tracked · ${active} active · ${feeds} feed found${boards ? ` · ${boards} job board${boards === 1 ? '' : 's'}` : ''}`;
  return shown.length === all.length ? head : `${shown.length} of ${head}`;
}

// The job system and its board name ("greenhouse · acme"), or the feed's host, or ''.
export function feedName(row) {
  if (row.ats) return [row.ats, row.slug].filter(Boolean).join(' · ');
  try { return row.feed ? new URL(row.feed).hostname : ''; } catch { return ''; }
}

// Links to open: [label, url]; only http(s).
export function researchLinks(row) {
  return [['Website', row.website], ['Careers', row.careers_url], ['Feed', row.feed], ['Glassdoor', row.glassdoor], ['levels.fyi', row.levels_fyi]]
    .filter(([, url]) => /^https?:\/\//i.test(String(url || '')));
}

// The muted line under the name: cities, size, relevant roles.
export const metaLine = row => [row.cities, row.size && `${row.size} people`, row.relevant_roles].filter(Boolean).join(' · ');

// The rest of the record, for the row's detail: [label, value] with a value only.
export function detailLines(row) {
  const yes = value => (value === true ? 'yes' : value === false ? 'no' : value);
  return [['Notes', row.notes], ['Integration', row.integration], ['Verification', row.verification],
    ['In your preferred places', yes(row.in_preferred_places)], ['Added', day(row.added || row.created_at)]]
    .filter(([, value]) => value !== undefined && value !== null && value !== '');
}

// The table's sortable columns (renderer/table-sort.js). Feed status sorts in the select's order (found first); blanks go last.
export const SORT_COLUMNS = [
  {key: 'name', label: 'Employer', type: 'words', value: row => row.name},
  {key: 'kind', label: 'Kind', type: 'words', value: row => row.kind || 'Employer'},
  {key: 'feed', label: 'Feed', type: 'number', value: row => (row.feed_status ? -(Object.keys(FEED_TONES).indexOf(row.feed_status) + 1 || Object.keys(FEED_TONES).length + 1) : null)},
  {key: 'quality', label: 'Quality', type: 'number', tip: QUALITY_HELP, value: row => (row.quality === '' ? null : row.quality)},
  {key: 'origin', label: 'Origin', type: 'words', value: row => row.origin},
  {key: 'checked', label: 'Checked', type: 'date', value: row => (row.checked ? Date.parse(row.checked) || null : null)},
  {key: 'active', label: 'Active', type: 'flag', value: row => (row.active ? 1 : 0)},
];

// The date a row was checked, in the screens' one format (date.js).
export const day = (iso, now = Date.now()) => shortDay(iso, now);
