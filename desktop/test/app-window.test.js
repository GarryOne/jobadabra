// The window and its helpers: scripts and wizard markup, open questions and fill reports, the Jobs filter, Windows wording, Gmail failures.
// Split from app.test.js (8 Oct 2026) without changing any test.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {fakeNotion} from './fake-notion.js';
import {fileURLToPath} from 'node:url';
import * as apply from '../lib/apply.js';
import * as pipeline from '../lib/pipeline.js';
import {createStorage} from '../lib/storage.js';

// Stand-in for safeStorage: reversible, and obviously not plain text on disk.
const fakeCrypto = {encrypt: v => Buffer.from(v).reverse().toString('base64'), decrypt: s => Buffer.from(s, 'base64').reverse().toString()};
const tempStorage = () => { const s = createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'pilot-')), fakeCrypto); s.saveSettings({telemetry: false}); return s; };   // no request to the live site

test('the window scripts parse (a syntax error leaves the app window blank)', async () => {
  const {execFileSync} = await import('node:child_process');
  const {readdirSync} = await import('node:fs');
  const pages = readdirSync(new URL('../renderer/pages/', import.meta.url)).map(file => `renderer/pages/${file}`);
  for (const file of ['renderer/app.js', ...pages, 'preload.cjs', 'main.js', 'start.js']) {
    execFileSync(process.execPath, ['--check', fileURLToPath(new URL(`../${file}`, import.meta.url))]);
  }
});

test('open questions are the ❓ lines of the Notion standard answers; answering fills the line in place', async () => {
  const questions = await import('../lib/questions.js');
  const storage = tempStorage();
  storage.setSecret('NOTION_TOKEN', 'ntn_x');
  storage.saveSettings({notionIds: {NOTION_PROFILE_PAGE_ID: 'profile', NOTION_ANSWERS_PAGE_ID: 'answers'}});
  const {blocks, fetcher} = fakeNotion(['Notice period: ❓', 'Salary expectation: CHF 130,000']);
  const run = {url: 'https://x/1', trace: [
    {label: 'Are you open to relocation?', required: true, reason: questions.NO_ANSWER},
    {label: 'Nickname', required: false, reason: questions.NO_ANSWER},
    {label: 'Salary expectation', required: true, reason: questions.NO_ANSWER},  // the page already has it
    {label: 'Email', required: true, reason: ''}]};
  assert.equal(await questions.collect(storage, run, 'Acme', fetcher), 1);
  assert.equal(await questions.collect(storage, run, 'Acme', fetcher), 0);  // already on the page
  assert.equal(blocks.at(-1).text, 'Are you open to relocation?: ❓ (asked by Acme)');
  const open = await questions.list(storage, fetcher);
  assert.deepEqual(open.map(q => [q.question, q.company]), [['Notice period', ''], ['Are you open to relocation?', 'Acme']]);
  assert.deepEqual(await questions.answer(storage, open[1].key, 'Yes, within Switzerland', fetcher), {ok: true});
  assert.equal(blocks.at(-1).text, 'Are you open to relocation?: Yes, within Switzerland');
  assert.deepEqual(await questions.answer(storage, open[0].key, '', fetcher), {ok: true});  // skip = line removed
  assert.deepEqual(blocks.map(b => b.text), ['Salary expectation: CHF 130,000', '❓ Questions to answer', 'Are you open to relocation?: Yes, within Switzerland']);
  assert.equal((await questions.list(storage, fetcher)).length, 0);
  assert.equal(storage.settings().openQuestions, undefined);  // nothing kept on the Mac
});

