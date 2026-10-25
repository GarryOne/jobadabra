// Settings → Plan, the Pro card while Pro is not open (owner, 17 Oct 2026): what Pro is, "Join the Pro waitlist" (a dialog asking only for an e-mail), then "You're on the waitlist (<email>)".
// The address goes to the website's waitlist through the main process (lib/pro-waitlist.js). PRO_CHECKOUT (plan-line.js) will send the button to the payment instead. Guard: test/pro-waitlist.test.js.
import {el} from '../components.js';
import {icon} from '../icons.js';
import {$, message, show} from './core.js';
import {shared} from './shared.js';
import {INCLUDED, ALWAYS_ON} from '../plan-view.js';
import {BADGE} from '../pro-promise.js';
import {promoLink} from './plan-promo.js';
import {reloadPlan} from './plan.js';
import {PRO_CHECKOUT, PRO_PRICE, showsProWaitlist} from '../plan-line.js';

export const PRO_FEATURES = [...INCLUDED, ALWAYS_ON];

function dialog() {
  const box = el('dialog', 'save-dialog panel-dialog pro-waitlist-dialog');
  box.id = 'pro-waitlist-dialog';
  const head = el('div', 'dialog-head'), tile = el('span', 'dialog-icon'), close = el('button', 'ghost icon-btn', '');
  tile.append(icon('sparkle'));
  close.type = 'button'; close.id = 'pro-waitlist-close'; close.setAttribute('aria-label', 'Close'); close.append(icon('close'));
  head.append(tile, el('h2', '', 'Join the Pro waitlist'), close);
  const label = el('label', '', 'Your e-mail'), field = el('input', '');
  label.htmlFor = 'pro-waitlist-email';
  Object.assign(field, {id: 'pro-waitlist-email', type: 'email', placeholder: 'you@example.com', autocomplete: 'email'});
  const note = el('p', 'muted small', 'We\'ll e-mail you once when Pro opens. Nothing else.');
  const msg = el('p', 'message', ''), cancel = el('button', 'secondary', 'Cancel'), join = el('button', 'primary', 'Join'), foot = el('div', 'dialog-foot'), buttons = el('span', 'inline');
  msg.id = 'pro-waitlist-message'; cancel.id = 'pro-waitlist-cancel'; cancel.type = 'button'; join.id = 'pro-waitlist-join'; join.type = 'button';
  buttons.append(cancel, join);
  foot.append(el('span', ''), buttons);
  box.append(head, label, field, note, msg, foot);
  const shut = () => box.close();
  close.addEventListener('click', shut);
  cancel.addEventListener('click', shut);
  join.addEventListener('click', async () => {
    join.disabled = true;
    message('pro-waitlist-message', 'Adding you…');
    const result = await window.pilot.proWaitlistJoin(field.value).catch(() => ({ok: false, error: 'That did not work. Try again in a moment.'}));
    join.disabled = false;
    if (!result.ok) { message('pro-waitlist-message', result.error, 'error'); return; }
    if (shared.state?.settings) shared.state.settings.proWaitlist = {email: result.email};
    box.close();
    showProCard(shared.licenseState);
  });
  field.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); join.click(); } });
  return box;
}

// The e-mail the person already gave the app (Always on), so Join is one press.
const knownEmail = () => shared.state?.settings?.hostedSearch?.email || '';

export function openWaitlist() {
  const box = $('pro-waitlist-dialog') || document.body.appendChild(dialog());
  $('pro-waitlist-email').value = knownEmail();
  message('pro-waitlist-message', '');
  if (!box.open) box.showModal();
  $('pro-waitlist-email').focus();
}

// Fills the Pro card (it is a shell in index.html) for the license state; hidden when Pro is open (the real plan card is shown then).
export function showProCard(state = {}) {
  shared.licenseState = state;
  const card = $('setting-pro-waitlist');
  show(card, showsProWaitlist(state));
  if (card.hidden) return;
  const joined = shared.state?.settings?.proWaitlist?.email;
  $('pro-waitlist-pill').textContent = `from ${PRO_PRICE}`;
  const body = $('pro-waitlist-body');
  body.replaceChildren(el('p', 'panel-lead', el('span', 'ui-pill tone-good', BADGE)), el('ul', 'plan-list', ''));
  body.lastChild.append(...PRO_FEATURES.map(text => el('li', '', text)));
  if (joined) { body.append(el('p', 'plan-joined', `You're on the waitlist (${joined})`)); body.lastChild.id = 'pro-waitlist-joined'; body.append(promoLink(reloadPlan)); return; }
  const button = el('button', 'primary', PRO_CHECKOUT ? 'Upgrade to Pro' : 'Join the Pro waitlist');
  button.id = 'pro-waitlist-open';
  button.addEventListener('click', () => PRO_CHECKOUT ? window.pilot.planCheckout('pro') : openWaitlist());
  const row = el('div', 'inline', '');
  row.append(button);
  body.append(row, promoLink(reloadPlan));
}
