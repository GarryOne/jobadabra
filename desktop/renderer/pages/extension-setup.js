// Settings → Connections → Chrome extension (and the setup wizard's extras card): is it installed (the browser says so at once),
// is it awake (its report), and the buttons that install and connect it. Moved from connections.js (26 Oct 2026, a pure move).
// Guards: test/extension-store-setup.test.js, test/palette-every-action.test.js, test/extension-card-first-paint.test.js.
// The first paint draws the last known state (owner, 26 Oct 2026: "We should see the status from beginning"), from the record settings.js keeps
// for the Connections cards (one copy); the live read then confirms or corrects it. The install steps fold only when the state changes.
import {$, message, osPick, osText, show} from './core.js';
import {extensionFrom, extensionState, justStarted} from '../service-status.js';
import {foldFollows} from '../fold-follows.js';
import {lookedText} from '../extension-looked.js';
import {inBrowser, retarget} from '../browser-words.js';
import {keptExtension, noteCheck, stateLine} from './settings.js';
import {toastMessage} from './startup.js';

function showStray(entry) {
  const box = $('ext-stray');
  show(box, !!entry);
  if (!entry) return;
  $('ext-stray-text').textContent = `A windowless Chrome from an earlier automation (started ${entry.since}) holds Chrome's scripting connection, so this app can't reach your own Chrome window.`;
  $('ext-stray-quit').dataset.pid = String(entry.pid);
}

// ---------- Chrome extension: is it installed (the browser says so at once), and is it awake (its report)? ----------
// What the card says in each state: the pill is the state, this is the sentence that explains it.
const EXT_LINE = {
  connected: 'Connected: it fills application forms with your details and CV.',
  closed: 'Installed in Chrome. Chrome isn\'t running, so it can\'t reach this app: open it and it reports within 30 seconds.',
  idle: 'Installed in Chrome, connecting to this app. If it stays amber, press Connect the extension below and then Connect to the Jobadabra app.',
  off: 'Installed in Chrome but turned off: switch it back on in chrome://extensions.',
  absent: 'Not installed in Chrome yet: Add to Chrome below takes a minute.',
  checking: 'Looking for it in Chrome…',
};
let browserApp = 'Google Chrome';  // the browser the extension is (or will be) installed in, from the app

// One state drawn: the pill, its sentence, Connect, and the install steps (opened or closed only when the state changes: foldFollows).
function drawCard(state) {
  const pill = stateLine(state.on, state.on && state.version ? `v${state.version}` : '', state.checking, state.words);
  pill.id = 'ext-status';
  $('ext-status').replaceWith(pill);
  for (const card of ['setting-extension', 'extras-extension']) retarget($(card), browserApp, '#ext-stray, #ext-looked, #ext-path');  // Chrome's words become Edge's when that is where it is
  $('ext-line').textContent = inBrowser(EXT_LINE[state.state] || EXT_LINE.absent, browserApp);
  show($('ext-connect'), state.state === 'idle');
  foldFollows($('ext-setup'), state.state, state.state !== 'connected');
  const SUMMARY = {connected: 'Reinstall or troubleshoot', absent: 'Install the extension'};
  $('ext-setup').querySelector('summary').textContent = SUMMARY[state.state] || 'Troubleshoot the connection';
}

// The window's first paint (connections.js init): the last known state at once; with nothing kept, index.html's Checking… stays.
export function paintExtensionCardFirst() {
  const record = keptExtension();
  const state = extensionFrom(record);
  if (state.checking) return;
  browserApp = record.browser || browserApp;
  drawCard(state);
}

