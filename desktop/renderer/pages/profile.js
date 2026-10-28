// Settings → Application profile.
import {mountContactControls} from '../contact-controls.js';
import {showMode} from '../assistant-mode.js';
import {showClaudeAuto} from '../claude-auto.js';
import {contactHints} from '../audience.js';
import {openInNotion, showNotionPanel} from './notion-connect.js';
import {showStoreParts} from './store-parts.js';
import {addQuestion, loadApplicationAnswers} from './application-answers.js';
import {pick} from '../tab-choice.js';
import {remembered} from '../view-memory.js';
import {initExperience, loadExperience} from './experience.js';
import {loadExperienceProfile} from './experience-profile.js';
import {startOfficeProgress} from './office-progress.js';
import {loadLetterStyle} from './letter-style.js';
import {initLetter, loadLetter} from './base-letter.js';
import {loadPortrait} from './portrait.js';
import {moreButton, openMenu} from '../components.js';
import {cvCheckAction, lastCheck, showCvCheck} from '../cv-check-view.js';
import {documentFacts} from '../cv-check-model.js';
import {icon} from '../icons.js';
import {costText, dollars} from '../ai-cost.js';
import {shared} from './shared.js';
import {byStore, storeName} from '../store-words.js';
import {showCloud, showExtensionStatus, showGoogle, showSchedule, showTelegram} from './connections.js';
import {$, message, osText, runWhen, show} from './core.js';
import {showCvChanged} from './cv-change.js';
import {openSetting, renderOverview} from './settings.js';
import {goStep} from './wizard.js';
import {showEngineSettings} from './ai-engine.js';
import {humanError, isSpendingLimit} from '../run-warnings.js';
import {cvStateText} from '../cv-state.js';
import {loadProposals} from './contact-proposals.js';
import {contactChangedIn, contactDirty, contactRead, factsChangedIn, registerDetails} from './details-drafts.js';
import {guardLeave} from './nav.js';
import {profileBar} from './profile-save-bar.js';
import {mountProfileMenu} from './profile-menu.js';
import {showFacts} from './details-facts.js';
import {initDetailsRead, linksView} from './details-read.js';
import {reading} from '../contact-reading.js';
import {swr} from '../swr.js';
import {foldProfilePanels, initFoldBar, showFoldBar} from '../profile-fold.js';
import {showNotify} from './notify-settings.js';

// ---------- Settings → Application profile: tabs (CV, Your details, Experience, What we learned, Cover letter) ----------
// Your details is drawn once with the settings (showContact): switching to it never redraws the form, so unsaved edits stay.
// Strategy → Job preferences, through the sidebar's own Strategy button (nav.js imports this file).
const openJobPreferences = () => { document.querySelector('.nav[data-view=strategy]')?.click(); setTimeout(() => $('strategy-job-prefs')?.scrollIntoView({block: 'start'}), 300); };
export function profileTab(name, {byDefault = false} = {}) {
  if (!byDefault) pick();   // a person's pick (or a deep link) wins over a default that arrives late (tab-choice.js)
  if (name === 'knowledge') name = 'answers';   // Form knowledge is a section of Application answers since 16 Oct 2026 (owner)
  // The Preferences tab is gone (owner, 17 Oct 2026: "General Preferences links can open Strategy"): its old name opens Strategy → Job preferences.
  if (name === 'profiletext') { openJobPreferences(); return; }
  if (![...document.querySelectorAll('[data-profile-tab]')].some(tab => tab.dataset.profileTab === name)) name = 'cv';
  remembered('profileTab', name);
  document.querySelectorAll('[data-profile-tab]').forEach(tab => tab.classList.toggle('is-active', tab.dataset.profileTab === name));
  document.querySelectorAll('[data-profile-panel]').forEach(panel => {
    show(panel, panel.dataset.profilePanel === name && panel.dataset.wanted !== '0');   // a conditional part keeps its wish (pages/tab-part.js)
  });
  showStoreParts();
  showFoldBar();
  if (name === 'answers') loadApplicationAnswers();
  else if (name === 'experience') loadExperience();
  else if (name === 'letter') { loadLetterStyle(); loadLetter(); }
  else if (name === 'portrait') loadPortrait();
  else if (name === 'cv') { loadCvSetting(); showCvChanged(); }
}
// What we learned's ⋯ (one "View source" link per page, in a menu: owner, 18 Oct 2026, fix 10); the button shows only where the store has pages.
function answersMenu() {
  openMenu($('answers-review'), [{label: `View source in ${storeName()}`, icon: 'external', run: () => openInNotion('NOTION_ANSWERS_PAGE_ID')}]);
}
// Professional links: shown as tiles; Edit shows the fields (saved by the Profile page's one save bar).
// The links card's read view (pages/details-read.js linksView; GitHub only while its box shows).
const showLinks = () => $('links-view')?.replaceChildren(linksView());
// Sidebar: the Notion pages, most used first. Click opens them in the app's Notion window; ⌘-click in the browser.
const NOTION_LINKS = [['NOTION_MATCHES_DB', 'Job matches', 'target'], ['NOTION_APPLICATIONS_DB', 'Applications', 'layers'],
  ['NOTION_EVENTS_DB', 'Replies & events', 'mail'], ['NOTION_INTERVIEWS_DB', 'Interviews', 'mic'], ['NOTION_INSIGHTS_DB', 'Insights', 'chart'],
  ['NOTION_PIPELINE_PAGE', 'Pipeline', 'columns'], ['NOTION_PROFILE_PAGE_ID', 'Profile', 'user'], ['NOTION_ANSWERS_PAGE_ID', 'Standard answers', 'file'],
  ['NOTION_SEARCH_SETTINGS_PAGE', 'Search settings', 'settings'], ['NOTION_KNOWLEDGE_PAGE', 'Form knowledge', 'bookmark'],
  ['NOTION_EMPLOYERS_DB', 'Employers', 'building'], ['NOTION_CRON_RUNS_DB', 'Search runs', 'search'], ['NOTION_AGENT_RUNS_DB', 'Form fills', 'bot']];
