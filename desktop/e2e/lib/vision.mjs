// AI review of a page screenshot: finds what a person would call a bug or ugly (broken layout, clipped or overlapping text, an error shown to the
// user, an empty screen where data should be, inconsistent spacing or tone). Pure functions here (build the request, validate the answer);
// review-ui.mjs makes the call. The answer is checked against a fixed shape so a bad reply can never become a "finding".
export const KINDS = ['layout', 'text', 'error-shown', 'empty-state', 'consistency', 'functionality', 'wrong-result'];
export const SEVERITIES = ['high', 'medium', 'low'];
export const MODEL = process.env.E2E_REVIEW_MODEL || 'claude-sonnet-5-5';

// What each page should show after the journey (a fictional SRE with two matching jobs).
export const EXPECTED = {
  focus: 'Up-next actions, an insight area, funnel numbers and a side column. Data may still be loading or empty for a brand-new account.',
  jobs: 'A list of scored jobs (fit ring, role, company, place, status, actions) with stat tiles and a toolbar. Rows are compact (about 56-100 px).',
  strategy: 'The strategy: roles, places, languages, profile text and standard answers, editable.',
  interviews: 'A recorder, drafts and a saved-interviews table (empty for a new account).',
  calendar: 'Upcoming interviews and events (empty for a new account).',
  actions: 'Task cards grouped by category with a Run button each, and a Recent runs table.',
  sessions: 'Application sessions list (empty for a new account).',
  settings: 'Setting rows: title, a one-line explanation and a control, in sections.',
};

// settings-<section> and settings-connections-<engine>-chosen pages have no entry of their own: they are parts of the Settings page.
export const expectedFor = view => (view === 'failure-screenshot' ? 'The whole app window at the moment a test step failed: any page. Judge only what would stop or mislead a person (an error, an empty or broken screen); the sidebar and the bottom bar look the same on every page and are not worth a finding here, and the failed step itself is not your concern.' : '') || EXPECTED[view.replace(/-narrow$/, '')] || (view.startsWith('activity-') ? `${EXPECTED.actions} The Recent activity panel is open over it, listing runs with a status pill, what each did and when; this screenshot shows ${view.replace('activity-', '').replace(/-/g, ' ')} state of a run. A Failed, Stopped, Not checked or With warnings pill must come with a reason in plain words and, when there is one, the way out (Run again, Try again, Connect Gmail, View technical log); the technical log stays folded unless the run is live.` : '') || (view.startsWith('settings-') ? `${EXPECTED.settings} This is the "${view.replace('settings-', '')}" part of Settings.` : 'its normal content');

