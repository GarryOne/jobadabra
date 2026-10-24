/* global document, getComputedStyle */
// The AI explorer: Claude USES the app (a compact text view of the page and a few tools), like a curious, careful person, on paths no suite scripted.
// Every bug it reports carries a CHECK a script can verify, and is replayed WITHOUT AI from a fresh page: only a bug whose check holds again becomes a
// finding (filed by the Finder like any other). "The agent explores, a script proves": an AI's one-off judgement never reaches the issue list alone.
// Safety: it presses only what the interaction probe may press (lib/interact.mjs isSafe), never Enter, and types at most 200 characters.
import {isSafe} from './interact.mjs';

export const CHECKS = ['text_visible', 'text_missing', 'console_error', 'dead_control'];
export const KEYS = ['Escape', 'Tab', 'Shift+Tab', 'ArrowDown', 'ArrowUp'];
const KINDS = ['functionality', 'error-shown', 'text', 'layout', 'consistency', 'empty-state'];

export function tools(views) {
  return [
    {name: 'click', description: 'Press a control by its index in the latest page view.', input_schema: {type: 'object', properties: {control: {type: 'integer'}}, required: ['control']}},
    {name: 'type', description: 'Type text into a field (by index). Enter is never pressed.', input_schema: {type: 'object', properties: {control: {type: 'integer'}, text: {type: 'string'}}, required: ['control', 'text']}},
    {name: 'press', description: 'Press a key.', input_schema: {type: 'object', properties: {key: {type: 'string', enum: KEYS}}, required: ['key']}},
    {name: 'go', description: 'Open a page from the sidebar. Your replayable steps for a bug start at your latest go.', input_schema: {type: 'object', properties: {view: {type: 'string', enum: views}}, required: ['view']}},
    {name: 'report_bug', description: 'Report a bug you can SHOW, with a check a script can verify after replaying your steps since your latest go.',
      input_schema: {type: 'object', required: ['title', 'kind', 'severity', 'what', 'check'], properties: {
        title: {type: 'string', description: 'At most 8 words.'}, kind: {type: 'string', enum: KINDS}, severity: {type: 'string', enum: ['high', 'medium', 'low']},
        what: {type: 'string', description: 'What you did, what you saw, what you expected.'},
        check: {type: 'object', required: ['type'], properties: {type: {type: 'string', enum: CHECKS}, text: {type: 'string', description: 'Exact text for text_visible / text_missing.'},
          control: {type: 'string', description: 'The control label for dead_control.'}}}}}},
    {name: 'done', description: 'Stop exploring.', input_schema: {type: 'object', properties: {summary: {type: 'string'}}}},
  ];
}

export const SYSTEM = `You test the Jobadabra desktop app (a job-search tool) in a TEST account, like a curious, careful person who wants to find real bugs.
Explore what scripted tests miss: multi-step flows, doing things in an odd order, filters and sorting, opening and closing things, going away and coming back, empty and error states.
A real bug, by severity: high = it BLOCKS a task (a needed control missing or doing nothing, a wrong result or false status, a raw error or technical text shown, lost data);
medium = it confuses the person or makes them work around it, or it is plainly bad UX; low = barely noticeable.
Never report: taste; a toast, tooltip or animation caught half-way; a guess about how the app works inside; anything you cannot show on the page.
Every report needs a CHECK a script can verify after replaying your steps since your latest "go": text_visible / text_missing with EXACT text you saw, console_error, or dead_control
with the control's label. Prefer few, solid reports over many weak ones. Controls marked [not allowed] are refused (they delete, send, sign in, leave the app or spend AI credit).
You have a limited number of steps: when you have explored enough, call done.`;

