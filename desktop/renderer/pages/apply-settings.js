// Settings → Apply (owner, 26 Oct 2026, hybrid fill step 2): how applying works (3 modes), where answers come from, Full automation's checks, and the
// Confirm bar the first-Apply dialog's "Adjust settings…" opens (pages/apply-choice.js). Each change saves at once into settings.apply
// (renderer/apply-settings-model.js); the consent and accounts cards moved here keep their own modules (consent-setting.js, assistant-mode.js).
// Guards: test/apply-settings.test.js, test/apply-choice-gate.test.js.
import {$} from './core.js';
import {choiceCards} from '../components.js';
import {ANSWERS_TEXT, MODES, applyOf, modeBuilt, needsBrowser} from '../apply-settings-model.js';
import {saveApply} from '../apply-save.js';
import {offerBrowser} from './browser-progress.js';
import {openSetting} from './settings.js';

let current = {};   // the saved settings, as the app last answered them
let ready = Promise.resolve();
export const settingsNow = () => current;

/**
 * The three modes as stacked choice cards, the same on every Apply surface (Settings → Apply, the first-Apply dialog, Jobs' Apply to jobs).
 * A mode not built yet is disabled with a "Coming soon" pill in place of its badge; busy: every card off (a save or a start in flight).
 */
export function modeCards(selected, onPick, {busy = false} = {}) {
  const modes = MODES.map(mode => ({...mode, disabled: busy || !modeBuilt(mode.id), badge: modeBuilt(mode.id) ? mode.badge : ['Coming soon', 'neutral']}));
  const group = choiceCards(modes, {selected, onPick, label: 'How applying works'});
  group.classList.add('is-single');
  return group;
}

// The one Full automation setting: the optional wait before a submit (owner, 29 Oct 2026: remove all checks), a number as a short field.
export const CHECKS = [
  {key: 'waitMin', before: 'Wait', after: 'minutes before sending, with Stop', min: 0, max: 120},
];
const el = (tag, cls = '', text = '') => Object.assign(document.createElement(tag), cls ? {className: cls} : {}, text ? {textContent: text} : {});

function checkRow(check) {
  if (!('min' in check)) {
    const row = el('label', 'switch-row'), sw = el('span', 'switch'), words = el('span');
    const box = Object.assign(el('input'), {type: 'checkbox'});
    box.dataset.applyCheck = check.key;
    box.addEventListener('change', () => save({auto: {[check.key]: box.checked}}));
    sw.append(box, el('span'));
    words.append(el('span', '', check.title));
    if (check.note) words.append(el('span', 'muted small', check.note));
    row.append(sw, words);
    return row;
  }
  const row = el('label', 'inline-field');
  const box = Object.assign(el('input'), {type: 'number', min: check.min, max: check.max, step: 1});
  box.dataset.applyCheck = check.key;
  box.setAttribute('aria-label', `${check.before} … ${check.after}`.trim());
  box.addEventListener('change', () => save({auto: {[check.key]: box.value}}));
  row.append(check.before, box);
  if (check.after) row.append(check.after);
  return row;
}

export function draw(settings = current) {
  const apply = applyOf(settings);
  $('apply-modes')?.replaceChildren(modeCards(apply.mode, mode => save({mode})));
  document.querySelectorAll('[data-apply-answers]').forEach(button => button.classList.toggle('is-active', button.dataset.applyAnswers === apply.answers));
  if ($('apply-answers-text')) $('apply-answers-text').textContent = ANSWERS_TEXT[apply.answers];
  document.querySelectorAll('[data-apply-check]').forEach(box => {
    const value = apply.auto[box.dataset.applyCheck];
    if (box.type === 'checkbox') box.checked = !!value; else box.value = String(value);
  });
}

// change: part of settings.apply; chosen: stamps the person's confirmation (the gate in lib/apply-choice-gate.js then lets every Apply through).
/** Saves a change of settings.apply and redraws; -> the saved settings, or null when the save failed (the last saved ones stay drawn). */
export async function save(change = {}, {chosen = false} = {}) {
  await ready;
  // Why (2026-10-29, owner: "go ahead" with the switch; Gitar on #2471): every route into Full automation (Settings, Jobs, the first-Apply dialog) comes through saveApply, which asks the one confirmation and writes nothing on "Not now".
  const saved = await saveApply({change, chosen, current, confirm: askFullAutomation, write: patch => window.pilot.saveSettings(patch).catch(() => null)});
  if (saved) current = saved;
  draw();
  if (saved) offerBrowser($('ss-browser'), needsBrowser(saved));   // Why (2026-10-28, B follow-up 2): the offer was decided once at start-up, so choosing Background automation later showed none until a restart
  return saved ? current : null;
}

/** The one confirmation for Full automation: the checks it will run under, one button to turn it on. Resolves true only on that button. */
export function askFullAutomation() {
  const dialog = $('auto-confirm-dialog');
  const auto = applyOf(current).auto;
  $('auto-confirm-checks').replaceChildren(...[
    auto.waitMin ? `A ${auto.waitMin}-minute wait with Stop before each submit (your setting)` : 'No wait before each submit (optional: Settings → Apply)',
  ].map(text => Object.assign(document.createElement('li'), {textContent: text})));
  return new Promise(resolve => {
    const finish = yes => { dialog.close(); resolve(yes); };
    $('auto-confirm-go').onclick = () => finish(true);
    dialog.addEventListener('cancel', () => finish(false), {once: true});
    $('auto-confirm-cancel').onclick = () => finish(false);
    dialog.showModal();
  });
}

// "Adjust settings…" in the first-Apply dialog: Settings → Apply with a Confirm bar; answer(true) after Confirm, answer(false) after Not now.
let answerBar = null;
export function askConfirm(answer) {
  answerBar = answer;
  $('apply-confirm-bar').hidden = false;
  openSetting('apply-mode');
}
export const confirming = () => !!answerBar;
function closeBar(chosen) {
  const answer = answerBar;
  answerBar = null;
  $('apply-confirm-bar').hidden = true;
  answer?.(chosen);
}

export async function init() {
  if (!$('apply-modes')) return;
  ready = window.pilot.state().catch(() => null).then(state => { current = state?.settings || {}; });
  await ready;
  const box = $('apply-auto-checks');
  box.replaceChildren(...CHECKS.map(checkRow));
  document.querySelectorAll('[data-apply-answers]').forEach(button => button.addEventListener('click', () => save({answers: button.dataset.applyAnswers})));
  $('apply-confirm-go').addEventListener('click', async () => { await save({}, {chosen: true}); closeBar(true); });
  $('apply-confirm-cancel').addEventListener('click', () => closeBar(false));
  draw();
}