let retrying = false;
export async function showExtensionStatus() {
  const [seen, found] = await Promise.all([window.pilot.extensionSeen().catch(() => null), window.pilot.extensionInstall().catch(() => null)]);
  const state = extensionState({known: !!found || !!seen, installed: found?.installed || [], seen, browserRunning: found?.browserUp ?? null, justStarted: justStarted()});
  if (state.checking) {   // the profile read, or the first report since the start, is a moment away: what is drawn stays until then
    if (!retrying) { retrying = true; setTimeout(() => { retrying = false; showExtensionStatus(); }, 1500); }
    return;
  }
  browserApp = found?.browser || browserApp;
  drawCard(state);
  showStray((await window.pilot.strayChrome().catch(() => []))[0] || null);
  $('ext-path').textContent = found?.folder || '';  // what Chrome's Load unpacked dialog wants pasted (developer runs only)
  const looked = lookedText(found?.looked);  // where we looked: the answer when the profile is somewhere we can't know
  $('ext-looked').textContent = looked;
  $('ext-looked').hidden = !looked;
  noteCheck({extension: {installed: found?.installed || [], seen, browserUp: found?.browserUp ?? null, browser: found?.browser || '', at: Date.now()}});  // the cards above follow, and the next start paints it first
}

// The card's buttons, bound once at start (connections.js init).
export function bindExtension() {
  // Add to Chrome (Settings and the setup wizard): the Chrome Web Store page in the browser the extension goes in.
  for (const button of document.querySelectorAll('[data-add-extension]')) {
    button.addEventListener('click', async () => {
      button.disabled = true;
      const result = await window.pilot.extensionStore().catch(() => null);
      button.disabled = false;
      toastMessage(result?.opened ? 'Chrome Web Store opened' : 'Couldn\'t open Chrome',
        inBrowser(result?.opened ? 'Press Add to Chrome there. It connects to this app by itself within 30 seconds.'
          : 'Open Chrome, then search the Chrome Web Store for Jobadabra.', browserApp));
    });
  }
  $('ext-stray-quit').addEventListener('click', async event => {
    const button = event.currentTarget;
    button.disabled = true;
    const result = await window.pilot.quitStrayChrome(Number(button.dataset.pid)).catch(() => null);
    button.disabled = false;
    toastMessage(result?.ok ? 'Background Chrome quit' : 'Couldn\'t quit it',
      result?.ok ? 'Chrome\'s scripting now reaches your window — press the button again.' : (result?.error || 'Try again.'));
    showExtensionStatus();
  });
  // The step-1 chip: best effort at Chrome's page, and the URL on the clipboard so the paste always gets there.
  $('ext-open-page').addEventListener('click', async () => {
    const result = await window.pilot.extensionPage().catch(() => null);
    message('ext-message', inBrowser(result?.opened
      ? osText('Asked Chrome to open its extensions page. If nothing appears: chrome://extensions is on your clipboard (⌘L, ⌘V, ⏎).')
      : osText('chrome://extensions is on your clipboard: in Chrome press ⌘L, then ⌘V and ⏎.'), browserApp), result?.opened ? 'ok' : 'error');
  });
  // The folder in front of the user and its path on the clipboard. The Mac's dialog takes ⌘⇧G (Go to Folder), ⌘V,
  // Return; the PC's has no such shortcut, so it gets its own sentence. Bound by attribute, so the setup wizard's
  // own button behaves the same.
  for (const button of document.querySelectorAll('[data-show-extension-folder]')) {
    button.addEventListener('click', async () => {
      button.disabled = true;
      const result = await window.pilot.extensionShow().catch(() => null);
      button.disabled = false;
      toastMessage(result?.opened ? 'Extension folder opened' : 'Couldn\'t open the folder',
        inBrowser(result?.opened ? osPick('Its path is on your clipboard: in Chrome press Load unpacked, then ⌘⇧G, ⌘V, Return.',
          'Its path is on your clipboard: in Chrome press Load unpacked, paste it into the folder box (Ctrl+V), and press Enter.')
          : 'Open the extension folder by hand, then press Load unpacked in Chrome.', browserApp));
    });
  }
  $('ext-connect').addEventListener('click', async () => {
    const result = await window.pilot.extensionOptions().catch(() => null);
    message('ext-message', result?.opened ? 'Its settings page is open: press Connect to the Jobadabra app there.'
      : inBrowser('Couldn\'t open the extension\'s settings page. Open it from Chrome: 🧩 → ⋮ next to Jobadabra → Options.', browserApp), result?.opened ? 'ok' : 'error');
  });
}
