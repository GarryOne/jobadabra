// Navigation: pages, ⌘R memory, the ⌘K palette.
import {openPalette} from '../palette.js';
import {PROMISE} from '../pro-promise.js';
import {SHOW_I_HAVE_PRO, creditWords} from '../plan-view.js';
import {openQuestionReview} from './question-review.js';
import {buttonEntry, reveal} from './palette-busy.js';
import {paletteEntry as browserOfferEntry} from './browser-offer-rows.js';
import {COMMAND_KIND, KIND, TASK_BUTTONS, kindOf, lastActivity, openActivity, prepareActions, unqueue} from './activity.js';
import {$, show} from './core.js';
import {shared} from './shared.js';
import {showRunsTab} from './runs-tab.js';
import {showCvChanged} from './cv-change.js';
import {loadFocus} from './focus.js';
import {showFocusStarted} from './focus-onboarding.js';
import {loadCalendar} from './calendar.js';
import {loadInterviews} from './interviews.js';
import {loadEmployers} from './employers.js';
import {closeJobPanel, openJobPanel} from './job-panel.js';
import {usage} from '../usage-signals.js';
import {REPORT_TABS, loadReports} from './reports.js';
import {applyViewGate, openInNotion} from './notion-connect.js';
import {fillFromCv} from './profile-menu.js';
import {loadSettings, profileTab} from './profile.js';
import {openSession, renderSessionPage} from './session-log.js';
import {bestSession, renderDock, sessionList} from './sessions.js';
import {openSetting, settingsPage, showServicesNow} from './settings.js';
import {exportState} from './jobs-export.js';
import {ENGINE_CHOICES} from '../ai-engine-view.js';
import {openWaitlist} from './plan-waitlist.js';
import {openPromoDialog} from './plan-promo.js';
import {reloadPlan} from './plan.js';
import {showsProWaitlist} from '../plan-line.js';
import {GATED_FEATURES, proGate} from '../pro-gate.js';
import {openProGate} from './pro-upgrade-dialog.js';
import {loadStrategy} from './strategy.js';
import {openCard} from './strategy-cards.js';
import {reviewPreferences} from './job-preferences.js';
import * as viewHistory from '../view-history.js';
import {buildCommands} from './build.js';
import {initMenu, refreshMenu} from './menu.js';
import {FILTER_OPTIONS} from '../jobs-filters.js';
import {setFilters} from './jobs-filter-menu.js';

