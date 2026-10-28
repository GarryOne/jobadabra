// The app's side of the extension server: what main.js plugs in (notifier, window signal, and one handler per extension message), kept as
// live bindings so the routes in server.js and the helpers in server-env.js always call the current one. Setters keep their names (re-exported
// by server.js). Guarded by desktop/test/local-server.test.js, extension-cors.test.js and targets.test.js.

// Desktop notifications for what happens in Chrome (set by main.js): the fill starting and finishing,
// and the application being marked Applied.
export let notify = () => {};
export const setNotifier = fn => { notify = fn; };
export let tellWindow = () => {};   // (channel, payload) -> the open window
export const setWindowSignal = fn => { tellWindow = fn; };
export const jobName = job => job ? `${job.title} · ${job.company}` : 'this job';
export let tabsHandler = () => {};
export let appliedHook = () => {};   // the app counts an application the extension saw submitted (lib/analytics.js)
export function setAppliedHook(fn) { appliedHook = fn; }
export let renderer = null;
export function setRenderer(fn) { renderer = fn; }   // (url) -> {status, html} | {error}: lib/page-render.js, bound in main.js
export function setTabsHandler(fn) { tabsHandler = fn; }  // ({ids, boot, reading}) -> read tabs to hand back: which Chrome tabs exist (lib/review.js binds sessions to them)

// In-app Claude sessions (terminals.js) report their state here: the Claude Code hooks (JSON on stdin, with a
// "message" for Notification) and tools/notify.sh (form field "message"). Local programs only, as for tickets.
export let sharedLogger = null;   // lib/shared-log.js: a copy of what is sent to the service, for Settings → "See what's sent"
export function setSharedLogger(fn) { sharedLogger = fn; }
export let answerReporter = () => {};   // each AI answer call's counts -> lib/recipes.js reporter.answer (set in ext-server-handlers.js)
export function setAnswerReporter(fn) { answerReporter = fn; }
export let proposalReporter = () => {};
export function setProposalReporter(fn) { proposalReporter = fn; }
export let sessionReporter = () => {};
export function setSessionReporter(fn) { sessionReporter = fn; }
// The application form page (extension/review.js) and its session: what is left in the form, what to show (lib/review.js).
export let reviewHandler = () => ({matched: null, watch: [], commands: []});
export let sitePasswordHandler = () => ({ok: false});
export let accountCodeHandler = async () => ({ok: false});
export function setAccountCodeHandler(fn) { accountCodeHandler = fn; }   // ({host, needs, session, job, url}) → {ok, code}: the email code, to the extension only (never logged)
export function setSitePasswordHandler(fn) { sitePasswordHandler = fn; }   // ({host}) → {ok, password}: the extension fills a sign-in/sign-up page (lib/credentials.js)
export function setReviewHandler(fn) { reviewHandler = fn; }
export let learnedHandler = () => {};
export function setLearnedHandler(fn) { learnedHandler = fn; }
export let visitHandler = async () => ({ok: false});   // a page the person opened and asked the extension to read (lib/visits.js)
export function setVisitHandler(fn) { visitHandler = fn; }
export let visitMore = {};   // '/extension/visit-understand', '/extension/visit-recipe': (payload) => answer (lib/visits.js)
export function setVisitRoute(route, fn) { visitMore[route] = fn; }
export let visitFilters = async () => ({ok: false});   // which filters to set on a page, for this search (lib/visits.js filters)
export function setVisitFilters(fn) { visitFilters = fn; }
export let missesHandler = () => {};
export function setMissesHandler(fn) { missesHandler = fn; }
export let controlsHandler = () => {};
export function setControlsHandler(fn) { controlsHandler = fn; }
export let aliasesHandler = async () => [];
export function setAliasesHandler(fn) { aliasesHandler = fn; }  // label meanings for the form in front of the extension (lib/aliases.js)
export let recipesHandler = async () => ({});
export function setRecipesHandler(fn) { recipesHandler = fn; }  // recipes for the fingerprints on a form (lib/recipes.js)  // how the generic operators fared (lib/control-events.js)  // controls the form model could not read (lib/misses.js)  // what you answered yourself in a form (lib/learned.js)
// Review in form, when the panel is not on the tab yet: which open tabs to inject into, and whether the field was there.
export let joinHandler = () => [];
export function setJoinHandler(fn) { joinHandler = fn; }
export let focusHandler = () => ({ok: false});
export function setFocusHandler(fn) { focusHandler = fn; }
// The panel's "Open in Jobadabra": the app comes forward on that session's page.
export let pageHandler = () => {};  // the extension says what a session's page is now (extension/page-mark.js): the card follows it at once, panel or not
export function setPageHandler(fn) { pageHandler = fn; }
export let accountPressedHandler = () => {};  // the extension pressed an account page's button (sign-up): the app records it and waits for the confirmation mail
export function setAccountPressedHandler(fn) { accountPressedHandler = fn; }
export let stuckHandler = () => {};  // the extension can't get to a form (no form / needs an account): the app's session offers Apply with Claude
export function setStuckHandler(fn) { stuckHandler = fn; }
// The person's Stop in the app: the request's id rides on every answer to the extension's reports (review, tabs) until the extension says it stopped; the app then marks the sessions (lib/stop-all.js).
let stopId = '', stopAt = 0;
export const STOP_ASK_MS = 2 * 60 * 1000;   // asked for two minutes: an extension that was not running then must not stop a fill the person starts later
export function requestStop() { stopId = `stop-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`; stopAt = Date.now(); return stopId; }
export const stopAsked = () => (stopId && Date.now() - stopAt < STOP_ASK_MS ? stopId : '');
export function stopHeard() { stopId = ''; }
export let stoppedHandler = () => {};   // the extension stopped (its Stop, the app's, Chrome's Cancel on the debugging bar): set by ext-server-handlers.js
export function setStoppedHandler(fn) { stoppedHandler = fn; }
export let startedHandler = () => {};   // the person started the extension again on a tab (its Fill, Check form again, the popup's Apply on this page): set by ext-server-handlers.js
export function setStartedHandler(fn) { startedHandler = fn; }
export let takeOverHandler = () => {};  // the panel's "Take over with Claude": the person asks for Claude on this application (set by main.js)
export function setTakeOverHandler(fn) { takeOverHandler = fn; }
export let claudeAutoHandler = () => {};  // the panel's "Always let Claude finish when I'm stuck" box (set by apply-handlers.js)
export function setClaudeAutoHandler(fn) { claudeAutoHandler = fn; }
export let accountFactHandler = () => {};  // the extension handled something on an account page (a consent accepted, a code typed): the session card's record (set by ext-server-handlers.js)
export function setAccountFactHandler(fn) { accountFactHandler = fn; }
export let formIssue = () => {};  // technical reports: a field the extension couldn't fill (lib/telemetry.js, set by main.js)
export function setFormIssueHandler(fn) { formIssue = fn; }
export let errorWatcher = () => {};  // the extension's decision lines, read for real errors (lib/real-errors.js, set by telemetry-handlers.js)
export function setErrorWatcher(fn) { errorWatcher = fn; }
export let openHandler = () => false;
export function setOpenHandler(fn) { openHandler = fn; }

// The panel's Remember switch defaults for the answers you typed: {labels, host} -> {label: boolean} (lib/learned.js rememberDefaults; unjudged stays true).
export let rememberHandler = async () => ({});
/** Sets the handler behind POST /extension/remember: takes {labels, host}, returns {label: boolean}; the default answers {} (every switch stays on). */
export function setRememberHandler(fn) { rememberHandler = fn; }