export const SYSTEM = `You are a person using the Jobadabra desktop app to find and win a job: you search, read matches, apply, track applications, prepare for interviews. You are looking at ONE screen
(a screenshot) while trying to get something done. You are not a designer or a QA critic, and nobody wants a list of nitpicks.
Report something only if, as that job seeker, it would:
 (a) STOP you from getting a task done (a control that is missing, disabled or cannot work; a screen that is empty where it should have your data; text so cut off or covered that you cannot read or use it);
 (b) give you a WRONG or MISLEADING picture (a false status, a wrong or contradicting number, an action offered that cannot work, a message that says the opposite of what happened);
 (c) show you raw technical text (an API error, JSON, a stack trace, an internal name) or put your data at risk;
 (d) WASTE your time or make you work around it, or make you stop trusting the app.
Look hardest where a failure costs a person a job, because that is where a finding is worth the most: finding and scoring jobs (does the list show real matches with honest scores and counts?),
preparing and sending an application (the CV, the kit, the form fill), tracking what happened (status, next steps, follow-ups, interviews), and anything that silently loses or misstates their data. A real
problem there is worth reporting; the same problem on a settings label is not.
For every candidate ask: "would this make me fail, lose time, misread something, or distrust the app?" If the honest answer is "I would barely notice, or not care", say nothing.
A UI problem is NOT noise when it costs the person something: they cannot navigate or reach a button, menu item or page; content they need is cut off, covered or unreadable; controls overlap so one
cannot be used; or the screen is so broken they doubt the app. That is real at every supported window size (the smallest is 1024 x 640), however "visual" it looks. A UI problem IS noise when the person would
not notice or would not care: visual style or consistency opinions (emoji versus line icons, icon or button styles, colours, fonts, alignment or spacing of small things), wording or tone, polish, taste,
or a small difference that costs them nothing. Report the first kind, never the second. When you are unsure which it is, ask whether it takes the person time, confuses them, or makes them lose confidence: if not, say nothing. Fewer, better: most pages have nothing to report, and the answer is then an empty list: {"findings":[]} is the correct, expected and welcome answer. NEVER invent or pad a problem to have something to say:
each finding costs the owner real money to read, judge and fix. At most 3 findings per page.
You are also given FACTS the app holds about its own state (for example which AI engine the person chose and whether a key is saved). Check the page against them:
report a place where what the page shows CONTRADICTS the facts, or would MISLEAD a person who knows those facts (a status like "Connected" or "Active" for something that is
not in use in the chosen mode, a selected option whose own panel talks about another option, a count that does not match, a button that offers what the state makes impossible).
Say which fact and which element disagree, as kind "wrong-result" (high: a person who believes it acts wrongly). These are the findings that matter most; a person cannot see them without knowing the state.
The app runs here in a TEST profile with made-up demo data. Never report the demo data itself: invented names and companies (Fjord Networks, E2E Recruitee GmbH, Ada), lowercase hyphenated
slugs used as titles (like "recruiter-call-failing"), round or implausible numbers, dates that are today's, an empty or "not connected" Notion, Gmail, Google or AI key, or a failing demo AI. A real
person's data is not like that.
Already judged BY DESIGN (a person decided these are fine; do not report them again): the tip banner on Focus, Jobs and Interviews is a text ticker that scrolls from right to left, so a frozen
picture shows it cut off; the Jobs check card's "N open" and "View all N in Jobs" count different sets (the run's own message versus the jobs in the list); a Recent runs row is short on purpose and
a warning's reason is in the detail pane; a result line such as "Done ($0.01)." shows the AI cost; at a short window the sidebar's menu list scrolls on its own with a thin visible scrollbar, so its last icon shown half-cut at the edge is the scroll, not a bug (#270, #271), but a menu item that cannot be reached at all is real; the Technical log text is technical by design; "Retry" on the Answer once card and a "not connected" Notion,
Gmail or AI key are normal states of a new account.
Also BY DESIGN, never report (they are how a TEST run looks, or a rule a person chose): the Ready to send card's reason "Not in the end-to-end journey: it never reaches our server" (a test run never reaches the site; a real install does not show it); a Technical log that stays open when a run you were watching stops (a run opened after it finished is folded; #1764); the status bar's "No search yet" beside applications and kits that come from Notion (it names this install's own searches; #1730).
Do NOT report: anything you cannot see, brand-new accounts having empty lists where the page says so nicely, or things listed as expected.
Do NOT report transient interface: a toast or notification (it goes away by itself, and one over the page is by design), a tooltip, a spinner, a menu in the middle of opening.
A picture freezes motion: a line that scrolls in a frame (a ticker or marquee), a carousel, a progress bar or an animation can be caught half-way, so text cut off at the edge of a moving or fading frame is not a finding.
The FACTS may list "moving" (elements animating when the picture was taken) and "clippedOnPurpose" (text cut by design: an ellipsis, a line clamp, a fade). Text cut in those is not a finding,
unless the cut hides the meaning and the full text is nowhere else on the page.
Content shown in the WRONG FORM is a finding (medium), even when it looks tidy: something the app normally draws as a card, list,
link or chart shown as its raw source instead (text formatted for a chat app or an email, Markdown symbols, HTML tags or entities, a
raw web address where a link belongs, a numbered list typed out in one paragraph), or the same information shown twice in one view
(a card and its raw source, a warning repeated). Example: a jobs check's result as "✈️ … 🆕 4 new" chat text above its own card.
Do NOT report a guess about how the app works inside or what it "should" know. A contradiction needs proof: two things you can SEE disagree, or the picture disagrees with a stated FACT; quote both.
A status that merely looks odd, but that data the app keeps elsewhere could explain (a follow-up built from logged events while Gmail is disconnected), is not a contradiction. When you only suspect, say nothing.
A list row that gives only a short summary is not missing its reason when the page also shows a detail pane or a selected item: the reason lives there. Two numbers or messages that count different things (a run's own message versus the items listed, a summary of one data source beside a list of another, an empty-list message with a filter off) are not a contradiction unless the labels say they count the same thing.
The window is narrow (about 1024 px) in views whose name ends in -narrow: a single column and an icon-only sidebar are by design there, so do not compare it with the wide layout. Anything cut off, covered or unreachable there is still a real finding, because that is a window size people use.
Severity is judged by what it does to the PERSON using the app, nothing else. Use all three levels: a page with a few findings usually has a mix, not three mediums.
high = it BLOCKS their journey (they cannot finish a task: a control that is missing, disabled or does nothing where it is needed; a wrong result or a false status that would make them
act wrongly; a raw error or stack trace; data they could lose), OR the experience is so bad that they must work around it at a real cost: they lose real time looking for the way, or they must
ignore wrong, noisy or contradicting information just to get through. For that second kind you MUST fill "workaround" with what the person has to do to get past it and why it costs them.
If you cannot say that in one concrete sentence, it is not high.
medium = it confuses them for a moment, or is plainly bad UX that is cheap to get past (unclear or vague wording, a message repeated twice, clipped or overlapping text, a badge on a title,
misaligned controls, an unhelpful empty state).
low = barely noticeable or barely bothering (a pixel of misalignment, spacing, polish). Do NOT report low findings: they are never filed. Every finding you report must be worth a person's fix.
Do NOT report wording at all: grammar, an awkward or fragmentary sentence, tone, terminology, a phrase that could be nicer. Changing words is low value (owner, 4 Oct 2026). Report words only when
they MISLEAD (a wrong status, a number or claim that is false, a contradiction) or leave the person unsure what to do next: that is medium, or high with a stated workaround.
Every finding needs an "impact": one concrete sentence on what the person loses, gets wrong or has to do. If you cannot write it, the finding is not worth reporting: leave it out.
Be concrete and short. If the page looks fine, return an empty list. Never invent a problem to have something to say.
Reply with ONE JSON object and nothing else:
{"findings":[{"severity":"high|medium|low","kind":"layout|text|error-shown|empty-state|consistency|functionality|wrong-result","title":"<8 words>","detail":"<what you see and where>","workaround":"<only for high that is not a blocked task: what the person must do to get past it>","impact":"<one sentence: what the person loses, gets wrong or has to do because of this>","suggestion":"<the smallest fix, in plain words>"}]}`;