// ---------- app ----------
// The page (and Settings section) open now, kept for a reload (⌘R): the app comes back where it was.
// sessionStorage: survives a reload of this window, not a restart of the app (that opens Focus as before).
export const remembered = (key, value) => {
  try { if (value === undefined) return sessionStorage.getItem(key); sessionStorage.setItem(key, value); } catch {}
  return null;
};
// Back / forward (⌘← ⌘→, ⌘[ ⌘], the mouse's side buttons): every screen opened through here, in order, and the
// Recent activity panel opened over one (pages/activity.js tells us through panelOpened / panelClosed).
let history = viewHistory.start(null);
export const panelOpened = run => { history = viewHistory.openPanel(history, run); };
export const panelClosed = run => { history = viewHistory.closePanel(history, run); };
// A page with unsaved work can hold a move away (Strategy's draft): guard(proceed) returns true to let it go, or false and calls proceed() later.
const leaveGuards = {};
let currentView = '';
export const guardLeave = (view, guard) => { leaveGuards[view] = guard; };
export function openView(name, {fromHistory = false} = {}) {
  const leaving = currentView;
  if (leaving && leaving !== name && leaveGuards[leaving] && !leaveGuards[leaving](() => { currentView = ''; openView(name, {fromHistory}); })) return;
  if (leaving !== name) closeJobPanel();   // the job's drawer covers the page it was opened from: going to another page closes it (a callback that opens a job does openView first)
  currentView = name;
  if (!fromHistory) history = viewHistory.visit(history, name);
  remembered('view', name);
  usage.viewChanged(name);   // seconds on the screen just left (active vs idle) go out; renderer/usage-signals.js
  window.pilot.pageView?.(name).catch?.(() => {});   // the page's name only (a fixed list on the other side), for the usage funnel
  setTimeout(() => { if (typeof renderDock === 'function' && sessionList) renderDock(); }, 0);  // the tray hides on the sessions page
  if (name === 'actions') prepareActions();   // its banner and result card are in the first frame, not a moment later above the tasks (#286)
  document.querySelectorAll('.view').forEach(view => show(view, view.dataset.view === name));
  document.querySelectorAll('.nav').forEach(nav => nav.classList.toggle('active', nav.dataset.view === name));
  refreshMenu(name);   // a page opened any way (⌘K too) is in the menu from then on
  // Notion later: a page that needs Notion shows only its gate card until it is connected (pages/notion-connect.js); connecting reopens it.
  // Focus without Notion shows its Get started list instead (pages/focus.js showFocusStarted): a fresh setup can search first.
  const started = name === 'focus' && showFocusStarted();
  const locked = !started && applyViewGate(name, {then: () => openView(name, {fromHistory: true})});
  if (name === 'sessions' && !locked) renderSessionPage();  // the view's HTML starts on the spinner; opening it must paint the list we already have
  if (name === 'strategy') { loadStrategy(); showCvChanged(); }
  if (name === 'settings') {
    // Arriving from another page starts on Overview; a move within Settings (sidebar Profile while on Profile, ⌘K "Open Profile: …") never passes
    // through it, or Profile's unsaved-changes question popped up on the way back to Profile itself (test/profile-page.test.js).
    if (leaving !== 'settings') settingsPage('overview');
    showServicesNow();
    loadSettings();
    window.pilot.dailyTarget().then(setting => { $('set-target').value = $('set-target').dataset.saved = setting.target; $('set-remind').checked = setting.reminders; });
  }
  if (name === 'interviews' && !locked) loadInterviews();
  if (name === 'calendar' && !locked) loadCalendar();
  if (name === 'reports' && !locked) loadReports();
  if (name === 'employers' && !locked) loadEmployers();
  if (name === 'focus' && !locked && !started) loadFocus();
}

// ⌘K / Ctrl+K: the command palette. Its commands are the app's own buttons, read when it opens (so a disabled
// button or a missing Notion link isn't offered); running one opens its page, then clicks it.
const PALETTE_KEYWORDS = {mail: 'email inbox replies confirmations calendar google', run: 'search check jobs find refresh scan crawl',
  tailor: 'tailor cv cover letter resume top matches', visits: 'linkedin indeed glassdoor sites read portals visit extension', board: 'board linkedin sign in login behind read list search',
  scout: 'employers companies discover', status: 'health check', weekly: 'report stats weekly insight review', insight: 'tip advice', kits: 'kits prepare applications cover letter', tune: 'strategy settings roles places tune', ready: 'ready to send overnight night fill forms submit morning',
  today: 'telegram list', applied: 'applications', saved: 'bookmarks starred'};
