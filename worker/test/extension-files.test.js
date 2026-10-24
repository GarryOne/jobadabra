import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { FILL_FILES } from '../../extension/page-files.js';
import { readPanel } from './helpers/panel.js';

const read = path => fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

// background.js and the files split out of it (messages-*.js, submit-watch.js, tab-report.js, settle-tabs.js, stop-messages.js) are one background for these checks.
const readBackground = () => ['background', 'messages-app', 'messages-learning', 'messages-panel', 'submit-watch', 'tab-report', 'settle-tabs', 'stop-messages'].map(name => read(`extension/${name}.js`)).join('\n');

test('extension page helpers are the same as the tools/ originals (run extension/sync.sh)', () => {
  for (const name of ['browser-submit-guard.js', 'browser-form-fastpath.js']) {
    assert.equal(read(`extension/page/${name}`), read(`tools/${name}`), name);
  }
});

test('manifest asks for activeTab, alarms, debugger, scripting and storage, and runs by itself only on the job-application sites', () => {
  const manifest = JSON.parse(read('extension/manifest.json'));
  assert.equal(manifest.manifest_version, 3);
  // debugger: real clicks on dropdowns, used only when Settings → Fill drop-down menus too is on (Chrome can't make it optional).
  // cookies: optional since 24 Oct 2026 (Chrome Web Store: a shorter install warning); Ready to send's "Open in my browser" carries the night's cookies only when granted (options.js carryLogins).
  assert.deepEqual(manifest.permissions.sort(), ['activeTab', 'alarms', 'debugger', 'scripting', 'storage', 'webNavigation']);
  // The flow's own list ("Opened in Chrome", auto-fill) is the same.
  assert.match(read('extension/flow.js'), /successfactors\.eu/);
  // Granted at install, so tabs opened by the app or "Open & fill" fill themselves (as optional
  // permissions they needed a prompt that closed the popup, and nothing filled).
  assert.deepEqual(manifest.host_permissions, ['https://*.greenhouse.io/*', 'https://jobs.lever.co/*', 'https://jobs.ashbyhq.com/*',
    'https://*.myworkdayjobs.com/*', 'https://*.smartrecruiters.com/*', 'https://apply.workable.com/*',
    'https://*.successfactors.eu/*', 'https://*.successfactors.com/*', 'https://*.jobs.personio.de/*', 'https://*.jobs.personio.com/*', 'https://*.teamtailor.com/*', 'https://*.recruitee.com/*', 'https://*.softgarden.io/*', 'https://*.umantis.com/*', 'https://*.taleo.net/*', 'https://*.icims.com/*', 'https://*.bamboohr.com/*']);
  // Every other site only through Settings → Work on every job site (asked from the options tab, which stays open).
  assert.deepEqual(manifest.optional_host_permissions, ['https://*/*']);
  assert.match(read('extension/options.js'), /chrome\.permissions\.request\(EVERY_SITE\)/);
  assert.deepEqual(manifest.optional_permissions, ['cookies']);
  assert.match(read('extension/options.js'), /chrome\.permissions\.request\(COOKIES\)/);
});

test('contact details go into matching empty text fields, never over kit answers or filled fields', () => {
  const window = {};
  const context = vm.createContext({window, document: {}});
  vm.runInContext(read('extension/page/radios.js'), context);   // injected before fill.js (extension/flow.js)
  for (const file of FILL_FILES) vm.runInContext(read(`extension/${file}`), context);   // the filler, in its injection order
  const rows = [
    {field: 'first_name', label: 'First Name*', type: 'text', filled: false},
    {field: 'last_name', label: 'Last Name', type: 'text', filled: false},
    {field: 'email', label: 'Email', type: 'email', filled: true},
    {field: 'phone', label: 'Phone', type: 'tel', filled: false},
    {field: 'question_9', label: 'LinkedIn Profile', type: 'text', filled: false},
    {field: 'question_10', label: 'Website', type: 'text', filled: false},
    {field: 'country', label: 'Location (City)', type: 'combobox', filled: false},
    {field: 'name', label: 'Name', type: 'text', filled: false},
    {field: 'consent', label: 'I agree to the privacy policy', type: 'text', filled: false, legal: true},
  ];
  const profile = {first_name: 'Ada', last_name: 'L', full_name: 'Ada L', email: 'a@b.c', phone: '+41',
                   linkedin: 'https://linkedin.com/in/ada', website: 'https://ada.dev', location: 'Zurich'};
  const entries = JSON.parse(JSON.stringify(window.__jobPilottoProfileEntries(rows, profile, ['question_10'])));
  assert.deepEqual(entries, [
    {field: 'first_name', value: 'Ada'}, {field: 'last_name', value: 'L'},
    {field: 'phone', value: '+41'}, {field: 'question_9', value: 'https://linkedin.com/in/ada'},
  ]);
});