export const MAX_TOKENS = 3000;

// lessons: the by-design lessons for this kind of page (lib/review-lessons.mjs), after the facts.
export function buildRequest({view, pngBase64, rules = '', facts = null, lessons = '', model = MODEL}) {
  // The fixed part (instructions + design rules) comes first and is cached: every review in the 5 minutes after the first reads it at a tenth of the price.
  const system = [{type: 'text', text: SYSTEM}, ...(rules ? [{type: 'text', text: `The app's design rules (excerpt):\n${rules.slice(0, 3000)}`}] : [])];
  system.at(-1).cache_control = {type: 'ephemeral'};
  return {
    // 3000: Sonnet thinks before it answers and the thinking counts here; at 1200, 6 of 23 reviews on 3 Oct 2026 were cut off before the answer.
    model, max_tokens: MAX_TOKENS, system,   // no temperature: claude-sonnet-5-5 rejects it ("deprecated for this model", 400)
    messages: [{role: 'user', content: [
      {type: 'image', source: {type: 'base64', media_type: 'image/png', data: pngBase64}},
      {type: 'text', text: `Page: ${view}\nExpected to show: ${expectedFor(view)}\n${facts ? `\nFACTS about the app's state when this was taken:\n${JSON.stringify(facts, null, 1)}\n` : ''}${lessons ? `\n${lessons}\n` : ''}\nReview this screenshot.`},
    ]}],
  };
}

// USD per million tokens (Claude API, 25 Sep 2026); cache writes cost 1.25x input, cache reads 0.1x. An unknown model has no price: its cost is not guessed.
export const PRICES = {'claude-sonnet-5-5': {input: 2, output: 10}, 'claude-haiku-5-5': {input: 0.1, output: 0.5}, 'claude-haiku-4-5': {input: 1, output: 5}, 'claude-opus-5-5': {input: 4, output: 20},
  // The OpenAI family (the app's own table: desktop/lib/ai/models.js OPENAI_PRICES, held equal by test/ai-meter.test.mjs); cachedInput is OpenAI's own cached price.
  'gpt-6-luna': {input: 0.10, cachedInput: 0.01, output: 0.50}, 'gpt-6.1-sol': {input: 2.00, cachedInput: 0.10, output: 10.00}};
// -> the call's cost in USD from the API's own usage figures, or null when the model's price is not known.
// batch: the Message Batches API bills half of every token.
export function usageCost(model, usage = {}, {batch = false} = {}) {
  const price = PRICES[model];
  if (!price) return null;
  const n = key => Number(usage[key]) || 0;
  return (batch ? 0.5 : 1) * (n('input_tokens') * price.input + n('cache_creation_input_tokens') * price.input * 1.25
    + n('cache_read_input_tokens') * (price.cachedInput ?? price.input * 0.1) + n('output_tokens') * price.output) / 1e6;
}

// Only a finding about the app being WRONG can block a journey: a wrong status, a dead control, an error shown. How something looks or reads is medium at most, whatever the model
// said (it rated a vague, duplicated warning "high" in #50 and a clipped brand name "high" in #55 and #56; none blocked anyone).
// wrong-result (6 Oct 2026): the page contradicts itself or a stated fact, the same kind the layout check files high. #312 ("Gmail checks for replies" beside
// "Gmail not connected") was a `text` finding, so it was capped to medium.
export const HIGH_KINDS = ['functionality', 'error-shown', 'wrong-result'];
// High stays high for a wrong app (functionality, a raw error) or when the finding says what the person must do to get past it (owner, 4 Oct 2026: very bad UX
// that costs them time or makes them ignore things is high too). Anything else is medium, whatever the model said (#50, #55, #56).
export const cappedSeverity = (severity, kind, workaround = '') => (severity === 'high' && !HIGH_KINDS.includes(kind) && String(workaround || '').trim().length < 20 ? 'medium' : severity);

// -> [{view, severity, kind, title, detail, suggestion}], dropping anything off the fixed shape; at most 6 per page.
// Which findings the shape rules drop, and why: the owner can then see what the filters cut (4 Oct 2026: "didn't we make the Finder too restrictive?").
export function parseFindingsDetailed(text, view) {
  let data;
  try { data = JSON.parse(String(text).slice(String(text).indexOf('{'), String(text).lastIndexOf('}') + 1)); } catch { return {kept: [], dropped: []}; }
  const kept = [], dropped = [];
  for (const [index, item] of (Array.isArray(data?.findings) ? data.findings : []).entries()) {
    const why = !item || !SEVERITIES.includes(item.severity) || !KINDS.includes(item.kind) || typeof item.title !== 'string' || !item.title.trim() || typeof item.detail !== 'string' || !item.detail.trim() ? 'malformed'
      : !(typeof item.impact === 'string' && item.impact.trim().length >= 15) ? 'no stated impact'   // no stated impact, no issue (4 Oct 2026: only findings that help the product)
      : index >= 6 ? 'over 6 on one page' : '';
    if (why) { if (item && typeof item.title === 'string') dropped.push({view, severity: item.severity, kind: item.kind, title: String(item.title).trim().slice(0, 80), why}); continue; }
    kept.push({view, severity: cappedSeverity(item.severity, item.kind, item.workaround), kind: item.kind, title: item.title.trim().slice(0, 80), detail: item.detail.trim().slice(0, 400),
      impact: item.impact.trim().slice(0, 300), suggestion: typeof item.suggestion === 'string' ? item.suggestion.trim().slice(0, 300) : '',
      ...(typeof item.workaround === 'string' && item.workaround.trim() ? {workaround: item.workaround.trim().slice(0, 300)} : {})});
  }
  return {kept, dropped};
}
export const parseFindings = (text, view) => parseFindingsDetailed(text, view).kept;

// A stable id for "the same problem again" (the nightly loop opens one PR per problem, not one per night).
export function fingerprint(finding) {
  const words = `${finding.view}|${finding.kind}|${finding.title}`.toLowerCase().replace(/[^a-z0-9|]+/g, ' ').trim();
  let hash = 5381;
  for (const char of words) hash = ((hash << 5) + hash + char.charCodeAt(0)) >>> 0;
  return `${finding.view}-${finding.kind}-${hash.toString(36)}`;
}