// A button's own words: the count badge and the dot inside a nav button are not part of its label.
export const labelOf = node => {
  if (!node) return '';
  const copy = node.cloneNode(true);
  copy.querySelectorAll('.nav-badge, .nav-dot').forEach(child => child.remove());
  return copy.textContent.replace(/\s+/g, ' ').trim();
};
export function paletteCommands() {
  const commands = [];
  const add = (group, label, hint, keywords, run, more = {}) => { if (label) commands.push({group, label, hint, keywords, run, ...more}); };
  // A button's ⌘K entry brings you to it and does not press it (owner, 18 Oct 2026: "I don't want necessarily to trigger the action, I just want you to focus
  // on it"): `open` shows its page, then the card scrolls into view, takes focus and pulses (palette-busy.js). A button off only because its task runs is listed too.
  // Every button entry goes through addNode.
  const addNode = (node, group, label, hint, keywords, open) => {
    const entry = buttonEntry(node, {group, label, hint, keywords, run: () => { open(); reveal(node); }});
    if (entry) add(entry.group, entry.label, entry.hint, entry.keywords, entry.run, {enter: entry.enter, running: entry.running});
    if (entry?.label) commands[commands.length - 1].node = node;   // the probe in palette-every-action.test.js finds a button's entry by its node
  };
  // A button that starts a task an Actions card already offers is that card's twin: one entry per task (6 Oct 2026: "Refresh jobs" and
  // "Check for new jobs" were listed side by side and ran the same jobs check).
  const carded = new Set([...document.querySelectorAll('.action[data-command]')].map(node => COMMAND_KIND[node.dataset.command]).filter(Boolean));
  const twins = new Set(TASK_BUTTONS.filter(([kind]) => carded.has(kind)).flatMap(([, ...selectors]) => selectors.map(s => document.querySelector(s))).filter(Boolean));
  const button = (view, id, keywords, hint = '') => {
    const node = $(id);
    if (node && !twins.has(node) && !node.closest('[hidden]:not(.view)')) addNode(node, view[0].toUpperCase() + view.slice(1), labelOf(node), hint || node.title, keywords, () => openView(view));
  };
  document.querySelectorAll('.nav').forEach(nav => add('Go to', `Open ${labelOf(nav)}`, '', 'page view', () => nav.click()));
  // The bottom bar's panel is not a page, so the loop above misses it (owner, 7 Oct 2026: "recent" found nothing).
  add('Go to', 'Open Runs', 'Every task run in Actions → Runs: filter by task, status and date', 'runs recent activity history tasks log results queued failed',
    () => showRunsTab());
  add('Go to', 'Open the current run', 'The running task, else the next queued one, else the latest: its result, its log, and Stop', 'current run running now activity details progress log',
    () => { shared.selectedRun = null; openActivity(true); });
  // A card whose Run is off because its task runs or waits (runs-page.js syncRunButtons) is still listed: its entry brings you to the card.
  document.querySelectorAll('.action[data-command]').forEach(node => addNode(node, 'Actions', labelOf(node.querySelector('b')).replace(/^\W+/, ''),
    labelOf(node.querySelector('span')), PALETTE_KEYWORDS[node.dataset.command], () => openView('actions')));
  // An action card with its own handler (not a Telegram command): "Tailor CVs" costs minutes of AI, so its entry only brings you to the card.
  document.querySelectorAll('.action[data-palette]').forEach(node => addNode(node, 'Actions', labelOf(node.querySelector('b')).replace(/^\W+/, ''),
    labelOf(node.closest('.task-body')?.querySelector('.task-words .muted')), PALETTE_KEYWORDS[node.dataset.palette], () => openView('actions')));
  // The finished Find jobs run's "Find jobs using your browser" (browser-offer.js): brings you to the button on its card.
  const offer = browserOfferEntry({runs: lastActivity?.runs, settings: shared.state?.settings});
  if (offer) add('Actions', offer.label, offer.hint, PALETTE_KEYWORDS.visits, () => { shared.selectedRun = offer.runId; openActivity(true); setTimeout(() => { const go = $('browser-offer-go'); if (go) reveal(go); }, 300); });
  // A task waiting its turn can be taken out of the queue from here too (activity.js unqueue).
  (lastActivity?.queued || []).forEach(run => add('Actions', `Remove ${KIND[kindOf(run)].name} from the queue`, 'It has not started: it will not run',
    'unqueue cancel queued waiting remove', () => unqueue(run)));
  // Every tracked job's page (pages/job-panel.js): its kit, prep, reviews, record, messages and history, found by its title or company.
  (shared.allJobs || []).filter(job => job.stage && job.url).forEach(job => add('Jobs', `Open job page: ${job.title} · ${job.company}`, job.stage,
    'job page kit cover letter form answers prep review record messages description history', () => { openView('jobs'); openJobPanel(job); }));
  // The job's Documents tab (tailored CV + cover letter): a job with a kit or a tailored CV, opened straight on that tab.
  (shared.allJobs || []).filter(job => job.url && (job.kit || job.tailored)).forEach(job => add('Jobs', `Open documents: ${job.title} · ${job.company}`, 'Tailored CV and cover letter',
    'documents tailored cv cover letter files pdf', () => { openView('jobs'); openJobPanel(job, 'documents'); }));
  // Jobs → List | Board and every filter of the Show menu (jobs-filters.js), so a new filter is listed by itself.
  document.querySelectorAll('[data-mode]').forEach(node => add('Jobs', `Show jobs as a ${labelOf(node).toLowerCase()}`, node.dataset.mode === 'board'
    ? 'Your applications in columns by stage; drag a card to change its stage' : 'One row per job', 'pipeline kanban board columns stages list', () => { openView('jobs'); node.click(); }));
  // Export job list (Pro, pages/jobs-export.js): the Jobs button opens its menu; a free user is taken to the Plan card once Pro is on at the site.
  const exporting = exportState(shared.licenseState || {});
  add('Jobs', 'Export job list', exporting === 'open' ? 'Save your jobs as a spreadsheet (CSV) or JSON file' : 'Part of Pro: save your jobs as a spreadsheet', 'export download save csv json excel spreadsheet jobs list pro',
    () => { if (exporting === 'locked') return openProGate(); openView('jobs'); setTimeout(() => $('jobs-export').click(), 150); }, exporting === 'locked' ? {badge: ['Pro']} : {});
  FILTER_OPTIONS.forEach(option => add('Jobs', `Jobs filter: ${option.label}`, option.title,
    'show menu filter saved views applications active applying in progress kit ready rejected this week', () => { openView('jobs'); setFilters([option.id]); document.dispatchEvent(new CustomEvent('jobs-rerender')); }));
  // Each Reports tab (pages/reports.js), by what it holds.
  for (const [tab, label, words] of REPORT_TABS) add('Reports', `Open Reports: ${label}`, '', words, () => { openView('reports'); loadReports(tab); });
  // The AI engine's choices (pages/ai-engine.js): open Settings → Connections → AI and press the card, as by hand.
  const press = (choice, wait) => setTimeout(() => document.querySelector(`#ai-engine-settings [data-choice="${choice}"]`)?.click(), wait);
  for (const [choice, label, hint, words, family] of ENGINE_CHOICES) add('Settings', label, hint, `ai engine ${words}`, () => {
    openSetting('ai'); if (family) press(family, 300); press(choice, family ? 700 : 300);
  });
  // The Pro plan (pages/plan.js), only when the site's plan is on: the Plan card in Settings → Plan.
  if (['test', 'live'].includes(shared.plan?.mode)) {
    const goPlan = () => { openSetting('plan'); };
    if (shared.plan.plan === 'pro') {
      if (shared.plan.package === 'pro') add('Settings', 'Upgrade to Pro + AI', 'Pay only the difference to add the AI credit', 'pro ai upgrade credit plan buy pay difference', goPlan);
      add('Settings', 'Plan and AI credit', 'Your AI credit left and your plan', 'pro plan credit ai balance license', goPlan); add('Settings', 'Add AI credit', `A one-time top-up: ${(shared.plan.offers || []).filter(o => o.id.startsWith('topup')).map(o => `€${o.price}`).join(', ') || '€5, €10 or €20'}, each adds that much credit`, 'pro top up topup credit buy ai more', goPlan);
    } else {
      add('Settings', 'Get Pro', PROMISE, 'pro upgrade plan price buy pay unlimited license', goPlan);
      add('Settings', 'Get Pro + AI', `${PROMISE}, ${creditWords((shared.plan.offers || []).find(o => o.id === 'pro-ai')) || 'AI credit'} included`, 'pro ai upgrade plan price buy pay credit unlimited license', goPlan);
      if (SHOW_I_HAVE_PRO) add('Settings', 'I have Pro', 'Add this computer with a code sent by e-mail', 'pro sign in signin code add device computer have', () => { goPlan(); setTimeout(() => $('plan-have-pro')?.click(), 300); });
    }
  }
  // A promo code gives Pro with paying on or off (renderer/pro-gate.js): shown to everyone who is not Pro yet.
  if (GATED_FEATURES.promo(proGate(shared.licenseState || {})).shown) add('Settings', 'Redeem a promo code', 'Get Pro with a code you were given', 'promo code redeem pro voucher coupon gift free', () => openPromoDialog(reloadPlan));
  // Pro is not open yet: the Pro card on the Plan page, and its waitlist (pages/plan-waitlist.js).
  if (showsProWaitlist(shared.licenseState || {}) && !shared.state?.settings?.proWaitlist?.email) add('Settings', 'Join the Pro waitlist', 'Get one e-mail when Pro opens', 'pro waitlist early access upgrade plan price join email', () => { openSetting('license'); setTimeout(openWaitlist, 150); });
  button('sessions', 'ss-stop', 'stop freeze halt panic extension chrome everything cancel emergency', 'Stops everything the extension does, on every tab');
  button('jobs', 'refresh', 'find jobs scan');
  button('employers', 'emp-paste', 'add employers companies paste page text address list newsletter portfolio talent agent matches startups');
  // Application questions, one at a time (pages/question-review.js): the same drawer as Jobs' card and Profile → Application answers.
  add('Jobs', 'Review application questions', 'Answer the questions forms asked, one at a time', 'questions answers review answer once missing facts details notice period salary permit suggested forms application',
    () => openQuestionReview());
  button('strategy', 'open-profile', 'edit roles locations places cities country skills targeting preferences');
  // Strategy → Job preferences (pages/job-preferences.js; was Profile → Preferences, 17 Oct 2026): the card, and its Review button.
  add('Strategy', 'Job preferences', 'Must-haves, deal-breakers and the preferences that rank jobs', 'deal-breakers must-haves preferences ranking on-call industries workload',
    () => { openView('strategy'); setTimeout(() => $('strategy-job-prefs')?.scrollIntoView({block: 'start'}), 300); });
  // Strategy → Locations (pages/locations-card.js): preferred, acceptable, relocation, remote work; the reset only while a search-only list is active.
  const locationsCard = () => { openView('strategy'); setTimeout(() => document.querySelector('#strategy-locations [data-list="places"]')?.scrollIntoView({block: 'start'}), 300); };
  // Strategy → Main goals (pages/main-goals.js) opens its editor; Advanced search settings unfolds (owner, 18 Oct 2026, mockup 03).
  add('Strategy', 'Main goals', 'Target roles (also your job board searches), level, work mode and minimum salary', 'goals target roles job titles job board searches search terms level seniority work mode remote hybrid minimum salary compensation',
    () => { openView('strategy'); setTimeout(() => { openCard('goals'); $('strategy-main-goals')?.scrollIntoView({block: 'start'}); }, 300); });
  add('Strategy', 'Advanced search settings', 'Skills, exclusions, companies and titles to skip, the digest minimum', 'advanced skills stack exclusions languages skip companies titles google digest minimum score',
    () => { openView('strategy'); setTimeout(() => { const box = $('strategy-advanced'); if (box) { box.open = true; box.scrollIntoView({block: 'start'}); } }, 300); });
  add('Strategy', 'Locations', 'Preferred and acceptable places, relocation, remote work', 'locations places cities countries relocation remote preferred acceptable search coverage', locationsCard);
  if (shared.coverageActive) add('Strategy', 'Reset search coverage', 'Searches use your preferences again', 'reset search coverage override custom locations places', locationsCard);
  if (shared.locationsOpen) add('Strategy', 'Which locations are right?', 'Your search settings and Profile named different places', 'locations places conflict which right preferred acceptable relocation cities countries',
    () => { openView('strategy'); setTimeout(() => $('strategy-locations-which')?.scrollIntoView({block: 'start'}), 300); });
  // Review your preferences lives in Job preferences' editor: opened first, then the AI reads the fields (pages/job-preferences.js).
  add('Strategy', 'Review your preferences', 'The AI reads your job preferences and proposes clean values', 'job preferences review clean values ai',
    () => { openView('strategy'); setTimeout(() => { openCard('prefs'); reviewPreferences(); $('strategy-job-prefs')?.scrollIntoView({block: 'start'}); }, 300); });
  button('jobs', 'apply-open', 'apply fill forms');
  button('jobs', 'add-open', 'add new job application message update recruiter');
  // The three flows behind "+ Add" keep their own entries (their openers are out of sight, so the sweep above skips them): each opens its flow directly.
  [['import-open', 'Add job', 'A job you want to consider', 'add job link paste posting'],
   ['applied-open', 'Add application', 'A job you\'ve already applied to', 'track add application applied elsewhere outside'],
   ['lead-open', 'Add message or update', 'A recruiter message or another job update', 'log activity recruiter message email screenshot update']]
    .forEach(([id, label, hint, keywords]) => add('Jobs', label, hint, keywords, () => { openView('jobs'); $(id).click(); }));
  button('interviews', 'iv-add', 'upload audio video transcript file');
  button('interviews', 'iv-record', 'start call audio', 'Record a call (everyone agreed)');
  button('interviews', 'iv-recordings', 'files folder finder');
  // Settings: every page, every section (by its heading) and every button in a section, read from the page itself so a new one is listed without being
  // added here (6 Oct 2026: Export and Import data were not in ⌘K). A section opens its page and scrolls to it; a button does that and brings you to the button
  // (focus and a pulse) without pressing it.
  const pages = new Set();   // one entry a page: Overview's shortcuts ("Manage automation") lead to a page already listed
  document.querySelectorAll('[data-settings-go]').forEach(go => {
    if (pages.has(go.dataset.settingsGo)) return;
    pages.add(go.dataset.settingsGo);
    add('Settings', `Open Settings: ${labelOf(go)}`, '', 'settings preferences', () => { openView('settings'); go.click(); });
  });
  // Connections are drawn as service cards (settings.js renderConnections): each one's Manage or Connect.
  document.querySelectorAll('#conn-on .service-card, #conn-off .service-card').forEach(card => {
    const name = labelOf(card.querySelector('.service-text b')), node = card.querySelector('button');
    if (name && node) addNode(node, 'Settings', `${name}: ${labelOf(node)}`, labelOf(card.querySelector('.service-text .muted')), 'settings connections connect', () => { openView('settings'); settingsPage('connections'); });
  });
  const hiddenAt = node => node.closest('[hidden]:not(.view):not([data-settings-page])');
  const shown = node => !hiddenAt(node);
  // A Profile section is hidden only because its tab is closed: still listed, and its entry opens that tab first (17 Oct 2026: CV and Your details split).
  const openTab = () => document.querySelector('[data-profile-tab].is-active')?.dataset.profileTab;
  const onClosedTab = section => !!section.dataset.profilePanel && section.dataset.profilePanel !== openTab() && hiddenAt(section) === section
    && !hiddenAt(section.parentElement);
  // A connection's card (Settings → Connections → Manage: Chrome extension, Telegram, ...) is hidden until chosen: listed too, its entry opens it (settings.js openSetting).
  // A parked feature's card (data-parked, src/features.py PARKED) is never listed: it stays hidden until the feature is back.
  const onClosedPanel = section => section.classList.contains('conn-panel') && !section.dataset.parked && hiddenAt(section) === section && !hiddenAt(section.parentElement);
  const reachable = (node, section) => shown(node) || ((onClosedTab(section) || onClosedPanel(section)) && hiddenAt(node) === section);
  document.querySelectorAll('[data-profile-tab]').forEach(tab => add('Settings', `Open Profile: ${labelOf(tab)}`, '', 'settings profile tab',
    () => { openView('settings'); settingsPage('profile'); profileTab(tab.dataset.profileTab); }));
  // The Profile ⋯ menu's two actions (pages/profile-menu.js; UI redesign fix 10, 18 Oct 2026).
  add('Settings', 'Fill my details from my CV', 'Empty boxes in Profile → Your details, filled in for you to check', 'profile details contact cv fill empty phone address',
    () => { openView('settings'); settingsPage('profile'); fillFromCv(profileTab); });
  if (shared.state?.notion?.NOTION_PROFILE_PAGE_ID) add('Notion', 'Profile: View source in Notion', '', 'notion profile page open source', () => openInNotion('NOTION_PROFILE_PAGE_ID'));   // about Notion
  const seen = new Set();
  // A Settings page's name: its side-menu button; Profile has none there (it is a page of the main menu), so it is named here.
  const pageName = page => page === 'profile' ? 'Profile' : labelOf(document.querySelector(`[data-settings-go="${page}"]`));
  document.querySelectorAll('[data-settings-page] .setting[id]').forEach(section => {
    // A summary's own heading, not its whole line; a card with none is named by its bold line (Current CV) or its page (Credentials, Logs).
    const title = labelOf(section.querySelector('h3') || section.querySelector('h4, summary') || section.querySelector('.cv-card-text b')) || pageName(section.closest('[data-settings-page]')?.dataset.settingsPage);
    if (!reachable(section, section) || !title || seen.has(title)) return;
    seen.add(title);
    const page = section.closest('[data-settings-page]').dataset.settingsPage;
    const open = () => {
      openView('settings'); settingsPage(page);
      if (section.dataset.profilePanel) profileTab(section.dataset.profilePanel);
      if (section.classList.contains('conn-panel')) openSetting(section.id.replace(/^setting-/, ''));
      if (section.tagName === 'DETAILS') section.open = true;
      section.scrollIntoView({block: 'start'});
    };
    add('Settings', title, '', `settings ${page} ${section.dataset.keywords || ''}`, open);   // data-keywords: the words a person types for it ("email" finds Notifications)
    // The section's own sub-headings ("Chrome extension: manual connection" inside Developer options), each its own entry; never a field's value.
    section.querySelectorAll('h3, h4').forEach(heading => {
      const name = labelOf(heading);
      if (!name || seen.has(name) || !reachable(heading, section)) return;
      seen.add(name);
      add('Settings', name, `Section · ${title}`, `settings ${page}`, () => { open(); reveal(heading); }, {node: heading});
    });
    const buttons = [...section.querySelectorAll('button[id]')].filter(node => reachable(node, section) && !twins.has(node));
    buttons.forEach(node => {
      const danger = !!node.closest('.danger-zone') || /danger/.test(node.className);
      if (danger && buttons.length === 1) return;   // a section's sole danger button lands where its own entry does: a duplicate row
      addNode(node, 'Settings', `${title}: ${labelOf(node)}`, node.title, `settings ${page}`, open);
    });
  });
  // Headings on a Settings page that sit outside a section with an id (Overview's "Your setup", Connections' "Connected"): the page opens, the heading flashes.
  document.querySelectorAll('[data-settings-page] :is(h2, h3, h4)').forEach(heading => {
    const name = labelOf(heading), page = heading.closest('[data-settings-page]').dataset.settingsPage;
    if (!/\p{L}{2}/u.test(name) || seen.has(name) || heading.closest('.setting[id]') || hiddenAt(heading) || heading.closest('dialog, [role="dialog"]')) return;
    seen.add(name);
    add('Settings', name, `Section · ${pageName(page)}`, `settings ${page}`, () => { openView('settings'); settingsPage(page); reveal(heading); }, {node: heading});
  });
  document.querySelectorAll('#notion-links:not([hidden]) .notion-link').forEach(link => add('Notion', `Notion: ${labelOf(link)}`, '', 'open page database', () => link.click()));   // about Notion
  // Every other button a page shows (a Refresh, "Edit in Notion", "Fill now"): found by sweeping each page, so a new button is listed without being added here
  // (18 Oct 2026: Chrome extension was missing from ⌘K; palette-every-action.test.js fails on any button left out). Buttons in a dialog, hidden by their state
  // or already listed are skipped; Settings has its own sweep above.
  const listed = new Set(commands.map(command => command.node).filter(Boolean));
  document.querySelectorAll('.view:not([data-view="settings"]) button[id]').forEach(node => {
    const view = node.closest('.view').dataset.view, page = view[0].toUpperCase() + view.slice(1), label = labelOf(node) || node.getAttribute('aria-label') || '';
    if (listed.has(node) || twins.has(node) || node.closest('dialog, [role="dialog"], [hidden]:not(.view)') || !/\p{L}{2}/u.test(label)) return;
    addNode(node, page, `${page}: ${label}`, node.title, `${view} page`, () => openView(view));
  });
  // Every card and section heading on the other pages (Focus' Insight, Reports, Calendar's Coming up): the card scrolls into view and flashes.
  const named = new Set(commands.map(command => `${command.group}|${command.label}`));
  document.querySelectorAll('.view:not([data-view="settings"]) :is(h2, h3, h4)').forEach(heading => {
    const view = heading.closest('.view').dataset.view, page = view[0].toUpperCase() + view.slice(1), name = labelOf(heading);
    if (!/\p{L}{2}/u.test(name) || named.has(`${page}|${name}`) || heading.closest('dialog, [role="dialog"], [hidden]:not(.view)')) return;
    named.add(`${page}|${name}`);
    add(page, name, `Card · ${page}`, `${view} page card section`, () => { openView(view); reveal(heading); }, {node: heading});
  });
  for (const command of buildCommands()) add(command.group, command.label, command.hint, command.keywords, command.run);   // Restart to get N fixes (pages/build.js)
  return commands;
}