test('consent boxes are recognised by whole words (Acknowledge, consents, certify), not only stems', () => {
  const source = read('extension/page/fill-labels.js');
  const LEGAL = eval(source.match(/const LEGAL = (\/.*\/i);/)[1]);
  for (const text of ['Acknowledge', 'I consent to Twilio collecting', 'By checking this box, I confirm I have read the policy',
    'I certify that the information is true', 'Privacy Policy']) assert.ok(LEGAL.test(text), text);
  for (const text of ['How did you hear about us?', 'Current company', 'Terminal skills', 'Are you legally authorized to work in the country?']) assert.ok(!LEGAL.test(text), text);
});

test('Apply with Claude hand-off: hook only on a tab the app opened, ticket checked by the app before filling', () => {
  const manifest = JSON.parse(read('extension/manifest.json'));
  // No content script. hook.js and review.js are injected into a tab the desktop app opened, nowhere else.
  assert.equal(manifest.content_scripts, undefined);
  const hook = read('extension/hook.js');
  assert.match(hook, /addEventListener\('jobpilotto:fill'/);
  assert.match(hook, /typeof request\?\.ticket !== 'string'/);
  const background = readBackground();
  const handOff = background.slice(background.indexOf('async function handOff'), background.indexOf('// Older builds registered'));
  assert.ok(handOff.indexOf("'/extension/ticket'") > 0 && handOff.indexOf("'/extension/ticket'") < handOff.indexOf('fillOpenedTab('),
    'the ticket is checked before any fill');
  assert.match(background, /unregisterContentScripts\(\{ids: \['hook-everywhere'\]\}\)/);
  assert.doesNotMatch(background, /\.registerContentScripts\(/);
  assert.match(background, /message\?\.type === 'panelAllowed'/);
  // The events a page can send carry no personal data, and the result written back holds only counts and field labels.
  assert.doesNotMatch(handOff, /contact|resume|profile/);
});

test('the Submit guard can be loaded twice on a page (a second fill) without throwing', () => {
  const code = read('extension/page/browser-submit-guard.js');
  const noop = () => {};
  const window = { __jobPilottoNoGuard: true, addEventListener: noop };
  const context = vm.createContext({ window, document: { addEventListener: noop, querySelectorAll: () => [] },
    HTMLFormElement: function () {}, HTMLElement: function () {}, Element: function () {}, MutationObserver: function () { this.observe = noop; } });
  window.window = window;
  assert.doesNotThrow(() => { vm.runInContext(code, context); vm.runInContext(code, context); });
  assert.equal(window.__jobPilottoGuardActive, false);
});

test('the panel (review.js) is read only: it never types, ticks, clicks or submits anything in the form', () => {
  const written = fs.readFileSync(new URL('../../extension/panel-written.js', import.meta.url), 'utf8');
  const overlayFile = fs.readFileSync(new URL('../../extension/panel-overlay.js', import.meta.url), 'utf8');
  const ring = readPanel().replace(written, '').replace(overlayFile, '');   // panel-written.js is the one exception, pinned below: the person's own "Use this version" press; panel-overlay.js only holds the person's input and tells the panel, it never touches a field
  assert.doesNotMatch(overlayFile, /\.click\(\)|\.checked\s*=[^=]|\.value\s*=[^=]|\.submit\(|requestSubmit/);
  // Only its own ring and panel get click handlers; the form's fields are scrolled to, outlined and focused.
  assert.doesNotMatch(ring, /\.click\(\)|\.checked\s*=[^=]|\.value\s*=[^=]|dispatchEvent|\.submit\(|requestSubmit/);
  assert.match(ring, /attachShadow/);
  // It talks to the app only through the extension's background worker, never from the page's origin.
  assert.doesNotMatch(ring, /fetch\(|XMLHttpRequest/);
  assert.match(ring, /const send = message => \(chrome\.runtime\?\.id \? chrome\.runtime\.sendMessage\(message\)/);
  assert.match(ring, /send\(\{type: 'review', payload\}\)/);
  // The review of a written answer (owner, 16 Oct 2026) types only when the person presses "Use this version" (and the box still holds the text that was reviewed); it never clicks, ticks or submits.
  assert.doesNotMatch(written, /\.click\(\)|\.checked\s*=[^=]|\.submit\(|requestSubmit|fetch\(|XMLHttpRequest/);
  assert.equal(written.match(/setValue\(el,/g).length, 1, 'one place types: the person\'s press');
  assert.match(written, /use\.onclick = \(\) => \{[^}]*changed since this review[^}]*\}\s*setValue\(el, result\.done\.improved\)/);
});

test('an out-of-date extension in Chrome loads the new copy by itself, and only rejoins tabs the app opened', () => {
  const background = readBackground();
  const newer = new Function(`${background.match(/export function newer[\s\S]*?\n}\n/)[0].replace('export ', '')}; return newer;`)();
  assert.equal(newer('0.7.1', '0.6.8'), true);
  assert.equal(newer('0.7.1', '0.7.1'), false);
  assert.equal(newer('0.10.0', '0.9.9'), true);
  assert.match(background, /reloadedFor !== answer\.latest/);  // once per version: no reload loop
  assert.match(background, /executeScript\(\{target: \{tabId, allFrames: true\}, files: \['page\/skeleton\.js', 'page\/required-mark\.js', 'page\/typed-check\.js', 'page\/read-back\.js', 'page\/label-before\.js', 'page\/coverage\.js', 'page\/option-groups\.js', 'page\/review-payload\.js', 'hook\.js', 'panel-claude\.js', 'page\/submit-press\.js', \.\.\.PANEL_FILES\], injectImmediately: true\}\)/);
  assert.match(background, /jobpilotto-review-host/);
  assert.match(readPanel(), /send\(\{type: 'panelAllowed'\}\)/);
  // A copy left behind by a reload gives way to the fresh one instead of blocking it.
  assert.match(readPanel(), /__jobPilottoReviewAlive\?\.\(\)/);
  assert.match(read('extension/hook.js'), /__jobPilottoHookAlive\?\.\(\)/);
});

test('a kit fill starts at once: kit and contact details prefetched, no fixed wait from the panel, quick dropdowns', () => {
  const background = readBackground();
  assert.match(background, /const data = await prefetch\(config, /);  // the panel's first look fetches both
  assert.match(background, /fillOpenedTab\(sender\.tab, url, !!message\.force, \{fast: true\}\)/);
  assert.match(background, /if \(!fast\) await new Promise/);
  // Your CV is read again when the prefetch is a few seconds old: a CV tailored after the form was first seen must be the one attached.
  assert.match(background, /Date\.now\(\) - ready\.meAt > ME_FRESH_MS/);
  const flow = read('extension/flow.js');
  assert.match(flow, /const me = early \|\| await apiFor\(tab\.id, /);
  assert.match(read('extension/combo-click.js'), /limit = PATIENCE\.first; waited < limit; waited = waitedNow\(\)/);   // the quick wait moved with the menu click (combo-click.js); real time since 14 Oct 2026, never counted ticks, less the page's busy time (#731)
});

test('a CV tailored after the first fill replaces the one the extension attached, never one the person chose', () => {
  const fill = read('extension/page/upload.js');   // page/upload.js owns attaching a file
  assert.match(fill, /input\.dataset\.jobPilottoFile = file\.name/);
  assert.match(fill, /ours && input\.files\[0\]\.name === ours && ours !== file\.name/);
  const review = readPanel();
  assert.match(review, /panelTailor/);                                          // the panel offers a CV tailored to the job
  assert.match(review, /ready && !filling && !readyNow/);                       // and the Fill button stays to attach it
  assert.match(readBackground(), /type: 'tailor-cv'/);
});

test('the form panel marks the questions a hiring system can reject on, first', () => {
  const review = readPanel();
  assert.match(review, /const KNOCKOUT = /);
  assert.match(review, /const knockout = field => KNOCKOUT\.test\(field\.label\) \|\| field\.category === 'knockout'/);   // English words or the AI's reading
  assert.match(review, /sort\(\(a, b\) => knockout\(b\) - knockout\(a\)\)/);   // knockouts sorted to the top
  const KNOCKOUT = new RegExp(review.match(/const KNOCKOUT = \/(.*)\/i;/)[1], 'i');
  for (const label of ['Are you authorized to work in the country where the job is located?', 'Will you now or in the future require sponsorship for employment visa status in this country?',
    'Are you able to work from our US office three days per week?', 'Do you hold a valid driving licence?']) assert.ok(KNOCKOUT.test(label), label);
  for (const label of ['Preferred name', 'Why do you want to work here?', 'LinkedIn profile']) assert.ok(!KNOCKOUT.test(label), label);
});

test('the app and the form panel mark the same knockout questions', () => {
  const regex = text => text.match(/const KNOCKOUT = (\/.*\/i);/)[1];
  assert.equal(regex(read('desktop/renderer/knockout.js')), regex(readPanel()));
});

test('the form panel\'s tip line draws from the same pool as the app (run extension/sync.sh after changing it)', () => {
  assert.equal(read('extension/tips-pool.js'), read('desktop/renderer/tips-pool.js'));
  assert.match(readBackground(), /message\?\.type === 'panelTip'/);
  assert.match(readPanel(), /type: 'panelTip'/);
});

test('the form report sends the AI-read knockouts: its key is code, not the tail of a // comment', () => {
  const line = read('extension/page/review-payload.js').split('\n').find(text => text.includes('knockouts: state.list'));
  assert.ok(line, 'the report has a knockouts key');
  assert.doesNotMatch(line.slice(0, line.indexOf('knockouts: state.list')), /\/\//);   // 9 Oct 2026: a comment on the same line swallowed it, the app never got the list
  assert.match(line, /f\.category === 'knockout'/);
});

test('the panel\'s Claude offer (panel-claude.js) shows only when Claude is ready and the extension stuck; the app sends both, and the panel hands the offer its facts', () => {
  const panel = readPanel();
  assert.match(panel, /__jobPilottoClaude\?\.render\(\{on: [^}]*!!claudeAsk\.help, stuck: !needsYou && !!session\?\.stuck/);
  assert.match(panel, /claudeAsk = \{takeover: reply\?\.claudeTakeover !== false, help: !!reply\?\.claudeHelp, always: !!reply\?\.claudeAlways, auto: !!reply\?\.claudeAuto, consent: !!reply\?\.claudeConsent\};/);
  assert.match(panel, /__jobPilottoClaude\?\.mount\(root, send\)/);
  assert.match(read('extension/background.js'), /'hook\.js', 'panel-claude\.js', 'page\/submit-press\.js', \.\.\.PANEL_FILES/);   // the offer's script is there before the panel mounts
  assert.match(read('desktop/lib/review.js'), /kind: session\.kind \|\| 'claude', stuck: session\.stuck \|\| ''\}/);
  assert.match(read('desktop/lib/ext-server-handlers.js'), /claudeHelp: takeoverOffered\(storage\), claudeTakeover: SHOW_RESUME_CLAUDE, claudeAlways: SHOW_RESUME_CLAUDE && !!storage\.settings\(\)\.claudeAuto/);
});

test('the account page reports what it did for the session card\'s record: the consent accepted (its wording) and a code typed (never the code)', () => {
  const step = read('extension/account-step.js');
  assert.match(step, /if \(pressed === 'pressed'\) tellFact\(config, tab, host, 'terms', ready\.needs\);/);
  assert.match(step, /if \(filled\) \{ tellFact\(config, tab, host, 'code'\);/);
  assert.doesNotMatch(step.slice(step.indexOf('function tellFact')), /got\.code/);   // the value of the code never goes into the report
});

test('a tab the app opened for a job never inherits the session of the tab that was in front (its mark is seen at once)', async () => {
  const tabs = read('extension/tabs.js'), background = read('extension/background.js');
  assert.equal(tabs.match(/export const APP_TAB_MARK = '([^']+)'/)[1], background.match(/export const FILL_MARK = '([^']+)'/)[1]);   // the same mark
  const follow = tabs.slice(tabs.indexOf('export async function followOpener'));
  assert.ok(follow.indexOf('APP_TAB_MARK') < follow.indexOf('await openerOf(tab)'), 'the mark is checked before anything is inherited from the opener');
  assert.match(follow, /\[tab\.url, tab\.pendingUrl\]\.some\(address => String\(address \|\| ''\)\.includes\(`#\$\{APP_TAB_MARK\}`\)\)\) return false;/);
});