test('a form\'s required marker (*) is not part of an open question', async () => {
  const questions = await import('../lib/questions.js');
  const storage = tempStorage();
  storage.setSecret('NOTION_TOKEN', 'ntn_x');
  storage.saveSettings({notionIds: {NOTION_PROFILE_PAGE_ID: 'profile', NOTION_ANSWERS_PAGE_ID: 'answers'}});
  const {blocks, fetcher} = fakeNotion(['* Street, No.: ❓ (asked by Acme)']);
  const run = {url: 'https://x/1', trace: [{label: '* Nationality', required: true, reason: questions.NO_ANSWER},
    {label: 'Street, No. *', required: true, reason: questions.NO_ANSWER}]};  // same question as the page's: not added again
  assert.equal(await questions.collect(storage, run, 'Acme', fetcher), 1);
  assert.equal(blocks.at(-1).text, 'Nationality: ❓ (asked by Acme)');
  assert.deepEqual((await questions.list(storage, fetcher)).map(q => q.question), ['Street, No.', 'Nationality']);
});

test('contact fields left empty never become questions for the answers page (they come from the Profile)', async () => {
  // 29 Sep 2026: a Canonical fill whose contact details didn't load added "First Name: ❓", "Last Name: ❓", "Email: ❓".
  const questions = await import('../lib/questions.js');
  const storage = tempStorage();
  storage.setSecret('NOTION_TOKEN', 'ntn_x');
  storage.saveSettings({notionIds: {NOTION_PROFILE_PAGE_ID: 'profile', NOTION_ANSWERS_PAGE_ID: 'answers'}});
  const {blocks, fetcher} = fakeNotion([]);
  const empty = label => ({label, required: true, reason: questions.NO_ANSWER});
  const run = {url: 'https://x/1', trace: ['First Name', 'Last Name *', 'Email', 'Phone', 'LinkedIn Profile', 'Location (City)',
    'How did you perform in mathematics at high school?'].map(empty)};
  assert.equal(await questions.collect(storage, run, 'Canonical', fetcher), 1);
  assert.deepEqual(blocks.map(b => b.text), ['❓ Questions to answer', 'How did you perform in mathematics at high school?: ❓ (asked by Canonical)']);
});

test('without Notion, open questions say so instead of keeping a copy on the Mac', async () => {
  const questions = await import('../lib/questions.js');
  const storage = tempStorage();
  const run = {url: 'https://x/1', trace: [{label: 'Are you open to relocation?', required: true, reason: questions.NO_ANSWER}]};
  await assert.rejects(questions.collect(storage, run, 'Acme'), /Connect Notion first/);
  await assert.rejects(questions.list(storage), /Connect Notion first/);
  assert.equal(storage.settings().openQuestions, undefined);
});

test('fill reports: mechanical failures only, form structure only, each site + field once, off with technical reports', async () => {
  const reports = await import('../lib/reports.js');
  const storage = tempStorage();
  const run = {url: 'https://job-boards.greenhouse.io/x/jobs/1', debug: {version: '0.6.2', form: [{label: 'Location (City)', type: 'combobox', options: ['Geneva']}],
    answers: [{field: 'loc', value: 'Geneva, Switzerland'}]},
    trace: [{label: 'Location (City)', required: true, reason: 'dropdown clicked, but no option matched (1.5 s)'},
      {label: 'Pronouns', reason: 'no answer in the kit, Profile or your details'}]};
  const sent = [];
  const fetcher = async (url, init) => { sent.push(JSON.parse(init.body)); return {ok: true}; };
  storage.saveSettings({telemetry: false});
  assert.equal(await reports.send(storage, run, fetcher), null);  // technical reports turned off
  storage.saveSettings({telemetry: true});
  const report = await reports.send(storage, run, fetcher);
  assert.equal(report.fields.length, 1);
  assert.equal(report.fields[0].reason, 'dropdown clicked, but no option matched');  // the click's time dropped
  assert.deepEqual(report.fields[0].options, ['Geneva']);
  assert.ok(!JSON.stringify(sent).includes('Geneva, Switzerland'));  // no answers
  assert.equal(await reports.send(storage, run, fetcher), null);  // already reported for this site
  // A field reported before snapshots existed is reported once more with its snapshot (for its issue), then never.
  const snapshot = {t: 'div', a: {class: 'select__container'}, c: [{t: 'input', a: {role: 'combobox', 'data-jp-field': ''}, c: []}]};
  const withSnapshot = {...run, snapshots: {'Location (City)': snapshot}};
  const again = await reports.send(storage, withSnapshot, fetcher);
  assert.deepEqual(again.fields[0].snapshot, snapshot);
  assert.equal(await reports.send(storage, withSnapshot, fetcher), null);
});

