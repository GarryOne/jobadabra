// Always on "on our servers" in the window (private spec jobadabra-lab:docs/specs/2026-10-16-hosted-always-on.md §4b, §4d): the wizard's step 4 (switch ON, e-mail, a pre-checked product-news box, Skip / Turn on Always on)
// and the Settings card (ON by default until Skip; asks for the e-mail first when there is none; Turn off and delete; Download my data; Delete our copy of your data while off, when we hold one; when the profile was last copied there). One name everywhere: "Always on" (owner, 17 Oct 2026).
// The words and states are renderer/hosted-words.js; the data calls are lib/hosted-search.js. Never "GitHub", "container" or dollars here. Guard: test/hosted-search.test.js, test/hosted-words.test.js.
import {el, pill, tile} from '../components.js';
import {$, message, show} from './core.js';
import {goStep} from './wizard.js';
import {shared} from './shared.js';
import {openSetting} from './settings.js';
import {HELPER, NAME, NEWS, NEWS_HINT, STORED, SUBTITLE, model} from '../hosted-words.js';
import {alwaysOnCard} from '../hosted-step-parts.js';

export const HEADLINE = 'New matching jobs every morning, even when your Mac is off';

function switchRow(id, label, checked, hint = '') {
  const input = Object.assign(document.createElement('input'), {type: 'checkbox', id, checked});
  input.setAttribute('aria-label', label);
  const row = el('div', 'switch-row'), toggle = el('span', 'switch', input);
  toggle.append(document.createElement('span'));
  const words = el('span');
  words.append(...(hint ? [el('b', '', label), el('span', 'muted small', hint)] : [label]));
  row.append(toggle, words);
  return row;
}
// The e-mail field as the AI step draws its key field (.step-field: the label above a full-width input), with a helper line under it.
function emailField(id, label = 'Where should we send them?') {
  const input = Object.assign(document.createElement('input'), {type: 'email', id, placeholder: 'you@example.com', autocomplete: 'email'});
  const field = el('div', 'step-field');
  field.append(Object.assign(document.createElement('label'), {htmlFor: id, textContent: label}), input, el('p', 'muted small field-hint', HELPER));
  return field;
}
const button = (id, label, cls) => { const node = el('button', cls, label); node.id = id; return node; };

// Wizard step 4. Skip only leaves Always on off; the rest of the app works as before.
export function mountStep() {
  if ($('hosted-step-root')) return;
  const step = el('div', 'step magic-stage');   // a small form: one centered column, like the CV card (magic.css)
  step.id = 'hosted-step-root'; step.dataset.step = 'hosted'; step.hidden = true;
  const head = el('header', 'view-head step-head'), text = el('div');
  text.append(el('span', 'eyebrow', 'Step 4 of 5'), el('h1', '', HEADLINE), el('p', 'muted subtitle', 'A short list of what is new, by e-mail, and in the app when you open it.'));
  head.append(text);
  const actions = el('div', 'actions');
  actions.append(button('hosted-skip', 'Skip', 'ghost'), button('hosted-go', 'Turn on Always on', 'primary'));
  const note = el('p', 'message'); note.id = 'hosted-message';
  // Two cards: the daily search (switch + e-mail), and the product news as its own consent, never tied to the search.
  const search = alwaysOnCard('A short list of what is new, in your inbox and in the app.', switchRow('hosted-daily', 'Search for me every day', true, 'Runs on our servers, with your Mac on or off'), emailField('hosted-email'));
  const news = el('div', 'setting panel roomy');
  news.append(switchRow('hosted-news', NEWS, true, NEWS_HINT));
  step.append(head, search, news, el('p', 'muted small', STORED), note, actions);
  document.querySelector('.step[data-step="extras"]').before(step);
  // The address and news choice already kept (the setup's Email step, Notifications): shown here, so the person types it once (#1711).
  window.pilot.notifyState?.().then(kept => { if (kept?.email && !$('hosted-email').value) $('hosted-email').value = kept.email; if (kept && typeof kept.marketing === 'boolean') $('hosted-news').checked = kept.marketing; }).catch(() => {});
  const item = el('li', '', 'Always on'); item.dataset.step = 'hosted';
  document.querySelector('#step-list li[data-step="extras"]').before(item);
  $('hosted-skip').addEventListener('click', async () => { await window.pilot.hostedOff(); goStep('extras'); });
  $('hosted-go').addEventListener('click', async () => {
    if (!$('hosted-daily').checked) { await window.pilot.hostedOff(); goStep('extras'); return; }   // the switch turned off here is the same as Skip
    $('hosted-go').disabled = true; message('hosted-message', 'Turning on…');
    const done = await window.pilot.hostedOn({email: $('hosted-email').value, marketing: $('hosted-news').checked});
    $('hosted-go').disabled = false;
    if (!done.ok) { message('hosted-message', done.error || 'Could not turn it on just now.', 'bad'); return; }
    goStep('extras');
  });
}

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

export function init() { mountStep(); mountCard(); }
