// Every place the window opens Notion (found by notion-entry-scan.js) and the in-app view a person without Notion sees instead.
// {view: '<renderer file> <function>'}: built (the test checks the function is still there); {pending: '<lane>'}: not built yet (listed by
// the test); {none: '<why>'}: needs no view of its own. Seeded from the Notion-optional parity checklist (P8 groups A–F), 9 Oct 2026.
// A new entry point fails notion-parity.test.js until it has a row here.
const JOB = {view: 'pages/job-panel.js openJobPanel'};
const PREP = {view: 'pages/prep.js openPrep'};
const FUNNEL = {view: 'pages/reports.js funnelTab'};             // Reports → Funnel: the Pipeline table and Where to improve (P8 D)

export const NOTION_PARITY = {
  'pages/calendar.js open': JOB,                                 // a meeting's job: its Notion page, else the job's side panel
  'pages/activity-render.js renderActivity': {none: 'opens the run on GitHub; the run\'s own page is #activity-notion'},
  'index.html#focus-funnel-notion': FUNNEL,                     // the 🎯 Pipeline page: funnel "from previous" / "Of applied"
  'pages/strategy.js init': {view: 'pages/strategy-targets.js renderTargets'},   // ⋯ → View source in Notion: ⚙️ Search settings (or the Profile); its lists and Job preferences are edited on Strategy on every store
  'pages/profile-menu.js profileMenuItems': {view: 'pages/profile.js showContact'},   // the Profile ⋯ menu's View source in Notion; without Notion the Profile itself
  'index.html#store-open': {none: 'Settings → Data: opens the workspace itself, shown only to a Notion user'},
  'index.html#activity-notion': {view: 'pages/activity-panel.js openActivity'},   // a run's row; Result digest, Billed to, Trigger: P8 D
  'index.html#moments-notion': {view: 'pages/interview-practice.js showMoments'},   // the insight's quotes; a name opens the interview
  'index.html#prep-open': PREP,
  'job-link.js jobLinkActions': JOB,
  'pages/activity-mail.js interviewPanel': JOB,
  'pages/activity-mail.js jobPrep': PREP,
  'pages/activity-mail.js jobLink': JOB,
  'pages/activity-run-card.js renderRunCard': {view: 'pages/employers.js loadEmployers'},   // Find employers' card → All employers
  'pages/activity.js init': {view: 'pages/activity-panel.js openActivity'},                             // links inside a run's result: the weekly report in full, an insight
  'pages/focus.js openLink': {none: 'helper: its callers are rows of their own (focusCard)'},
  'pages/focus.js focusCard': JOB,
  'pages/focus.js loadHistory': JOB,                             // the job's History tab
  'pages/focus.js prepAction': PREP,
  'pages/focus.js init': FUNNEL,                                // the funnel link (#focus-funnel-notion)
  'pages/interview-lists.js renderDrafts': {view: 'pages/interviews.js openReview'},   // a saved draft: Transcript and review
  'pages/interview-practice.js showMoments': {view: 'pages/interview-practice.js showMoments'},
  'pages/interviews.js showRow': {view: 'pages/interviews.js openReview'},
  'pages/interviews.js renderSaved': {view: 'pages/interviews.js openReview'},   // its job link: the job panel
  'pages/job-panel.js footer': JOB,                                // the panel itself; "Open in Notion" is the Notion user's extra
  'pages/jobs-talking.js renderTalking': JOB,
  'pages/jobs-render.js renderJobs': JOB,
  'pages/notion-connect.js openInNotion': {none: 'helper: its callers are rows of their own (index.html ids)'},
  'pages/prep.js init': PREP,
  'pages/profile.js renderNotionLinks': {view: 'pages/nav.js openView'},   // each database is a page of the app (Jobs, Interviews, Reports…)
  'pages/rich-text.js messageLink': {none: 'a link Claude wrote in its message; what it points to has its own row'},
};
