// The Applying card of a hidden-browser session becomes its live page (spec 2026-10-27-background-apply-execution, step B; owner's live view design,
// 28 Oct 2026, mockup https://claude.ai/artifact/Lq3MeVUtavGRm8W2sZekPS): a Live strip (address, zoom, Expand), the page's picture with the required
// fields still empty framed, a note line, then the actions. Four states: Filling, A bot check needs you, Review, Ready to submit. Pictures, the page's
// facts and the dropdown/file asks come from main's 'liveEvent' (lib/live-view-handlers.js); the person's mouse and keys go back as liveInput.
// Guard: test/session-live.test.js.
import {el, liveDot, pill} from '../components.js';
import {icon} from '../icons.js';
import {$} from './core.js';
import {keyMessage, liveCard, toPage} from '../live-card.js';

const ZOOMS = [50, 75, 100, 125, 150];

let view = null;   // the one open live view: {id, root, img, marks, ask, w, h, facts, zoom, card, item, on}
let listening = false;

// The session's live view, built once per session and kept across redraws (its picture never reloads while the card redraws).
function viewFor(item) {
  if (view?.id === item.id) return view;
  closeLive();
  const img = Object.assign(el('img', 'live-img'), {alt: 'The application page, live', draggable: false});
  const marks = el('div', 'live-marks'), page = el('div', 'live-page'), screen = el('div', 'live-screen'), strip = el('div', 'live-strip');
  const ask = el('div', 'live-ask'), filling = el('div', 'live-filling'), zoomText = el('span', 'live-zoom-text', '100%'), address = el('span', 'live-url', '');
  ask.hidden = true; filling.hidden = true;
  page.append(img, marks);
  screen.append(page);
  screen.tabIndex = 0;
  const stage = el('div', 'live-stage');   // the strip and an ask stay put while the picture scrolls
  stage.append(screen, filling, ask);
  const zoomButton = (text, label, step) => Object.assign(el('button', 'secondary live-zoom', text), {ariaLabel: label, onclick: () => setZoom(step)});
  const expand = el('button', 'secondary live-zoom with-icon', icon('maximize'));
  expand.ariaLabel = 'Expand';
  expand.onclick = () => { root.classList.toggle('is-expanded'); expand.replaceChildren(icon(root.classList.contains('is-expanded') ? 'collapse' : 'maximize')); };
  strip.append(liveDot('live'), el('b', '', 'Live'), address, el('span', 'live-gap'), zoomButton('−', 'Zoom out', -1), zoomText, zoomButton('+', 'Zoom in', 1), expand);
  const root = el('div', 'live-view');
  root.append(strip, stage);
  view = {id: item.id, root, img, marks, ask, filling, address, zoomText, screen, page, w: 0, h: 0, facts: null, zoom: 100, item};
  wireInput(view);
  window.pilot.liveOpen(item.id).then(result => { if (!result?.ok && view?.id === item.id) address.textContent = result?.error || 'The hidden form is not open.'; });
  return view;
}
function setZoom(step) {
  if (!view) return;
  view.zoom = ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, ZOOMS.indexOf(view.zoom) + step))];
  view.page.style.width = `${view.zoom}%`;
  view.zoomText.textContent = `${view.zoom}%`;
}
// The person's mouse, wheel and keys on the picture go to the page as theirs; while the fill runs they wait (the card says so).
function wireInput(v) {
  const send = message => { if (v.card?.input) window.pilot.liveInput(v.id, message); };
  const mouse = type => event => {
    if (!v.w || !v.h) return;
    const at = toPage(event.clientX, event.clientY, v.img.getBoundingClientRect(), v.w, v.h);
    send({t: 'mouse', type, ...at, button: type === 'mouseMoved' ? 'none' : 'left', buttons: event.buttons, clickCount: type === 'mouseMoved' ? 0 : 1});
  };
  let moved = 0;
  v.img.addEventListener('mousedown', event => { v.screen.focus(); mouse('mousePressed')(event); });
  v.img.addEventListener('mouseup', mouse('mouseReleased'));
  v.img.addEventListener('mousemove', event => { if (Date.now() - moved > 50) { moved = Date.now(); mouse('mouseMoved')(event); } });
  v.img.addEventListener('wheel', event => {
    if (!v.card?.input || !v.w) return;
    event.preventDefault();
    const at = toPage(event.clientX, event.clientY, v.img.getBoundingClientRect(), v.w, v.h);
    send({t: 'mouse', type: 'mouseWheel', ...at, deltaX: event.deltaX, deltaY: event.deltaY});
  }, {passive: false});
  v.screen.addEventListener('keydown', event => { if (v.card?.input && !event.metaKey) { event.preventDefault(); send(keyMessage(event)); } });
  v.screen.addEventListener('keyup', event => { if (v.card?.input && !event.metaKey) { event.preventDefault(); send(keyMessage(event, true)); } });
}
// The page asked for a choice the hidden browser cannot draw: a dropdown's list, or a file. The person answers here; nothing is picked for them.
function showAsk(v, message) {
  const done = () => { v.ask.hidden = true; v.ask.replaceChildren(); };
  if (message.kind === 'select') {
    const list = Object.assign(el('select', 'live-ask-list'), {size: Math.min(8, Math.max(2, message.options.length)), ariaLabel: message.label || 'Choose one'});
    list.append(...message.options.map(option => Object.assign(el('option', '', option.label || option.value), {value: option.value, disabled: option.disabled, selected: option.value === message.value})));
    list.onchange = () => { window.pilot.liveInput(v.id, {t: 'choose', id: message.id, value: list.value}); done(); };
    v.ask.replaceChildren(el('b', '', message.label || 'Choose one'), list, Object.assign(el('button', 'secondary', 'Cancel'), {onclick: done}));
  } else {
    const answer = choice => () => { window.pilot.liveInput(v.id, {t: 'file', id: message.id, choice}); done(); };
    v.ask.replaceChildren(el('b', '', 'The page asks for a file'), Object.assign(el('button', 'primary', 'Your CV'), {onclick: answer('cv')}),
      Object.assign(el('button', 'secondary', 'Choose a file…'), {onclick: answer('pick')}), Object.assign(el('button', 'secondary', 'Cancel'), {onclick: answer('')}));
  }
  v.ask.hidden = false;
}
// One event from main for the open view: a picture, the page's facts, or an ask.
export function liveEvent({session, message} = {}) {
  if (!view || session !== view.id || !message) return;
  if (message.kind === 'first' || message.kind === 'frame') {
    view.img.src = `data:image/jpeg;base64,${message.data}`;
    if (message.w && message.h) { view.w = message.w; view.h = message.h; }
  } else if (message.kind === 'needs') {
    view.facts = message;
    renderLive(view.item, view.on);   // Submit turns on, a count changes: the actions follow the page
  } else if (message.kind === 'select' || message.kind === 'file') showAsk(view, message);
}
/** Close the open live view (another session shown, or none): the stream stops in main. */
export function closeLive() {
  if (!view) return;
  window.pilot.liveClose(view.id);
  view = null;
}
const button = (text, kind, run, glyph) => {
  const node = el('button', `${kind}${glyph ? ' with-icon' : ''}`);
  if (glyph) node.append(icon(glyph));
  node.append(el('span', '', text));
  node.addEventListener('click', run);
  return node;
};
// The header, picture marks, note and actions for the current state; `actions` are the session's own (Open in my browser, Skip, Stop).
function drawCard(item) {
  const v = viewFor(item), card = liveCard(item.background || {}, v.facts, {note: item.note || ''});
  v.card = card; v.item = item;
  $('ss-decision').className = `ss-next tone-${card.tone}`;
  $('ss-next-title').textContent = card.title;
  $('ss-next-state').textContent = card.meta;
  $('ss-stage').replaceChildren(pill(card.pill[0], card.pill[1], {dot: true}));
  $('ss-form-state').replaceChildren();
  v.root.dataset.frame = card.frame;
  v.root.classList.toggle('is-filling', card.kind === 'filling');
  v.address.textContent = v.facts?.address || '';
  v.filling.hidden = !card.filling;
  v.filling.replaceChildren(el('span', 'spinner'), el('span', '', `Filling "${card.filling}"…`));
  v.marks.replaceChildren(...(card.marks ? (v.facts?.left || []) : []).map(box => Object.assign(el('span', 'live-mark'), {title: box.label,
    style: `left:${box.x * 100}%;top:${box.y * 100}%;width:${box.w * 100}%;height:${box.h * 100}%`})));
  $('ss-question').replaceChildren(v.root, el('p', 'rich-p muted small', card.note));
  return card;
}
/**
 * Draw a hidden-browser session's card (renderNextStep hands background sessions here). on: {open, skip, problem(title, text)} the session's own actions.
 * Submit presses the page's own sending button through main (liveSubmit), which reads the page again first.
 */
export function renderLive(item, on) {
  if (!listening) { listening = true; window.pilot.onLiveEvent(liveEvent); }
  const card = drawCard(item), actions = [];
  view.on = on;
  if (card.kind === 'filling') {
    actions.push(button('Stop', 'secondary', async event => { event.currentTarget.disabled = true; await window.pilot.liveStop(item.id); }));
  } else {
    const submit = button('Submit application', card.submit.on ? 'primary' : 'secondary', async event => {
      const pressed = event.currentTarget;
      pressed.disabled = true;
      const result = await window.pilot.liveSubmit(item.id).catch(error => ({ok: false, error: error.message}));
      pressed.disabled = false;
      if (!result?.ok) on.problem('Not submitted', result?.error || 'Try again.');
    });
    submit.disabled = !card.submit.on;
    actions.push(submit);
    if (card.submit.hint) actions.push(el('span', 'muted small live-hint', card.submit.hint));
  }
  actions.push(button('Open in my browser', 'secondary', on.open, 'external'));
  if (card.kind !== 'filling') actions.push(button('Skip this role', 'secondary', on.skip));
  $('ss-actions').replaceChildren(...actions);
}
