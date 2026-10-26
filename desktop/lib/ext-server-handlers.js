// The extension server's wiring (moved out of main.js's start-up, 8 Oct 2026): what the local server asks of the app when the Chrome extension calls it: the site
// password, the form's review, the stuck report, the learned answers and fill misses, the visit routes, the tabs and the session reports. main.js
// passes in the services they share. A FLOW FILE (docs/flows/applying.md). Guards: the server, review, credentials and visits tests in desktop/test and
// the matrix (npm run flows).
import {takeoverOffered, claudeAutoStart} from './claude-ready.js';
import {SHOW_RESUME_CLAUDE} from '../renderer/claude-help.js';
import {noteReport, observe, pageKeyOf} from './ladder/rung5-takeover-teach.js';
import * as aliasLibrary from './aliases.js';
import * as applyLib from './apply.js';
import * as contactDetails from './contact.js';
import * as controlEvents from './control-events.js';
import * as credentials from './credentials.js';
import * as learnedAnswers from './learned.js';
import * as misses from './misses.js';
import * as notionGate from './notion-gate.js';
import * as pipeline from './pipeline.js';
import * as recipeLibrary from './recipes.js';
import * as review from './review.js';
import * as server from './server.js';
import * as sharedLog from './shared-log.js';
import * as terminals from './terminals.js';
import {pageStepHandler} from './page-step.js';
import * as visits from './visits.js';
import {flowState, leftCounts, missedQuestions, submitCounts, unplaced} from './question-labels.js';
import {log as appLog} from './log.js';
import {markedSession} from './session-tab.js';
import {accountCodeAnswer, codeFromMail, confirmAccount} from './account-confirm.js';
import {createAccountCheck} from './account-check.js';
import {resolveSession} from './journey-identity.js';
import {automationOf, modeOf, record} from './site-accounts.js';
import {resultOf} from './application-result.js';
import {stopLiveForms} from './stop-all.js';
import {registerReportHandlers} from './report-handlers.js';
import {createUploader} from './report-upload.js';
// A test run never counts; a live-test twin does: its fills are real use (owner, 9 Oct 2026; lib/telemetry.js learningOff).
const testRun = () => !!process.env.JOB_PILOTTO_E2E;

