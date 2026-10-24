// The Jobs page's derived bits, kept free of the DOM so the tests can check them.
import {isInbound} from './origin.js';
import {READY_LABEL} from './pages/ready-rows.js';

// Skills, tools, licences or topics under a role: what the AI read from the posting (src/ai/enrich.py `technologies`, in the posting's language), for any trade.
export function tags(job, max = 4) {
  const skills = (Array.isArray(job.skills) ? job.skills : []).map(skill => String(skill).trim()).filter(Boolean);
  return [...new Set(skills)].slice(0, max);
}

const WEEK = 7 * 24 * 3600 * 1000;
// The four counters above the list.
export function stats(jobs, total, now = Date.now()) {
  return {
    total: total ?? jobs.length,
    high: jobs.filter(job => job.fit >= 70).length,
    week: jobs.filter(job => now - Date.parse(job.first_seen_at) <= WEEK).length,
    companies: new Set(jobs.map(job => (job.company || '').trim().toLowerCase()).filter(Boolean)).size,
  };
}

// Every job count on the Jobs page (the counters, the menu badge's siblings, the Find jobs card) comes from here, so two numbers for the same
// thing cannot appear (18 Oct 2026: a search said "206 Listed" over "351 Total matches"). `data` is what desktop_jobs.jobs() returns: the loaded
// rows (a cut list: 200 + every application) and the whole-store figures. Matches = job matches (no applications, no inbound), loaded or not.
export function jobCounts(data, now = Date.now()) {
  const loaded = data?.jobs || [], matched = openMatches(loaded);
  const beyond = data?.total == null ? 0 : Math.max(0, data.total - loaded.length);   // matches the cut list did not load
  const count = stats(matched, matched.length + beyond, now);
  count.week += data?.week_beyond || 0;
  count.high += data?.high_beyond || 0;
  return {...count, scored: matched.filter(job => job.fit != null).length + (data?.scored_beyond || 0)};
}

// Applications right now, by their Notion Stage, with the same stage sets as the Focus funnel (src/notion/funnel.py):
// sent = an outcome stage (not "Applying", a form still being filled); ended = rejected, withdrawn, no answer;
// in process = screening (Screening, Interview scheduled: often a screening call) or interviews (Interviewing, Offer).
// The funnel counts what each application ever reached; these count where it stands now.
export const SENT = new Set(['Applied', 'Confirmation received', 'Screening', 'Interview scheduled', 'Interviewing', 'Offer',
  'Rejected', 'Withdrawn', 'No response']);
export const ENDED = new Set(['Rejected', 'Withdrawn', 'No response']);
export const SCREENING = new Set(['Screening', 'Interview scheduled']);
export const INTERVIEWS = new Set(['Interviewing', 'Offer']);
const TALKING = new Set([...SCREENING, ...INTERVIEWS]);
// Sent = waiting + in process + closed: the boxes add up, except for opportunities that found you (inbound,
// renderer/origin.js): they count in Waiting / In process / Closed (real workload) but as Applied only once you applied
// (an Applied on date), not because a recruiter's pitch reached Screening.
const WAITING = new Set(['Applied', 'Confirmation received']);
const APPLICATION = {
  applied: job => SENT.has(job.stage) && (!isInbound(job) || !!job.applied_on),
  waiting: job => WAITING.has(job.stage),
  interviews: job => TALKING.has(job.stage),
  closed: job => ENDED.has(job.stage),  // rejected, withdrawn, or no answer
};
// The "In process" box's hover: how many are screening and how many interviewing.
export const inProcess = jobs => ({screening: jobs.filter(job => SCREENING.has(job.stage)).length,
  interviews: jobs.filter(job => INTERVIEWS.has(job.stage)).length});