function renderNotionLinks() {
  const box = $('notion-links');
  box.querySelectorAll('.notion-link').forEach(link => link.remove());
  const links = NOTION_LINKS.filter(([env]) => shared.state.notion?.[env]);
  show(box, links.length > 0);
  for (const [env, label, glyph] of links) {
    const link = Object.assign(document.createElement('button'), {className: 'notion-link', textContent: label,
      title: osText(`${shared.state.notionTitles?.[env] || label}: opens in Notion (⌘-click: in a Jobadabra window)`)});
    link.prepend(icon(glyph));
    link.addEventListener('click', event => window.pilot.openNotion(shared.state.notion[env], event.metaKey || event.ctrlKey));
    box.append(link);
  }
}

// ---------- Profile → CV: the document row and the CV check (renderer/cv-check-view.js) ----------
const checkOptions = () => ({cvName: shared.state?.settings?.cvName || '', when: runWhen, say: (text, tone) => message('cvc-message', text, tone)});
export async function loadCvCheck() { showCvCheck(await window.pilot.cvCheckStatus().catch(() => null), checkOptions()); }
let cvReadBlocked = false;
let readCvPdf = () => {};   // set by initProfile (it needs the page's error words)   // out of AI credit: another read would fail the same way until credit is added
export async function loadCvSetting() {
  await loadCvCheck();
  const status = await window.pilot.cvStatus();
  // One glance: ready (and which design), or not read yet. ✂️ Tailor CV on a job uses it.
  $('cv-state').textContent = cvStateText(status, shared.cvReadFailed);
  $('cv-facts').textContent = ['Current CV', documentFacts({pages: lastCheck()?.ats?.pages, ...(status.file || {})}, runWhen)].filter(Boolean).join(' · ');
  $('cv-view').hidden = !status.base;
  // ⋯ the rarer CV actions: read the PDF again (or for the first time), and the folder with the CV's files.
  $('cv-more').replaceChildren(moreButton(() => [
    {label: status.base ? 'Read my CV PDF again' : 'Read my CV PDF', icon: 'refresh', disabled: cvReadBlocked, run: readCvPdf},
    {label: 'Show CV folder', icon: 'folder', run: () => window.pilot.showCvFolder()}], 'More CV actions'));
}