test('the Jobs filter finds a job by its pasted link, however it was copied', async () => {
  const {matches, looksLikeLink} = await import('../renderer/filter.js');
  const job = {title: 'Site Reliability Engineer (a)', company: 'KMS AG', location: 'Kriens',
    url: 'https://www.jobs.ch/en/vacancies/detail/236ae744-8fa8-464d-b4ae-a9e3a9b9c8bd/'};
  for (const pasted of ['www.jobs.ch/en/vacancies/detail/236ae744-8fa8-464d-b4ae-a9e3a9b9c8bd',
    'https://www.jobs.ch/en/vacancies/detail/236ae744-8fa8-464d-b4ae-a9e3a9b9c8bd/?utm_source=x#apply',
    'jobs.ch/en/vacancies/detail/236ae744-8fa8-464d-b4ae-a9e3a9b9c8bd/']) {
    assert.ok(looksLikeLink(pasted), pasted);
    assert.ok(matches(job, pasted), pasted);
  }
  assert.ok(!matches(job, 'www.jobs.ch/en/vacancies/detail/other-job'));
  assert.ok(matches(job, 'kms'));
  assert.ok(matches(job, '236ae744'));  // part of the link, typed as a word
  assert.ok(!looksLikeLink('site reliability'));
  assert.ok(matches(job, ''));
});

test('Windows: Chrome is chrome.exe itself (no shell), the bundled Python is python.exe, claude may be claude.cmd', () => {
  const env = {ProgramFiles: 'C:\\Program Files', LOCALAPPDATA: 'C:\\Users\\x\\AppData\\Local'};
  const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  assert.deepEqual(apply.chromeCommand(['https://x/?a=1&b=2'], 'win32', env, file => file === chrome), [chrome, ['https://x/?a=1&b=2']]);
  assert.equal(apply.chromeCommand(['https://x'], 'win32', env, () => false), null);
  assert.deepEqual(apply.chromeCommand(['https://x'], 'darwin', {}, () => false), ['open', ['-a', 'Google Chrome', 'https://x']]);
  // Edge: used when it is the browser with the extension, or the only one installed; Chrome wins otherwise.
  const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  const both = file => file === chrome || file === edge;
  const pc = {...env, 'ProgramFiles(x86)': 'C:\\Program Files (x86)'};
  assert.deepEqual(apply.chromeCommand(['https://x'], 'win32', pc, file => file === edge), [edge, ['https://x']]);
  assert.deepEqual(apply.chromeCommand(['https://x'], 'win32', pc, both), [chrome, ['https://x']]);
  assert.deepEqual(apply.chromeCommand(['https://x'], 'win32', pc, both, 'Microsoft Edge'), [edge, ['https://x']]);
  assert.deepEqual(apply.chromeCommand(['https://x'], 'darwin', {}, file => file === '/Applications/Microsoft Edge.app'), ['open', ['-a', 'Microsoft Edge', 'https://x']]);
  assert.equal(apply.extensionBrowser(() => [{app: 'Google Chrome', enabled: false}, {app: 'Microsoft Edge', enabled: true}]), 'Microsoft Edge');
  assert.equal(apply.extensionBrowser(() => []), '');
  // The e2e stand-in, only with the e2e flag (a user's JOB_PILOTTO_E2E_OPENER alone does nothing).
  assert.deepEqual(apply.chromeCommand(['https://x'], 'win32', {JOB_PILOTTO_E2E: '1', JOB_PILOTTO_E2E_OPENER: 'C:\\o.mjs'}), ['node', ['C:\\o.mjs', 'https://x']]);
  assert.deepEqual(apply.chromeCommand(['https://x'], 'darwin', {JOB_PILOTTO_E2E_OPENER: '/o.mjs'}, () => false), ['open', ['-a', 'Google Chrome', 'https://x']]);
  assert.match(pipeline.python('win32', file => file.endsWith('python.exe')), /python[\\/]python\.exe$/);
  assert.equal(pipeline.python('win32', () => false), 'python');
  const npm = 'C:\\Users\\x\\AppData\\Roaming\\npm\\claude.cmd';
  assert.equal(apply.claudeBinary({PATH: 'C:\\Windows;C:\\Tools', USERPROFILE: 'C:\\Users\\x', APPDATA: 'C:\\Users\\x\\AppData\\Roaming'},
    file => file === npm, 'win32'), npm);
  assert.match(apply.claudeReady({}, () => npm, 'win32', () => '').error, /Git for Windows/);
});

