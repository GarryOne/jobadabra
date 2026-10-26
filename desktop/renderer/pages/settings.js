// Settings page: the overview of every service (AI, Notion, Gmail, Telegram, Always on, extras) and each one's sub-page.
import {showMode} from '../assistant-mode.js';
import {showClaudeAuto} from '../claude-auto.js';
import {openLogs} from './logs.js';
import {el, tile} from '../components.js';
import {icon} from '../icons.js';
import {betaText, testText, updateText} from '../update-text.js';
import {shared} from './shared.js';
import {$, aiReady, show} from './core.js';
import {extensionFrom, justStarted} from '../service-status.js';
import {openView, remembered} from './nav.js';
import {profileBar} from './profile-save-bar.js';
import {detailsChanged} from './details-drafts.js';
import {profileTab, showContact} from './profile.js';
import {startDefault} from '../tab-choice.js';
import {byStore} from '../store-words.js';
import {SERVICES, isRequired} from './services-list.js';
import {emailSetupCard} from './setup-email-card.js';

// ---------- Settings: sub-pages (Overview, Application profile, Automation, Connections, Data & backup, Advanced) ----------
let pageNow = '';
export function settingsPage(name) {
  if (pageNow === 'profile' && name !== 'profile' && !profileBar().leave(() => { pageNow = ''; settingsPage(name); })) return;   // unsaved Profile edits: ask first
  pageNow = name;
  remembered('settingsPage', name);
  if (name === 'connections' && lastStatus) setTimeout(() => autoConnect(lastStatus), 0);  // after the page is shown
  if (name === 'profile') openProfile();
  if (name === 'credentials') openCredentials();
  if (name === 'logs') setTimeout(() => openLogs().catch(error => console.error('Settings · logs:', error)), 0);  // after the page is shown
  document.querySelectorAll('[data-settings-page]').forEach(page => show(page, page.dataset.settingsPage === name));
  // Profile is its own page (owner, 18 Oct 2026, UI redesign fix 9): its heading and 5 tabs, without "Settings", its list of sections or a second heading.
  // Every way in (the sidebar's Profile, Settings → Profile, Overview's Edit profile, ⌘K) passes here. Guarded by test/profile-page.test.js.
  document.querySelector('.view[data-view="settings"]')?.classList.toggle('is-profile', name === 'profile');
  // The menu: Profile is a Settings page of its own there.
  document.querySelectorAll('.nav[data-view="settings"]').forEach(nav => nav.classList.toggle('active', (nav.dataset.settings === 'profile') === (name === 'profile')));
  document.querySelectorAll('.settings-nav [data-settings-go]').forEach(button => button.classList.toggle('is-active', button.dataset.settingsGo === name));
}
// One Settings card (setting-<id>): its sub-page, then scrolled to. Used by every link into Settings.
export function openSetting(id) {
  const card = $(`setting-${id}`) || $(id);  // a card, or a part of one (tg-cloud: inside Always on)
  if (!card || card.closest('[data-parked]')) return;   // a parked feature's card never opens (src/features.py PARKED)
  const view = card.closest('.view')?.dataset.view;
  if (view && view !== 'settings') {  // a card on another page (Profile: CV, details, links, assistant)
    openView(view);
    setTimeout(() => card.scrollIntoView({behavior: 'smooth', block: 'start'}), 50);
    return;
  }
  // Called from another page (the sidebar's allowance counter, a dialog's button): show Settings first, else only its inner page changed
  // behind the screen that was open and the click seemed to do nothing.
  if (document.querySelector('.view[data-view="settings"]')?.hidden) openView('settings');
  settingsPage(card.closest('[data-settings-page]')?.dataset.settingsPage || 'overview');
  if (card.dataset.profilePanel) profileTab(card.dataset.profilePanel);   // a card on a Profile tab (Your details' sections): that tab, not the default
  if (card.classList.contains('conn-panel')) document.querySelectorAll('.conn-panel').forEach(panel => show(panel, panel === card));
  setTimeout(() => card.scrollIntoView({behavior: 'smooth', block: 'start'}), 50);
  arrived(card);
}
// The card a link led to glows for a moment, so it's clear which one on the page was meant.
function arrived(card) {
  card.classList.remove('is-arrived');
  void card.offsetWidth;  // restart the glow when the same card is opened twice
  card.classList.add('is-arrived');
  setTimeout(() => card.classList.remove('is-arrived'), 2400);
}
// Settings → Profile: CV, Your details and Application answers. What goes into applications; nothing here re-scores jobs.
async function openProfile() {
  const stillDefault = startDefault();   // "CV" is only the default: a tab picked while the state loads stays (tab-choice.js)
  shared.state = await window.pilot.state();
  showClaudeAuto();
  showMode(shared.state.settings);
  showContact();
  if (stillDefault()) profileTab('cv', {byDefault: true});
}