// Runs in the page: what a person sees (the visible page's text, open dialogs and toasts) and the controls, each tagged data-explore=<index>.
export function observePage() {
  for (const old of document.querySelectorAll('[data-explore]')) old.removeAttribute('data-explore');
  const visible = el => { const box = el.getBoundingClientRect(); const style = getComputedStyle(el); return box.width > 2 && box.height > 2 && style.visibility !== 'hidden' && style.display !== 'none' && !el.closest('[hidden]'); };
  const controls = [];
  for (const el of document.querySelectorAll('button, a[href], [role="button"], [role="tab"], input, textarea, select, summary')) {
    if (controls.length >= 120 || !visible(el) || el.closest('nav, .sidebar')) continue;
    const kind = /^(INPUT|TEXTAREA)$/.test(el.tagName) ? 'field' : el.tagName === 'SELECT' ? 'select' : el.tagName === 'A' ? 'link' : 'button';
    const label = (el.getAttribute('aria-label') || el.textContent || el.getAttribute('placeholder') || el.getAttribute('name') || '').replace(/\s+/g, ' ').trim().slice(0, 80);
    el.setAttribute('data-explore', String(controls.length));
    controls.push({i: controls.length, kind, label, disabled: !!el.disabled, cls: String(el.className || ''), href: el.getAttribute('href') || '', type: el.getAttribute('type') || ''});
  }
  const shown = document.querySelector('.view:not([hidden])');
  const text = (shown?.innerText || document.body.innerText || '').replace(/\n{3,}/g, '\n\n').slice(0, 3000);
  const overlays = [...document.querySelectorAll('#toasts .toast, dialog[open]')].map(node => node.innerText.replace(/\s+/g, ' ').trim().slice(0, 200)).filter(Boolean);
  return {view: shown?.dataset.view || '', text, overlays, controls};
}

// Typing into a field presses nothing (Enter is never sent), so a field named "Search" is allowed; a password field never is. Anything pressable follows the probe's rule.
export const allowed = control => !control.disabled && control.type !== 'password' && (control.kind === 'field' || isSafe({text: control.label, cls: control.cls, href: control.href}));

export function formatObservation(seen) {
  return [`Page: ${seen.view || '(unknown)'}`, ...(seen.overlays.length ? [`Open dialogs and toasts: ${seen.overlays.join(' | ')}`] : []), '', 'Visible text:', seen.text, '',
    'Controls (index · kind · label):', ...seen.controls.map(c => `${c.i} · ${c.kind} · ${c.label || '(no label)'}${c.disabled ? ' [disabled]' : ''}${allowed(c) ? '' : ' [not allowed]'}`)].join('\n');
}

// The replayable steps of a report: from the latest "go" before it (or the start) to the report.
export function segmentFor(log, at) {
  let start = 0;
  for (let i = Math.min(at, log.length) - 1; i >= 0; i--) if (log[i].tool === 'go') { start = i; break; }
  return log.slice(start, at).filter(step => ['go', 'click', 'type', 'press'].includes(step.tool));
}
export const stepWords = step => (step.tool === 'go' ? `Open ${step.view}` : step.tool === 'click' ? `Press "${step.label}"` : step.tool === 'type' ? `Type "${step.text}" into "${step.label}"` : `Press the ${step.key} key`);