test('Windows wording: the PC, File Explorer, Ctrl, its own encryption; the Mac keeps its words', async () => {
  const {osText, pick} = await import('../renderer/os.js');
  assert.equal(osText("Keys are encrypted with your Mac's Keychain and never leave this Mac.", 'win32'),
    "Keys are encrypted with Windows' built-in encryption and never leave this PC.");
  assert.equal(osText('Runs on GitHub, even when your Mac is off.', 'win32'), 'Runs on GitHub, even when your PC is off.');
  // Forms the swap used to miss: a capital "This", the curly apostrophe, and the bare Keychain word (the PC's store is the Credential Manager).
  assert.equal(osText("This Mac's version is saved in Profile.", 'win32'), "This PC's version is saved in Profile.");
  assert.equal(osText('Credentials are stored in your Mac’s Keychain and never leave this Mac.', 'win32'), "Credentials are stored in Windows' built-in encryption and never leave this PC.");
  assert.equal(osText("The passwords stay in this Mac's Keychain, encrypted.", 'win32'), 'The passwords stay in Windows Credential Manager, encrypted.');
  assert.equal(osText('Keys: encrypted in Keychain. (password saved in your Keychain)', 'win32'), 'Keys: encrypted in Windows Credential Manager. (password saved in your Windows Credential Manager)');
  assert.equal(osText("This Mac's version", 'darwin'), "This Mac's version");
  assert.equal(osText('Show in Finder', 'win32'), 'Show in File Explorer');
  assert.equal(osText('Recordings in Finder', 'win32'), 'Recordings in File Explorer');
  assert.equal(osText('(⌘-click: in a window)', 'win32'), '(Ctrl-click: in a window)');
  assert.equal(osText('Show in Finder, this Mac', 'darwin'), 'Show in Finder, this Mac');
  // Every key the app names, including the ones the extension-install instructions show: a PC must never be told to
  // press ⌘, and two-key combinations are swapped before their second key alone.
  assert.equal(osText('chrome://extensions is on your clipboard: in Chrome press ⌘L, then ⌘V and ⏎.', 'win32'),
    'chrome://extensions is on your clipboard: in Chrome press Ctrl+L, then Ctrl+V and Enter.');
  assert.equal(osText('⌘K, ⌘R, ⌘⇧G, ⇧⌘G, ⌘G, ⇧Enter', 'win32'), 'Ctrl+K, Ctrl+R, Ctrl+Shift+G, Ctrl+Shift+G, Ctrl+G, Shift+Enter');
  assert.equal(osText('⌘K, ⌘R, ⌘⇧G, ⌘G', 'darwin'), '⌘K, ⌘R, ⌘⇧G, ⌘G');  // the Mac is left alone
  // The one instruction a swap can't fix: the PC's folder dialog has no "Go to Folder".
  assert.equal(pick('Load unpacked, then ⌘⇧G, ⌘V, Return.', 'Load unpacked, paste it (Ctrl+V), Enter.', 'win32'),
    'Load unpacked, paste it (Ctrl+V), Enter.');
  assert.equal(pick('Load unpacked, then ⌘⇧G, ⌘V, Return.', 'Load unpacked, paste it (Ctrl+V), Enter.', 'darwin'),
    'Load unpacked, then ⌘⇧G, ⌘V, Return.');
});