// Each service's state. Keys are known at once (this Mac); Google (a Python check) and the extension answer later, so
// their last answer is remembered here and shown meanwhile ("Checking…" the very first time).
const SERVICE_CACHE = 'serviceChecks';
const lastChecks = () => { try { return JSON.parse(localStorage.getItem(SERVICE_CACHE) || 'null'); } catch { return null; } };
function statusFrom({extension, google}) {
  const on = {ai: aiReady(), notion: !!shared.state.secrets.NOTION_TOKEN, serpapi: !!shared.state.secrets.SERPAPI_API_KEY, brave: !!shared.state.secrets.BRAVE_SEARCH_API_KEY,
    aggregators: !!((shared.state.secrets.ADZUNA_APP_ID && shared.state.secrets.ADZUNA_APP_KEY) || shared.state.secrets.JOOBLE_API_KEY), cloud: !!shared.state.settings.cloud?.repo, 'tg-cloud': !!shared.state.settings.telegramCloud,
    telegram: !!(shared.state.secrets.TELEGRAM_BOT_TOKEN && shared.state.settings.telegramChatId), notify: !!shared.state.notifyBy?.includes('email'), google: !!google?.connected, extension: extension.on};
  const detail = {ai: aiReady() && ({cli: 'Claude Code · your plan', codex: 'Codex · your plan', openai: 'OpenAI API key'}[shared.state.settings.aiEngine] || 'Anthropic API key'), google: google?.connected && google.email, extension: extension.on && extension.version && `v${extension.version}`,
    telegram: on.telegram && shared.state.settings.telegramBot && `@${shared.state.settings.telegramBot}`, notify: on.notify && shared.state.settings.notifyEmail,
    cloud: shared.state.settings.cloud?.repo, 'tg-cloud': shared.state.settings.telegramCloud?.url?.replace('https://', '')};
  const words = {extension: extension.on || extension.checking ? '' : extension.words};
  const checking = {google: !google, extension: extension.checking};
  return {on, detail, words, checking, extensionIdle: extension.state === 'idle', missing: SERVICES.find(service => isRequired(service) && !on[service.id] && !checking[service.id]) || null};
}
// The extension's state: renderer/service-status.js extensionFrom (a kept record is judged at the time it was kept).
// The extension card's first paint reads the same kept record (pages/extension-setup.js), so there is one copy.
export const keptExtension = () => lastChecks()?.extension || null;
// From what's known: the kept answer is shown at once, then the real checks land a moment later.
const quickStatus = () => { const last = lastChecks(); return statusFrom({extension: extensionFrom(last?.extension), google: last?.google}); };
async function serviceStatus() {
  const [google, seen, found] = await Promise.all([window.pilot.googleStatus().catch(() => ({})), window.pilot.extensionSeen().catch(() => null),
    window.pilot.extensionInstall().catch(() => null)]);
  const record = {installed: found?.installed || [], seen, browserUp: found?.browserUp ?? null, browser: found?.browser || '', at: Date.now()};
  const live = extensionFrom(record, {justStarted: justStarted()});   // no report yet since the start: the kept answer stays meanwhile
  const kept = live.checking ? keptExtension() : record;
  try { localStorage.setItem(SERVICE_CACHE, JSON.stringify({google: {connected: !!google.connected, email: google.email || ''}, extension: kept})); } catch {}
  return {...statusFrom({extension: live.checking && kept ? extensionFrom(kept) : live, google}), folder: found?.folder || ''};
}
export function stateLine(on, detail = '', checking = false, words = '') {
  if (checking) {
    const line = el('span', 'service-state is-checking');
    line.append(el('span', 'spinner'), 'Checking…');
    return line;
  }
  const line = el('span', `service-state${on ? ' is-on' : ''}`);
  const text = on ? `Connected${detail ? ` · ${detail}` : ''}` : (words || 'Not connected');
  line.append(icon(on ? 'check-circle' : 'info'), el('span', 'service-state-text', text));  // long details end in "…"
  line.title = text;
  return line;
}
// An extension that is installed but not talking to the app needs one press (its options page pairs itself on
// opening), not the install steps: every button that would send the user to those steps connects instead.
const connectsNow = (service, status) => service.id === 'extension' && !!status.extensionIdle;
let connecting = false, autoAt = 0, autoCount = 0, lastStatus = null;
const AUTO_WAIT_MS = 5 * 60 * 1000, AUTO_MAX = 3;  // a broken connection is retried every 5 min, three times, then left to the button
export async function connectExtension({auto = false} = {}) {
  if (connecting) return;
  connecting = true;
  try {
    const result = await window.pilot.extensionOptions().catch(() => null);
    const {toastMessage} = await import('./startup.js');  // dynamic: startup.js imports this file
    if (result?.opened) toastMessage('Connecting the Chrome extension', auto ? 'Its settings page opened and connects by itself. You can close that tab.' : 'Its settings page is open and connects by itself. You can close that tab.');
    else if (!auto) { toastMessage('Couldn\'t open the extension', 'Open it from Chrome: 🧩 → ⋮ next to Jobadabra → Options.'); openSetting('extension'); }
    for (const wait of [3000, 8000]) setTimeout(() => import('./connections.js').then(page => page.showExtensionStatus()), wait);
  } finally { connecting = false; }
}
// Nobody has to press it: while the Connections page is in front and the extension is installed but silent, the connection
// is made again (not more often than every 5 min, three tries in a row), and the count starts over once it reports.
function autoConnect(status) {
  lastStatus = status;
  const page = document.querySelector('[data-settings-page="connections"]');
  const here = page && !page.hidden && !document.querySelector('.view[data-view="settings"]')?.hidden;
  if (status.on?.extension) autoCount = 0;
  if (!here || !status.extensionIdle || status.checking?.extension || autoCount >= AUTO_MAX || Date.now() - autoAt < AUTO_WAIT_MS) return;
  autoAt = Date.now();
  autoCount++;
  connectExtension({auto: true});
}
function showAlert(prefix, missing, status) {
  show($(`${prefix}-alert`), !!missing);
  if (!missing) return;
  const connect = connectsNow(missing, status);
  $(`${prefix}-alert-title`).textContent = prefix === 'ov' ? `Finish connecting ${missing.name}` : `${missing.name} is not connected`;
  $(`${prefix}-alert-text`).textContent = missing.why;
  $(`${prefix}-alert-go`).textContent = prefix === 'ov' || connect ? `Connect ${missing.name}` : `Set up ${missing.name}`;
  $(`${prefix}-alert-go`).onclick = () => (connect ? connectExtension() : openSetting(missing.id));
}
function renderConnections(status) {
  const {on, detail, words = {}, missing, checking = {}} = status;
  show($('connections-dot'), !!missing);
  showAlert('conn', missing, status);
  const card = service => {
    const box = el('div', 'service-card is-row');
    box.dataset.service = service.id;   // ⌘K folds its Manage under its card (nav.js)
    const text = el('span', 'service-text');
    text.append(el('b', '', service.name), el('span', 'muted small', service.what));
    const button = el('button', on[service.id] ? 'secondary' : 'secondary is-signal', on[service.id] ? 'Manage' : service.connect || 'Connect');
    button.addEventListener('click', () => (connectsNow(service, status) ? connectExtension() : openSetting(service.id)));
    const actions = el('span', 'service-actions');
    actions.append(stateLine(on[service.id], detail[service.id], checking[service.id], words[service.id]), button);  // state, then the way in
    box.append(tile(service.icon, on[service.id] ? 'good' : 'warn'), text, actions);
    return box;
  };
  // A service still being checked sits with the connected ones until it answers (it usually is).
  const connected = service => on[service.id] || checking[service.id];
  const listed = SERVICES.filter(service => !service.shown || service.shown());
  $('conn-on').replaceChildren(...listed.filter(connected).map(card));
  $('conn-off').replaceChildren(...listed.filter(service => !connected(service)).map(card));
  show($('conn-off-head'), listed.some(service => !connected(service)));
  autoConnect(status);
}
export async function renderOverview() {
  // Each part as soon as it's known: the cards and the settings at once, then the backup, the contact details
  // (read from Notion) and the Gmail / extension checks, each as it answers, none waiting for the others.
  showServicesNow();
  window.pilot.backupStatus().then(renderBackup, () => renderBackup({}));
  window.pilot.contact().then(renderContact, () => renderContact(null));
  renderServices(await serviceStatus());
  checkingLine(false);
}
// Under the Connections title: what's being checked right now, then when it was.
function checkingLine(busy) {
  const line = $('conn-status');
  if (busy) line.replaceChildren(el('span', 'spinner small'), 'Checking Gmail and the Chrome extension…');
  else line.replaceChildren(icon('check'), 'Checked just now');
  line.classList.toggle('is-done', !busy);
}
// A fresher answer from a detail card (Gmail and Calendar, Chrome extension): the Overview and Connections cards follow
// it, so the same service never shows "Not connected" at the top and "Connected" below.
export function noteCheck(part) {
  const last = lastChecks() || {};
  try { localStorage.setItem(SERVICE_CACHE, JSON.stringify({...last, ...part})); } catch {}
  refreshServices();
}
// A connection changed in the app (Always on turned on or off): the cards follow at once, from what's known.
export function refreshServices() {
  if (shared.state?.secrets) renderServices(quickStatus());
}
// Settings opened: the service cards from what's known now, before the page's other reads.
export function showServicesNow() {
  if (!shared.state?.secrets) return;
  renderServices(quickStatus());
  checkingLine(true);
  renderKnown();
}
// Setup → Optional extras: the same status as Settings → Connections (Connected · detail / Not connected), and
// "Manage" instead of "Set up" once a service is on.
function renderExtras({on, detail, words = {}, checking = {}}) {
  for (const button of document.querySelectorAll('.extras [data-goto-settings], .extras [data-add-extension]')) {
    const id = button.dataset.gotoSettings || 'extension', text = button.closest('.service-card')?.querySelector('.service-text');
    if (!text) continue;
    text.querySelector('.service-state')?.remove();
    text.querySelector('b').after(stateLine(!!on[id], detail[id] || '', !!checking[id], words?.[id] || ''));
    if (!button.dataset.gotoSettings) { show(button, !on[id]); continue; }   // Add to Chrome: nothing to press once it is in
    button.textContent = on[id] ? 'Manage' : (button.dataset.connect ||= button.textContent);
  }
}
// The extras step opened: from what's known at once, then the real checks.
export async function showExtrasStatus() {
  if (!shared.state?.secrets) return;
  renderExtras(quickStatus());
  const status = await serviceStatus();
  renderExtras(status);
}
function renderServices(status) {
  const {on, detail, words = {}, missing, checking} = status;
  renderExtras(status);
  renderConnections(status);
  renderDiagnostics(status);
  renderUpdate();
  renderBeta();
  showAlert('ov', missing, status);
  $('ov-services').replaceChildren(...SERVICES.filter(isRequired).map(service => {
    const card = Object.assign(document.createElement('button'), {type: 'button', className: 'service-card', title: `Open ${service.name}`});
    const text = el('span', 'service-text');
    text.append(el('b', '', service.name), stateLine(on[service.id], detail[service.id], checking[service.id], words[service.id]));
    card.append(tile(service.icon, on[service.id] ? 'good' : 'warn'), text);
    card.addEventListener('click', () => openSetting(service.id));
    return card;
  }));
  emailSetupCard($('ov-services'), openSetting).catch(error => console.error('Settings · email card:', error));
}
// Overview's summaries. What this Mac knows is shown at once; the rest fills in as it answers.
function renderKnown() {
  $('ov-cv').textContent = shared.state.settings.cvName || 'None yet';
  const chosen = kind => document.querySelector(`[data-schedule="${kind}"]`)?.selectedOptions[0]?.textContent || '';
  $('ov-search').textContent = chosen('search') || '—';
  $('ov-kits').textContent = chosen('kits') || '—';
  $('ov-cloud').textContent = shared.state.settings.cloud?.repo ? `On — GitHub ${shared.state.settings.cloud.repo}` : 'Off — runs while the app is open';
  if (!$('ov-contact').firstChild) $('ov-contact').replaceChildren(stateLine(false, '', true));
  if (!$('ov-backup').textContent) $('ov-backup').replaceChildren(stateLine(false, '', true));
}
function renderContact(contact) {
  if (!contact) {
    const line = el('span', 'service-state');
    line.append(icon('info'), el('span', 'service-state-text', byStore('Couldn\'t read Notion just now', 'Couldn\'t read your contact details just now')));
    $('ov-contact').replaceChildren(line);
    return;
  }
  const needed = {first_name: 'first name', last_name: 'last name', email: 'email', phone: 'phone'};
  const gaps = Object.keys(needed).filter(key => !contact[key]).map(key => needed[key]);
  const line = el('span', `service-state${gaps.length ? '' : ' is-on'}`);
  line.append(icon(gaps.length ? 'info' : 'check'), el('span', 'service-state-text', gaps.length ? `Missing: ${gaps.join(', ')}` : 'Complete'));
  $('ov-contact').replaceChildren(line);
}
function renderBackup(backup) {
  $('ov-backup').textContent = backup?.at ? new Date(backup.at).toLocaleString([], {dateStyle: 'medium', timeStyle: 'short'}) : 'None yet';
}
// Automation: run mode (this Mac while open, or Always on in GitHub); both segments lead to the Always on card.
export function showRunMode() {
  const repo = shared.state.settings.cloud?.repo;
  document.querySelectorAll('[data-run-mode]').forEach(button => button.classList.toggle('is-active', (button.dataset.runMode === 'cloud') === !!repo));
  $('run-mode-text').textContent = repo ? `Runs in your GitHub repository ${repo}, even with your Mac off.`
    : 'Scheduled tasks run on this Mac while Jobadabra is open.';
  $('run-mode-more').textContent = repo ? 'Manage Always on' : 'Learn about Always on';
  $('tz-note').textContent = `Times shown in ${Intl.DateTimeFormat().resolvedOptions().timeZone}.`;
}
function renderDiagnostics({on, detail, checking}) {
  const version = document.querySelector('[data-version]')?.textContent?.trim();
  $('diag-app').replaceChildren(stateLine(true, version));
  $('diag-app').firstChild.lastChild.textContent = `Running${version ? ` · ${version}` : ''}`;
  $('diag-ext').replaceChildren(stateLine(on.extension, detail.extension, checking?.extension));
  $('diag-search').textContent = $('last-search').textContent;
}
// Updates: this version, and whether it's the latest (the app checks at start and every 10 minutes; Check now asks GitHub).
async function renderUpdate() {
  const status = await window.pilot.updateStatus().catch(() => ({}));
  const {latest, text} = updateText(status);
  $('diag-update-text').replaceChildren(icon(latest ? 'check' : 'info'), ` ${text}`);
  $('diag-update-text').className = `service-state${latest ? ' is-on' : ''}`;
  $('diag-update-check').hidden = !!status.fromStore;   // the Store copy: the Store checks, ours never would
}

