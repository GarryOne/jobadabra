/* global document, window, getComputedStyle, location */
// The interaction probe: clicks the safe controls of the page that is showing and records what each click did (page change, calls the window made to the app, signs of work
// while it ran, errors thrown). A control that did nothing, an expandable that did not expand, an action that ran long with no sign of work and a click that threw are findings.
// Screenshots cannot show any of these; behaviour can.

const SLOW_MS = 500;       // an app call at least this long should show it is working
const MAX_CONTROLS = 40;
const IDLE_MS = 3000;      // how long a page is watched untouched, to learn the calls it makes by itself (a refresh, a poll)
// Calls that only hand something to another program (a folder in Finder/Explorer, a link in the browser, system settings): reaching the app is the whole effect, and how
// long the other program takes is not the app's to show (#90 "Open Settings" on Windows).
export const EXTERNAL_CHANNELS = new Set(['openExternal', 'openPrivacy', 'showFolder', 'showCvFolder', 'jobLetterOpen', 'showBackups', 'ivRecordings', 'coverLetterOpen']);
// Kinds that are pressed a second time, from a reset page, before they are filed: a state left by an earlier press (a row already open) or a timing fluke does not repeat.
const RECHECK = new Set(['dead-control', 'silent-control', 'expand-broken', 'no-loading-state']);

// What a probe must never press: it deletes, sends, signs in, leaves the app, or spends AI credit.
// restart/relaunch: `\bstart` does not match inside "Restart", and Interviews' "Restart" (microphone denied on a Windows runner) relaunched the app mid-probe.
// look around / set up my own: the demo's way in and out restart the app too (6 Oct 2026: a Windows wander lost its app to "Look around first").
const UNSAFE_TEXT = /\b(delete|remove|quit|exit|restart|relaunch|look around|set up my own|sign\s?(in|out)|log\s?(in|out)|connect|disconnect|install|update|upgrade|apply|submit|send|record|import|replace|run|reset|clear|discard|stop|cancel|retry|start|generate|draft|scan|export|download|unlink|revoke|buy|pay|copy|open in|open settings|folder|finder|explorer|reveal|show in|check|refresh|rebuild|redo|find|search|review|score|prepare|sync|rescan|test)\b/i;
const UNSAFE_CLASS = /danger|destructive/i;

/**
 * Whether the probe may press a control: false for a command, a wand (AI work), unsafe text or class, or a link out; true otherwise.
 * Takes what the page collector reads off the element (text, class, href, data-command, data-wand); never throws.
 */
export function isSafe({text = '', cls = '', href = '', command = '', wand = false}) {
  // data-wand: the app's own mark for a press that starts AI work (renderer/magic.js wand; test/wand-cursor.test.js lists them). Why (#2350, 28 Oct 2026): Focus's
  // one-press "Read Indeed" starts a site read in Chrome; pressed on Focus, Jobs and Strategy it waited 30 s each for an extension and ran the suite over budget.
  if (command || wand) return false;
  if (UNSAFE_TEXT.test(text) || UNSAFE_CLASS.test(cls)) return false;
  return !/^(https?:|mailto:)/i.test(href);
}

// What the click showed, in kinds of bug. `effects`: names of what changed on the page. `calls`: [{channel, ms}] the window made to the app during the click.
export function classify({view, control, effects, calls, loading = false, errors = []}) {
  const name = control.text || control.label;
  const make = (kind, detail) => ({view, severity: 'warning', kind, control: name, label: control.label, detail, source: 'interaction-probe'});
  const found = [];
  if (errors.length) found.push(make('console-error', `Clicking "${name}" threw: ${errors[0].slice(0, 200)}`));
  else if (control.expandable && !effects.includes('expanded toggled') && !effects.includes('control removed')) found.push(make('expand-broken', `"${name}" is an expandable control but clicking it did not expand or collapse anything`));
  else if (!effects.length && !calls.length) found.push(make('dead-control', `Clicking "${name}" did nothing: the page did not change and no call reached the app`));
  // Something changed, but only where nobody can see it: the press wrote its answer (or its failure) into a hidden part of the page (#409, 12 Oct 2026: "Fill from my
  // CV" put "Couldn't read your CV" in a save bar that stays hidden, and the probe counted "structure changed" as working).
  else if (effects.length && effects.every(effect => effect === 'structure changed')) {
    found.push(make('silent-control', `Clicking "${name}" changed nothing the person can see${calls.length ? `: it reached the app (${calls[0].channel}) and` : ':'} its only change is in a hidden part of the page, so the person gets no answer`));
  }
  const slow = calls.filter(call => (call.ms === null || call.ms >= SLOW_MS) && !EXTERNAL_CHANNELS.has(call.channel));
  if (slow.length && !loading && !errors.length) found.push(make('no-loading-state', `"${name}" ran for ${slow[0].ms === null ? 'more than the wait' : `${slow[0].ms} ms`} (${slow[0].channel}) and showed no sign of work: no disabled state, spinner or changed label`));
  return found;
}

