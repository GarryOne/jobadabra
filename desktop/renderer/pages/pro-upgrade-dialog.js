// "Upgrade to Pro" dialog (owner, 25 Oct 2026) for a Pro feature pressed by a free person while paying is off: what Pro gives, "Join the Pro waitlist" and "Have a promo code?"; no price, no buy
// button. With paying on, openProGate sends the person to Settings → Plan instead. Rule: renderer/pro-gate.js. Guard: test/pro-gate.test.js.
import {el} from '../components.js';
import {icon} from '../icons.js';
import {shared} from './shared.js';
import {openSetting} from './settings.js';
import {PRO_FEATURES, openWaitlist} from './plan-waitlist.js';
import {promoLink} from './plan-promo.js';
import {reloadPlan} from './plan.js';
import {proGate} from '../pro-gate.js';
import {PROMISE} from '../pro-promise.js';

let box = null;
function build() {
  box = el('dialog', 'save-dialog panel-dialog pro-upgrade-dialog');
  box.id = 'pro-upgrade-dialog';
  const head = el('div', 'dialog-head'), tile = el('span', 'dialog-icon'), close = el('button', 'ghost icon-btn', '');
  tile.append(icon('sparkle'));
  close.type = 'button'; close.setAttribute('aria-label', 'Close'); close.append(icon('close'));
  close.addEventListener('click', () => box.close());
  head.append(tile, el('h2', '', 'Upgrade to Pro'), close);
  const list = el('ul', 'plan-list', ''), join = el('button', 'primary', 'Join the Pro waitlist'), row = el('div', 'inline', '');
  list.append(...PRO_FEATURES.map(text => el('li', '', text)));
  join.id = 'pro-upgrade-join'; join.type = 'button';
  join.addEventListener('click', () => { box.close(); openWaitlist(); });
  const link = promoLink(() => { reloadPlan(); box.close(); });
  link.addEventListener('click', () => box.close());   // the promo dialog takes over; the code's success refreshes the plan
  row.append(join, link);
  box.append(head, el('p', 'panel-lead', el('span', 'ui-pill tone-good', `✓ ${PROMISE}`)), list, row);
  document.body.append(box);
}

export function openUpgradeDialog() {
  if (!box) build();
  const joined = shared.state?.settings?.proWaitlist?.email, join = box.querySelector('#pro-upgrade-join');
  join.hidden = !!joined;
  if (!box.open) box.showModal();
}

// A Pro feature was pressed without the licence: the dialog while paying is off, Settings → Plan when it is on. -> true when it handled the press.
export function openProGate(state = shared.licenseState || {}) {
  const gate = proGate(state);
  if (gate === 'open') return false;
  if (gate === 'buy') openSetting('plan'); else openUpgradeDialog();
  return true;
}
