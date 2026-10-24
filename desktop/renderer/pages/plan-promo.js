// "Have a promo code?" (owner, 25 Oct 2026): a small link on the Free Plan card and the ⌘K entry open one dialog with one field. The site checks the code (lib/plan.js redeem); the app holds no
// code and compares nothing. Shown only while the site's plan is on and the install is Free. Words: renderer/plan-view.js redeemWords. Guard: test/plan-promo.test.js.
import {el} from '../components.js';
import {redeemWords} from '../plan-view.js';

let dialog = null;
// Opens the dialog (made once, on first use); onDone runs after a code worked, so the plan shows Pro at once.
export function openPromoDialog(onDone = () => {}) {
  if (!dialog) {
    dialog = el('dialog', 'save-dialog panel-dialog', '');
    const head = el('div', 'dialog-head', ''), field = el('input', '', ''), answer = el('p', 'message', ''), cancel = el('button', 'secondary', 'Cancel'), go = el('button', 'primary', 'Redeem');
    Object.assign(field, {type: 'text', id: 'promo-code', placeholder: 'Enter your code', autocomplete: 'off', spellcheck: false, maxLength: 64});
    head.append(el('h2', '', 'Redeem a promo code'));
    cancel.type = go.type = 'button';
    cancel.addEventListener('click', () => dialog.close());
    const redeem = async () => {
      if (!field.value.trim()) { answer.textContent = 'Enter your code.'; answer.className = 'message warn'; return; }
      go.disabled = true;
      const result = await window.pilot.planRedeem(field.value.trim()).catch(() => ({ok: false, error: 'offline'}));
      go.disabled = false;
      answer.textContent = redeemWords(result);
      answer.className = `message ${result.ok ? 'ok' : 'error'}`;
      if (result.ok) { field.value = ''; onDone(); setTimeout(() => dialog.close(), 1200); }
    };
    go.addEventListener('click', redeem);
    field.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); redeem(); } });
    dialog.append(head, el('label', '', 'Promo code'), field, answer, el('div', 'dialog-foot', ''));
    dialog.querySelector('.dialog-foot').append(cancel, go);
    dialog.querySelector('label').htmlFor = 'promo-code';
    document.body.append(dialog);
  }
  dialog.querySelector('input').value = '';
  dialog.querySelector('.message').textContent = '';
  dialog.showModal();
  dialog.querySelector('input').focus();
}

// The quiet link under the Free plan's packages.
export function promoLink(onDone) {
  const link = el('button', 'ghost', 'Have a promo code?');
  link.id = 'plan-promo-link';
  link.type = 'button';
  link.addEventListener('click', () => openPromoDialog(onDone));
  return link;
}
