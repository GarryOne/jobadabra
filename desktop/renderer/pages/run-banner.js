// The compact run banner on Actions (owner, 25 Oct 2026: "the compact version should be always something like this", the running banner): a queued or
// finished run as one line, in the running banner's look (.run-banner, toned): icon, task name + status pill, one meta line, the next step or fix,
// Run again when it did not end well, View details, then Cancel or Dismiss. The full report is the run panel's (drawer / Actions → Runs), never here. Model: renderer/run-compact.js.
// Guarded by test/run-compact.test.js.
import {el, pill, tile} from '../components.js';

const TONES = ['good', 'warn', 'bad', 'info', 'neutral'];

// Draws `model` into `box` (a .run-banner section). `on`: {view(), next(next), again(), close(close)}.
export function drawBanner(box, model, on = {}) {
  for (const tone of TONES) box.classList.toggle(`tone-${tone}`, model?.tone === tone);
  if (!model) { box.replaceChildren(); return; }
  const words = el('div', 'run-banner-words'), head = el('div', 'run-banner-head');
  head.append(el('b', '', model.title), pill(model.pill[0], model.pill[1], {dot: true}));
  words.append(head, el('span', 'muted', model.line));
  const button = (cls, text, run) => Object.assign(el('button', cls, text), {type: 'button', onclick: run});
  box.replaceChildren(tile(model.icon, model.tone), words,
    ...(model.next ? [button('primary', model.next.label, () => on.next?.(model.next))] : []),
    ...(model.again ? [button(model.next ? 'secondary' : 'primary', 'Run again', () => on.again?.())] : []),
    button('secondary run-banner-view', 'View details', () => on.view?.()),
    model.close.cancel ? button('secondary', model.close.label, () => on.close?.(model.close))
      : button('link', model.close.label, () => on.close?.(model.close)));
}
