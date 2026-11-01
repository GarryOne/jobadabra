// panel popup: restyled by the panel redesign. "Report" in the panel's footer (owner, 19 Oct 2026: the recording is always on, so Report sends it): a small popup ON the panel that says what goes, takes an
// optional note, then Send or Cancel. Nothing is recorded or reloaded by pressing it: the worker (messages-report.js) hands the trace kept so far to the app, which removes the personal details, holds
// the result and answers with counts; Send sends that, Cancel drops it. Drawn inside the panel's own shadow root with the panel's CSS tokens (so its theme reaches it); review.js mounts it and opens it.
// It still works after a Stop (the recording kept until then is what is sent). Guard: desktop/test/report-panel.test.js, desktop/e2e/test/report-button.test.mjs.
(() => {
  if (window.__jobadabraReport) return;
  const STYLE = `.report-pop { position: fixed; right: 18px; bottom: 84px; width: 348px; max-width: calc(100vw - 36px); z-index: 2; padding: 14px; border-radius: 14px; color: var(--ink); background: var(--card);
      border: 1px solid var(--line); box-shadow: 0 10px 32px var(--shadow); pointer-events: auto; }
    .report-pop b { display: block; margin-bottom: 6px; font-size: 14px; } .report-pop p { margin: 0 0 8px; } .report-pop .muted { color: var(--muted); font-size: 12px; }
    .report-pop textarea { width: 100%; min-height: 54px; resize: vertical; padding: 7px 9px; border-radius: 8px; border: 1px solid var(--line); background: var(--soft); color: var(--ink); font: inherit; }
    .report-pop .row { display: flex; gap: 8px; justify-content: flex-end; margin-top: 10px; }
    .report-pop .act { padding: 7px 14px; border-radius: 8px; border: 1px solid var(--line); background: var(--btn); color: var(--ink); font-weight: 600; }
    .report-pop .act.main { background: var(--signal); border-color: var(--signal); color: var(--on-signal); } .report-pop .act[disabled] { opacity: .6; cursor: default; }
    .report-pop .act:focus-visible, .report-pop textarea:focus-visible { outline: 3px solid var(--info); outline-offset: 2px; }`;
  const WORDS = {stopped: 'Jobadabra was stopped before anything was recorded on this page. Press Apply in the app to start again.',
    off: 'The recording is turned off in Jobadabra Settings, so there is nothing to send.', empty: 'Nothing has been recorded on this page yet (a sign-in page is never recorded). Try again after the page has loaded.',
    worker: 'Jobadabra could not reach its extension service. Reload this page and try again.', app: 'The Jobadabra app did not answer. Is the app open? Open it and press Report again.', expired: 'This report expired. Press Report again.',
    failed: 'The app hit an error while preparing this report, so nothing was sent. Press Report again; if it repeats, the app\'s log says what stopped it.',
    connect: 'The extension is not connected to the app. Open Jobadabra, then reload this page and press Report again.',
    old: 'This version of the app does not have Report yet. Update the app, then try again.',
    error: 'The extension hit an error while handing over the recording. Reload this page and try again.',
    unknown: 'The app did not understand the request. Update the app and the extension to the same version.',
    other: 'Something unexpected stopped the report, so nothing was sent. Press Report again.'};
  const BLOCKED = 'Jobadabra could not remove everything personal from it safely, so nothing was sent.';   // the same sentence the app logs
  const KINDS = {email: 'an e-mail address', phone: 'a phone number', name: 'your name', 'name-in-code': 'your name inside a script', location: 'your place', token: 'a sign-in token'};
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  let pop = null, send = null;

  const say = (title, text, buttons = [], extra = []) => {
    pop.replaceChildren();
    const head = document.createElement('b'), body = document.createElement('p'), row = document.createElement('div');
    head.textContent = title; body.textContent = text; row.className = 'row';
    for (const [label, main, onPress] of buttons) {
      const button = document.createElement('button');
      button.type = 'button'; button.className = `act${main ? ' main' : ''}`; button.textContent = label;
      button.addEventListener('click', event => { if (event.isTrusted) onPress(button); });   // a page's script cannot press it for the person
      row.append(button);
    }
    pop.append(head, body, ...extra, row);
    pop.hidden = false;
  };
  const close = () => { pop.hidden = true; };
  // The one true sentence for an answer that is not ok: its kind, else what the last check found, else what the upload said; never "the app is not open" unless the app did not answer.
  const refusal = answer => (WORDS[answer?.refused] || (answer?.blocked ? `${BLOCKED} Still found: ${[...new Set((answer.blocked || []).map(kind => KINDS[kind] || kind))].join(', ')}.` : answer?.error || WORDS.other));
  const ask = message => (send ? send(message).catch(() => null) : Promise.resolve(null));

  async function open() {
    say('Send this form\'s recording?', 'Preparing what would be sent…', [['Cancel', false, close]]);
    const state = await ask({type: 'report-state'});
    if (!state) { say('Nothing was sent', WORDS.worker, [['OK', true, close]]); return; }
    if (state.problem) { say('Nothing was sent', refusal({refused: state.problem}), [['OK', true, close]]); return; }   // the app could not be asked: that is not "turned off"
    if (state.enabled === false) { say('Nothing to send', WORDS.off, [['OK', true, close]]); return; }
    if (!state.has) { say('Nothing to send yet', WORDS[state.stopped ? 'stopped' : 'empty'], [['OK', true, close]]); return; }
    const answer = await ask({type: 'report-send'});
    if (!answer?.ok) { say('Nothing was sent', answer ? refusal(answer) : WORDS.worker, [['OK', true, close]]); return; }
    const data = answer.preview || {}, removed = Object.values(data.removed || {}).reduce((sum, n) => sum + (Number(n) || 0), 0);
    const note = Object.assign(document.createElement('textarea'), {placeholder: 'What went wrong? (optional)', maxLength: 300});
    const lines = document.createElement('div');
    lines.innerHTML = '<p class="muted"></p><p class="muted">Never sent: what you typed, passwords, cookies, your CV or your profile. Encrypted before it leaves this Mac; deleted after 30 days.</p>';
    lines.firstChild.textContent = `${plural(data.responses || 0, 'page response')} from ${plural((data.hosts || []).length, 'site')}. Personal details removed: ${removed}.${data.removed?.unclean ? ' One page part could not be cleaned, so it was left out.' : ''}`;
    say('Send this form\'s recording?', 'It shows how Jobadabra read this form, so it can be fixed.', [['Cancel', false, async () => { close(); ask({type: 'report-cancel'}); }], ['Send', true, async button => {
      button.disabled = true; button.textContent = 'Sending…';
      const done = await ask({type: 'report-confirm', note: note.value});
      if (done?.ok) say('Sent', 'Thank you. It is encrypted, and you can delete it any time in Jobadabra Settings.', [['OK', true, close]]);
      else say('Nothing was sent', done ? refusal(done) : WORDS.worker, [['OK', true, close]]);
    }]], [lines.firstChild, lines.lastChild, note]);
  }

  // review.js hands over the panel's shadow root and its message function, then opens the popup from the footer's Report. The first state answer goes back to review.js (whether the switch is on).
  function mount(root, sendMessage, onState = () => {}) {
    send = sendMessage;
    root.append(Object.assign(document.createElement('style'), {textContent: STYLE}));
    pop = Object.assign(document.createElement('div'), {className: 'report-pop', hidden: true});
    pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', 'Send this form\'s recording');
    (root.querySelector('.jp') || root).append(pop);   // inside the panel's own box: its fonts and colour tokens apply
    ask({type: 'report-state'}).then(onState);
  }
  window.__jobadabraReport = {mount, open, words: WORDS, sentence: refusal};   // words and sentence: for desktop/test/report-failures.test.js
})();
