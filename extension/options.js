// Settings: only the connection to the Jobadabra app — filled in by itself when this page opens, or by Connect.
// The user's contact details and CV live in the app, which the extension asks for each time it fills a form (flow.js).
import {plainWhy} from './ai-reply.js';
import {pair} from './flow.js';

const $ = id => document.getElementById(id);
const APP_URL = 'http://127.0.0.1';
const usesApp = url => !url || url.startsWith(APP_URL);   // the same rule as flow.js: not our own Worker
const stored = await chrome.storage.local.get(['workerUrl', 'token', 'checkEligibility', 'testMode', 'clickDropdowns', 'acceptConsents']);
// Every site: an optional permission, granted only by Chrome's own prompt from this click.
const EVERY_SITE = {origins: ['https://*/*']};
$('anySite').checked = await chrome.permissions.contains(EVERY_SITE);
$('anySite').addEventListener('change', async () => {
  const on = $('anySite').checked;
  const ok = await (on ? chrome.permissions.request(EVERY_SITE) : chrome.permissions.remove(EVERY_SITE)).catch(() => false);
  if (on && !ok) $('anySite').checked = false;
});
// Cookies: an optional permission too, asked by Chrome from this click (ready-handoff.js uses it only when granted).
const COOKIES = {permissions: ['cookies']};
$('carryLogins').checked = await chrome.permissions.contains(COOKIES);
$('carryLogins').addEventListener('change', async () => {
  const on = $('carryLogins').checked;
  const ok = await (on ? chrome.permissions.request(COOKIES) : chrome.permissions.remove(COOKIES)).catch(() => false);
  if (on && !ok) $('carryLogins').checked = false;
});
$('acceptConsents').checked = stored.acceptConsents !== false;   // on unless turned off (owner, 17 Oct 2026)
$('acceptConsents').addEventListener('change', () => chrome.storage.local.set({acceptConsents: $('acceptConsents').checked}));
// Chrome grants debugger only at install (it can't be optional); this switch decides whether it's used.
$('clickDropdowns').checked = stored.clickDropdowns !== false;  // on by default
$('clickDropdowns').addEventListener('change', () => chrome.storage.local.set({clickDropdowns: $('clickDropdowns').checked}));
$('testMode').checked = stored.testMode === true;
$('testMode').addEventListener('change', () => chrome.storage.local.set({testMode: $('testMode').checked}));
$('checkEligibility').checked = stored.checkEligibility !== false;
$('checkEligibility').addEventListener('change', () => chrome.storage.local.set({checkEligibility: $('checkEligibility').checked}));
$('workerUrl').value = stored.workerUrl || '';
$('token').value = stored.token || '';

// The pair button is the escape hatch (a reinstalled app, another Mac, a new workspace), not a step: the extension
// pairs itself whenever the app turns its token down. So it only looks like a call to action when there is one — with
// the app answering it is a small Reconnect beside the answer.
function pairWords(state, detail = '') {
  const button = $('pair');
  // Only "the app couldn't be reached" is a call to action; the rest are quiet, so the page never asks for a click
  // that has nothing to do.
  button.className = state === 'disconnected' ? '' : 'secondary small';
  button.disabled = state === 'checking';
  button.textContent = state === 'connected' ? 'Reconnect' : state === 'checking' ? 'Connecting…' : 'Connect to the Jobadabra app';
  $('pair-status').textContent = detail;
  $('pair-status').className = state === 'connected' ? 'on' : '';
}
async function connectToApp() {
  pairWords('checking', 'Looking for the Jobadabra app on this Mac…');
  try {
    const {workerUrl, token} = await pair();
    $('workerUrl').value = workerUrl;
    $('token').value = token;
    pairWords('connected', 'Connected to the Jobadabra app ✓');
  } catch (error) {
    pairWords('disconnected', `Couldn't reach the Jobadabra app (${plainWhy(error)}). Open the app, then try again.`);
  }
}
$('pair').addEventListener('click', connectToApp);
// Opening the page refreshes the connection — and heals a token the app rotated (reinstall, reset, another Notion
// workspace), because pair() saves what it finds. A URL of your own is left alone.
if (usesApp(stored.workerUrl) || !stored.token) connectToApp();
else pairWords('worker', 'Using your own Worker URL. Connect fills in the app on this Mac instead.');

$('save').addEventListener('click', async () => {
  await chrome.storage.local.set({workerUrl: $('workerUrl').value.trim(), token: $('token').value.trim()});
  $('saved').textContent = 'Saved ✓';
  setTimeout(() => { $('saved').textContent = ''; }, 2000);
});
