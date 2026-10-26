// Settings → Plan (private spec jobadabra-lab:docs/specs/2026-10-16-pro-plan.md §4): Upgrade to Pro for a free install, the AI credit bar and the top-ups for a Pro one. Shown only when the site's
// Pro plan is on (lib/plan.js says so); with it off nothing about Pro is on screen but the one honest line (plan-line.js). Words and numbers: renderer/plan-view.js. Guard: test/plan.test.js.
import {choiceCards, el} from '../components.js';
import {$, message, show} from './core.js';
import {shared} from './shared.js';
import {toastMessage} from './startup.js';
import {NOTES, PLAN_CHOICES, SHOW_I_HAVE_PRO, TOPUP_NOTE, planView, warnNow} from '../plan-view.js';
import {signinPart} from './plan-signin.js';
import {openPromoDialog, promoLink} from './plan-promo.js';
import {BADGE} from '../pro-promise.js';

const REFRESH_MS = 10 * 60 * 1000;

function render(view) {
  show($('setting-plan'), !!view);
  if (!view) return;
  $('plan-title').textContent = view.title;
  $('plan-pill').textContent = view.pill;
  show($('plan-pill'), !!view.pill);
  $('plan-pill').className = `ui-pill tone-${view.kind === 'pro' ? 'good' : 'info'}`;
  const body = $('plan-body');
  body.replaceChildren();
  if (view.kind === 'upgrade') {
    const cards = el('div', 'plan-packages', '');
    for (const pack of view.packages) {
      const card = el('div', 'summary-card', '');
      const price = el('p', 'panel-lead', '');
      if (pack.list) price.append(el('s', 'muted', pack.list), ' ');
      price.append(el('strong', '', pack.price), ' ', el('span', 'ui-pill tone-good', BADGE));
      const pay = el('button', pack.kind === 'pro-ai' ? 'primary' : 'secondary', pack.button);
      pay.addEventListener('click', () => buy(pack.kind));
      card.append(el('h4', '', pack.name), price, el('ul', 'plan-list', ''), pay);
      card.querySelector('ul').append(...pack.included.map(text => el('li', '', text)));
      cards.append(card);
    }
    body.append(cards);
    if (SHOW_I_HAVE_PRO) body.append(signinPart(() => load()));
    body.append(promoLink(() => load()));
    return;
  }
  // A Pro sees both plans, Free greyed and Pro selected (owner, 27 Oct 2026), then the AI credit below.
  const plans = choiceCards(PLAN_CHOICES, {selected: 'pro', label: 'Your plan'});
  plans.classList.add('is-pair', 'plan-choices');
  body.append(plans);
  if (view.hasCredit) {
    const bar = el('div', 'bar license-bar', ''), fill = el('span', '', '');
    fill.style.width = `${Math.max(2, view.percent)}%`;
    bar.dataset.tone = view.tone;
    bar.append(fill);
    body.append(el('p', 'panel-lead', view.label), bar, el('p', 'muted panel-lead', view.note));
  } else body.append(el('p', 'panel-lead', view.label), el('p', 'muted panel-lead', view.note));
  if (view.upgrade) {
    const upgrade = el('button', 'primary', `Get Pro + AI for ${view.upgrade.price} more`);
    upgrade.title = 'You pay only the difference. It adds the AI credit.';
    upgrade.addEventListener('click', () => buy('upgrade'));
    body.append(el('div', 'inline', ''));
    body.lastChild.append(upgrade);
  }
  const row = el('div', 'inline', '');
  for (const top of view.topups) {
    const button = el('button', 'secondary', `Add ${top.price}`);
    button.title = `${top.price} adds ${top.adds || 'AI credit'} (VAT included in the price)`;
    button.addEventListener('click', () => buy(top.kind));
    row.append(button);
  }
  if (view.topups.length) body.append(row, el('p', 'muted small', TOPUP_NOTE));
  if (view.promo) {   // paying is off: a credit code is how AI credit is added, so Top up (owner's word for Pro, 27 Oct 2026) opens the code field
    const top = el('button', 'primary', 'Top up with a promo code');
    top.type = 'button';
    top.addEventListener('click', () => openPromoDialog(() => load()));
    body.append(el('div', 'inline', ''));
    body.lastChild.append(top);
  }
}

async function buy(kind) {
  message('plan-message', 'Opening the payment page in your browser…');
  const result = await window.pilot.planCheckout(kind);
  message('plan-message', result.ok ? 'Pay in your browser; this page updates when you come back.' : result.error, result.ok ? 'ok' : 'error');
}

// Says each credit warning once (30%, 10%, used up); above 30% again they are new next time.
function warn(plan) {
  const {say, said} = warnNow(plan.warn, shared.state?.settings?.planWarned || []);
  if (JSON.stringify(said) === JSON.stringify(shared.state?.settings?.planWarned || [])) return;
  window.pilot.saveSettings({planWarned: said}).catch(() => {});
  if (shared.state?.settings) shared.state.settings.planWarned = said;
  if (say !== null) toastMessage(say === 0 ? 'AI credit used up' : `AI credit at ${say}%`, NOTES[say], {card: 'license'}, say === 0 ? 'bad' : 'warn');
}

// onChange: what shows the license state again (the counter and the plan line follow the site's answer).
let load = () => {};
export const reloadPlan = () => load();
export function initPlan(onChange = () => {}) {
  load = async () => {
    const plan = await window.pilot.planState().catch(() => null);
    if (!plan) return;
    shared.plan = plan;
    render(planView(plan));
    if (plan.plan === 'pro') warn(plan);
    onChange();
  };
  load();
  setInterval(load, REFRESH_MS);
  window.addEventListener('focus', load);
}
