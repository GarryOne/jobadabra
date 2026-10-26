// "Find jobs using your browser" offered on the card of a finished Find jobs run (owner, 26 Oct 2026: "It should be suggested to the user as an action button";
// "there should be a button on the card where the "find jobs" finished"). The sites that refused the engine are read in the person's browser only after this
// press (lib/refused-now.js); how many is settings.refusedOffer, kept when the run ended (lib/refused-offer.js). The words and when: browser-offer-rows.js; ⌘K: nav.js. Guard: test/refused-reads-button.test.js.
import {el} from '../components.js';
import {icon} from '../icons.js';
import {ALLOW, LABEL, browserOffer} from './browser-offer-rows.js';


let pressedFor = '';   // the offer already pressed: a redraw before its pass starts keeps the button off
// Draws the offer under `anchor` (the card's Recommended next step), or removes it. `start` is the press (lib/refused-reads-handlers.js refusedReadStart).
export function drawBrowserOffer(anchor, run, context, start = () => window.pilot.refusedReadStart()) {
  let box = document.getElementById('activity-browser-next');
  const offer = browserOffer(run, context);
  if (!offer) { box?.remove(); return null; }
  if (!box) { box = el('section', 'insight-next'); box.id = 'activity-browser-next'; anchor.after(box); }
  const go = el('button', 'secondary', LABEL);
  go.id = 'browser-offer-go';
  const waiting = () => { go.disabled = true; go.textContent = 'Starting in your browser in a moment…'; };
  if (pressedFor === offer.at) waiting();
  go.addEventListener('click', async () => {
    waiting();
    pressedFor = offer.at;
    const answer = await start().catch(error => ({ok: false, text: error.message}));
    if (answer?.ok === false) { pressedFor = ''; go.disabled = false; go.textContent = LABEL; }
  });
  const words = el('div', 'insight-next-words');
  words.append(el('b', '', 'Recommended next step'), el('p', '', offer.text), ...(offer.allow ? [el('p', 'muted', ALLOW)] : []), go);
  box.replaceChildren(el('span', 'insight-next-icon', icon('globe')), words);
  return box;
}