export async function loadSettings() {
  shared.state = await window.pilot.state();
  showNotionPanel();
  const hints = await window.pilot.secretHints();
  for (const [id, name, empty] of [['set-anthropic', 'ANTHROPIC_API_KEY', 'sk-ant-…'], ['set-openai', 'OPENAI_API_KEY', 'sk-…'], ['set-notion', 'NOTION_TOKEN', 'ntn_…'],
    ['set-telegram', 'TELEGRAM_BOT_TOKEN', '123456789:AA…'], ['set-serpapi', 'SERPAPI_API_KEY', 'SerpApi key'], ['set-brave', 'BRAVE_SEARCH_API_KEY', 'Brave Search key'], ['set-adzuna-id', 'ADZUNA_APP_ID', 'Adzuna app id'],
    ['set-adzuna-key', 'ADZUNA_APP_KEY', 'Adzuna app key'], ['set-jooble', 'JOOBLE_API_KEY', 'Jooble key']]) {
    if ($(id)) $(id).placeholder = hints[name] ? `${hints[name]} · saved (paste a new one to replace it)` : empty;
  }
  renderNotionLinks();
  showEngineSettings();
  showCloud();
  showSchedule();
  showNotify();
  showContact();
  showClaudeAuto();
  showMode(shared.state.settings);
  document.querySelectorAll('[data-secret]').forEach(line => {
    const set = shared.state.secrets[line.dataset.secret];
    line.textContent = set ? '✓ Connected' : 'Not set';
    line.classList.toggle('on', set);
  });
  showGoogle();
  showTelegram();
  const ext = await window.pilot.extensionInfo();
  showExtensionStatus();
  $('ext-url').textContent = ext.url;
  $('ext-token').textContent = ext.token;
  $('data-folder').textContent = shared.state.folder;
  $('auto-search').checked = shared.state.settings.autoSearch !== false;
  $('open-login').checked = !!shared.state.settings.openAtLogin;
  $('last-search').textContent = shared.state.settings.lastSearchAt
    ? `${runWhen(shared.state.settings.lastSearchAt)}${shared.state.settings.lastSearchOk === false ? ' (with problems)' : ''}`
    : 'No search yet';
  if (shared.state.settings.telegramBot && shared.state.secrets.TELEGRAM_BOT_TOKEN) {
    const line = document.querySelector('[data-secret="TELEGRAM_BOT_TOKEN"]');
    line.textContent = `✓ Connected to @${shared.state.settings.telegramBot}`;
  }
  renderOverview().catch(() => {});
}
// ---------- your details for application forms (the extension asks the app for them) ----------
// The example city is the candidate's own, the date example names its month, and the Swiss "place of origin" shows only for a candidate with Swiss places (renderer/audience.js).
function fitDetailsToCandidate(contact) {
  window.pilot.audience?.().then(answer => {
    const hints = contactHints(answer || {}, contact);
    document.querySelector('[data-contact="location"]').placeholder = hints.locationExample;
    document.querySelector('[data-contact="birth_date"]').placeholder = hints.dateExample;
    const origin = document.querySelector('[data-swiss-only]');
    if (origin) origin.hidden = !hints.showOrigin;
    document.querySelector('[data-contact="github"]').closest('label').hidden = !hints.showGithub;
    showLinks();
  }).catch(() => {});
}
export function showContact() {
  mountContactControls();   // the salutation, date of birth and links as their typed controls (contact-kinds.js)
  // The kept contact fills the boxes at once; with none kept the shared skeleton stands in until it is read (contact-reading.js); never empty boxes that look like lost data.
  let painted = false;
  swr('contact', async () => ({ok: true, contact: (await window.pilot.contact()) || {}}), {
    loading: () => reading(true),
    paint: ({contact}, kept) => {
      if (!kept && painted && contactDirty()) return;   // a refresh never redraws under unsaved edits (details-drafts.js)
      reading(false);
      document.querySelectorAll('[data-contact]').forEach(input => { input.value = contact[input.dataset.contact] || ''; });
      fitDetailsToCandidate(contact);
      showLinks();
      contactRead();   // the drafts count from what is shown now
      if (kept || painted) return;
      painted = true;
      loadProposals();   // the empty boxes, filled in from the CV for you to check (contact-proposals.js)
      showFacts();   // Work eligibility, Availability & compensation, Languages (details-facts.js)
      loadExperienceProfile('details');   // the voluntary survey answers (pages/experience-profile.js)
    },
    fail: result => { reading(false); message('contact-panel-message', `${byStore('Couldn\'t read them from Notion', 'Couldn\'t read them from your Profile')}: ${result.error}`, 'error'); },   // the panel's line: the save bar's is hidden
  });
  $('contact-cv').textContent = shared.state.settings.cvName || 'None yet';
}

