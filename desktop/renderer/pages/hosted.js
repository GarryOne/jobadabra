// Always on "on our servers": the Settings card, its status, and the actions to turn it on, export or delete the held data.
// The words and states are renderer/hosted-words.js; the data calls are lib/hosted-search.js. Never "GitHub", "container" or dollars here. Guard: test/hosted-search.test.js, test/hosted-words.test.js.
import {el, pill, tile} from '../components.js';
import {$, message, show} from './core.js';
import {shared} from './shared.js';
import {openSetting} from './settings.js';
import {NAME, STORED, SUBTITLE, model} from '../hosted-words.js';

const button = (id, label, cls) => { const node = el('button', cls, label); node.id = id; return node; };

// Settings: the card, built once; draw(model) shows one of its states.
export function mountCard() {
  if ($('setting-hosted')) return;
  const card = el('div', 'setting panel'); card.id = 'setting-hosted';
  const head = el('div', 'summary-head'), title = el('span'); title.id = 'hosted-pill';
  head.append(el('h3', '', NAME), title);
  // Rows, never one squeezed line (owner, 17 Oct 2026): 1 icon + status at full width, 2 the buttons. All solid, in one row: a text-only link under a button looked
  // misaligned and broken (owner, 27 Oct 2026: "let's have always just solid buttons in the app"; docs/rules/desktop-ui.md).
  const row = el('div', 'aon-row aon-stack'), info = el('div', 'aon-text'), status = el('p', 'muted small'); status.id = 'hosted-status';
  const held = el('p', 'muted small'); held.id = 'hosted-held';   // when the profile was last copied to our servers, or deleted (owner, 27 Oct 2026)
  info.append(status, held);
  const main = el('div', 'aon-actions');
  main.append(button('hosted-turn-on', 'Turn on Always on', 'secondary'), button('hosted-resume', 'Resume Always on', 'secondary'),
    button('hosted-change-email', 'Change e-mail', 'secondary'), button('hosted-download', 'Download my data', 'secondary'), button('hosted-turn-off', 'Turn off and delete', 'danger-outline'),
    button('hosted-delete', 'Delete our copy of your data', 'danger-outline'));   // destroys data: the red outline (owner, 27 Oct 2026)
  row.append(tile('cloud'), info, main);
  // No e-mail field of its own (#1711, owner 27 Oct 2026: one shared e-mail): the address and the news choice are Notifications', a button goes there.
  const msg = el('p', 'message'); msg.id = 'hosted-set-message';
  const result = el('div', 'step-field', msg);   // .step-field hides its empty message: no blank space under the card
  card.append(head, el('p', 'muted panel-lead', `${SUBTITLE}. ${STORED}`), row, result);
  $('setting-cloud').after(card);
  const turnOn = async () => {
    const done = await window.pilot.hostedOn({});   // main uses the Notifications address and news choice (lib/hosted-email.js)
    message('hosted-set-message', done.ok ? 'Always on ✓' : done.error || 'Could not turn it on just now.', done.ok ? 'ok' : 'bad');
    refresh();
  };
  const toNotify = () => { openSetting('notify'); setTimeout(() => $('notify-address')?.focus(), 120); };
  $('hosted-turn-on').addEventListener('click', () => (shared.hosted && !hostedAddress(shared.hosted) ? toNotify() : turnOn()));
  $('hosted-change-email').addEventListener('click', toNotify);
  $('hosted-resume').addEventListener('click', turnOn);
  $('hosted-turn-off').addEventListener('click', async () => { const done = await window.pilot.hostedOff(); message('hosted-set-message', done.ok ? 'Always on is off. Everything we held is deleted.' : done.error || 'Could not turn it off just now.', done.ok ? 'ok' : 'bad'); refresh(); });
  $('hosted-delete').addEventListener('click', async () => {
    const done = await window.pilot.hostedDelete();
    message('hosted-set-message', done.ok ? (done.nothing ? 'Nothing to delete: this Mac never sent anything to our servers.' : 'Deleted ✓ Nothing of yours is on our servers.') : done.error || 'Could not delete it just now. Try again.', done.ok ? 'ok' : 'bad');
    refresh();
  });
  $('hosted-download').addEventListener('click', async () => { const done = await window.pilot.hostedExport(); if (!done.cancelled) message('hosted-set-message', done.ok ? 'Saved ✓' : done.error || 'Could not save it just now.', done.ok ? 'ok' : 'bad'); });
  window.pilot.onHostedArrived(refresh);
  refresh();
}

// One state of the card (model from renderer/hosted-words.js), also what the screenshots draw for every state.
export function draw(view, email = '') {
  $('hosted-pill').replaceChildren(pill(view.pill[0], view.pill[1], {dot: true}));
  $('hosted-status').textContent = view.line;
  $('hosted-turn-on').textContent = view.button === 'email' ? 'Add your e-mail' : 'Turn on Always on';
  show($('hosted-turn-on'), view.button === 'on' || view.button === 'email');
  show($('hosted-resume'), view.button === 'resume');
  show($('hosted-change-email'), !!email && view.button !== 'email');
  show($('hosted-turn-off'), view.off); show($('hosted-download'), view.download); show($('hosted-delete'), !!view.erase);
  $('hosted-held').textContent = view.held || ''; show($('hosted-held'), !!view.held);
}
const hostedAddress = now => now.email || now.shared || '';

export async function refresh() {
  const now = await window.pilot.hostedState();
  shared.hosted = now;
  if ($('hosted-status')) draw(model(now, now.schedule, new Date(), now.shared), hostedAddress(now));
}

/** Mount the Always on Settings card and subscribe to its status refreshes. */
export function init() { mountCard(); }