test('every wizard step sits inside the wizard\'s content column (an extra </div> pushes the rest below the sidebar)', () => {
  const html = fs.readFileSync(new URL('../renderer/index.html', import.meta.url), 'utf8');
  const body = html.slice(html.indexOf('<div class="step-body">'), html.indexOf('<!-- After setup'));
  let depth = 0;
  for (const tag of body.matchAll(/<(\/?)div\b[^>]*>/g)) {
    depth += tag[1] ? -1 : 1;
    if (/data-step="/.test(tag[0])) assert.equal(depth, 2, `${tag[0]} opens outside .step-body`);
  }
  assert.equal(depth, 0, 'the wizard\'s divs are balanced');
});

test('every Settings card is closed before the next one starts (an unclosed card nests the rest inside it)', () => {
  const html = fs.readFileSync(new URL('../renderer/index.html', import.meta.url), 'utf8');
  const start = html.indexOf('<div class="view" data-view="settings"');
  const view = html.slice(start, html.indexOf('</main>', start));
  let depth = 0, page = null;  // cards sit directly inside a Settings sub-page (Overview, Connections…)
  for (const tag of view.matchAll(/<(\/?)div\b[^>]*>/g)) {
    depth += tag[1] ? -1 : 1;
    if (/class="settings-page"/.test(tag[0])) page = depth;
    if (/class="setting[ "]/.test(tag[0])) assert.equal(depth, page + 1, `${tag[0]} is nested inside another card`);
  }
  assert.equal(depth, 0, 'the Settings view\'s divs are balanced');
});

test('a Gmail check that exited normally but read nothing is a failure with its reason', async () => {
  const {mailProblem} = await import('../lib/pipeline.js');
  assert.equal(mailProblem('Cronjob run logged: https://x\nMail check skipped: the Anthropic API spend limit is reached (Error code: 400)'),
    'not checked: the Anthropic API spend limit was reached');
  assert.match(mailProblem('⚠️ The Google sign-in for Gmail and Calendar has expired (…)'), /Google sign-in expired/);
  assert.equal(mailProblem('Mail: 12 emails read, 2 updates\nUpdates:\nGrafana: Rejected'), null);
});

test('the window is one module per page, and every import between them resolves', async () => {
  // Each page's state is declared in its own module, and every module is loaded before app.js runs any page's
  // start-up code, so a page can't use another's state too early. esbuild fails on an import nothing exports.
  const {build} = await import('esbuild');
  const result = await build({entryPoints: [fileURLToPath(new URL('../renderer/app.js', import.meta.url))], bundle: true,
    write: false, format: 'esm', platform: 'browser', external: ['../../node_modules/*'], logLevel: 'silent'});
  assert.equal(result.errors.length, 0);
  const {readdirSync} = await import('node:fs');
  const pages = readdirSync(new URL('../renderer/pages/', import.meta.url)).filter(file => file.endsWith('.js'));
  assert.ok(pages.length > 10 && pages.includes('shared.js'));
});

test('Windows wording keeps watching: text drawn after start (a status card, a run result) is swapped too, the Mac is left alone', async () => {
  const {localize} = await import('../renderer/os.js');
  const empty = {nodeType: 1, ownerDocument: {createTreeWalker: () => ({nextNode: () => null})}, querySelectorAll: () => []};
  const watch = platform => {
    let callback = null;
    localize(empty, platform, class { constructor(fn) { callback = fn; } observe() {} });
    return callback;
  };
  const text = value => ({nodeType: 3, nodeValue: value});
  const late = [text('Not installed on this Mac'), text('Claude Code is not installed on this Mac. Install it, then Verify.')];
  watch('win32')([{type: 'childList', addedNodes: late}]);
  assert.deepEqual(late.map(node => node.nodeValue), ['Not installed on this PC', 'Claude Code is not installed on this PC. Install it, then Verify.']);
  const edited = text('Runs while your Mac is on');   // a text node changed in place
  watch('win32')([{type: 'characterData', target: edited}]);
  assert.equal(edited.nodeValue, 'Runs while your PC is on');
  assert.equal(watch('darwin'), null);   // on the Mac nothing is watched or changed
});
