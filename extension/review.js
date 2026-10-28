// The Jobadabra panel, only on a tab the desktop app opened (bottom right). Collapsed: a pill with a progress ring and what's
// left ("3 left", green "Ready to submit"). Open: the job, what Claude is doing on it, the progress, one Fill button,
// what's left for you (click one: the page scrolls to it), and Open in Jobadabra.
// App first: the job, its Apply with Claude session and the form's state are shared with the Jobadabra app both
// ways (the agreements you tick here are ticked off there; "Show it in the form" there scrolls here). Without the
// app it still shows the form's progress, and fills through the extension's own connection.
// The panel itself never types, ticks or clicks anything in the form: filling goes through the extension's fill.
// This file owns the panel's state, drawing, fill button and the sync with the app. Its parts are injected before it (panel-files.js): panel-form.js reads the form,
// panel-markup.js is the styles and markup, panel-learn.js reports what the person did. They share window.__jobPilottoPanel* (a content script has no imports).
(() => {
  // Once per page, but a copy left behind by an extension reload (its chrome.runtime is gone) gives way to the new one.
  if (window.__jobPilottoReviewAlive?.() || ['Required', 'ReadBack', 'TitleAbove', 'GroupTitle', 'PanelForm', 'PanelMarkup', 'CoverLetterNotice', 'PanelLearn', 'PanelWritten', 'Overlay'].some(name => !window['__jobPilotto' + name] && (console.warn('Jobadabra panel: helper script missing:', name), true))) return;   // only some helper scripts ran (a reload with the tab open): draw nothing, say which, the next full injection mounts; the option grouping alone is soft
  window.__jobPilottoReviewAlive = () => !!chrome.runtime?.id;
  let askedPassword = 0;
  const send = message => (chrome.runtime?.id ? chrome.runtime.sendMessage(message) : Promise.reject(new Error('reloaded')));
  // The desktop app is the only way onto a page. Anywhere else this script was injected (an old "every site"
  // registration, a reload) it draws nothing and listens for nothing.
  send({type: 'panelAllowed'}).then(answer => { if (answer?.ok) mount(); }).catch(() => {});

  function mount() {
  document.getElementById('jobpilotto-review-host')?.remove();

  const MIN_FIELDS = 3;
  // A form the night filled, opened in the morning (ready-handoff.js marks the page): the panel says so instead of a new reading (owner, 18 Oct 2026: "Last night's fill is back").
  const night = () => document.documentElement.getAttribute('data-jobpilotto-night') === '1';
  const MARK_WORDS = {get reading() { return night() ? 'Putting back last night\u2019s fill…' : 'Reading this page…'; }, other: 'This page shows no application', 'signing-in': 'Logging in…', 'signing-up': 'Creating your account…'};   // page-mark.js; a posting: the owner's own words
  const {KNOCKOUT, AGREE, fields, find, flash} = window.__jobPilottoPanelForm;
  const NOTE = '.note:not(.trace-note)';

  // ---- the panel (its own shadow root: the page's styles can't touch it, it can't touch the page) ----
  const host = Object.assign(document.createElement('div'), {id: 'jobpilotto-review-host'});
  host.style.cssText = 'position:fixed;right:18px;bottom:18px;z-index:2147483646;pointer-events:none;';   // only the card and the pill take clicks (.jp > *)
  const root = host.attachShadow({mode: 'open'});
  root.innerHTML = window.__jobPilottoPanelMarkup;
  const $ = selector => root.querySelector(selector);
  const jp = $('.jp'), card = $('.card'), pill = $('.pill');
  // While a fill step shows, the page is dimmed (panel-overlay.js) and the panel is centred, bigger, with what it is doing (owner, 19 Oct 2026); at the end the panel goes back to its corner.
  // ONE look: look(true) dims AND centres, look(false) does neither; nothing else turns either on or off, and when the worker's verdict lifts the dim (done, Stop, your turn:
  // apply-state.js) the step ends with it (owner, 27 Oct 2026: "everytime when the extension is working... it should be centered and there should be dark/glowing background").
  // Working = a step shows: the worker's fill steps (panelStep), this panel's own fill, and the page being read or routed (WORKING_MARKS). Not working: done, stopped, needs you, stuck, closed.
  const overlay = window.__jobPilottoOverlay, HOME = host.style.cssText, steps = [];
  const WORKING_MARKS = ['reading', 'posting', 'opening', 'signing-in', 'signing-up'];  let markStepWords = '';
  const place = working => { host.style.cssText = working ? 'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:2147483646;pointer-events:none;' : HOME; jp.classList.toggle('working', working); };
  // The Apply's state is the worker's (apply-state.js); this page draws it. applyWorking: the last thing the worker said (its answer at the first draw, then its pushes); this panel's own fill counts too.
  let applyWorking = false;
  // Why (2026-10-27, owner, dim-gap): one document observer restores the dim and this same panel together, including when the page replaces <html>. The worker's state stays unchanged.
  overlay.onRestore?.(() => { if (!host.isConnected && applyWorking && !host.hidden) document.documentElement.append(host); });
  const look = working => { const on = working && (applyWorking || filling) && !host.hidden; if (on) overlay.on(); else overlay.off(); place(on); };   // a closed panel (its X) has no Stop on the page: never dimmed (#1558)
  const stepShowing = () => $('.fill').classList.contains('is-busy');
  const markWorking = () => applyWorking && WORKING_MARKS.includes(document.documentElement.getAttribute('data-jobpilotto-page') || '') && !stopped && !moved;
  // Why (2026-10-27, owner, replacing #2221's end gap and its timers): the look ends on the worker's verdict only; it reaches the overlay (panel-overlay.js), which tells this panel here.
  let workerStep = '';
  overlay.onLift?.(() => { applyWorking = false; if (stepShowing()) endStep(); else look(false); });
  const drawSteps = () => $('.steps').replaceChildren(...steps.slice(-6, -1).map(text => Object.assign(document.createElement('li'), {textContent: text})));
  const written = window.__jobPilottoPanelWritten.start({send, alive: () => host.isConnected});   // Review my answer beside each written question's box (panel-written.js)
  window.__jobPilottoClaude?.mount(root, send);   // the stuck page's Claude offer: its own script (panel-claude.js)
  const SHOW_TIPS = false;   // the tip line (Fact / Recruiters say / Tip / Worth trying) is off for now (owner, 15 Oct 2026: "hide, disable it, we'll get back to it"); true brings it back
  let stopped = false, stuckSince = 0, stepAt = 0, lastStuck = '', startedAt = 0;   // stopped: the person's Stop reached this page (stop.js), until they start again here (`started`); stuckSince/stepAt: which came last
  let counts = {total: 0, left: 0}, moved = false, movedTab = null, open = false, shown = [], job = null, session = null, connection = null, build = null, claudeAsk = {}, filling = false, userMoved = false, cv = null, tipFor = null, coverLetterStatus = null;

  const setOpen = value => { open = value; card.hidden = !open; if (open) render(); };
  pill.onclick = () => { userMoved = true; setOpen(!open); };
  $('.min').onclick = () => { userMoved = true; setOpen(false); };   // minimise: back to the pill
  $('.x').onclick = () => { userMoved = true; setOpen(false); host.hidden = true; look(false); if (applyWorking) send({type: 'applyVerdict', verdict: 'your-turn'}).catch(() => {}); };   // close: the panel is out of the way until the page loads again; the overlay goes with it and a later step does not bring it back, as the Stop is on the panel (#1558)
  const stopButtons = [...root.querySelectorAll('.stop-btn, .pill-stop')], stopsBack = () => { for (const button of stopButtons) { button.disabled = false; button.textContent = 'Stop'; } };
  for (const button of stopButtons) button.onclick = event => { if (event.isTrusted) { button.disabled = true; button.textContent = 'Stopping…'; const pressed = Date.now(); send({type: 'stop', reason: 'the Stop button in the panel'}).then(answer => { if (answer?.ok) stoppedHere(pressed); else stopsBack(); }, stopsBack); } };   // the one Stop (stop.js): in the live step row and beside the minimised pill
  // "Report", the one entry, in the footer of every state (owner, 16 Oct 2026): a popup on the panel (panel-report.js) that says what goes, takes a note and sends. A page script's click is ignored; a press that cannot open it says why.
  $('.report-btn').onclick = event => {
    if (!event.isTrusted) return;
    if (window.__jobPilottoReport) window.__jobPilottoReport.open();
    else note('Report could not open on this page. Reload the page and try again.');
  };

  // Chrome's debugging bar is explained once, where a fill starts, the first time a trace is kept (the trace: trace.js; owner, 16 Oct 2026).
  window.__jobPilottoReport?.mount(root, send, state => { if (state?.enabled) window.__jobPilottoReportOn = true; if (state?.tracing) traceOn(); });   // the first state answer: whether the switch is on, and whether a trace is kept (the bar note)
  const traceOn = async () => { const {traceBarSeen} = await chrome.storage.local.get('traceBarSeen').catch(() => ({})); if (!traceBarSeen) $('.trace-note').hidden = false; };
  $('.trace-note .got-it').onclick = () => { $('.trace-note').hidden = true; chrome.storage.local.set({traceBarSeen: true}).catch(() => {}); };

  const view = window.__jobPilottoPanelView({$, jp, night, MARK_WORDS, KNOCKOUT, AGREE, flash, written, stoppedCard, send});

  // ---- drawing ----
  // Draw the current page state in the pill and, when open, the review card.
  function render(list = fields()) {
    const needsNow = document.documentElement.getAttribute('data-jobpilotto-needs');
    const account = !!document.querySelector('input[type=password]');
    requestPassword(account);
    // A sign-in page is too small for a panel, unless the AI says it needs the person, or the extension works on it: then the panel shows what it does (and Stop), centred over the dim.
    if (list.length < MIN_FIELDS && !needsNow && !stepShowing() && !markWorking()) { look(false); host.remove(); return null; }
    if (!host.isConnected) document.documentElement.append(host);
    const handed = handoff(needsNow);
    renderMark(handed);
    const progress = renderSummary(list, account);
    if (!open) return progress.state;
    const heading = view.renderHeader({...progress, job, session, moved, movedTab, filling});
    view.renderProgress({...progress, moved, markStepWords}, heading);
    const canTailor = view.renderFill({...progress, session, connection, cv, moved, filling});
    const knockouts = view.renderRemaining({...progress, moved, shown});
    renderTip(knockouts, canTailor);
    view.renderActions({session, connection, claudeAsk, needsYou: progress.needsYou, handed, stopped, needs: () => shown[0] && flash(shown[0].el)});
    view.renderFooter({connection, session, build});
    return progress.state;
  }

  // Request a visible account password at the original throttle before checking the panel's field minimum.
  function requestPassword(account) {
    // An empty password box is filled from the Keychain (asked again now and then; the value never comes to this panel). Asked BEFORE the
    // field count below: a sign-in page has two boxes (Coop's SuccessFactors, live run 8 Oct 2026), too few for a panel.
    if (account && Date.now() - askedPassword > 2000 && [...document.querySelectorAll('input[type=password]')].some(box => (!box.value || (box.hasAttribute('data-jobpilotto-filled') && !document.documentElement.hasAttribute('data-jobpilotto-account-pressed'))) && box.getClientRects().length)) {
      askedPassword = Date.now();
      send({type: 'sitePassword'}).catch(() => {});
    }
  }

  // Track the app's current stuck answer and hand a working step back to the person when needed.
  function handoff(needsNow) {
    // The person is needed (a captcha, a question the page asks) or the page is stuck: the step ends (no dim, the corner, no busy step row) so they can act. The app's "stuck" is
    // an older word than a step the extension showed after it (it handed the page over, then fields appeared and it went on: owner, 27 Oct 2026), and never ends this panel's own fill.
    const stuckNow = !!session?.stuck && !(session.live && ['running', 'input'].includes(session.status));
    const stuckWord = stuckNow ? String(session.stuck) : '';
    if (session && stuckWord !== lastStuck) { lastStuck = stuckWord; stuckSince = stuckWord ? Date.now() : 0; }   // from the app's answer changing, not from a sync that brought no session
    const handed = (!!needsNow && !filling) || stopped || (stuckNow && !filling && stepAt <= stuckSince);   // this panel's own fill (Check again, Fill again) reads the page anew: the AI's older "needs you" waits for its end
    // Why (2026-10-27, red CI on #2281): only the worker says stopped; this page's own stopped flag is stale while a restart is on its way, and a verdict sent from it ended the restarted run.
    if (handed && !stopped && stepShowing() && applyWorking) send({type: 'applyVerdict', verdict: 'your-turn'}).catch(() => {});   // the person must act: a verdict, which the worker answers by lifting every page
    return handed;
  }

  // Draw the worker's routing words without changing who owns the working look.
  function renderMark(handed) {
    // The extension reading or routing a page (page-mark.js: reading, posting, opening, signing-in/up) is working like a fill: the same layer and one step row, ending when the mark moves on.
    const markNow = document.documentElement.getAttribute('data-jobpilotto-page') || '';
    const markWorks = applyWorking && WORKING_MARKS.includes(markNow) && !handed && !moved;
    if (markWorks && !filling) { const words = MARK_WORDS[markNow] || 'Apply button detected. Redirecting…'; if (markStepWords !== words) { const first = !markStepWords; markStepWords = words; const was = stepped; showStep(words); stepped = was; if (first && !userMoved && !open) setOpen(true); } }
    // Why (#2221, owner 27 Oct 2026; now by the one state owner): the mark moved on: only its words end, never the look: a fill step still running under it (the worker's, or this panel's fill) gets its row back, and the dim and
    // the centring stay until the worker's verdict (owner: "flashes (very short moments) when the extension panel moves from center to bottom right"; "we keep it like that until we have a very clear verdict").
    else if (markStepWords) { markStepWords = ''; if (workerStep || filling) showStep(workerStep || 'Reading the form…'); }   // the mark moved on: the step's words only; the look stays until the verdict
  }

  // Draw the cover-letter notice and return the original missing-letter value.
  function renderLetter(list, account) {
    const letterAsked = list.some(f => f.el?.getAttribute('data-jobpilotto-letter') === '1') || Array.from(document.querySelectorAll('[data-jobpilotto-letter-manual]')).some(el => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
    const letterGiven = list.some(f => f.el?.getAttribute('data-jobpilotto-letter') === '1' && f.filled);
    const failedManual = Array.from(document.querySelectorAll('[data-jobpilotto-letter-manual][data-jobpilotto-letter-error]')).find(el => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
    const letterRejected = list.find(f => f.el?.hasAttribute('data-jobpilotto-letter-error') && !f.filled) || (failedManual && {el: failedManual});
    const letterMissing = !account && letterAsked && !letterGiven && (letterRejected || coverLetterStatus && !coverLetterStatus.ready);
    $('.letter-setup').hidden = moved || !letterMissing;
    // Why (2026-10-27, owner): keep each letter status truthful while sharing the same compact notice and routing setup through the app.
    const letterCopy = window.__jobPilottoCoverLetterNotice(coverLetterStatus, !!letterRejected);
    $('.letter-title').textContent = letterCopy.title;
    $('.letter-reason').textContent = letterMissing ? letterCopy.reason : '';
    $('.letter-action').textContent = letterCopy.action;
    $('.letter-action').onclick = event => letterRejected ? flash(letterRejected.el) : ask(event.currentTarget, 'Opening…', {type: 'panelOpenApp', session: 'setup:cover-letter'}, APP_DOWN);
    return letterMissing;
  }

  // Count the needed fields, draw the collapsed summary and return the facts for the open card.
  function renderSummary(list, account) {
    // An answer Claude wrote that is now empty (marked amber) still needs you, required or not.
    written.update(list);
    const needed = list.filter(f => f.required || f.ai || f.changed || f.draft);
    shown = needed.filter(f => !f.filled);
    const letterMissing = renderLetter(list, account);
    const total = needed.length, left = shown.length, pageMark = (m => (['form', 'account', 'sign-up'].includes(m) ? '' : m || 'reading'))(document.documentElement.getAttribute('data-jobpilotto-page') || ''), ready = !moved && !pageMark && total > 0 && left === 0 && !letterMissing, needsYou = document.documentElement.getAttribute('data-jobpilotto-needs');
    counts = {total, left};   // the stopped note says what the page holds
    const done = total ? Math.round(100 * (total - left) / total) : 0;
    const readyWords = view.drawPill({moved, pageMark, ready, needsYou, total, left, done, account, job, session, letterMissing});
    // A fill running (this panel's, Claude's, the popup's) or over: a field filled after it is yours.
    const busy = filling || (session?.live && session.status === 'running') || $('.fill').classList.contains('is-busy');
    jp.classList.toggle('busy', busy);   // the Stop beside the minimised pill shows while a fill runs
    const over = filledOnce || ['done', 'input'].includes(session?.status);
    return {state: {list, left, total, busy, over, account}, pageMark, ready, needsYou, done, readyWords};
  }

  // Keep the original preferred tip and request it only when tips are enabled.
  function renderTip(knockouts, canTailor) {
    // One tip at the bottom, about what the form is at: knockout questions left, no tailored CV yet, else the CV. Click for the next one.
    const prefer = knockouts ? 'knockout' : canTailor && !cv.tailored ? 'tailor' : 'cv';
    if (SHOW_TIPS && tipFor !== prefer && connection?.connected) { tipFor = prefer; askTip(); }
  }

  // ---- actions ----
  // What the fill is doing, shown in the button. It ends on the worker's verdict, with no timer (owner, 27 Oct 2026; was a 45 s safety net).
  let filledOnce = false, stepped = false;
  function showStep(text) {
    stepped = true;
    $('.step-hint').textContent = /^check/i.test(text) ? 'Checking whether any fields need your input.' : /^(reading this page|putting back)/i.test(text) ? 'Looking for the application on this page.' : /^(apply button|logging in|creating your)/i.test(text) ? 'Taking you to the application form.' : 'Counts update as new fields appear.';   // our own step words, each with its sub-line (mockups 01/02)
    if (steps.at(-1) !== text) { if (steps.includes(text)) steps.splice(steps.indexOf(text), 1); steps.push(text); drawSteps(); }   // "Done so far" never repeats the step now on
    stepAt = Date.now();
    look(true);
    const button = $('.fill');
    button.classList.add('is-busy');
    button.setAttribute('aria-busy', 'true');
    button.title = text;
    $('.fill .label').textContent = text;
  }
  function endStep(redraw = true) {
    workerStep = '';
    look(false); steps.length = 0; drawSteps();
    const button = $('.fill');
    button.classList.remove('is-busy');
    button.removeAttribute('aria-busy');
    button.title = '';
    if (stepped) filledOnce = true;  // a fill ran here (this button, Claude's session or the popup) and is over
    $('.fill .label').textContent = filledOnce ? 'Fill again' : 'Fill this form';
    if (redraw) render();
  }
  async function fill(force = false) {
    filling = true; stopped = false; startedAt = Date.now();   // the person's own start: this page works again (the worker clears its Stop and the page's: stop.js startTab)
    $(NOTE).hidden = true;
    stoppedCard(false);
    showStep('Reading the form…');
    render();
    const result = await send({type: 'panelFill', url: session?.url || job?.url || location.href, force}).catch(error => ({ok: false, error: error.message}));
    filling = false;
    filledOnce = true;
    endStep();
    if (result?.ineligible) note(`Not filled: ${result.note}`, true);
    else if (!result?.ok && /^Stopped by you/.test(result?.error || '')) { stopped = true; stoppedCard(true); }   // the person's Stop: a calm state, not a failure (mockup 03)
    else if (!result?.ok) note(`Couldn't fill: ${result?.error || 'try again'}`);
    else if (result.sharedNote) note(result.sharedNote);   // the service changed how a control was filled: say so
    render();
  }
  // 03 Stopped by you: a pause tile with how many fields hold values, the rest in "Left for you", and one way to read the form again (owner mockup, 19 Oct 2026).
  function stoppedCard(on) {
    $('.stopped').hidden = !on;
    $('.recheck').hidden = !on;
    if (on) $('.stopped .s-text').textContent = `${Math.max(0, counts.total - counts.left)} required fields currently contain values.`;
  }
  $('.recheck').onclick = () => { stoppedCard(false); fill(); };
  // 04 Your action needed: the page waits for the person (the AI's word in data-jobpilotto-needs): a warm card, Show on form (scrolls to the first thing left), Check again (reads the form now).
  $('.verify .v-show').onclick = () => shown[0] && flash(shown[0].el);
  // Check again reads the form again like Check form again: the fill runs (what the person did is kept, what is left is filled) and, at its end, the AI judges the page anew (messages-panel.js
  // panelFill). It only redrew the panel before, and the AI's "needs you" stayed until the page claimed every field filled (owner, 27 Oct 2026: "clicking "check again" does nothing").
  $('.verify .v-again').onclick = () => fill();
  // The note line, never the debugging-bar note above it (both are .note): since 516e3fb every note went into that box, under its "Got it", and Fill anyway sat in a box that stayed hidden (27 Oct 2026).
  function note(text, anyway = false) {
    $(NOTE).hidden = false;
    $(`${NOTE} span`).textContent = text;
    $('.anyway').hidden = !anyway;
  }
  $('.fill').onclick = () => fill();
  $('.anyway').onclick = () => fill(true);
  const LABEL = {research: 'Fact', recruiters: 'Recruiters say', advice: 'Tip', 'to-test': 'Worth trying'};
  async function askTip() {
    const answer = await send({type: 'panelTip', host: location.hostname, prefer: tipFor}).catch(() => null);
    if (!answer?.ok) return;
    $('.tip-chip').textContent = LABEL[answer.evidence] || 'Tip';
    $('.tip-text').textContent = answer.text;
    $('.tip').hidden = false;
  }
  $('.tip').onclick = askTip;
  // Every control that asks the app something goes through ask(): it says it is working on the panel, and says so on the panel when the app did not answer (a silent control looks dead).
  async function ask(button, busyText, message, failText) {
    const label = button.textContent;
    button.disabled = true; button.textContent = busyText;
    const answer = await send(message).catch(() => null);
    button.disabled = false; button.textContent = label;
    if (!answer?.ok) note(failText);
    return answer;
  }
  const APP_DOWN = 'Jobadabra is not answering: open the app, then try again.';
  $('.go-there').onclick = () => Number.isInteger(movedTab) && send({type: 'panelGoTab', tab: movedTab}).catch(() => {});
  $('.open-app').onclick = event => session && ask(event.currentTarget, 'Opening…', {type: 'panelOpenApp', session: session.id}, APP_DOWN);
  // The extension's fill reports its steps here (instead of a floating box).
  chrome.runtime.onMessage.addListener((message, _, reply) => {
    if (message?.type !== 'panelStep') return false;
    if (!host.isConnected) { reply({shown: false}); return false; }
    // Why (2026-10-27, minimized Stop): a progress update must keep the person's chosen pill visible, with its Stop button.
    if (message.text) { workerStep = message.text; applyWorking = true; showStep(message.text); if (!open && !userMoved) setOpen(true); }
    else workerStep = '';   // the fill's last step said nothing more; the end is the worker's verdict (applyState)
    reply({shown: true});
    return false;
  });

  // Stop reached this page (stop.js): the step ends (no dim, the corner), the Stop buttons come back, and the panel says "Stopped by you" with Check form again, until the person
  // starts again here (`started`: the Fill, Check form again, the popup's Apply on this page). The app's "stopped" goes with it (its next answer says so too).
  // `at`: when the Stop happened; a Stop older than the person's last start here (its answer arriving late) changes nothing.
  function stoppedHere(at = Date.now()) {
    if (at < startedAt) return;
    if (stopped && !stepShowing()) { stopsBack(); return; }
    stopped = true; markStepWords = ''; endStep(false); stopsBack(); $(NOTE).hidden = true; stoppedCard(true);
    if (!host.hidden && !open) setOpen(true);
    render();
  }
  chrome.runtime.onMessage.addListener(message => {
    if (message?.type === 'stopped') stoppedHere(Number(message.at) || Date.now());
    else if (message?.type === 'started') { startedAt = Math.max(startedAt, Date.now()); stopped = false; stoppedCard(false); stopsBack(); if (session?.stuck === 'stopped') session = {...session, stuck: ''}; stuckSince = 0; lastStuck = ''; render(); }
    return false;
  });

  // A note from the extension's worker (page-notes.js): the panel's own note line, so the page never shows a second box beside it.
  chrome.runtime.onMessage.addListener((message, _, reply) => {
    if (message?.type !== 'panelNote') return false;
    if (!host.isConnected) { reply({shown: false}); return false; }
    note(String(message.text || ''), !!message.anyway); if (!open) setOpen(true);
    reply({shown: true});
    return false;
  });

  // Why (2026-10-27, owner: "we start with dark/glow and the panel in the middle, and keep it until a clear verdict"): the first draw is the worker's state, whatever it takes to answer (no 800 ms race that fell
  // back to the finished look): working draws the dim and the centred panel with the step now ("Starting…" before the first); a verdict draws the finished look. No worker answer at all (the extension is gone) draws it too.
  const stepFirst = send({type: 'panelApply'}).then(answer => {
    if (answer?.state !== 'working') return;   // the host is not on the page yet (the first render attaches it): the look is drawn into it all the same
    applyWorking = true;
    const was = stepped; showStep(answer.text || 'Starting…'); if (!answer.text) stepped = was;
    if (!open) setOpen(true);
  }).catch(() => {});
  // The worker's state changes reach the panel here (a lift also reaches it through the overlay, panel-overlay.js): working draws, a verdict is drawn by endStep.
  chrome.runtime.onMessage.addListener(message => {
    if (message?.type !== 'applyState') return;
    if (message.state === 'working') { applyWorking = true; if (!stepShowing() && host.isConnected) { const was = stepped; showStep(workerStep || 'Starting…'); stepped = was; if (!open) setOpen(true); } }
  });

  const learn = window.__jobPilottoPanelLearn.start({send, alive: () => host.isConnected, form: window.__jobPilottoPanelForm, mine: {box: $('.mine'), list: $('.mine-list')}});

  // ---- in step with the app ----
  let watch = [], timer = null, busy = false, jobAsked = '';
  async function sync() {
    if (!chrome.runtime?.id) { host.remove(); clearInterval(tick); return; }  // this copy was replaced by a reload
    await stepFirst;   // the worker's answer about the step on this page comes before the first draw (above)
    const state = render();
    if (!state || busy) return;
    learn.reportMisses(state.list);
    learn.showMine();
    busy = true;
    try {
      const payload = window.__jobPilottoReviewPayload(state, watch, {agree: AGREE, find});
      const reply = await send({type: 'review', payload});
      moved = !!reply?.moved; movedTab = Number.isInteger(reply?.tab) ? reply.tab : null;
      session = reply?.session || null; claudeAsk = {takeover: reply?.claudeTakeover !== false, help: !!reply?.claudeHelp, always: !!reply?.claudeAlways, auto: !!reply?.claudeAuto, consent: !!reply?.claudeConsent};   // the app's Claude readiness and choices (lib/claude-ready.js)
      cv = reply?.cv || null;
      coverLetterStatus = reply?.coverLetterStatus || null;
      if (reply?.theme === 'light' || reply?.theme === 'dark') jp.dataset.theme = reply.theme; else delete jp.dataset.theme;   // the app's setting, live; 'system' or no app: the system's (panel-markup.js)
      const before = JSON.stringify(watch);
      watch = Array.isArray(reply?.watch) ? reply.watch : [];
      // The app asked to see this form (and maybe one field): this tab comes forward, then the field.
      for (const command of reply?.commands || []) {
        // The app asked this page to reload itself: the repair for a page whose panel died with an older extension
        // instance (an uninstall/reinstall leaves it unable to answer). This panel is alive, so it can do it.
        if (command.reload) { Promise.resolve(send({type: 'panelReloading'})).catch(() => {}).then(() => location.reload()); return; }
        if (command.close) { send({type: 'panelCloseTab'}).catch(() => {}); return; } if (command.fill) { send({type: 'panelFillOne', ...command.fill}).catch(() => {}); continue; }   // cancelled in the app; "Use" there: the worker fills it (fill-flow.js)
        send({type: 'panelShowTab'}).catch(() => {});
        if (!open) setOpen(true);
        if (command.focus) {
          const field = find(command.focus, state.list);
          if (field) flash(field.el);
          send({type: 'focusResult', found: !!field}).catch(() => {});
        }
      }
      // The job once per page (and again when a session matched): title, stage, kit.
      const wanted = session?.url || location.href;
      // The job's details load on the side (Notion can be slow or busy): the check-in, and the app's "show this
      // form", never wait for them.
      if (jobAsked !== wanted) {
        jobAsked = wanted;
        send({type: 'panelBuild'}).then(answer => { build = answer; render(); }).catch(() => {});
        send({type: 'panelJob', url: wanted}).catch(() => ({connected: false})).then(answer => {
          connection = answer;
          // The app answered with an error (Notion busy): ask again in 30 s instead of never on this page.
          if (connection?.retry) setTimeout(() => { if (jobAsked === wanted) jobAsked = ''; }, 30000);
          job = connection?.job || null;
          // Open by itself the first time on a job it knows (you can close it; it stays closed).
          if ((job || session) && !userMoved && !open) setOpen(true);
          render();
        });
      }
      render();
      if (JSON.stringify(watch) !== before) setTimeout(sync, 50);
    } catch { /* the app is closed: the panel still shows the form's progress */ } finally { busy = false; }
  }
  const soon = () => { clearTimeout(timer); timer = setTimeout(sync, 400); };
  document.addEventListener('input', soon, true);
  document.addEventListener('change', soon, true);
  if (document.documentElement) new MutationObserver(soon).observe(document.documentElement, {childList: true, subtree: true});
  const tick = setInterval(sync, 2000);
  sync();
  }
})();