// Beta: opt-in, off by default. Joining asks in a native dialog (main.js); "Back to stable" shows while this install is ahead of the stable version.
async function renderBeta() {
  const state = await window.pilot.betaState().catch(() => ({fromSource: true}));
  const {text, toggle, back} = betaText(state);
  $('diag-beta-text').textContent = text;
  $('diag-beta-toggle').textContent = toggle;
  $('diag-beta-toggle').hidden = !toggle;
  $('diag-beta-toggle').dataset.on = state.on ? '1' : '';
  $('diag-beta-back').hidden = !back;   // also for a test-build install that is ahead of stable
  const test = testText(state);
  $('diag-test-text').textContent = test.text;
  $('diag-test-toggle').textContent = test.toggle;
  $('diag-test-toggle').hidden = !test.toggle;
  $('diag-test-toggle').dataset.on = state.test ? '1' : '';
}

// Run at start-up, in the order the window has always done it (app.js calls each page's init in turn).
export async function init() {
  $('diag-update-check').addEventListener('click', async () => {
    const button = $('diag-update-check');
    button.disabled = true;
    $('diag-update-text').replaceChildren(el('span', 'spinner'), ' Checking…');
    const result = await window.pilot.updateCheck().catch(error => ({ok: false, text: error.message}));
    button.disabled = false;
    if (result?.ok === false) { $('diag-update-text').textContent = result.text; return; }
    renderUpdate();
  });
  $('diag-beta-toggle').addEventListener('click', async () => {
    const button = $('diag-beta-toggle');
    button.disabled = true;
    const result = await window.pilot.betaSet(!button.dataset.on).catch(error => ({ok: false, text: error.message}));
    button.disabled = false;
    if (result?.ok === false && result.text) $('diag-beta-text').textContent = result.text; else renderBeta();
  });
  $('diag-test-toggle').addEventListener('click', async () => {
    const button = $('diag-test-toggle');
    button.disabled = true;
    const result = await window.pilot.testSet(!button.dataset.on).catch(error => ({ok: false, text: error.message}));
    button.disabled = false;
    if (result?.ok === false && result.text) $('diag-test-text').textContent = result.text; else renderBeta();
  });
  window.pilot.onUpdateChannel?.(() => renderBeta());   // switched from the menu (Update Channel): the Diagnostics switches follow
  $('diag-beta-back').addEventListener('click', async () => {
    const result = await window.pilot.betaRollback().catch(error => ({ok: false, text: error.message}));
    if (result?.ok === false && result.text) $('diag-beta-text').textContent = result.text;
  });
  document.addEventListener('click', event => {
    const go = event.target.closest('[data-settings-go]');
    if (go) { settingsPage(go.dataset.settingsGo); document.querySelector('main')?.scrollTo(0, 0); }
  });
  $('ov-backups').addEventListener('click', () => window.pilot.showBackups());
  $('ov-profile').addEventListener('click', () => settingsPage('profile'));

  // Application profile: CV preview, one Save for contact + links (enabled once something changed), the assistant's explainer.
  document.querySelectorAll('[data-contact]').forEach(input => input.addEventListener('input', () => detailsChanged()));
  $('claude-how').addEventListener('click', () => { $('claude-how-text').hidden = !$('claude-how-text').hidden; });
  // The job-site password is on Credentials too (and on Profile → Application assistant): the same two buttons.
  for (const [where, said] of [['credentials-shared', 'credentials-message']]) {
    $(`${where}-show`).addEventListener('click', async () => {
      const result = await window.pilot.sitePassword('show');
      if (result?.password) $(where).textContent = result.password;
      $(said).textContent = result?.ok ? (result.password ? '' : 'Copied: paste it to read it.') : result?.error || '';
    });
    $(`${where}-copy`).addEventListener('click', async () => {
      const result = await window.pilot.sitePassword('copy');
      $(said).textContent = result?.ok ? 'Copied.' : result?.error || '';
    });
  }
  // Data & backup and Advanced: explainers and the reset options open on demand; Diagnostics shows live status.
  $('reset-review').addEventListener('click', () => { $('reset-options').hidden = !$('reset-options').hidden; });
  $('diag-troubleshoot').addEventListener('click', () => {
    settingsPage('connections');
    const help = document.querySelector('[data-settings-page="connections"] .troubleshoot');
    help.open = true;
    setTimeout(() => help.scrollIntoView({behavior: 'smooth', block: 'start'}), 50);
  });
}

