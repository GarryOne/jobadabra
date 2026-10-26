// The Email card in Settings → Overview "Your setup": its state (confirmed, waiting for the link, unsubscribed, our sender off) from notifyState, a click opens
// Notifications. Drawn after the other service cards, since its state comes from the website. Words: renderer/notify-words.js emailCard; guard test/notify-choice.test.js.
import {el, tile} from '../components.js';
import {icon} from '../icons.js';
import {emailCard} from '../notify-words.js';

let asked = null, askedAt = 0;
const FRESH_MS = 60_000;   // the Overview redraws often; the website is asked at most once a minute

export async function emailSetupCard(list, open) {
  if (!asked || Date.now() - askedAt > FRESH_MS) { asked = window.pilot.notifyState().catch(() => null); askedAt = Date.now(); }
  const state = await asked;
  list.querySelector('[data-service="email"]')?.remove();
  if (!state) return;
  const card = emailCard(state);
  if (!card.shown) return;
  const button = Object.assign(document.createElement('button'), {type: 'button', className: 'service-card', title: 'Open Notifications'});
  button.dataset.service = 'email';
  const text = el('span', 'service-text'), line = el('span', `service-state${card.on ? ' is-on' : ''}`);
  line.append(icon(card.on ? 'check-circle' : 'info'), el('span', 'service-state-text', card.text));
  line.title = card.text;
  text.append(el('b', '', 'Email'), line);
  button.append(tile('inbox', card.on ? 'good' : 'warn'), text);
  button.addEventListener('click', () => open('notify'));
  list.append(button);
}

// A save on Notifications asks again at the next redraw.
export const forgetEmailState = () => { asked = null; };