// Run at start-up, in the order the window has always done it (app.js calls each page's init in turn).
export async function init() {
  initLetter({openAiSettings: () => openSetting('ai')});
  document.querySelectorAll('[data-profile-tab]').forEach(tab => tab.addEventListener('click', () => profileTab(tab.dataset.profileTab)));
  initExperience();
  startOfficeProgress();   // the LibreOffice download for a Word CV, under the CV card (office-progress.js)
  mountProfileMenu($('profile-more'), profileTab);   // Fill from my CV and View source in Notion, quiet in the header (profile-menu.js)
  $('answers-review').addEventListener('click', answersMenu);
  initDetailsRead({contact: contactChangedIn, facts: factsChangedIn});   // Your details read first: summaries, a quiet Edit per card, Done (pages/details-read.js)
  document.addEventListener('details-changed', showLinks);   // the links' tiles follow their fields
  $('answers-add').addEventListener('click', addQuestion);
  renderNotionLinks();
  $('strategy-redo').addEventListener('click', () => { shared.rebuildAsked = true; show($('app'), false); show($('wizard')); goStep('cv'); });
  // An error from the AI service is said in words, never shown as the API's JSON (#94: "400 {"type":"error",…}" sat in the CV card).
  const cvError = (raw, verb) => { const said = humanError(raw); return said === String(raw || '').trim() ? said : `Couldn't ${verb} your CV: ${said}.`; };
  $('cv-view').addEventListener('click', async () => {
    const result = await window.pilot.viewBaseCv();
    $('cv-message').textContent = !result.ok ? cvError(result.error, 'show') : result.overflow?.length ? `Page ${result.overflow.join(', ')} is too full: its end is cut off.` : '';
  });
  readCvPdf = async () => {
    if ((await window.pilot.cvStatus()).base && !confirm('Replace your CV data (and any hand edits) with a fresh read of your CV PDF?')) return;
    $('cv-message').textContent = 'Reading your CV… (about 30 s)';
    const result = await window.pilot.importCv();
    cvReadBlocked = !result.ok && isSpendingLimit(humanError(result.error));
    show($('cv-limit-link'), cvReadBlocked);
    shared.cvReadFailed = !result.ok;
    $('cv-message').textContent = result.ok ? `Done${costText(result.usd, usd => ` (${dollars(usd)})`)}.` : cvError(result.error, 'read');
    loadCvSetting();
  };
  $('cv-limit-link').addEventListener('click', event => {
    event.preventDefault();
    window.pilot.openExternal('https://console.anthropic.com/settings/limits');
    cvReadBlocked = false;
    show($('cv-limit-link'), false);
  });
  // Long detail cards start closed; the bar shows their summary (owner, 17 Oct 2026). Forms you fill in stay open.
  foldProfilePanels({closed: new Set(['setting-experience-sources', 'setting-details-profile'])});   // every Profile card folds (profile-fold.js); these start closed (the voluntary surveys: optional, owner's review item 5); Work history starts open (owner, 18 Oct 2026, mockup 09)
  initFoldBar();
  $('cvc-run').addEventListener('click', () => cvCheckAction($('cvc-run'), 'Reading your CV…', () => window.pilot.cvCheckRun(), checkOptions).then(loadCvSetting));
  $('cvc-ai-run').addEventListener('click', () => cvCheckAction($('cvc-ai-run'), 'Reviewing… (about 30 s)', () => window.pilot.cvCheckAi(), checkOptions));
  $('set-telegram-save').addEventListener('click', async () => {
    const value = $('set-telegram').value.trim();
    if (!/^\d+:[\w-]{30,}$/.test(value)) { message('telegram-message', 'That doesn\'t look like a bot token (numbers, a colon, then letters).', 'error'); return; }
    $('set-telegram-save').disabled = true;
    message('telegram-message', 'Checking the token…');
    const result = await window.pilot.telegramConnect(value);
    $('set-telegram-save').disabled = false;
    if (!result.ok) { message('telegram-message', result.error, 'error'); return; }
    $('set-telegram').value = '';
    message('telegram-message', `Connected to @${result.username} ✓ Matches arrive there after each search.`, 'ok');
    loadSettings();
  });
  registerDetails({repaintContact: showContact});   // Contact and the fact sections save through the Profile page's one bar (details-drafts.js)
  guardLeave('settings', proceed => !document.querySelector('.view[data-view="settings"]')?.classList.contains('is-profile') || profileBar().leave(proceed));   // leaving Profile with drafts asks
  showStoreParts();   // every [data-notion-only] in the window (index.html's Notion-only words too), from the start, not only once a Profile tab opens
}
