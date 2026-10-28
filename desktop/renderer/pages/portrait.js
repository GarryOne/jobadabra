// Profile → Your portrait (spec 2026-10-28-your-portrait-design.md, owner 28 Oct 2026): a read-only text the app writes about you. No control edits it; each statement's
// evidence chip opens the source tab where that source can be corrected, and the next run follows. Drawn from lib/portrait.js status(): not_yet (what it needs, with
// progress), current, outdated (the text stays, "Updating soon"). Guarded by test/portrait-tab.test.js.
import {el, pill, tag} from '../components.js';
import {emptyState} from '../page-parts.js';
import {$} from './core.js';
import {PROFILE_TABS} from './profile-save-bar.js';

const TONE = {strengths: 'good', come_across: 'warn', short: 'lead'};   // the rule beside a statement: what stands out, what an employer may see
const openTab = key => document.querySelector(`[data-profile-tab="${key}"]`)?.click();

const progressRow = ({label, have, need}) => {
  const row = el('li', 'portrait-need');
  row.append(el('span', '', label), el('span', 'muted', `${have} / ${need}`), pill(have >= need ? 'Done' : 'Needed', have >= need ? 'good' : 'neutral'));
  return row;
};

// One section of the sheet: a small-caps label, then its statements as plain text, each with the chips of its evidence (no card, no icon).
function sectionBlock(section, evidence, open) {
  const block = el('section', `portrait-sec portrait-sec-${section.key}`);
  block.dataset.tone = TONE[section.key] || 'plain';
  block.append(el('h3', 'portrait-label', section.title));
  const list = el('div', 'portrait-statements');
  for (const statement of section.statements) {
    const one = el('div', 'portrait-statement'), sources = el('div', 'portrait-sources');
    sources.append(...statement.evidence.filter(id => evidence[id]).map(id => tag(evidence[id].label, {title: `Open ${PROFILE_TABS[evidence[id].tab] || 'the source'} to correct it`, onClick: () => open(evidence[id].tab)})));
    one.append(el('p', 'portrait-text', statement.text), sources);
    list.append(one);
  }
  block.append(list);
  return block;
}

const VIEWS = [['structured', 'Structured'], ['letter', 'Plain text']];
const viewSwitch = (view, onView) => {
  const group = el('div', 'segmented');
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', 'How to read your portrait');
  for (const [key, label] of VIEWS) {
    const button = Object.assign(el('button', key === view ? 'is-active' : '', label), {type: 'button'});
    button.dataset.portraitView = key;
    button.addEventListener('click', () => onView(key));
    group.append(button);
  }
  return group;
};

/** The plain view: the portrait as a recommendation letter, raw coherent text on the sheet, no label, chip or control (owner, 28 Oct 2026). */
const letterSheet = status => {
  const sheet = el('article', 'portrait-sheet portrait-letter');
  sheet.append(...status.letter.map(paragraph => el('p', 'portrait-letter-text', paragraph)), el('p', 'portrait-letter-end', `Written by Jobadabra, ${status.updated}`));
  return sheet;
};

/**
 * The tab's content for one status ({state, sections, letter, evidence, updated, progress}) -> an element. `open(tab)` opens a source's Profile tab; `view` is
 * 'structured' or 'letter' (the letter only when the status has one), `onView(key)` switches it; `note` explains a first portrait that could not be written.
 * Invariants: it draws no input, textarea or editable text; a chip is only ever a button that opens a source; the view switch is the only other control.
 */
export function portraitView(status, {open = openTab, view = 'structured', onView = () => {}, note = ''} = {}) {
  const box = el('div', 'portrait-view');
  if (status.state === 'not_yet') {
    box.append(emptyState({icon: 'user', chip: 'Not yet', title: 'Not enough to describe you yet',
      text: 'Your portrait appears as we learn about you: your CV, your form fills and your interview reviews. You cannot edit it; correct the sources and it follows.'}));
    const needs = el('ul', 'portrait-needs');
    needs.append(...status.progress.map(progressRow));
    box.append(needs);
    return box;
  }
  if (!status.sections.length) {   // enough to write, nothing written yet: the first run is pending, or it could not run (Gitar on #2334)
    box.append(emptyState({icon: 'user', chip: note ? 'Not written' : 'Updating soon', title: note ? 'Your portrait could not be written yet' : 'Writing your first portrait',
      text: note || 'It is written when you open this tab, from what we know about you.'}));
    return box;
  }
  const showLetter = view === 'letter' && status.letter?.length > 0;
  const line = el('header', 'portrait-masthead'), cited = new Set(status.sections.flatMap(section => section.statements.flatMap(each => each.evidence)));
  const title = el('div', 'portrait-title');
  title.append(el('h2', '', 'Your portrait'), el('span', 'muted small', `Updated ${status.updated} · from ${cited.size} sources`));
  line.append(title);
  if (status.state === 'outdated') line.append(pill('Updating soon', 'info'));
  if (status.letter?.length) line.append(viewSwitch(showLetter ? 'letter' : 'structured', onView));
  box.append(line);
  if (showLetter) { box.append(letterSheet(status)); return box; }
  const sheet = el('article', 'portrait-sheet');
  sheet.append(...status.sections.map(section => sectionBlock(section, status.evidence, open)));
  const tabs = new Map();
  for (const id of cited) { const info = status.evidence[id]; if (info) tabs.set(info.tab, (tabs.get(info.tab) || 0) + 1); }
  const built = el('footer', 'portrait-built');
  built.append(el('span', 'portrait-label', 'Built from'), ...[...tabs].map(([tab, count]) => tag(`${PROFILE_TABS[tab] || tab} · ${count}`, {title: `Open ${PROFILE_TABS[tab] || tab}`, onClick: () => open(tab)})));
  sheet.append(built);
  box.append(sheet);
  return box;
}

const REASONS = {no_ai: 'Choose your AI in Settings → Connections → AI, then open this tab again.', failed: 'The writer could not run just now. Open this tab again to retry.'};
let view = 'structured', last = null, loaded = false;
try { view = localStorage.getItem('portraitView') === 'letter' ? 'letter' : 'structured'; } catch { /* storage blocked: the default view */ }
function draw(status, note = '') {
  last = status;
  $('portrait-body')?.replaceChildren(portraitView(status, {view, note, onView: key => { view = key; try { localStorage.setItem('portraitView', key); } catch { /* a convenience only */ } draw(last, note); }}));
}
/** Draws the tab, then asks for a refresh when the text is outdated (the handler runs the writer at most once a day). A first portrait that could not run says why, and opening the tab again retries. */
export async function loadPortrait() {
  if (!$('portrait-body')) return;
  const status = await window.pilot.portrait();
  if (status?.ok === false) return $('portrait-body').replaceChildren(el('p', 'muted', status.error));
  draw(status);
  if (loaded || status.state === 'current' || status.state === 'not_yet') return;
  loaded = true;
  const result = await window.pilot.portraitRefresh();
  if (result?.ran) draw(await window.pilot.portrait());
  else if (REASONS[result?.reason]) { loaded = false; draw(status, status.sections.length ? '' : REASONS[result.reason]); }
}