// Opportunities that found you are not job matches: every match list leaves them out (Inbound is the list for them;
// the application counters above and a pasted link still reach them), and the active ones are "In conversation" above.
const OVER = new Set([...ENDED, 'Dismissed', 'Closed']);
export const matchesOnly = jobs => jobs.filter(job => !isInbound(job));
// The matches still to decide on: an applied job is an application (the Applied counters and menu list it), so Total
// matches, High fit, New this week, Companies and All matches leave it out.
export const openMatches = jobs => matchesOnly(jobs).filter(job => job.status !== 'applied');
// The list's "Show" menu: New matches (value open), Saved, Applied, Dismissed = job matches with that status; All
// matches (value all) = every job match, whatever its status; Inbound = every opportunity that found you, whatever
// its stage (they are not matches, so no match list shows them); Everything (value everything) = the two sets together,
// the only list that holds both kinds.
export function inStatus(job, filter) {
  if (filter === 'all' || filter === 'everything') return true;
  if (filter === 'inbound') return isInbound(job);
  return job.status === (filter === 'open' ? 'unreviewed' : filter);
}
export const inboundCount = jobs => jobs.filter(isInbound).length;
// A counter clicked above the list: the list it filters to (stat) and the menu's value. Inbound is the menu's own
// Inbound list; the active counter again, or Total matches, shows every match.
export function statClick(kind, active, filter) {
  if (kind === 'inbound') return {stat: null, filter: !active && filter === 'inbound' ? 'all' : 'inbound'};
  return {stat: kind === 'total' || kind === active ? null : kind, filter: 'all'};
}
export const statPressed = (kind, active, filter) => kind === active || (!active && kind === {all: 'total', inbound: 'inbound'}[filter]);
export const byFilter = (jobs, filter) => (filter === 'inbound' || filter === 'everything' ? jobs : filter === 'all' ? openMatches(jobs) : matchesOnly(jobs))
  .filter(job => inStatus(job, filter));
// The list as it opens (the menu's "New matches"): the jobs waiting for a first look. The Jobs menu item carries this
// count — the same number the list bar shows under the page title, whatever the list is later filtered to.
export const toReview = jobs => byFilter(jobs, 'open').length;
// In conversation: a person is talking to you about it. Every open inbound opportunity (a recruiter's pitch included),
// and the jobs you applied to that reached a screening or interviews.
export const inConversation = jobs => jobs.filter(job => isInbound(job) ? !OVER.has(job.stage) : TALKING.has(job.stage))
  .sort((a, b) => (b.next_step ? 1 : 0) - (a.next_step ? 1 : 0) || String(a.company).localeCompare(String(b.company)));
// The In conversation bar: folded it is one line ("2 in conversation"), open it names the section and splits inbound / outbound.
// It starts folded (the job list comes up higher); only a saved "open" choice unfolds it.
export const talkingStartsOpen = stored => stored === '1';
export function talkingBar(talking, open) {
  const found = talking.filter(isInbound).length;
  return open ? {title: 'In conversation', detail: `${talking.length} active · ${found} inbound · ${talking.length - found} outbound`}
    : {title: `${talking.length} in conversation`, detail: ''};
}
// A job's status pill: its own status, except that an application shows where it stands in Notion (its Stage),
// e.g. Rejected rather than Applied.
const STATUS = {unreviewed: ['New', 'info'], saved: ['Saved', 'signal'], applied: ['Applied', 'good'], dismissed: ['Dismissed', 'neutral']};
const STAGE_TONE = {Rejected: 'bad', Withdrawn: 'neutral', 'No response': 'neutral', Offer: 'good'};
export function statusPill(job) {
  if (job.ready && job.status !== 'applied') return {label: READY_LABEL, tone: 'good'};   // filled on the server, waiting for your Submit (pages/jobs-ready.js)
  if (job.stage === 'Rejected' && ['Asked for feedback', 'Received feedback'].includes(job.feedback_status)) {
    return {label: `Rejected · ${job.feedback_status}`, tone: job.feedback_status === 'Received feedback' ? 'info' : 'warn'};
  }
  if (job.stage === 'Recruiter lead') return {label: 'Recruiter lead', tone: 'signal'};
  if (job.status === 'applied' && job.stage && job.stage !== 'Applied') {
    return {label: job.stage, tone: STAGE_TONE[job.stage] || (TALKING.has(job.stage) ? 'info' : 'good')};
  }
  const [label, tone] = STATUS[job.status] || [job.status, 'neutral'];
  return {label, tone};
}
// The application counters: applied (sent) in total, then where they stand: waiting for a reply, in process, closed.
// A job still "Applying" is not sent; it is a session in progress (or one to settle: isStuck).
export function applicationStats(jobs) {
  return Object.fromEntries(Object.entries(APPLICATION).map(([kind, test]) => [kind, jobs.filter(test).length]));
}

