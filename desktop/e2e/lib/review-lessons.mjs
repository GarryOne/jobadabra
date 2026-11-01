// The screenshot review's by-design lessons, learned from the issues themselves (owner, 26 Oct 2026: the 11 "by design" false alarms become lessons):
// every AI-review issue a person closed as resolution:by-design becomes one line in the next review of the same kind of page (its view, the finding's title,
// and the verdict's "Why"), so the reviewer stops raising it in other words. The hand-written BY DESIGN list in lib/vision.mjs SYSTEM stays; this adds
// to it without anyone editing a prompt. Read from GitHub at review time (GITHUB_TOKEN, issues: read); none readable: the review runs without them.
// Guarded by test/review-lessons.test.mjs.
export const LESSON_LABELS = ['source:ai-review', 'resolution:by-design'];
const MAX_LESSONS = 12;

// `Page \`<view>\`` in the issue body (lib/ui-issue body); the title without its "[auto-ui] <view>: " prefix; the last verdict's "Why" section.
export function lessonFromIssue(issue, comments = []) {
  const view = String(issue.body || '').match(/Page `([^`]+)`/)?.[1];
  if (!view) return null;
  const title = String(issue.title || '').replace(/^\[auto-ui\]\s*[^:]*:\s*/, '').trim().slice(0, 120);
  let why = '';
  for (const comment of comments) {
    const said = String(comment.body || '').match(/###[^\n]*\bWhy\b[^\n]*\n+([\s\S]*?)(?=\n###|\n<sub>|$)/);
    if (said) why = said[1].replace(/\s+/g, ' ').trim();
  }
  return {issue: issue.number, view, title, why: why.slice(0, 280)};
}

// The kind of page: activity-run-failed and activity-limit-paused are both the Recent activity panel; -narrow is the same page in a small window.
const family = view => String(view).replace(/-narrow$/, '').split('-')[0];

// -> the lessons for this page: its own kind (a failure screenshot can be any page: all of them), newest first, without `exclude` (an eval leaves the issue it scores out).
export function lessonsFor(lessons, view, {exclude = null} = {}) {
  return lessons.filter(lesson => lesson && lesson.issue !== exclude && (view === 'failure-screenshot' || family(lesson.view) === family(view)))
    .sort((a, b) => b.issue - a.issue).slice(0, MAX_LESSONS);
}

export function lessonsText(list) {
  if (!list.length) return '';
  return `Already judged BY DESIGN on this kind of page by a person (do not report these again, nor the same thing in other words):\n${
    list.map(lesson => `- #${lesson.issue} (${lesson.view}) "${lesson.title}"${lesson.why ? `: ${lesson.why}` : ''}`).join('\n')}`;
}

// -> lessons from the closed by-design AI-review issues of `repo`; [] (and why, on the log) when GitHub cannot be read.
export async function fetchLessons({repo = process.env.GITHUB_REPOSITORY, token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN, fetchImpl = fetch, log = console.log} = {}) {
  if (!repo) return [];
  const headers = {accept: 'application/vnd.github+json', ...(token ? {authorization: `Bearer ${token}`} : {})};
  const get = async url => {
    const response = await fetchImpl(url, {headers, signal: AbortSignal.timeout(20000)});
    if (!response.ok) throw new Error(`${response.status} on ${new URL(url).pathname}`);
    return response.json();
  };
  try {
    const issues = await get(`https://api.github.com/repos/${repo}/issues?state=closed&labels=${encodeURIComponent(LESSON_LABELS.join(','))}&per_page=100`);
    const lessons = [];
    for (const issue of issues.filter(item => !item.pull_request)) lessons.push(lessonFromIssue(issue, await get(`https://api.github.com/repos/${repo}/issues/${issue.number}/comments?per_page=100`)));
    return lessons.filter(Boolean);
  } catch (error) {
    log(`::warning::by-design lessons not read (${error.message}): the review runs with the hand-written list only`);
    return [];
  }
}