export function registerExtServerHandlers(ctx) {
  const {DEMO, app, createWindow, cvOf, flow, ipcMain, notify, readSites, scoreVisitJobs, sessionNeedsYou, storage, getTelemetry, toWindow, getWindow, setRecipeReporter} = ctx;
  registerReportHandlers({ipcMain, storage, uploader: createUploader({storage})});   // the panel's Report popup (lib/report-handlers.js; sends only after the person's Send in the popup)
  // The Gmail check for an account awaiting its confirmation mail (lib/account-check.js): after the account button, and again when its sign-in page is met (10 Oct 2026: the page
  // sat untouched in 'confirm' mode with no check and no word to the person). A link in the mail is opened; a code, or no mail, is told to the session.
  const ids = {get: id => terminals.get(id), list: () => terminals.list(), isFormOf: (address, posting) => applyLib.isFormOf(address, posting)};
  const accountCheck = createAccountCheck({confirm: confirmAccount, noteStuck: (...args) => terminals.noteStuck(...args)});
  const checkAccount = ({host, email, session, ...rest}) => accountCheck({host, email, session, run: args => pipeline.run(storage, args), open: link => applyLib.openOne(link, {session: String(session || '')}),
    mark: () => { storage.saveSettings({siteAccounts: record(storage.settings().siteAccounts, host, email, 'confirmed', Date.now(), terminals.record(String(session || ''))?.company || '')}); if (session) terminals.setAccount(session, 'created'); }, ...rest});
  // A site with no account item yet gets its OWN generated password (owner, 10 Oct 2026: a different one per site; it replaced the 8 Oct one-password-everywhere), kept under the
  // site's name so Settings → Credentials lists it with the profile's email. An account with an item keeps the one it has.
  server.setSitePasswordHandler(async ({host, peek, session: carried, job, url} = {}) => {
    const sessionId = resolveSession({session: carried, job, url}, ids);   // the tab's identity, resolved one way (lib/journey-identity.js); answered so the extension binds it
    const company = String(terminals.record(String(sessionId || ''))?.company || '');   // the job's company: one host can serve several employers, each with its own account
    const applying = terminals.list().some(session => !session.outcome && !session.endedAt);
    if (DEMO || !applying || !credentials.forExtension(host, {applying, read: () => 'x'}).ok) {
      appLog('extension', 'site password refused', {host: String(host || '').slice(0, 120), applying});
      return {ok: false};
    }
    let answer = credentials.forExtension(host, {applying});
    let made = false;
    const email = await Promise.resolve(notionGate.tracking(storage) ? contactDetails.read(storage) : {}).then(contact => contact?.email || '').catch(() => '');
    const mode = modeOf(storage.settings().siteAccounts, host, email, credentials.emailOf(host), !!answer.ok, company);   // our record, else the Credentials item (its email, or just that it exists): sign in first
    if (peek) return {ok: true, mode, email, session: sessionId};   // the extension only asks which step this site is for this email (no password is made or read)
    if (!answer.ok) {
      const {code} = await pipeline.run(storage, ['src.ai.passwords', 'new', host, '--no-copy', ...(email ? ['--email', email] : [])]);
      made = code === 0;
      answer = credentials.forExtension(host, {applying});
      // The password item now carries this email, which the next page would read as "an account made earlier": say the sign-up is only under way.
      if (made && email && !storage.settings().siteAccounts?.[String(host).trim().toLowerCase()]) storage.saveSettings({siteAccounts: record(storage.settings().siteAccounts, host, email, 'creating', Date.now(), company)});
    }
    appLog('extension', 'site password given for a sign-in page', {host: String(host || '').slice(0, 120), made, given: !!answer.ok, mode, email: !!email});   // which site, never the password
    if (mode === 'confirm' && email && !DEMO) checkAccount({host, email, session: sessionId, wait: 20, minutes: 180});   // a pending account's page is met: look for its mail now, not only right after the press
    // sign-in only where THIS email has an account on this site (recorded when a sign-up was confirmed); anywhere else the extension signs up.
    return answer.ok && email ? {...answer, email, mode, automation: automationOf(storage.settings()), session: sessionId} : {...answer, session: sessionId};   // the email goes into the account's email box, as the password goes into its password boxes
  });
  // The code a confirmation page asks for (owner, 10 Oct 2026): in "Do it for me" only, read from the mail sent to the account's email (Gmail, read-only; the AI picks the
  // code) and handed to the extension, which types it; never logged. "Let me check each step", no email or no code: nothing, the person types it.
  server.setAccountCodeHandler(async ({host} = {}) => {
    const email = DEMO ? '' : await Promise.resolve(notionGate.tracking(storage) ? contactDetails.read(storage) : {}).then(contact => contact?.email || '').catch(() => '');
    return accountCodeAnswer({mode: automationOf(storage.settings()), host, email, read: found => codeFromMail({...found, run: args => pipeline.run(storage, args)})});
  });
  server.setAccountFactHandler(({fact, text, session: carried, job, url} = {}) => {   // the card's account record: a consent accepted (the page's own wording), a code typed
    const session = resolveSession({session: carried, job, url}, ids);
    if (session && terminals.setAccountFact(session, fact === 'code' ? 'code' : 'terms', text)) appLog('extension', fact === 'code' ? 'account record: a code from the mail was typed' : 'account record: a consent was accepted', {terms: fact === 'code' ? undefined : String(text || '').length});
  });
  // The extension pressed a sign-up page's button: this email has an account on this host now, unconfirmed until its mail's link is opened (never the address in a log).
  // The page's step as it happens (extension/page-mark.js): the session the tab carries, nothing guessed.
  server.setPageHandler(pageStepHandler({terminals, review, appLog}));   // lib/page-step.js
  server.setAccountPressedHandler(async ({host, state, session: carried, job, url} = {}) => {
    const session = resolveSession({session: carried, job, url}, ids);
    const email = await Promise.resolve(notionGate.tracking(storage) ? contactDetails.read(storage) : {}).then(contact => contact?.email || '').catch(() => '');
    if (!host || !email) { appLog('extension', 'account made but not recorded', {host: String(host || '').slice(0, 120), email: !!email}); return; }
    if (state === 'refused') {   // a sign-in with this email was refused here (the account judge, any language): no account yet; the next look signs up (under full)
      storage.saveSettings({siteAccounts: record(storage.settings().siteAccounts, host, email, 'refused', Date.now(), terminals.record(String(session || ''))?.company || '')});
      appLog('extension', 'sign-in refused: no account for this email on this site, sign-up next', {host: String(host).slice(0, 120)});
      if (session) terminals.setAccount(session, 'refused');   // the session card says so (it said nothing: "Form open" over a rejected sign-in, 10 Oct 2026)
      return;
    }
    // confirmed: usable at once (signed in, or the site moved on); exists: it was there before, the sign-in is tried; pending: a confirmation mail (or a code) is awaited.
    const usable = state === 'confirmed' || state === 'exists';
    storage.saveSettings({siteAccounts: record(storage.settings().siteAccounts, host, email, usable ? 'confirmed' : 'pending', Date.now(), terminals.record(String(session || ''))?.company || '')});
    if (session) terminals.setAccount(session, state === 'confirmed' ? 'created' : state === 'exists' ? 'exists' : 'confirm');   // the session card says so
    appLog('extension', usable ? `account ${state === 'exists' ? 'already exists: the sign-in is tried' : 'created: usable at once'}` : 'account created: waiting for the confirmation', {host: String(host).slice(0, 120)});
    // A mail to confirm: looked for in the background (Gmail, read-only; the AI picks the link or code): its link opens in the extension's Chrome.
    if (!usable && !DEMO) checkAccount({host, email, session, force: true});
  });
  // A page of a session's form reported: its tab is open, so a stopped Claude session is not "Ended" (terminals.formInChrome).
  const formSeen = id => { if (id && terminals.formInChrome(id)) appLog('sessions', 'form open in Chrome: the session is active again', {id}); };
  // The app's theme (Settings → Appearance, main-window.js applyTheme) travels with every answer, so an open panel follows it live: light, dark, or system (the panel then follows the browser).
  const themeOf = () => { const saved = storage.settings().theme; return saved == null || saved === '' ? 'dark' : ['light', 'dark'].includes(saved) ? saved : 'system'; };
  server.setReviewHandler(payload => ({...reviewAnswer(payload), theme: themeOf()}));
  const reviewAnswer = payload => {
    const report = review.report(terminals.list(), payload);
    if (report.session?.url) { const key = pageKeyOf(report.session.url); noteReport(key, payload); observe(key, payload, {misses: misses.read(storage), report: items => recipeReporter.outcome(items), log: appLog}); }   // Claude teaches the extension (lib/ladder/rung5-takeover-teach.js)
    if (report.matched && report.session) formSeen(report.matched);
    if (report.moved) return {...report, tab: review.tabOf(String(payload?.session || ''), String(payload?.boot || '')) || null};   // "Go there": the tab that continues this application
    return report.session ? {...report, cv: cvOf(report.session.url), claudeHelp: takeoverOffered(storage), claudeTakeover: SHOW_RESUME_CLAUDE, claudeAlways: SHOW_RESUME_CLAUDE && !!storage.settings().claudeAuto, claudeAuto: claudeAutoStart(storage), claudeConsent: !!storage.settings().claudeConsent} : report;   // the one Claude switch (renderer/claude-help.js)
  };
  // Each send is logged with its counts (never its content): "is the twin's fill reaching the site?" was unanswerable on 9 Oct 2026.
  const recipeReporter = recipeLibrary.createReporter(storage, {onSent: (what, sent) => {
    sharedLog.add(storage, what, sent);
    appLog('recipes', `sent to the site: ${what}`, {cards: sent?.cards?.length || 0, proposalUses: sent?.proposalUses?.length || 0, samples: sent?.samples?.length || 0, outcomes: sent?.outcomes?.length || 0});
  }});
  setRecipeReporter(recipeReporter);   // main.js keeps it: the other handler groups reach it through a getter
  // How an application ended (submitted clean / assisted / by Claude, or failed and where): one fixed word per finished application, by board. Never from a test run.
  terminals.onOutcome(session => {
    if (testRun()) return;
    const state = review.allStates().find(item => item.id === session.id);
    const result = resultOf(session, state);
    if (!result) return;
    let host = '';
    for (const address of [state?.url, session.accountHost ? `https://${session.accountHost}/` : '', session.url]) { try { host = new URL(address).hostname; break; } catch { /* the next one */ } }
    const board = controlEvents.boardName(host);
    recipeReporter.flow(board, result);
    appLog('sessions', `application ended: ${result}`, {board, id: session.id});
  });
  server.setProposalReporter(items => recipeReporter.proposal(items));
  server.setAnswerReporter(trace => { if (!testRun()) recipeReporter.answer(trace); });   // per-AI-family answer metrics, never from a test run
  // After a search: how much of the market the role keywords caught (data/coverage.json, src/coverage.py), as anonymous counts, once per crawl.
  pipeline.onRunEnd(({args, code}) => {
    if (code !== 0 || args[1] !== 'daily') return;
    try {
      const summary = JSON.parse(storage.readText('data/coverage.json') || 'null');
      if (!summary?.at || storage.settings().intelCoverageAt === summary.at) return;
      storage.saveSettings({intelCoverageAt: summary.at});
      recipeReporter.coverage(summary);
    } catch { /* a number for the product is never worth a failed run */ }
  });
  const shared = (what, sent) => sharedLog.add(storage, what, sent);
  server.setSharedLogger(shared);
  server.setRecipesHandler(payload => recipeLibrary.lookup(storage, payload.fingerprints, {onSent: shared}));
  server.setAliasesHandler(() => aliasLibrary.forExtension(storage, {onSent: shared}));   // shared meanings + this Mac's (lib/contact-keys.js)
  const owner = () => !!process.env.JOB_PILOTTO_OWNER;   // the owner's own installs name sites in plain, to debug with
  // Sites only you can open (lib/visits.js): the extension sends each page of a tab the app opened to read.
  server.setVisitFilters(page => visits.filters(storage, page));
  server.setVisitRoute('/extension/visit-understand', outline => visits.understand(storage, outline));
  server.setVisitRoute('/extension/visit-unblock', page => visits.unblock(storage, page));
  server.setVisitRoute('/extension/visit-recipe', page => visits.recipe(storage, page));
  server.setVisitRoute('/extension/visit-jobpage', page => visits.jobPage(storage, page));   // a home page: where its job list is
  server.setVisitRoute('/extension/visit-done', payload => visits.done(payload));
  server.setVisitRoute('/extension/posting', payload => visits.posting(storage, payload));   // a posting read in your browser ("Jobs we couldn't read")
  server.setVisitRoute('/extension/visit-waiting', payload => visits.waitingFor(payload));
  server.setVisitRoute('/extension/visit-state', payload => visits.stepOf(payload));   // what each read tab is doing, live in its row
  let waitingSaid = 0;
  visits.onWaiting(() => {   // once a run: a notification that brings Chrome forward on click
    if (Date.now() - waitingSaid < 10 * 60000) return;
    waitingSaid = Date.now();
    notify('Jobadabra is waiting for you in Chrome', 'Press "Allow on the sites the app opens" once: then it reads the sites by itself.', () => visits.focusBrowser());
  });   // the extension waits on the person: said, not "reading"   // a tab the Actions task opened has been read
  server.setVisitHandler(async page => {
    const answer = await visits.read(storage, page);
    // A page you read by your own click is said at once; one read for a Find jobs using your browser run (it has a ticket) is said by that run's card, which also
    // starts the search (7 Oct 2026: a toast per page said "your next jobs check scores them" while the card said a search had started).
    if (answer.ok && !page?.ticket) toWindow('visit-read', answer);
    return answer;
  });
  server.setMissesHandler(payload => misses.record(storage, payload, Date.now(), prints => {
    for (const item of controlEvents.fromMisses(payload, prints, {owner: owner()})) getTelemetry()?.record('control', item);
    recipeReporter.sample((payload.items || []).filter(item => prints.has(item.fingerprint)));   // the structure of a new kind of control, no text
  }));
  server.setControlsHandler(payload => {
    for (const item of controlEvents.fromOperators(payload, {owner: owner()})) getTelemetry()?.record('control', item);
    recipeReporter.outcome(payload.items);   // counts per fingerprint and recipe: the canary's evidence
    const board = controlEvents.boardName(payload.host);
    if (Array.isArray(payload.trace)) recipeReporter.fill(board, payload.required, payload.starred);   // one more form on this board (only a fill report carries the trace; a flow or alias event is not a fill)
    recipeReporter.question((Array.isArray(payload.buttons) ? payload.buttons : []).map(label => ({label, kind: 'button'})), board);   // button texts of a page with no Apply button we knew
    recipeReporter.question((Array.isArray(payload.uploads) ? payload.uploads : []).map(label => ({label, kind: 'upload'})), board);   // titles of upload slots no meaning knew
    recipeReporter.alias(payload.aliasUse);   // which label meanings from the service placed a question, and whether the field took it
    recipeReporter.fillQuality(payload.filled, payload.corrections);   // which answers were filled, and which the person changed by hand (labels only)
    recipeReporter.question(unplaced(payload.trace), board);   // the form's own wording for questions no answer matched
    const left = leftCounts(payload.trace);
    recipeReporter.unfilled(board, left);   // why fields stayed empty: counts per fixed reason word
    const unreadCount = left.find(c => c.reason === 'unread')?.n || 0;
    if (unreadCount) appLog('review', `fill: ${unreadCount} required question(s) on the page not read`, {board});
    if (Array.isArray(payload.trace)) appLog('review', `fill: marks: ${Number(payload.starred) || 0} starred, ${Number(payload.required) || 0} required`, {board});   // the pool reads it back; starred well above required = the required rule missed a layout
    if (payload.flow) recipeReporter.flow(board, flowState(payload.flow));   // where an application got to on this board
    if (payload.card) recipeReporter.card(board, payload.card, payload.host);   // this fill's anonymous record (extension/fill-card.js)
    if (payload.byYou || payload.invalid || payload.fillId) {   // at Submit: what the fill missed (the person answered it, or the page flagged it)
      const counts = submitCounts(payload);
      if (payload.fillId) recipeReporter.submit(payload.fillId, {submitted: payload.submitted, ...Object.fromEntries(counts.map(c => [c.reason, c.n]))});
      recipeReporter.unfilled(board, counts);
      recipeReporter.question(missedQuestions(payload), board);
      appLog('review', `at submit: ${counts.map(c => `${c.n} ${c.reason}`).join(', ') || 'nothing missed'}`, {board});
    }
  });
  server.setLearnedHandler(payload => learnedAnswers.save(storage, payload, {notify: (title, body, target) => toWindow('toast', {title, body, target}), contactSaved: contact => server.contactSaved(storage, contact)}));
  server.setTabsHandler(report => {
    const sessions = terminals.list();
    review.noteTabs(report, new Set(sessions.map(session => session.id)));
    for (const session of sessions) if (review.tabOpen(session.id) === true) formSeen(session.id);   // a restarted app: its form is still open
    return visits.noteTabs(report);
  });   // one tab report: form tabs (Applying) and read tabs (Find jobs using your browser)
  server.setJoinHandler(tabs => {   // the wake page's list of open tabs: hosts and whether each carries a session mark, never titles or paths
    const arm = review.tabsToArm(terminals.list(), tabs);
    appLog('review', `join: ${tabs.length} tab(s) reported, ${arm.length} to take`, {sessions: terminals.list().length, marked: tabs.filter(tab => markedSession(tab?.url)).length,
      hosts: [...new Set(tabs.map(tab => { try { return new URL(tab.url).hostname; } catch { return ''; } }).filter(Boolean))].slice(0, 12), arm: arm.map(url => { try { return new URL(url).hostname; } catch { return ''; } })});
    return arm;
  });
  server.setFocusHandler(payload => review.noteFocus(terminals.list(), payload));
  server.setOpenHandler(id => {
    if (!terminals.get(id)) return false;
    if (!getWindow() || getWindow().isDestroyed()) createWindow();
    getWindow().show();
    getWindow().focus();
    app.focus({steal: true});
    toWindow('session', 'open', {id});
    return true;
  });
  server.setStoppedHandler(event => appLog('extension', 'the extension stopped', {reason: String(event?.reason || '').slice(0, 80), marked: stopLiveForms(terminals)}));   // its Stop, the app's, or Chrome's Cancel: every live form says Stopped (lib/stop-all.js)
  server.setStuckHandler(event => { flow().stuck(event); });   // tier 3: the extension can't reach a form (lib/session-flow.js)
  review.onBind(({id, tab, before, by, host}) => appLog('review', `tab ${tab} is session ${id}'s now`, {before, by, host}));   // which tab a session follows, and why
  review.setReporter(state => flow().reported(state));   // the step each form report puts its session at (lib/session-flow.js)
  const readReported = new Set();
  // (readSites, set when a Read with Claude session starts: its sites' addresses, so each site's button is told when it ends)   // Read with Claude sessions already reported (a session's Stop can arrive more than once)
  server.setSessionReporter((id, info) => {
    const {session, needsYou} = terminals.report(id, info);
    if (session && needsYou) sessionNeedsYou(session);
    // A Read with Claude session that finished: what it saved, said like the extension's reads (log, toast, the site's button) and scored
    // (owner, 7 Oct 2026: "Read with Claude never reports back"). Its pages were saved under its session name (claude-session.js readPrompt).
    if (session?.kind === 'read' && session.status === 'done' && !readReported.has(id)) {
      readReported.add(id);
      visits.claudeResult(storage, id).then(result => {
        appLog('visit', 'read with Claude finished', {host: (() => { try { return new URL(session.url).hostname; } catch { return ''; } })(), jobs: result?.jobs ?? 0, fits: result?.fits ?? 0});
        toWindow('visit-claude-done', {url: session.url, urls: readSites.get(id) || [session.url], name: result?.name || session.company || '', jobs: result?.jobs || 0, fits: result?.fits || 0});
        scoreVisitJobs(result?.fits || 0, 'read with Claude');
      }).catch(error => appLog('visit', 'read with Claude result not read', {error: error.message}));
    }
  });
}
