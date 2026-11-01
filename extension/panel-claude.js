// The stuck page's Claude offer in the form panel (owner, 10 Oct 2026; spec docs/superpowers/specs/2026-10-10-claude-finishes-stuck-pages.md parts 1-4).
// A classic panel script, injected before review.js (which stays frozen at its size: it only hands this file the panel's root and each render's facts through
// window.__jobadabraClaude). Owns: the three choices ("Let Claude finish this page" / "I'll do it myself" / "Always let Claude finish when I'm stuck"), the consent line on
// the first press, the visible 5 s countdown with Cancel for "always", and "Tell me what's needed" when Claude is not ready. It never clicks or types in the page: a press
// asks the app (panelTakeOver), which starts Claude's session; Claude never presses Submit. Guards: desktop/test/panel-claude.test.js (the choices as a pure function),
// the real-extension check (desktop/e2e/test/real-extension.test.mjs).
(() => {
  if (window.__jobadabraClaude) return;
  const COUNT = 5;   // seconds the person sees before "always" starts Claude

  // The view for the facts (info: on = Claude ready, stuck, auto = countdown allowed [always + "Do it for me"], consent) and what the person pressed.
  // mem is what was decided on this page: {phase: null | 'consent' | 'countdown' | 'sent', dismissed}. Pure: the tests drive it.
  const INFORM = ['email', 'told', 'other', 'site_broken'];   // the page says what to do, or the site is broken: no Claude offer (desktop/lib/application-journey.js INFORM; desktop/test/stuck-reasons.test.js)
  function next(info, mem, action = null) {
    if (!info.stuck || INFORM.includes(info.stuck)) return {view: 'hidden', mem: {phase: null, dismissed: false}};
    // Claude's takeover is off (the app's flag, sent with each report): where Claude was offered, a visible "Report this form" button (owner, 15 Oct 2026).
    if (info.takeover === false) return {view: info.report ? 'report' : 'needs', mem};
    if (!info.on) return {view: 'needs', mem};
    const m = {...mem};
    if (action === 'myself' || action === 'cancel') { m.phase = null; m.dismissed = true; }
    else if (action === 'press') m.phase = info.consent ? 'sent' : 'consent';
    else if (action === 'continue' || action === 'done') m.phase = 'sent';
    if (m.dismissed) return {view: 'hidden', mem: m};
    if (!m.phase && info.auto && info.consent) m.phase = 'countdown';
    return {view: m.phase || 'offer', mem: m};
  }

  const STYLE = `.claude-offer { display: flex; flex-direction: column; gap: 8px; padding: 10px; border-radius: 10px; background: var(--soft); font-size: 12.5px; width: 100%; }
    .claude-offer p { margin: 0; } .claude-offer .co-muted { color: var(--muted); }
    .claude-offer .co-row { display: flex; gap: 6px; flex-wrap: wrap; }
    .claude-offer .co-report { width: 100%; padding: 10px 12px; font-weight: 700; }
    .claude-offer .co-always { display: flex; gap: 6px; align-items: center; color: var(--muted); cursor: pointer; }
    .claude-offer .co-count b { font-size: 18px; }`;

  let stopped = false;   // the person's Stop reached this tab (stop.js sends 'stopped'): the line says so instead of "stuck"
  if (typeof chrome !== 'undefined') chrome.runtime?.onMessage?.addListener(message => { if (message?.type === 'stopped') { stopped = true; if (last && shown === 'report') draw('report'); } });
  let box = null, send = null, mem = {phase: null, dismissed: false}, page = '', last = null, shown = null, timer = null;

  function mount(root, sendMessage) {
    send = sendMessage;
    if (!root.querySelector('style[data-claude-offer]')) root.append(Object.assign(document.createElement('style'), {textContent: STYLE}));
    root.querySelector('style:last-of-type').setAttribute('data-claude-offer', '');
    box = root.querySelector('.claude-offer');
  }
  const el = (tag, props = {}, ...kids) => { const node = Object.assign(document.createElement(tag), props); node.append(...kids); return node; };
  const button = (text, action, className = 'secondary') => el('button', {className, textContent: text, onclick: () => act(action)});

  // A press (or the countdown's end): decided by next(); a start is one message to the app, which starts Claude's session (and keeps it to one per application).
  function act(action) {
    if (!last) return;
    if (action === 'needs') { last.needs?.(); return; }
    const before = mem.phase, result = next(last, mem, action);
    mem = result.mem;
    if (result.view === 'sent' && before !== 'sent') {
      const failed = () => { mem = {...mem, phase: null}; shown = null; render(last); };   // the app did not answer: the offer comes back
      send({type: 'panelTakeOver', consent: action === 'continue'}).then(answer => { if (!answer?.ok) failed(); }).catch(failed);
    }
    shown = result.view;
    draw(result.view);
  }

  function draw(view) {
    if (!box) return;
    box.hidden = view === 'hidden';
    if (view !== 'countdown' && timer) { clearInterval(timer); timer = null; }
    if (view === 'hidden') { box.replaceChildren(); return; }
    if (view === 'report') {
      box.replaceChildren(el('p', {}, stopped ? 'Stopped by you.' : 'The extension is stuck on this page.'));   // one Report on the panel: the footer's (review.js); a second button here was two doors to the same card (owner, 19 Oct 2026)
    } else if (view === 'needs') {
      box.replaceChildren(el('p', {}, 'The extension is stuck on this page.'), el('div', {className: 'co-row'}, button('Tell me what\'s needed', 'needs')));
    } else if (view === 'offer') {
      const check = el('input', {type: 'checkbox', checked: !!last.always, onchange: () => { last.always = check.checked; send({type: 'panelClaudeAuto', on: check.checked}).catch(() => {}); }});
      box.replaceChildren(el('p', {}, 'Stuck on this page? Claude works in this tab and stops before Submit.'),
        el('div', {className: 'co-row'}, button('Let Claude finish this page', 'press', 'primary'), button('I\'ll do it myself', 'myself')),
        el('label', {className: 'co-always'}, check, 'Always let Claude finish when I\'m stuck'));
    } else if (view === 'consent') {
      box.replaceChildren(el('p', {}, 'Claude will click and type in this tab without asking each step. It never presses Submit.'),
        el('div', {className: 'co-row'}, button('Continue', 'continue', 'primary'), button('Cancel', 'myself')));
    } else if (view === 'countdown') {
      const count = el('b', {textContent: String(COUNT)});
      box.replaceChildren(el('p', {className: 'co-count'}, 'Claude takes over in ', count, ' s'), el('div', {className: 'co-row'}, button('Cancel', 'cancel')),
        el('p', {className: 'co-muted'}, 'It works in this tab and stops before Submit.'));
      let left = COUNT;
      timer = setInterval(() => { left -= 1; count.textContent = String(Math.max(left, 0)); if (left <= 0) { clearInterval(timer); timer = null; act('done'); } }, 1000);
    } else if (view === 'sent') {
      box.replaceChildren(el('p', {}, 'Claude is starting in Jobadabra. It works in this tab and stops before Submit.'));
    }
  }

  // Called by the panel at every render with what it knows: on, stuck, auto, consent, always (the checkbox), needs() (flashes the first field the person must give).
  // Only a change of view redraws, so the countdown is not restarted by each render.
  function render(info) {
    last = info;
    const key = location.pathname + location.search;
    if (key !== page) { page = key; mem = {phase: null, dismissed: false}; }   // another page of the application: asked again
    const result = next(info, mem);
    mem = result.mem;
    if (result.view !== shown) { shown = result.view; draw(result.view); }
  }
  window.__jobadabraClaude = {next, mount, render, act};
})();