// Clicking a counter shows the jobs it counts: high fit, new this week, or one job per company (its best fit).
export function byStat(jobs, kind, now = Date.now()) {
  if (APPLICATION[kind]) return jobs.filter(APPLICATION[kind]);
  if (kind === 'high') return jobs.filter(job => job.fit >= 70);
  if (kind === 'week') return jobs.filter(job => now - Date.parse(job.first_seen_at) <= WEEK);
  if (kind === 'companies') {
    const best = new Map();
    for (const job of jobs) {
      const key = (job.company || '').trim().toLowerCase();
      if (key && (!best.has(key) || (job.fit ?? -1) > (best.get(key).fit ?? -1))) best.set(key, job);
    }
    const keep = new Set(best.values());
    return jobs.filter(job => keep.has(job));
  }
  return jobs;
}

// The list order: best match (as the engine ranked it), newest first, by company, or the latest activity first (the
// Inbound list: tracked or applied most recently).
const lastActivity = job => Math.max(Date.parse(job.first_seen_at) || 0, Date.parse(job.applied_on) || 0);
export function sorted(jobs, by) {
  const list = [...jobs];
  if (by === 'activity') list.sort((a, b) => lastActivity(b) - lastActivity(a));
  if (by === 'newest') list.sort((a, b) => (Date.parse(b.first_seen_at) || 0) - (Date.parse(a.first_seen_at) || 0));
  if (by === 'company') list.sort((a, b) => (a.company || '').localeCompare(b.company || ''));
  return list;
}

// A company's badge: its initials on a colour picked from its name, the same every time.
const HUES = [14, 200, 262, 152, 330, 38, 180, 4, 222, 96];
export function avatar(company) {
  const words = String(company || '?').replace(/[^\p{L}\p{N} ]/gu, ' ').trim().split(/\s+/);
  const initials = (words.length > 1 ? words[0][0] + words[1][0] : (words[0] || '?').slice(0, 2)).toUpperCase();
  let hash = 0;
  for (const ch of String(company || '')) hash = (hash * 31 + ch.codePointAt(0)) >>> 0;
  return {initials, hue: HUES[hash % HUES.length]};
}

// The work-mode chip: one word for the mode the source names ("Remote (stated)" reads Remote), else its own wording.
const MODES = [['remote', 'Remote', /remote/i], ['hybrid', 'Hybrid', /hybrid/i], ['onsite', 'On-site', /on.?site/i]];
export function workMode(text) {
  const [kind, label] = MODES.find(([, , pattern]) => pattern.test(text || '')) || ['', String(text || '')];
  return {kind, label};
}

// The Notion page of an Applications row (its id, as the Interviews list gives it).
export const notionPageUrl = id => (id ? `https://www.notion.so/${String(id).replace(/-/g, '')}` : '');

// What the Job cell of an Interviews row shows and can do: the job in the list (opens in Jobs), a job that is
// only linked in Notion (opens in Notion), or none ("Link a job").
// An interview's application id → its job in the list: by the store's id (page_id: every store; on SQLite it is the only one) or by the
// Notion page in its URL. Pure, so a SQLite-shaped list is tested (test/jobs-view-interview.test.js).
const plainId = id => String(id || '').replace(/-/g, '');
export const jobOfApplication = (jobs, pageId) => (!pageId ? undefined : (jobs || []).find(job => (job.page_id && plainId(job.page_id) === plainId(pageId))
  || (job.notion_url && plainId(job.notion_url).includes(plainId(pageId)))));

// links: the store has pages to open (Notion). Without, a linked job not in the list is said plainly and has no page link.
export function interviewJob(row, job, {links = true, linked = 'Linked in Notion', elsewhere = 'Linked to a job'} = {}) {   // about Notion
  const page = row.application?.[0] || '';
  if (job) return {kind: 'job', name: job.company || job.title, role: job.company ? job.title : '', notion: job.notion_url || (links ? notionPageUrl(page) : '')};
  if (page) return {kind: links ? 'notion' : 'none', name: links ? linked : elsewhere, role: '', notion: links ? notionPageUrl(page) : ''};
  return {kind: 'none', name: 'No job linked', role: '', notion: ''};
}