// Runs in the page. Finds the visible, enabled controls under `scope`, tags each with data-probe, returns plain facts.
function discover({scope, max}) {
  const root = document.querySelector(scope) || document.body;
  const seen = [];
  for (const old of document.querySelectorAll('[data-probe]')) old.removeAttribute('data-probe');   // tags of an earlier page would match twice
  const visible = el => { const box = el.getBoundingClientRect(); const style = getComputedStyle(el); return box.width > 4 && box.height > 4 && style.visibility !== 'hidden' && style.display !== 'none'; };
  for (const el of root.querySelectorAll('button, [role="button"], summary, [aria-expanded], a[href^="#"]')) {
    if (seen.length >= max) break;
    if (el.getAttribute('aria-pressed') === 'true' || el.getAttribute('aria-selected') === 'true' || el.getAttribute('aria-checked') === 'true' || /(^|\s)(active|selected|current|on)(\s|$)/.test(String(el.className))) continue;   // the option already chosen: pressing it again rightly does nothing
    if (el.disabled || el.getAttribute('aria-disabled') === 'true' || !visible(el) || el.closest('[hidden], nav, .sidebar')) continue;
    el.setAttribute('data-probe', String(seen.length));
    const text = (el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80);
    seen.push({
      id: seen.length, text, cls: String(el.className || ''), href: el.getAttribute('href') || '', command: el.getAttribute('data-command') || '', wand: el.hasAttribute('data-wand'),
      label: `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${typeof el.className === 'string' && el.className ? `.${el.className.trim().split(/\s+/)[0]}` : ''}`,
      expandable: el.hasAttribute('aria-expanded') || el.tagName === 'SUMMARY' || el.hasAttribute('aria-controls'),
    });
  }
  return seen;
}

// Runs in the page. What the page looks like now, for before/after.
function snapshot({id, scope}) {
  const root = document.querySelector(scope) || document.body;
  const el = document.querySelector(`[data-probe="${id}"]`);
  if (!el) return null;
  const structure = [], seen = [];   // seen: the same, for the nodes the person can see
  for (const node of document.body.querySelectorAll('*')) {
    if (node === el) continue;
    const bits = [node.tagName, node.hidden ? 'h' : '', node.getAttribute('aria-expanded') || '', node.getAttribute('aria-hidden') || '', node.open ? 'o' : '', node.disabled ? 'd' : '', node.getAttribute('data-state') || '', typeof node.className === 'string' ? node.className : '',
      node.getAttribute('aria-pressed') || '', node.getAttribute('aria-selected') || '', node.getAttribute('aria-checked') || '', node.getAttribute('aria-current') || ''];
    structure.push(bits.join('|'));
    if (node.checkVisibility ? node.checkVisibility() : node.offsetParent !== null) seen.push(bits.join('|'));
  }
  const target = el.getAttribute('aria-controls') ? document.getElementById(el.getAttribute('aria-controls')) : null;
  const details = el.closest('details');
  return {
    text: (document.body.innerText || '').length + ':' + (document.body.innerText || '').slice(0, 4000),
    structure: structure.join('\n'),
    seen: seen.join('\n'),
    hash: location.hash,
    expanded: [el.getAttribute('aria-expanded'), details ? details.open : null, target ? `${target.hidden}:${Math.round(target.getBoundingClientRect().height)}` : null].join('/'),
    busy: root.querySelectorAll('[aria-busy="true"], .spinner, .skeleton, [data-state="busy"], progress, [disabled]').length,
    own: `${el.disabled}|${el.getAttribute('aria-busy')}|${el.textContent}`,
    // A toggle says it was pressed (aria-pressed on the Jobs stat cards, #81/#82); "Edit target" only moves the focus to a field (#87). Both are effects (a press focuses the pressed control itself: that is not one).
    state: ['aria-pressed', 'aria-selected', 'aria-checked', 'aria-current'].map(name => el.getAttribute(name) || '').join('|'),
    focus: (() => { const active = document.activeElement; if (!active || active === document.body || active === el) return ''; return `${active.tagName}#${active.id}.${active.getAttribute('name') || ''}`; })(),
    scroll: Math.round(window.scrollY),
  };
}