// Settings → Credentials: one row per site Claude made an account on, with the companies it serves (lib/site-accounts.js withCompanies). Passwords hidden until Show; Copy never shows them; Delete asks once.
const when = iso => (iso ? new Date(iso).toLocaleDateString(undefined, {day: 'numeric', month: 'short', year: 'numeric'}) : '');
async function openCredentials() {
  const result = await window.pilot.credentials();
  const rows = result?.rows || [];
  const table = $('credentials-table');
  table.replaceChildren(table.firstElementChild, ...rows.map(row => {
    const line = el('div', 'task-row');
    const who = el('span');
    const details = [row.email || 'email not recorded', when(row.accountAt || row.created), ({confirmed: 'Account ready', pending: 'Waiting for the confirmation'})[row.state] || '', row.job ? (() => { try { return new URL(row.job).hostname.replace(/^www\./, ''); } catch { return ''; } })() : '']
      .filter(Boolean).join(' · ');
    who.append(el('b', '', row.host), ...(row.test ? [el('small', 'cred-companies', 'Test account: only tests sign in with it, never an application')] : []), ...(row.unassigned ? [el('small', 'cred-companies', 'Not assigned to a profile yet: no application uses it until you press Assign')] : []), ...(row.companies?.length ? [el('small', 'cred-companies', `For ${row.companies.join(', ')}`)] : []), el('small', '', details));
    const secret = el('b', '', '••••••••');
    const shown = el('span', '');
    shown.append(secret);
    const actions = el('span', 'inline');
    const reveal = el('button', 'secondary small-button', 'Show');
    reveal.addEventListener('click', async () => {
      if (reveal.textContent === 'Hide') { secret.textContent = '••••••••'; reveal.textContent = 'Show'; return; }
      const answer = await window.pilot.credentialReveal(row.key || row.host, 'show');
      if (!answer?.ok) { $('credentials-message').textContent = answer?.error || ''; return; }
      secret.textContent = answer.password;
      reveal.textContent = 'Hide';
    });
    const copy = el('button', 'secondary small-button', 'Copy');
    copy.addEventListener('click', async () => {
      const answer = await window.pilot.credentialReveal(row.key || row.host, 'copy');
      if (!answer?.ok) { $('credentials-message').textContent = answer?.error || ''; return; }
      await navigator.clipboard.writeText(answer.password);
      $('credentials-message').textContent = `Copied the password for ${row.host}.`;
    });
    // Delete asks once in place (it cannot be undone): the password goes from this Mac's Keychain; the account on the site stays.
    const remove = el('button', 'danger-outline small-button', 'Delete');
    remove.addEventListener('click', () => {
      const sure = el('button', 'danger-outline small-button', 'Delete for good'), keep = el('button', 'secondary small-button', 'Cancel');
      $('credentials-message').textContent = `Delete the saved password for ${row.host}? The account on the site stays; only this Mac forgets its password.`;
      keep.addEventListener('click', () => { actions.replaceChildren(reveal, copy, remove); $('credentials-message').textContent = ''; });
      sure.addEventListener('click', async () => {
        sure.disabled = keep.disabled = true;
        const answer = await window.pilot.credentialDelete(row.key || row.host);
        if (!answer?.ok) { $('credentials-message').textContent = answer?.error || 'It could not be deleted.'; actions.replaceChildren(reveal, copy, remove); return; }
        await openCredentials();
        $('credentials-message').textContent = `Deleted the saved password for ${row.host}.`;
      });
      actions.replaceChildren(keep, sure);
    });
    // An account from before profiles (lib/profile-accounts.js): no application uses it until it is assigned to this profile, or deleted.
    const assign = el('button', 'secondary small-button', 'Assign');
    assign.addEventListener('click', async () => {
      const answer = await window.pilot.credentialAssign(row.key);
      if (!answer?.ok) { $('credentials-message').textContent = answer?.error || ''; return; }
      await openCredentials();
      $('credentials-message').textContent = `${row.host} now belongs to this profile.`;
    });
    actions.append(...(row.unassigned ? [assign] : []), reveal, copy, remove);
    line.append(who, shown, actions);
    return line;
  }));
  show($('credentials-empty'), !rows.length);
  $('credentials-message').textContent = result?.ok === false ? result.error : '';
}
