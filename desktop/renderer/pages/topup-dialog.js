// The top-up dialog (owner, 26 Oct 2026: "Blocking, but showing a topup popup/dialog ... a smaller button/option to topup using promo code"; "on every action that requires
// AI and their cap is reached"): opened by every start refused for AI credit or a Free AI line (pages/startup.js sayRefused, the Find jobs card) and by a line found after a
// run or a refused AI call (main's 'aiCap'). Top-ups (greyed while paying is off), "Use my own key", and "Have a promo code?": a credit code adds AI credit, then the refused
// start runs again. Words: renderer/plan-view.js topupWords / redeemWords. Built from the shared dialog, pill and button parts. Guard: test/topup-dialog.test.js.
import {el} from '../components.js';
import {redeemWords, topupWords} from '../plan-view.js';
import {openSetting} from './settings.js';

const QUIET_MS = 30 * 60 * 1000;   // a line nobody pressed for is shown once per half hour; a press always shows it
const PACKS = [5, 10, 20];
let dialog = null, shownQuiet = {cap: '', at: 0};

const tiles = async () => {
  const plan = await Promise.race([window.pilot.planState?.().catch(() => null), new Promise(resolve => setTimeout(resolve, 800))]);   // never holds the dialog
  const offers = ['test', 'live'].includes(plan?.mode) ? (plan.offers || []).filter(offer => /^topup\d+$/.test(offer.id)) : [];
  const row = el('div', 'inline topup-packs', '');
  if (offers.length) {
    for (const offer of offers) {
      const buy = el('button', 'secondary', `Add €${offer.price}`);
      buy.type = 'button';
      buy.addEventListener('click', () => window.pilot.planCheckout(offer.id));
      row.append(buy);
    }
    return {parts: [row], paying: true};
  }
  for (const euros of PACKS) { const off = el('button', 'secondary', `Add €${euros}`); Object.assign(off, {type: 'button', disabled: true}); row.append(off); }
  return {parts: [row, el('p', 'muted small', 'Top-ups open when paying is on. A promo code can add AI credit now.')], paying: false};
};

// why: {cap?, resetsAt?, text?} (a refusal or a line). action: what was pressed ('Find jobs'); retry: runs that press again after a code added credit.
export async function openTopupDialog(why = {}, {action = '', retry = null} = {}) {
  if (!action) {
    if (shownQuiet.cap === (why.cap || 'credit') && Date.now() - shownQuiet.at < QUIET_MS) return;
    shownQuiet = {cap: why.cap || 'credit', at: Date.now()};
  }
  dialog?.remove();
  const words = topupWords(why, action);
  dialog = el('dialog', 'save-dialog panel-dialog topup-dialog', '');
  dialog.id = 'topup-dialog';
  const head = el('div', 'dialog-head', '');
  head.append(el('span', 'ui-pill tone-warn', words.tag), el('h2', '', words.title));
  const close = () => dialog.close();
  // "Have a promo code?": a quiet link that opens one field; the site decides what the code gives.
  const promo = el('div', 'topup-promo', ''), link = el('button', 'ghost', 'Have a promo code?');
  link.type = 'button';
  const openField = () => {
    const field = el('input', '', ''), go = el('button', 'secondary', 'Redeem'), answer = el('p', 'message', ''), row = el('div', 'inline', '');
    Object.assign(field, {id: 'topup-code', placeholder: 'Enter your code', autocomplete: 'off', spellcheck: false, maxLength: 64});
    go.type = 'button';
    const redeem = async () => {
      if (!field.value.trim()) { answer.textContent = 'Enter your code.'; answer.className = 'message warn'; return; }
      go.disabled = true;
      const result = await window.pilot.planRedeem(field.value.trim()).catch(() => ({ok: false, error: 'offline'}));
      go.disabled = false;
      const again = result.ok && retry && action;
      answer.textContent = `${result.ok ? '✓ ' : ''}${redeemWords(result)}${again ? ` Starting ${action}…` : ''}`;
      answer.className = `message ${result.ok ? 'ok' : 'error'}`;
      if (result.ok) setTimeout(() => { close(); if (again) retry(); }, 1200);
    };
    go.addEventListener('click', redeem);
    field.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); redeem(); } });
    row.append(field, go);
    promo.replaceChildren(row, answer);
    field.focus();
  };
  link.addEventListener('click', openField);
  // Credit codes are Pro's (owner, 27 Oct 2026: a free-tier person cannot add credit by code without upgrading): the free tier sees no link; while paying is off its
  // Upgrade to Pro opens the field for a Pro code, the one way to upgrade until then.
  if (words.pro) promo.append(link);
  const foot = el('div', 'dialog-foot', ''), own = el('button', 'secondary', 'Use my own key'), add = el('button', 'primary', words.primary);
  own.type = add.type = 'button';
  own.addEventListener('click', () => { close(); openSetting('ai'); });
  // Paying off (owner, 27 Oct 2026: "I have no button to topup"): Top up / Upgrade to Pro opens the promo code field, the one way in until paying is on.
  const packs = await tiles();
  add.addEventListener('click', () => { if (!packs.paying) { if (!promo.querySelector('input')) openField(); else promo.querySelector('input').focus(); return; } close(); openSetting('plan'); });
  const wait = words.wait ? el('button', 'secondary', words.wait) : null;
  if (wait) { wait.type = 'button'; wait.addEventListener('click', close); }
  foot.append(...[wait || own, add]);
  dialog.append(head, el('p', 'muted', words.body), ...(words.pro ? packs.parts : []), promo, foot);   // the packs are Pro's top-ups; the free tier upgrades
  document.body.append(dialog);
  dialog.showModal();
}