function effectsOf(before, after) {
  if (!after) return ['control removed'];
  const effects = [];
  if (before.text !== after.text) effects.push('text changed');
  if (before.structure !== after.structure) effects.push('structure changed');
  if (before.seen !== after.seen) effects.push('visible structure changed');   // what the person can see changed, not only hidden parts
  if (before.hash !== after.hash) effects.push('location changed');
  if (before.expanded !== after.expanded) effects.push('expanded toggled');
  if (before.own !== after.own) effects.push('control changed');
  if (before.state !== after.state) effects.push('state changed');
  if (before.focus !== after.focus && after.focus) effects.push('focus moved');
  return effects;
}

// A press can leave a dialog open that blocks the next press: Escape first, then close any dialog still open the way its own Close/Cancel would.
async function recover(page) {
  await page.keyboard.press('Escape').catch(() => {});
  await page.evaluate(() => {
    for (const toast of document.querySelectorAll('#toasts .toast')) toast.remove();   // a toast over a control takes the next press
    for (const dialog of document.querySelectorAll('dialog[open]')) {
      const close = [...dialog.querySelectorAll('button')].find(button => /^(cancel|close|not now|no|back|×|✕)\b/i.test(button.textContent.trim()) || button.getAttribute('aria-label') === 'Close');
      if (close) close.click(); else dialog.close();
    }
  }).catch(() => {});
}

const wait = ms => new Promise(done => setTimeout(done, ms));

// The channels the app is called on while nobody touches the page.
async function idleChannels(ipc, ms) {
  if (!ms) return new Set();
  const mark = await ipc.mark();
  await wait(ms);
  return new Set((await ipc.since(mark)).map(call => call.channel));
}