// Place and mode on one line, without saying the mode twice ("Remote (Europe)" + Remote reads "Remote (Europe)").
export function placeAndMode(location, mode) {
  const {kind, label} = workMode(mode);
  const said = kind && MODES.find(([k]) => k === kind)[2].test(location || '');
  return [shortPlace(location).text, mode && !said ? label : ''].filter(Boolean).join(' · ');
}

// A posting may list a dozen countries ("Remote - European Union; Spain; Italy; …"): the row shows the first two and a count, and all of
// them on hover (`full`, empty when nothing was cut).
export function shortPlace(location, max = 2) {
  const parts = String(location || '').split(/\s*;\s*/).filter(Boolean);
  if (parts.length <= max) return {text: parts.join('; '), full: ''};
  return {text: `${parts.slice(0, max).join('; ')} +${parts.length - max}`, full: parts.join('; ')};
}

// Fit ring colour band.
export const band = fit => (fit == null ? 'none' : fit >= 70 ? 'high' : fit >= 50 ? 'mid' : 'low');

// Under the ring in the compact list.
export const matchLabel = fit => (fit == null ? 'Not scored' : fit >= 70 ? 'Strong match' : fit >= 50 ? 'Good match' : 'Weak match');

// The fit score's bands, a few words each: the same bands the scoring prompt states (src/ai/score.py; Notion "Fit score - the scoring
// rubric"). Shown as the tooltip of every place a fit score is drawn (the Jobs ring, a run card's score), with this job's own band first.
export const FIT_BANDS = [[85, 'Everything matches'], [70, 'Small gaps only'], [50, 'Partial fit'], [30, 'Mostly another role'], [0, 'Unrelated']];
export function fitTooltip(fit, extra = '') {
  const bands = FIT_BANDS.map(([from], i) => `${from}–${i ? FIT_BANDS[i - 1][0] - 1 : 100}  ${FIT_BANDS[i][1]}`);
  const head = fit == null ? 'Not scored yet' : `Fit ${fit}: ${matchLabel(fit)}`;
  return [head, ...bands, ...(extra ? ['', extra] : [])].join('\n');
}

// Why a job has no score, for the ring's tooltip and the row's badge. place_unclear (src/desktop_jobs.py): its location is only a country and its
// posting could not be read, so no refresh can place or score it; it is listed for you to check, never hidden or closed (#323, 12 Oct 2026).
export const PLACE_UNCLEAR = 'Place unclear';
export function unscoredWhy(job) {
  if (job.fit != null) return '';
  return job.place_unclear ? 'Not scored: its place is unclear (the location names only a country) and the posting could not be read. Open it to check where the job is.'
    : 'Not scored yet: no description to read, or excluded by your filters';
}

// When a job was first seen: "just now", "5h ago", "3d ago", "2w ago".
export function ago(iso, now = Date.now()) {
  const ms = now - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) return '';
  const hours = Math.floor(ms / 3600000);
  if (hours < 1) return 'just now';
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days < 14 ? `${days}d ago` : `${Math.floor(days / 7)}w ago`;
}

// "Applying" that no open session explains: the session was closed without saying whether it was submitted.
export const isStuck = (job, hasSession) => job.stage === 'Applying' && !hasSession(job);

// Which jobs are having their kit drafted, by job code. The list re-renders whenever anything changes (a Skip, a Save, a
// reload), so "Preparing" can't live on the button: a rebuilt row asks here. 'local' = running on this Mac, 'cloud' = on
// GitHub (until the reloaded list shows the kit), 'failed' = the last try failed (the row offers Retry).
export const preparing = new Map();
export const prepareState = (job, tracker = preparing) => {
  if (job.kit) { tracker.delete(job.code); return ''; }
  return tracker.get(job.code) || '';
};
// Jobs you saved or drafted a kit for that a refresh found Closed: their posting was taken down (the daily check, or a
// batch Apply that found it gone). Said in a pop-up, so a job you were looking at doesn't vanish without a word.
export function takenDown(before, after) {
  const was = new Map((before || []).filter(job => ['Saved', 'Kit ready'].includes(job.stage)).map(job => [job.url, job]));
  return (after || []).filter(job => job.stage === 'Closed' && was.has(job.url));
}
