// Shared helpers and start-up state of the window.
import {fillIcons} from '../icons.js';
import {ago} from '../jobs-view.js';
import {localize, osText as swap, pick} from '../os.js';
import {plainError} from '../run-warnings.js';
import {shared} from './shared.js';

export const $ = id => document.getElementById(id);
export const osText = text => swap(text, window.pilot.platform);
export const osPick = (mac, windows) => pick(mac, windows, window.pilot.platform);
export const STEPS = ['welcome', 'ai', 'cv', 'draft', 'letter', 'hosted', 'extras'];
// How old a saved screen is, in minutes (ago() rounds to hours): "just now", "4 min ago", "2 h ago".
export const savedAgo = iso => {
  const minutes = Math.floor((Date.now() - Date.parse(iso)) / 60000);
  return !Number.isFinite(minutes) || minutes < 1 ? 'just now' : minutes < 60 ? `${minutes} min ago` : minutes < 1440 ? `${Math.floor(minutes / 60)} h ago` : ago(iso);
};

// "Today 19:10", "Mon 19:10", or a date once it is older than a week.
export function runWhen(iso) {
  const at = new Date(iso), today = new Date();
  const time = at.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
  if (at.toDateString() === today.toDateString()) return `Today ${time}`;
  if (today - at > 7 * 86400000) return `${at.toLocaleDateString([], {day: 'numeric', month: 'short'})} ${time}`;
  return `${at.toLocaleDateString([], {weekday: 'short'})} ${time}`;
}

// ---------- helpers ----------
export function show(element, visible = true) { element.hidden = !visible; }
// AI steps can run: the user chose their own Claude Code or Codex, or saved the chosen API engine's key (the same rule as lib/ai/index.js ready).
export const aiReady = () => {
  const engine = shared.state?.settings?.aiEngine, secrets = shared.state?.secrets || {};
  if (engine === 'cli' || engine === 'codex') return true;
  return engine === 'openai' ? !!secrets.OPENAI_API_KEY : !!secrets.ANTHROPIC_API_KEY;
};
export function message(id, text, tone = '') { const el = $(id); el.textContent = plainError(text); el.className = `message ${tone}`; }
// Regex fragments from the draft ("z[uü]rich", "\\bsre\\b") shown as plain words.
export {fragmentWords as readable} from '../fragment-words.js';   // a crawl pattern as words (one rule for every screen)

// Run at start-up, in the order the window has always done it (app.js calls each page's init in turn).
export async function init() {
  localize(document.body, window.pilot.platform);
  fillIcons();
  for (const line of document.querySelectorAll('[data-version]')) {
    // The setup sidebar: a short line (the full label with build and commit on hover); elsewhere the full label.
    const short = line.closest('.steps-foot');
    line.textContent = short ? `Version ${shared.state.about.version}${shared.state.about.build ? '' : ' · dev'}` : `Version ${shared.state.about.label}`;
    line.title = `Version ${shared.state.about.label}`;
  }
  for (const line of document.querySelectorAll('[data-version-title]')) line.title = `Version ${shared.state.about.label}`;
  // Running from source (npm start): a DEV tag next to the name, so it's never mistaken for the installed app.
  // Developer-only blocks ("For developers: load it from a folder"): hidden in index.html, shown only in a run from source, never the beta or stable install.
  for (const node of document.querySelectorAll('[data-dev-only]')) node.hidden = !shared.state.about.dev;
  if (shared.state.about.dev) for (const brand of document.querySelectorAll('.brand')) brand.append(Object.assign(document.createElement('span'), {className: 'dev-tag', textContent: shared.state.about.mark || 'DEV'}));

  document.addEventListener('click', event => {
    const link = event.target.closest('[data-link]');
    if (link) { event.preventDefault(); window.pilot.openExternal(link.dataset.link); }
    // Every Copy button (data-copy="<id of what it copies>"): says "Copied ✓" for a moment, then is itself again (icon included). Inside a
    // card's header (the Technical log's summary) the click copies only, it doesn't also open or close the card.
    const copy = event.target.closest('[data-copy]');
    if (copy) {
      if (copy.closest('summary')) event.preventDefault();
      navigator.clipboard.writeText($(copy.dataset.copy).textContent).then(() => {
        copy.dataset.label ??= copy.innerHTML;
        copy.textContent = 'Copied ✓';
        clearTimeout(copy.copiedTimer);
        copy.copiedTimer = setTimeout(() => { copy.innerHTML = copy.dataset.label; }, 1500);
      }).catch(error => console.error('copy failed', error));
    }
  });
}
