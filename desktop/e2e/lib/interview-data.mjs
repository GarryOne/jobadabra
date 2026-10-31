// Dummy data for the Interviews and Calendar suites, written to the test Notion page through its API (no AI call), and the small pure checks the suites
// assert with. Everything here is tested in test/interview-data.test.mjs, including the cases that must fail.
// Job: run the backbone
import {paragraph, richText} from './notion.mjs';

const title = content => ({title: [{text: {content}}]});
const select = name => ({select: {name}});
const date = start => ({date: {start}});

// An Applications ("Job Tracker") row: what the app turns into a job with a Notion page, and a "Next interview" the Calendar shows.
export function trackerProps({role, company, url, stage = 'Interviewing', nextInterview = '', location = 'Zurich, Switzerland'}) {
  return {Job: title(role), Company: richText(company), 'Job URL': {url}, Stage: select(stage), Location: richText(location),
    ...(nextInterview ? {'Next interview': date(nextInterview)} : {})};
}

// A 🎤 Interviews row. `overall` unset = not reviewed yet.
export function interviewProps({name, day, round = '', overall = '', nextStep = '', input = 'Transcript', applicationId = ''}) {
  return {Interview: title(name), Date: date(day), Round: richText(round), Input: select(input), ...(nextStep ? {'Next step': richText(nextStep)} : {}),
    ...(overall ? {Overall: select(overall)} : {}), ...(applicationId ? {Application: {relation: [{id: applicationId}]}} : {})};
}

// The page body the app reads a transcript from: a "Transcript" toggle (src/ai/interviews.py transcript_toggle).
export const transcriptBlocks = text => [{object: 'block', type: 'heading_3', heading_3: {rich_text: [{type: 'text', text: {content: 'Transcript'}}], is_toggleable: true,
  children: [paragraph(text)]}}];

// A short recruiter call in the format the recorder writes ("[hh:mm:ss] Speaker: words"), enough for a real review.
export const TRANSCRIPT = `[00:00:03] Recruiter: Thanks for making time. Tell me why you are looking at the Senior Site Reliability Engineer role at Gamma Freight.
[00:00:12] You: I run production for a payments platform on Kubernetes and AWS, and I want to own reliability for a bigger system. Last year I cut our paging volume by forty percent by moving to SLO based alerts.
[00:00:41] Recruiter: How do you handle an incident where the root cause is unclear?
[00:00:49] You: I start with the user impact, stabilise first by rolling back the last change, then work the timeline from metrics and traces. I keep a written log and run a blameless review within the week.
[00:01:20] Recruiter: What is your experience with Terraform at scale?
[00:01:27] You: Six years. I maintain about two hundred modules, with plan checks in CI and a policy gate, but I have not run a multi cloud estate.
[00:02:02] Recruiter: Good. The next step is a technical interview with the platform lead, probably next week. Salary range is one hundred forty to one hundred sixty thousand francs.`;

// ---- pure checks ----
const day = ms => new Date(ms).toISOString().slice(0, 10);
export const addDays = (isoDay, n) => day(Date.parse(`${isoDay}T12:00:00Z`) + n * 86400000);

// Three days inside the month of `today` (YYYY-MM-DD), in the order a person would expect "this week": the next days when there is room in the month,
// else the days just gone. -> {days: [a, b, c], future: boolean}
export function weekDays(today) {
  const [year, month] = today.split('-').map(Number);
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const dom = Number(today.slice(8));
  return dom + 3 <= last ? {days: [1, 2, 3].map(n => addDays(today, n)), future: true} : {days: [3, 2, 1].map(n => addDays(today, -n)), future: false};
}

/** The calendar's month title for a YYYY-MM-DD day, "November 2026": the one place the suites spell it (calendar.mjs compares the grid's #cal-title with it). */
export const monthTitle = day => new Date(`${day.slice(0, 7)}-01T00:00:00Z`).toLocaleDateString('en-US', {month: 'long', year: 'numeric', timeZone: 'UTC'});
// The month names of that title, January first.
const MONTHS = Array.from({length: 12}, (_, m) => monthTitle(`2000-${String(m + 1).padStart(2, '0')}-01`).split(' ')[0]);
// How many months the calendar title `want` ("November 2026") is after `shown`: > 0 later, < 0 earlier. Why (beta 41220959824, 31 Oct 2026): the suite
// compared titles as text, and "October 2026" < "November 2026" is false, so on a month's last day (Tokyo past it, Honolulu not) it paged back.
// Takes two titles as the calendar shows them ("<Month> <year>"); throws "not a month title" on anything else, so a changed title fails loudly.
export function monthsBetween(shown, want) {
  const index = text => {
    const [name, year] = String(text).trim().split(/\s+/), m = MONTHS.indexOf(name);
    if (m < 0 || !/^\d{4}$/.test(year || '')) throw new Error(`not a month title: "${text}"`);
    return Number(year) * 12 + m;
  };
  return index(want) - index(shown);
}

// Rows are listed newest first (src/ai/interviews.py listing): true when no row is older than the one before it.
export const newestFirst = days => days.every((value, i) => i === 0 || days[i - 1] >= value);

// The hour:minute a chip or row shows, for an instant, in a zone: "08:30" or "1:30 PM" both read as the same clock.
export function clockOf(iso, zone) {
  const [h, m] = new Intl.DateTimeFormat('en-GB', {timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23'}).format(new Date(iso)).split(':').map(Number);
  return {h, m};
}
// Does the text show that clock, in 24 h or 12 h form?
export function showsClock(text, {h, m}) {
  const mm = String(m).padStart(2, '0'), h12 = h % 12 || 12;
  return new RegExp(`(^|\\D)(${String(h).padStart(2, '0')}:${mm}(?!\\s?[AP]M)|0?${h12}:${mm}\\s?${h < 12 ? 'AM' : 'PM'})`, 'i').test(text);
}
