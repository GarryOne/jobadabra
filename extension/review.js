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
  if (window.__jobPilottoReviewAlive?.() || ['Required', 'ReadBack', 'TitleAbove', 'GroupTitle', 'PanelForm', 'PanelMarkup', 'PanelLearn', 'PanelWritten', 'Overlay'].some(name => !window['__jobPilotto' + name] && (console.warn('Jobadabra panel: helper script missing:', name), true))) return;   // only some helper scripts ran (a reload with the tab open): draw nothing, say which, the next full injection mounts; the option grouping alone is soft
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
  // ONE look: look(true) dims AND centres, look(false) does neither; nothing else turns either on or off, and when the dim lifts by itself (Stop, the 3-minute backstop, a removal
  // from outside) the step ends with it (owner, 27 Oct 2026: "everytime when the extension is working... it should be centered and there should be dark/glowing background").
  // Working = a step shows: the worker's fill steps (panelStep), this panel's own fill, and the page being read or routed (WORKING_MARKS). Not working: done, stopped, needs you, stuck, closed.
  const overlay = window.__jobPilottoOverlay, HOME = host.style.cssText, steps = [];
  const WORKING_MARKS = ['reading', 'posting', 'opening', 'signing-in', 'signing-up'], MARK_STEP_MS = 60000; let markStepWords = '';
  const place = working => { host.style.cssText = working ? 'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:2147483646;pointer-events:none;' : HOME; jp.classList.toggle('working', working); };
  const look = working => { const on = working && !host.hidden; if (on) overlay.on(); else overlay.off(); place(on); };   // a closed panel (its X) has no Stop on the page: never dimmed (#1558)
  const stepShowing = () => $('.fill').classList.contains('is-busy');
  const markWorking = () => WORKING_MARKS.includes(document.documentElement.getAttribute('data-jobpilotto-page') || '') && !stopped && !moved;
  // Why (#2221, owner 27 Oct 2026): a step that ends and the next one that starts within END_GAP_MS are one piece of work, the look stays ("flashes (very short moments)" between steps).
  // Every end the person must see at once (Stop, needs you, stuck, a close, the dim lifted, the fill writing its end on the page) ends without the gap.
  let workerStep = '', endTimer = null; const END_GAP_MS = 700;
  const endSoon = () => { clearTimeout(endTimer); endTimer = setTimeout(() => { endTimer = null; if (stepShowing() && !filling && !workerStep) endStep(); }, END_GAP_MS); };
  overlay.onLift?.(() => { if (stepShowing()) endStep(); else look(false); });
  const drawSteps = () => $('.steps').replaceChildren(...steps.slice(-6, -1).map(text => Object.assign(document.createElement('li'), {textContent: text})));
  const written = window.__jobPilottoPanelWritten.start({send, alive: () => host.isConnected});   // Review my answer beside each written question's box (panel-written.js)
  window.__jobPilottoClaude?.mount(root, send);   // the stuck page's Claude offer: its own script (panel-claude.js)
  const SHOW_TIPS = false;   // the tip line (Fact / Recruiters say / Tip / Worth trying) is off for now (owner, 15 Oct 2026: "hide, disable it, we'll get back to it"); true brings it back
  let stopped = false, stuckSince = 0, stepAt = 0, lastStuck = '', startedAt = 0;   // stopped: the person's Stop reached this page (stop.js), until they start again here (`started`); stuckSince/stepAt: which came last
  let counts = {total: 0, left: 0}, moved = false, movedTab = null, open = false, shown = [], job = null, session = null, connection = null, build = null, claudeAsk = {}, filling = false, userMoved = false, cv = null, asked = false, addMode = false, tipFor = null;

  const setOpen = value => { open = value; card.hidden = !open; if (open) render(); };
  pill.onclick = () => { userMoved = true; setOpen(!open); };
  $('.min').onclick = () => { userMoved = true; setOpen(false); };   // minimise: back to the pill
  $('.x').onclick = () => { userMoved = true; setOpen(false); host.hidden = true; look(false); };   // close: the panel is out of the way until the page loads again; the overlay goes with it and a later step does not bring it back, as the Stop is on the panel (#1558)
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

  // ---- drawing ----
  function render(list = fields()) {
    const needsNow = document.documentElement.getAttribute('data-jobpilotto-needs');
    const account = !!document.querySelector('input[type=password]');
    // An empty password box is filled from the Keychain (asked again now and then; the value never comes to this panel). Asked BEFORE the
    // field count below: a sign-in page has two boxes (Coop's SuccessFactors, live run 8 Oct 2026), too few for a panel.
    if (account && Date.now() - askedPassword > 2000 && [...document.querySelectorAll('input[type=password]')].some(box => (!box.value || (box.hasAttribute('data-jobpilotto-filled') && !document.documentElement.hasAttribute('data-jobpilotto-account-pressed'))) && box.getClientRects().length)) {
      askedPassword = Date.now();
      send({type: 'sitePassword'}).catch(() => {});
    }
    // A sign-in page is too small for a panel, unless the AI says it needs the person, or the extension works on it: then the panel shows what it does (and Stop), centred over the dim.
    if (list.length < MIN_FIELDS && !needsNow && !stepShowing() && !markWorking()) { look(false); host.remove(); return null; }
    if (!host.isConnected) document.documentElement.append(host);
    // The person is needed (a captcha, a question the page asks) or the page is stuck: the step ends (no dim, the corner, no busy step row) so they can act. The app's "stuck" is
    // an older word than a step the extension showed after it (it handed the page over, then fields appeared and it went on: owner, 27 Oct 2026), and never ends this panel's own fill.
    const stuckNow = !!session?.stuck && !(session.live && ['running', 'input'].includes(session.status));
    const stuckWord = stuckNow ? String(session.stuck) : '';
    if (session && stuckWord !== lastStuck) { lastStuck = stuckWord; stuckSince = stuckWord ? Date.now() : 0; }   // from the app's answer changing, not from a sync that brought no session
    const handed = (!!needsNow && !filling) || stopped || (stuckNow && !filling && stepAt <= stuckSince);   // this panel's own fill (Check again, Fill again) reads the page anew: the AI's older "needs you" waits for its end
    if (handed && stepShowing()) endStep(false);
    // The extension reading or routing a page (page-mark.js: reading, posting, opening, signing-in/up) is working like a fill: the same layer and one step row, ending when the mark moves on.
    const markNow = document.documentElement.getAttribute('data-jobpilotto-page') || '';
    const markWorks = WORKING_MARKS.includes(markNow) && !handed && !moved;
    if (markWorks && !filling) { const words = MARK_WORDS[markNow] || 'Apply button detected. Redirecting…'; if (markStepWords !== words) { const first = !markStepWords; markStepWords = words; const was = stepped; showStep(words, MARK_STEP_MS); stepped = was; if (first && !userMoved && !open) setOpen(true); } }
    // Why (#2221, owner 27 Oct 2026): the mark moved on: its row ends. A fill step still running under it (the worker's, or this panel's fill) keeps the look and gets its row back: ending here dropped the dim and the
    // centring until the fill's next step brought them back (owner, 27 Oct 2026: "flashes (very short moments) when the extension panel moves from center to bottom right").
    else if (markStepWords) { markStepWords = ''; if (workerStep || filling) showStep(workerStep || 'Reading the form…'); else endSoon(); }
    // An answer Claude wrote that is now empty (marked amber) still needs you, required or not.
    written.update(list);
    const needed = list.filter(f => f.required || f.ai || f.changed || f.draft);
    shown = needed.filter(f => !f.filled);
    const total = needed.length, left = shown.length, pageMark = (m => (['form', 'account', 'sign-up'].includes(m) ? '' : m || 'reading'))(document.documentElement.getAttribute('data-jobpilotto-page') || ''), ready = !moved && !pageMark && total > 0 && left === 0, needsYou = document.documentElement.getAttribute('data-jobpilotto-needs');
    counts = {total, left};   // the stopped note says what the page holds
    const done = total ? Math.round(100 * (total - left) / total) : 0;
    jp.classList.toggle('ready', ready && !needsYou);
    $('.ring').style.setProperty('--done', done);
    $('.ring span').textContent = moved ? '↗' : pageMark ? '…' : ready && !needsYou ? '✓' : total ? String(left) : '–';
    const readyWords = needsYou ? `Needs you: ${needsYou.replace(/^1$/, 'see what the page asks')}` : account ? (document.documentElement.getAttribute('data-jobpilotto-account-step') === 'sign_up' ? 'Ready to create the account' : document.documentElement.getAttribute('data-jobpilotto-account-step') === 'sign_in' ? 'Ready to sign in' : 'Ready to continue') : 'Ready to submit';   // the AI's veto (account-step.js, form-ready.js): a consent link or a widget the count cannot see
    // A tab the application has moved on from (the app bound another tab of it) never says Ready or counts: only the tab with the form does.
    $('.pill b').textContent = moved ? 'Continues in another tab' : pageMark ? (MARK_WORDS[pageMark] || 'Apply button detected. Redirecting…') : ready || needsYou ? readyWords : total ? `${left} left` : 'Jobadabra';
    $('.pill small').textContent = night() && !pageMark && !moved ? `Last night\u2019s fill is back${(job?.company || session?.company) ? ` · ${job?.company || session?.company}` : ''}` : (job?.company || session?.company) ? (job?.company || session?.company) : ready ? (account ? (document.documentElement.getAttribute('data-jobpilotto-account-step') === 'sign_up' ? 'Review, then create it' : document.documentElement.getAttribute('data-jobpilotto-account-step') === 'sign_in' ? 'Review, then sign in' : 'Review, then continue') : 'Review, then submit') : 'required fields';
    // A fill running (this panel's, Claude's, the popup's) or over: a field filled after it is yours.
    const busy = filling || (session?.live && session.status === 'running') || $('.fill').classList.contains('is-busy');
    jp.classList.toggle('busy', busy);   // the Stop beside the minimised pill shows while a fill runs
    const over = filledOnce || ['done', 'input'].includes(session?.status);
    if (!open) return {list, left, total, busy, over, account};
    // job + Claude
    const title = job?.title || session?.title, company = job?.company || session?.company;
    $('.job').hidden = !title;
    $('.job-title').textContent = title || '';
    $('.job-meta').replaceChildren(...[company && Object.assign(document.createElement('span'), {textContent: company}),
      Object.assign(document.createElement('span'), {className: `tag ${/applied/i.test(job?.stage || '') ? 'good' : ''}`, textContent: job?.stage || 'Not submitted'})].filter(Boolean));
    $('.go-there').hidden = !(moved && Number.isInteger(movedTab));
    const verify = $('.verify');
    verify.hidden = !needsYou || moved || filling;
    if (!verify.hidden) { stoppedCard(false); $('.verify .v-title').textContent = needsYou === '1' ? 'Your action is needed' : needsYou; }   // the AI's own words for what the page waits on
    const claude = pageMark ? '' : moved ? 'This application continues in another tab.'   // an older tab of the session: it no longer reports
      : session?.kind === 'form' ? ''   // the Apply button's session: the extension fills it, there is no Claude to name
      : session?.live && session.status === 'running' ? `AI is filling this form · ${session.note || 'working'}`
      : session?.live && session.status === 'input' ? 'AI is waiting for you in Jobadabra.'
      : session?.status === 'done' ? 'AI filled this form. Review it, then submit it yourself.' : '';
    $('.claude').hidden = !claude;
    $('.claude span').textContent = claude;
    // progress
    $('.progress-line b').textContent = moved ? 'Continues in another tab' : markStepWords ? (title || company || 'Jobadabra') : pageMark ? (MARK_WORDS[pageMark] || 'Apply button detected. Redirecting…') : ready ? readyWords : total ? `${total - left} of ${total}` : 'No required fields';
    $('.progress-line span').textContent = moved || pageMark ? '' : ready ? 'every required field is filled' : total ? 'required fields filled' : '';
    $('.bar i').style.width = `${moved || pageMark ? 0 : ready ? 100 : done}%`;
    // fill (not while Claude is filling this form: it would fight it)
    const claudeFilling = session?.live && session.status === 'running';
    // A tailored CV written after the form was filled still has to be attached: the button stays for that.
    // A sign-in or sign-up page (a password box) is not the application: no CV goes there, so no "Tailor my CV" (owner, 8 Oct 2026).
    const canTailor = !!session && !!connection?.connected && !!connection.app && !!cv && !account && !pageMark;
    const readyNow = canTailor && cv.tailored && asked;
    $('.fill-box').hidden = moved || claudeFilling || (ready && !filling && !readyNow);  // nothing left to fill
    $('.fill').disabled = filling;
    // What's left for you, once the filling is over: before and during it, nearly every field is still to be filled
    // by the extension or Claude, not by you (the ring and the bar show the progress meanwhile).
    $('.left h4').textContent = left === 1 ? 'Remaining field' : 'Remaining fields';
    $('.left').hidden = moved || !!pageMark || !left || busy || !over;
    const knockout = field => KNOCKOUT.test(field.label) || field.category === 'knockout', ranked = [...shown].sort((a, b) => knockout(b) - knockout(a));   // or the AI, any language
    const knockouts = ranked.filter(knockout).length;
    $('.knock').hidden = !knockouts;
    $('.knock').textContent = 'Some of these can trigger automatic rejection if the employer has set a knockout rule (work permit, sponsorship, location, office days); others are only flagged for review. Answer them truthfully: they can decide more than the CV.';
    $('.list').replaceChildren(...ranked.slice(0, 30).map(field => {
      const row = Object.assign(document.createElement('button'), {className: 'item'});
      row.append(Object.assign(document.createElement('i'), {textContent: knockout(field) ? '⛔' : AGREE.test(field.label) || field.category === 'legal' ? '⚖️' : field.draft ? '✍️' : '○'}),
        Object.assign(document.createElement('span'), {textContent: field.label.slice(0, 120) || 'A required field'}),
        ...(field.draft ? [Object.assign(document.createElement('span'), {className: 'tag warn', textContent: field.draft === 'outline' ? 'Outline: complete it' : 'Drafted for you: review'}),   // typed by us, never counted as done until read (owner, 16 Oct 2026)
          Object.assign(document.createElement('span'), {className: 'tag', textContent: 'Review my answer', onclick: event => { event.stopPropagation(); flash(field.el); written.review(field); }})] : []),
        Object.assign(document.createElement('span'), {className: 'go', textContent: '›'}));
      row.onclick = () => flash(field.el);
      return row;
    }));
    // A CV written for this job gets noticeably more replies than the general one: offered while the form is still open, the person's click (it costs a few cents).
    // Once it is written the fill has to run again to attach it.
    const tailor = $('.tailor');
    // What the app says it did with the press (desktop/lib/tailor-status.js): shown while it runs, and for the press made on this panel; every branch is said here.
    const said = cv?.status && (asked || ['running', 'adding'].includes(cv.status.state)) ? cv.status : null;
    const running = !!cv?.working || said?.state === 'running', adding = said?.state === 'adding';
    tailor.hidden = !canTailor || (cv.tailored && !asked && !said);
    if (!tailor.hidden) {
      const letterNote = said?.letter === false ? ' (the letter was not made)' : '';
      $('.t-text').textContent = adding ? 'Adding this job to your list…'
        : running ? 'Tailoring your CV + cover letter for this job… about 1–2 minutes.'
        : said?.state === 'not-listed' ? 'This job is not in your list yet.'
        : said?.state === 'added' ? 'Added to your list. Now tailor the CV + letter.'
        : said?.state === 'failed' ? `Not done: ${said.error || 'try again'}`
        : readyNow ? `Tailored: CV + letter ready${letterNote}. Press Fill again to attach them.` : 'General CV attached';
      $('.t-text').title = 'A CV tailored to this job gets noticeably more replies. The cover letter is attached only if the form asks for one.';
      $('.t-btn').hidden = readyNow || running || adding;
      addMode = said?.state === 'not-listed';
      $('.t-btn').textContent = addMode ? 'Add this job' : said?.state === 'failed' ? 'Try again' : 'Tailor CV + letter';
    }
    // One tip at the bottom, about what the form is at: knockout questions left, no tailored CV yet, else the CV. Click for the next one.
    const prefer = knockouts ? 'knockout' : canTailor && !cv.tailored ? 'tailor' : 'cv';
    if (SHOW_TIPS && tipFor !== prefer && connection?.connected) { tipFor = prefer; askTip(); }
    // actions + connection
    $('.open-app').hidden = !session;
    window.__jobPilottoClaude?.render({on: !!connection?.connected && !!connection.app && !!claudeAsk.help, stuck: !needsYou && handed && !stopped, always: !!claudeAsk.always, auto: !!claudeAsk.auto, consent: !!claudeAsk.consent, takeover: claudeAsk.takeover !== false, report: !!window.__jobPilottoReportOn, needs: () => shown[0] && flash(shown[0].el)});   // offered, never automatic unless "always" (panel-claude.js)
    // The footer, one component for every state (owner, 16 Oct 2026): the connection on the left (a dot and its word; the build stays in the line, it is in every screenshot), Report on the right.
    const foot = $('.foot'), stateLine = $('.foot .state');
    foot.classList.toggle('on', !!connection?.connected);
    foot.classList.toggle('off', !!connection && !connection.connected);
    const word = connection?.connected ? 'Connected' : connection ? 'Not connected' : 'Checking the connection…';   // the reason is in the tooltip
    const version = chrome.runtime.getManifest().version;
    stateLine.textContent = `${word} · v${version}${build?.label ? ` · ${build.label}` : ''}`;
    foot.title = `${connection?.connected ? (connection.app ? (session ? 'In sync with Jobadabra' : 'Connected to Jobadabra') : 'Connected to your Worker') : (connection?.why || 'Not connected: the form still fills from your settings')} · Jobadabra extension v${version}${build?.label ? ` (${build.label})` : ''}`;
    if (build && build.behind !== 0 && build.behind !== undefined) {
      const reload = Object.assign(document.createElement('button'), {className: 'reload', textContent: build.reloadLabel || 'Reload the extension to get the latest fixes'});
      reload.addEventListener('click', () => { reload.disabled = true; reload.textContent = 'Reloading…'; send({type: 'panelReload'}).catch(() => {}); });
      stateLine.append(reload);
    }
    return {list, left, total, busy, over, account};
  }

  // ---- actions ----
  // What the fill is doing, shown in the button; a fill's empty end step ends it. The timer is only a safety net: 45 s, not 6 (owner, 15 Oct 2026: "Fill again" showed while Claude's later pass was still answering).
  let stepTimer = null, filledOnce = false, stepped = false; const STEP_SAFETY_MS = 45000;
  function showStep(text, wait = STEP_SAFETY_MS) {
    stepped = true;
    $('.step-hint').textContent = /^check/i.test(text) ? 'Checking whether any fields need your input.' : /^(reading this page|putting back)/i.test(text) ? 'Looking for the application on this page.' : /^(apply button|logging in|creating your)/i.test(text) ? 'Taking you to the application form.' : 'Counts update as new fields appear.';   // our own step words, each with its sub-line (mockups 01/02)
    if (steps.at(-1) !== text) { if (steps.includes(text)) steps.splice(steps.indexOf(text), 1); steps.push(text); drawSteps(); }   // "Done so far" never repeats the step now on
    stepAt = Date.now(); clearTimeout(endTimer);
    look(true);
    const button = $('.fill');
    button.classList.add('is-busy');
    button.setAttribute('aria-busy', 'true');
    button.title = text;
    $('.fill .label').textContent = text;
    clearTimeout(stepTimer);
    if (!filling) stepTimer = setTimeout(endStep, wait);
  }
  function endStep(redraw = true) {
    clearTimeout(stepTimer); clearTimeout(endTimer); workerStep = '';
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
  $('.t-btn').onclick = async event => {
    const told = await ask(event.currentTarget, 'Asking Jobadabra…', {type: addMode ? 'panelAddJob' : 'panelTailor'}, APP_DOWN);
    if (told?.ok) asked = true;
    render();
    sync();   // the app's answer (started / not in your list / failed) comes now, not on the next tick
  };
  $('.go-there').onclick = () => Number.isInteger(movedTab) && send({type: 'panelGoTab', tab: movedTab}).catch(() => {});
  $('.open-app').onclick = event => session && ask(event.currentTarget, 'Opening…', {type: 'panelOpenApp', session: session.id}, APP_DOWN);
  // The extension's fill reports its steps here (instead of a floating box).
  chrome.runtime.onMessage.addListener((message, _, reply) => {
    if (message?.type !== 'panelStep') return false;
    if (!host.isConnected) { reply({shown: false}); return false; }
    if (message.text) { workerStep = message.text; showStep(message.text); if (!open) setOpen(true); }
    else { workerStep = ''; if (!filling) endSoon(); }  // the fill is over: no step line left over a form that is ready; this panel's own fill ends at its answer (fill())
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

  // Why (#2221, owner 27 Oct 2026: "instantly show the overlay"): the page was dimmed from its first moment (early-dim.js): the panel takes that look over at once, centred, so nothing jumps between the dim and the first step.
  if (overlay.early?.()) { const was = stepped; showStep('Starting…', 20000); stepped = was; setOpen(true); }
  // A fill already on a step when this panel appeared: show it here (the background removes its floating copy).
  send({type: 'panelStepNow'}).then(answer => { if (answer?.text && host.isConnected) { showStep(answer.text, answer.wait || STEP_SAFETY_MS); if (!open) setOpen(true); } }).catch(() => {});

  const learn = window.__jobPilottoPanelLearn.start({send, alive: () => host.isConnected, form: window.__jobPilottoPanelForm});

  // ---- in step with the app ----
  let watch = [], timer = null, busy = false, jobAsked = '';
  async function sync() {
    if (!chrome.runtime?.id) { host.remove(); clearInterval(tick); return; }  // this copy was replaced by a reload
    const state = render();
    if (!state || busy) return;
    learn.reportMisses(state.list);
    busy = true;
    try {
      const payload = window.__jobPilottoReviewPayload(state, watch, {agree: AGREE, find});
      const reply = await send({type: 'review', payload});
      moved = !!reply?.moved; movedTab = Number.isInteger(reply?.tab) ? reply.tab : null;
      session = reply?.session || null; claudeAsk = {takeover: reply?.claudeTakeover !== false, help: !!reply?.claudeHelp, always: !!reply?.claudeAlways, auto: !!reply?.claudeAuto, consent: !!reply?.claudeConsent};   // the app's Claude readiness and choices (lib/claude-ready.js)
      cv = reply?.cv || null;
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
  // Why (#2221, 27 Oct 2026): the fill writes its end on the page (done, error, no-form…) before its bookkeeping and its step clear: the look ends then, with no gap, so the person's
  // first click after "done" is theirs (the apply suite's Next and Submit were held). The panel's own fill ends at its answer (fill()); a page still being read keeps its look.
  const fillOver = () => { try { return !['', 'running', 'received'].includes(JSON.parse(document.documentElement.dataset.jobpilottoFill || '{}').state || ''); } catch { return false; } };
  if (document.documentElement) new MutationObserver(() => { if (!filling && stepShowing() && !markWorking() && fillOver()) endStep(); }).observe(document.documentElement, {attributes: true, attributeFilter: ['data-jobpilotto-fill']});
  const tick = setInterval(sync, 2000);
  sync();
  }
})();