// The loop. `act`: {observe(), click(i), type(i, text), press(key), go(view)}; `ask(messages)` -> an Anthropic Messages response. Stops at maxSteps, at maxUsd, on done, or when the
// API refuses (a limit: nothing is filed from a run that could not finish thinking).
export async function explore({act, ask, cost = () => 0, views, maxSteps = 40, maxUsd = 1.5, log = () => {}}) {
  const steps = [], bugs = [];
  let usd = 0, seen = await act.observe(), stopped = 'steps';
  const messages = [{role: 'user', content: `Start. You have ${maxSteps} steps.\n\n${formatObservation(seen)}`}];
  for (let turn = 0; turn < maxSteps; turn++) {
    let response;
    try { response = await ask(messages); } catch (error) { stopped = `api: ${String(error.message).slice(0, 160)}`; break; }
    usd += cost(response.usage || {});
    messages.push({role: 'assistant', content: response.content});
    const uses = (response.content || []).filter(block => block.type === 'tool_use');
    if (!uses.length) { stopped = 'no tool'; break; }
    const results = [];
    let finished = false;
    for (const use of uses) {
      const input = use.input || {};
      let reply = '';
      if (use.name === 'done') { finished = true; reply = 'Stopped.'; }
      else if (use.name === 'report_bug') {
        if (!CHECKS.includes(input.check?.type)) reply = `Refused: the check must be one of ${CHECKS.join(', ')}.`;
        else { bugs.push({...input, steps: segmentFor(steps, steps.length), at: steps.length}); reply = 'Recorded. It will be replayed without AI.'; }
      } else {
        const control = Number.isInteger(input.control) ? seen.controls[input.control] : null;
        if ((use.name === 'click' || use.name === 'type') && (!control || !allowed(control))) reply = `Refused: control ${input.control} is ${control ? 'not allowed' : 'not in the latest page view'}.`;
        else if (use.name === 'type' && control.kind !== 'field') reply = 'Refused: that control is not a field.';
        else {
          const step = use.name === 'go' ? {tool: 'go', view: input.view} : use.name === 'press' ? {tool: 'press', key: input.key}
            : {tool: use.name, label: control.label, kind: control.kind, ...(use.name === 'type' ? {text: String(input.text || '').slice(0, 200)} : {})};
          try { await act[use.name](use.name === 'go' ? input.view : use.name === 'press' ? input.key : control.i, step.text); steps.push(step); }
          catch (error) { reply = `That failed: ${String(error.message).split('\n')[0].slice(0, 160)}\n\n`; }
          seen = await act.observe();
          reply += formatObservation(seen);
        }
      }
      results.push({type: 'tool_result', tool_use_id: use.id, content: reply});
    }
    // Older page views are dropped from the conversation: the latest one is what matters, and the cost stays flat.
    for (const message of messages.slice(0, -1)) if (message.role === 'user' && Array.isArray(message.content)) for (const block of message.content) if (block.type === 'tool_result' && block.content.length > 400) block.content = '(an earlier page view, omitted)';
    messages.push({role: 'user', content: results});
    log(`  step ${turn + 1}: ${uses.map(use => use.name).join(', ')} ($${usd.toFixed(3)})`);
    if (finished) { stopped = 'done'; break; }
    if (usd >= maxUsd) { stopped = `budget $${maxUsd}`; break; }
  }
  return {steps, bugs, usd, stopped};
}

// Replays a report's steps WITHOUT AI and evaluates its check. `act` as above plus readText(), errorsSince(mark) / errorMark(), and measure(label) -> {changed, calls} for a press.
export async function replay({act, bug}) {
  const mark = act.errorMark();
  for (const step of bug.steps) {
    if (step.tool === 'go') await act.go(step.view);
    else if (step.tool === 'press') await act.press(step.key);
    else {
      const seen = await act.observe();
      const control = seen.controls.find(c => c.label === step.label && c.kind === step.kind && allowed(c));
      if (!control) return {reproduced: false, why: `"${step.label}" was not on the page when replayed`};
      await act[step.tool](control.i, step.text);
    }
  }
  const check = bug.check;
  if (check.type === 'text_visible' || check.type === 'text_missing') {
    const has = (await act.readText()).replace(/\s+/g, ' ').includes(String(check.text || '').replace(/\s+/g, ' ').trim());
    const held = check.type === 'text_visible' ? has && !!String(check.text || '').trim() : !has;
    return {reproduced: held, why: `"${check.text}" ${has ? 'is' : 'is not'} on the page`};
  }
  if (check.type === 'console_error') { const errors = act.errorsSince(mark); return {reproduced: errors.length > 0, why: errors[0] ? `console: ${errors[0].slice(0, 160)}` : 'no console error'}; }
  const result = await act.measure(String(check.control || ''));
  return {reproduced: !!result && !result.changed && !result.calls, why: result ? `pressing "${check.control}": ${result.changed ? 'the page changed' : 'nothing changed'}, ${result.calls} call(s)` : `"${check.control}" not found`};
}