// Click every safe control of the page showing now. `ipc`: {mark(): Promise<number>, since(mark): Promise<[{channel, ms, failed}]>}.
// `arrange(list)` (lib/variation.mjs shuffle) puts the controls in another order and picks a different `max` of them from a wider look, so two runs press different things.
export async function probePage({page, view, ipc, scope = 'body', settleMs = 1500, idleMs = IDLE_MS, max = MAX_CONTROLS, onFlag, reset, arrange = null}) {
  const errors = [];
  const onConsole = message => { if (message.type() === 'error') errors.push(message.text()); };
  const onPageError = error => errors.push(String(error.message || error));
  page.on('console', onConsole);
  page.on('pageerror', onPageError);
  const results = [], findings = [], skipped = [];
  try {
    const look = arrange ? max * 3 : max;
    const found = await page.evaluate(discover, {scope, max: look});
    const controls = (arrange ? arrange(found.filter(control => isSafe(control))) : found.filter(control => isSafe(control))).slice(0, max);
    skipped.push(...found.filter(control => !isSafe(control)).map(control => control.text || control.label));
    // The calls this page makes untouched (its refreshes and polls) are never a click's (#65: a questions refresh was blamed on "Save").
    const background = await idleChannels(ipc, idleMs);
    // One press: what it changed, the calls it made, any sign of work, any error.
    const press = async control => {
      // Scroll the control into view and let the scroll settle BEFORE pressing: a click that scrolls the page itself delivers its scroll event just after the press, and the ⋯ menu
      // closes on any scroll, so a menu below the fold looked broken ("More actions" on Focus, #86/#89).
      await page.locator(`[data-probe="${control.id}"]`).scrollIntoViewIfNeeded({timeout: 2000}).catch(() => {});
      await wait(150);
      const before = await page.evaluate(snapshot, {id: control.id, scope});
      if (!before) return {skip: `${control.text || control.label} (gone)`};
      errors.length = 0;
      const mark = await ipc.mark();
      const clickedAt = Date.now();
      const clicked = await page.locator(`[data-probe="${control.id}"]`).click({timeout: 2000, noWaitAfter: true}).then(() => '', error => String(error.message).split('\n').filter(line => /intercepts|obscur|not visible|not stable|outside|disabled/.test(line)).join(' ').trim() || 'timeout');
      if (clicked) return {skip: `${control.text || control.label} (${clicked.slice(0, 80)})`};
      let loading = false, after = null, calls = [];
      const started = Date.now();
      while (Date.now() - started < settleMs) {
        await wait(100);
        after = await page.evaluate(snapshot, {id: control.id, scope});
        calls = (await ipc.since(mark)).filter(call => call.start >= clickedAt - 50 && call.start <= clickedAt + 500 && !background.has(call.channel));   // a poll that happened to run meanwhile is not this click's
        if (after && (after.busy > before.busy || after.own !== before.own)) loading = true;
        const running = calls.some(call => call.ms === null);
        if (running && after && effectsOf(before, after).length) loading = true;   // the page said something while the call was still running ("updating…")
        if (!running && Date.now() - started >= 300 && (calls.length || effectsOf(before, after).length)) break;
      }
      const effects = effectsOf(before, after);
      const result = {view, control: control.text || control.label, label: control.label, effects, calls: calls.map(call => ({channel: call.channel, ms: call.ms})), loading, errors: [...errors]};
      return {result, flagged: classify({view, control, effects, calls: result.calls, loading, errors: result.errors})};
    };
    for (const control of controls) {
      // A page that drew itself again (or a dialog a press left open) loses the tags: go back to the page, find the control again by its words.
      if (!(await page.locator(`[data-probe="${control.id}"]`).isVisible().catch(() => false))) {
        if (reset) await reset();
        const again = (await page.evaluate(discover, {scope, max: look})).find(item => item.text === control.text && item.label === control.label);
        if (!again) { skipped.push(`${control.text || control.label} (gone)`); continue; }
        control.id = again.id;
      }
      const first = await press(control);
      if (first.skip) { skipped.push(first.skip); continue; }
      let {result, flagged} = first;
      // Pressed again from a reset page before it is filed: only what fails both times is a finding.
      if (flagged.some(item => RECHECK.has(item.kind))) {
        await recover(page);
        if (reset) await reset();
        const tagged = await page.locator(`[data-probe="${control.id}"]`).isVisible().catch(() => false);
        const again = tagged ? control : (await page.evaluate(discover, {scope, max: look})).find(item => item.text === control.text && item.label === control.label);
        const second = again ? await press({...control, id: again.id}) : {skip: 'gone'};
        const kept = second.skip ? [] : new Set(second.flagged.map(item => item.kind));
        // A silent press fails again when it does something (a call, a hidden change) and the person still sees nothing: its hidden answer is often already there.
        if (!second.skip && (second.result.calls.length || second.result.effects.length) && second.result.effects.every(effect => effect === 'structure changed')) kept.add('silent-control');
        flagged = flagged.filter(item => !RECHECK.has(item.kind) || (kept instanceof Set && kept.has(item.kind)));
        result = {...result, rechecked: second.skip ? `not pressed again (${second.skip})` : second.result};
      }
      results.push(result);
      if (flagged.length && onFlag) await onFlag(control, flagged);
      findings.push(...flagged);
      await recover(page);
    }
  } finally {
    page.off('console', onConsole);
    page.off('pageerror', onPageError);
  }
  return {results, findings, skipped};
}
