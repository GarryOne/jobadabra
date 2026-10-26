// Settings → Automation → Notifications ("Tell me by"): e-mail, app notifications, Telegram, any mix, plus the address, how often the digest comes and the product-news tick (pre-checked, unsubscribe in one click).
// Saves at once like the rest of Automation. The choice and the address live in lib/notify-channel.js; the engine and the Always on repo follow it. The words (why a switch does nothing) are
// renderer/notify-words.js; guard test/notify-choice.test.js.
import {$} from './core.js';
import {shared} from './shared.js';
import {notes} from '../notify-words.js';
import {openSetting} from './settings.js';

const BOXES = {email: 'notify-email', app: 'notify-app', telegram: 'notify-telegram'};
let busy = false;

// `error`: the last save's refusal, kept on screen (the refresh after a save used to wipe it, so a switch flipped back without a word).
export async function showNotify(error = '') {
  const state = await window.pilot.notifyState().catch(() => null);
  if (!state) return;
  if (shared.state) Object.assign(shared.state, {notifyBy: state.by, settings: {...shared.state.settings, notifyBy: state.chosen}});   // Connections and the Actions header follow the choice at once
  for (const [name, id] of Object.entries(BOXES)) $(id).checked = state.by.includes(name);
  $('notify-address').value = state.email || '';
  $('notify-marketing').checked = state.marketing;
  $('notify-cadence').value = state.cadence || 'daily';
  $('notify-telegram').disabled = !state.telegram;
  const said = notes(state, error);
  $('notify-telegram-note').textContent = said.telegram;
  $('notify-telegram-connect').hidden = state.telegram;
  $('notify-email-note').textContent = said.email;
  $('notify-message').textContent = said.message;
}

export function bindNotify({savedToast, updateRepo}) {
  const save = async () => {
    if (busy) return;
    busy = true;
    let error = '';
    try {
      const by = Object.entries(BOXES).filter(([, id]) => $(id).checked).map(([name]) => name);
      const result = await window.pilot.notifySave({by, email: $('notify-address').value, marketing: $('notify-marketing').checked, cadence: $('notify-cadence').value});
      error = result.ok ? '' : result.error;
      if (result.ok) { savedToast('Saved ✓', `Tell me by: ${by.join(', ') || 'nothing'}`); updateRepo(); }
    } finally { busy = false; }
    await showNotify(error);
  };
  for (const id of [...Object.values(BOXES), 'notify-address', 'notify-marketing', 'notify-cadence']) $(id).addEventListener('change', save);
  $('notify-telegram-connect').addEventListener('click', () => openSetting('telegram'));
}
