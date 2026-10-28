// Settings → Apply (owner, 26 Oct 2026, hybrid fill step 2): how applying works (3 modes), where answers come from, Full automation's checks, and the
// Confirm bar the first-Apply dialog's "Adjust settings…" opens (pages/apply-choice.js). Each change saves at once into settings.apply
// (renderer/apply-settings-model.js); the consent and accounts cards moved here keep their own modules (consent-setting.js, assistant-mode.js).
// Guards: test/apply-settings.test.js, test/apply-choice-gate.test.js.
import {$} from './core.js';
import {choiceCards} from '../components.js';
import {ANSWERS_TEXT, MODES, applyOf, applyPatch, modeBuilt} from '../apply-settings-model.js';
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

// The checks, each the person's to change (CLAUDE.md "The app submits only in Full automation"): numbers as a short field, yes/no as a switch.
export const CHECKS = [
  {key: 'minFit', before: 'Fit is at least', after: '', min: 0, max: 100},
  {key: 'noEmpty', title: 'No required field is empty'},
  {key: 'factsOnly', title: 'Every answer comes from my saved facts', note: 'No AI guess in a form that is sent by itself.'},
  {key: 'perDay', before: 'At most', after: 'applications a day', min: 1, max: 200},
  {key: 'perEmployer', before: 'At most', after: 'per employer a day', min: 1, max: 20},
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
export async function save(change = {}, {chosen = false} = {}) {
  await ready;
  const saved = await window.pilot.saveSettings(applyPatch(current, change, {chosen})).catch(() => null);
  if (saved) current = saved;
  draw();
  return current;
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
