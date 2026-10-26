// The stuck session card's Claude offer (owner, 10 Oct 2026; spec docs/superpowers/specs/2026-10-10-claude-finishes-stuck-pages.md part 3): the same three choices as the page's panel
// (extension/panel-claude.js): "Let Claude finish this page", "I'll do it myself", "Always let Claude finish when I'm stuck", the consent line on the first press, and the line "Claude
// works in this tab and stops before Submit". A press goes through the app's one guarded take-over (lib/ladder/rung5-takeover.js: at most one per application). No countdown here: the panel does that
// where the tab is open. Only while Claude is ready (claude-help.js). Guarded by test/claude-offer.test.js.
import {el} from './components.js';
import {cardOffer} from './claude-offer-view.js';
import {icon} from './icons.js';
import {resumeOffered} from './claude-help.js';
import {shared} from './pages/shared.js';
import {toastMessage} from './pages/startup.js';
import {jobPlace} from './targets.js';

const dismissed = new Set(), asking = new Set();   // sessions whose offer the person waved away / whose consent line is open

function button(text, kind, run, glyph) {
  const node = el('button', `${kind}${glyph ? ' with-icon' : ''}`);
  if (glyph) node.append(icon(glyph));
  node.append(el('span', '', text));
  node.addEventListener('click', run);
  return node;
}

// -> {buttons, notes}: what the card adds to its actions and to its text; `after` runs once Claude started (refresh the list, open the session).
export function offerParts(item, {rerender, after = async () => {}}) {
  const view = cardOffer({help: resumeOffered(), dismissed: dismissed.has(item.id), asking: asking.has(item.id)});
  if (view === 'hidden') return {buttons: [], notes: []};
  const start = async consent => {
    const result = await window.pilot.takeOverClaude(item.url, {title: item.title, company: item.company, location: item.location, workMode: item.workMode}, consent).catch(() => null);
    if (result?.ok === false) { toastMessage(result.refused ? 'Claude already worked on this application' : 'Claude could not start', result.refused ? 'Open its session to continue, or finish the page yourself.' : (result.error || 'Try again.'), result.refused ? {view: 'sessions'} : jobPlace(item), result.refused ? 'warn' : 'bad'); return; }
    if (consent) shared.state.settings = {...shared.state.settings, claudeConsent: new Date().toISOString()};
    asking.delete(item.id);
    await after(result);
  };
  if (view === 'consent') {
    return {notes: [el('p', 'rich-p', 'Claude will click and type in this tab without asking each step. It never presses Submit.')],
      buttons: [button('Continue', 'secondary', () => start(true), 'bot'), button('Cancel', 'link', () => { asking.delete(item.id); rerender(); })]};
  }
  const always = el('input');
  always.type = 'checkbox';
  always.checked = !!shared.state?.settings?.claudeAuto;
  always.addEventListener('change', async () => { shared.state.settings = await window.pilot.saveSettings({claudeAuto: always.checked}); });
  const label = el('label', 'check-row');   // the shared checkbox row (components.css)
  label.append(always, el('span', '', 'Always let Claude finish when I\'m stuck'));
  return {notes: [el('p', 'muted small', 'Claude works in this tab and stops before Submit.'), label],
    buttons: [button('Let Claude finish this page', 'secondary', () => (shared.state?.settings?.claudeConsent ? start(false) : (asking.add(item.id), rerender())), 'bot'),
      button('I\'ll do it myself', 'link', () => { dismissed.add(item.id); rerender(); })]};
}