// Run at start-up, in the order the window has always done it (app.js calls each page's init in turn).
function go(way) {
  if (!$('activity-panel').hidden) history = viewHistory.withRun(history, shared.selectedRun);   // forward to it again shows the same run
  const step = way === 'back' ? viewHistory.back(history) : viewHistory.forward(history);
  if (!step.name) return;
  const [from, to] = [viewHistory.step(history.list[history.at]), viewHistory.step(step.name)];
  history = step.history;
  if (to.view !== from.view || !to.panel) openView(to.view, {fromHistory: true});   // the panel's own step: the screen under it is already there
  if (to.panel) shared.selectedRun = to.run;
  openActivity(to.panel, {fromHistory: true});
}
const editable = target => !!target?.closest?.('input, textarea, select, [contenteditable=""], [contenteditable="true"], .xterm');

export async function init() {
  const mac = /Mac/.test(navigator.platform);
  document.addEventListener('keydown', event => {
    const way = viewHistory.navKey(event, {mac, editable: editable(event.target)});
    if (way) { event.preventDefault(); go(way); }
  });
  document.addEventListener('mouseup', event => {  // the mouse's side buttons: 3 back, 4 forward
    if (event.button === 3 || event.button === 4) { event.preventDefault(); go(event.button === 3 ? 'back' : 'forward'); }
  });
  document.querySelectorAll('.nav').forEach(nav => {
    nav.title ||= nav.textContent.trim();  // the label, when the narrow window shows the sidebar as icons only
    nav.addEventListener('click', () => {
      // A button of the menu that is not a page ("Send feedback" opens its own dialog; the wizard's "Stuck? Tell us"): it has no view to open.
      // Opening "no view" hid every page and left the window blank behind the dialog (a friend's first feedback, 2 Oct 2026).
      if (!nav.dataset.view) return;
      // Applying opens the session that needs you most (else the latest), not just the page.
      if (nav.dataset.view === 'sessions' && bestSession()) return openSession(bestSession().id);
      openView(nav.dataset.view);
      if (nav.dataset.view === 'settings') settingsPage(nav.dataset.settings || 'overview');   // the sidebar's Settings is its Overview, also from Profile
    });
  });
  initMenu();   // pages/menu.js: the pages that appear when used, the More row, the first-launch tour
  // The sessions line at the foot does the same as Applying.
  $('nav-sessions').addEventListener('click', () => document.querySelector('.nav[data-view="sessions"]').click());
  $('palette-hint').addEventListener('click', () => openPalette(paletteCommands()));
  document.addEventListener('keydown', event => {
    if (event.key.toLowerCase() !== 'k' || !(event.metaKey || event.ctrlKey) || event.shiftKey || event.altKey) return;
    if ($('app').hidden) return;  // the setup wizard has nothing to run yet
    event.preventDefault();
    // Open or closed, not present or absent: a closed palette is removed a moment later (its close event), and ⌘K pressed in between did nothing (Linux/Windows CI, 6 Oct 2026).
    if ($('palette')?.open) $('palette').close(); else openPalette(paletteCommands());
  });
}
