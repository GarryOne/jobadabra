// "Report this form" wiring (spec 2026-10-15-report-this-form.md §3, §7): the panel flag (the only entry point since 16 Oct 2026; no app button, no ⌘K entry) is off with the Settings switch and until the uploader exists,
// nothing records before the person's press, the debugger is used only inside start(), the manifest's permissions are unchanged, and the app side holds, previews, drops hosts and sends only through the gate.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {registerReportHandlers, reportFormOn} from '../lib/report-handlers.js';
import {PANEL_FILES} from '../../extension/panel-files.js';
import {visitMore} from '../lib/server-hooks.js';

const read = file => fs.readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
const code = file => read(file).split('\n').filter(line => !/^\s*\/\//.test(line)).join('\n');
const TEXTS = ['full name: Rosalind Quill\nemail: rosalind.quill@mailbox.test\n'];
const entry = (url, body, type = 'text/html') => ({method: 'GET', url, type: 'document', mode: 'navigate', startMs: 0, waitMs: 5, bodyKey: '', status: 200, failed: false, headers: {'content-type': type}, hadCookie: false, body: Buffer.from(body).toString('base64'), size: body.length});

const okUploader = {send: async () => ({ok: true}), count: () => 0, deleteAll: async () => ({ok: true, deleted: 0})};
function harness({uploader = okUploader, settings = {}} = {}) {
  const handlers = {}, sent = [], saved = {};
  const ipcMain = {handle: (name, fn) => { handlers[name] = fn; }};
  registerReportHandlers({ipcMain, uploader, texts: () => TEXTS, toWindow: (...args) => sent.push(args), getWindow: () => null,
    storage: {settings: () => ({...settings, ...saved}), saveSettings: patch => Object.assign(saved, patch)}});
  return {handlers, sent, route: payload => visitMore['/extension/report-form'](payload)};
}

test('the panel flag is off until the uploader exists and while the switch is off; the app has no button or ⌘K entry for it', async () => {
  assert.deepEqual((await harness({uploader: null}).route({action: 'state'})), {ok: true, enabled: false});
  assert.equal((await harness({settings: {reportForm: false}}).route({action: 'state'})).enabled, false);
  const on = harness(); assert.equal((await on.route({action: 'state'})).enabled, true);
  await on.handlers.reportFormSet(null, false); assert.equal((await on.route({action: 'state'})).enabled, false);
  assert.deepEqual(await on.route({action: 'submit', entries: []}), {ok: false, refused: 'off'});
  for (const file of ['desktop/renderer/index.html', 'desktop/renderer/pages/nav.js', 'desktop/renderer/pages/report-form.js']) assert.doesNotMatch(read(file), /ss-report/, `${file}: the flag lives only in the extension panel, no app button or ⌘K entry`);
  assert.match(read('extension/panel-markup.js'), /<div class="foot">[^]*<button class="report-btn"[^>]*>[^]*Report<\/button><\/div>/, 'one Report entry, in the footer of every state');
  assert.doesNotMatch(read('extension/panel-markup.js'), /report-flag|report-open/, 'no header flag, no body button');
  assert.match(read('extension/review.js'), /\$\('\.report-btn'\)\.onclick[^]*window\.__jobPilottoReport\.open\(\)/, 'the footer\'s Report opens the popup on the panel');
  assert.doesNotMatch(code('extension/panel-report.js'), /class="flag"|bottom: 12px|left: 12px/, 'no bottom-left ⚑ chip (owner, 19 Oct 2026: Stop and the flag leave the corner)');
});

test('the press hands over the trace Jobadabra already keeps: the popup asks for its state, prepares, sends or cancels from a trusted click; nothing reloads', () => {
  const panel = code('extension/panel-report.js');
  assert.deepEqual([...new Set(panel.match(/type: 'report-[a-z]+'/g))].sort(), ["type: 'report-cancel'", "type: 'report-confirm'", "type: 'report-send'", "type: 'report-state'"]);
  assert.ok(/event\.isTrusted/.test(panel), 'a page\'s script cannot press the buttons');
  assert.match(panel, /Never sent: what you typed, passwords, cookies, your CV or your profile/);
  assert.doesNotMatch(panel, /read it and press Send|Review in Jobadabra|will reload|Start recording/);
  assert.match(panel, /var\(--ink\)/, 'the popup takes the panel\'s own tokens, so its theme reaches it');
  assert.equal(fs.existsSync(new URL('../../extension/report-recorder.js', import.meta.url)), false, 'the reload-and-record collector is gone');
});

test('the manifest\'s permissions are what they were: debugger stays a normal permission, nothing new, nothing optional', () => {
  const manifest = JSON.parse(read('extension/manifest.json'));
  // cookies: Ready to send's "Open in my browser" carries the night's cookies (owner, 18 Oct 2026, knowing Chrome asks each user once on update)
  assert.deepEqual(manifest.permissions, ['activeTab', 'alarms', 'debugger', 'scripting', 'storage', 'webNavigation']);
  assert.ok(!(manifest.optional_permissions || []).includes('debugger'));
});

test('Report sends in the panel: a submitted recording is scrubbed and held, answered with counts only, and sent once after the gate runs again, with the person\'s scrubbed note', async () => {
  const uploads = [], h = harness({uploader: {...okUploader, send: async (record, meta) => { uploads.push({record, meta}); return {ok: true}; }}});
  const answer = await h.route({action: 'submit', entries: [entry('https://jobs.example.test/apply', '<h1>Hi Rosalind</h1>'), entry('https://cdn.example.test/w.html', '<p>x</p>')], truncated: false});
  assert.equal(answer.ok, true); assert.equal(answer.preview.responses, 2);
  assert.ok(!JSON.stringify(answer).match(/Rosalind|Quill|mailbox/), 'the popup is shown counts and hosts only');
  assert.equal(h.sent.length, 0, 'the app window is not opened or told: the report is made and sent from the panel');
  assert.deepEqual(await h.route({action: 'send', note: 'It stopped at the CV step; I am Rosalind Quill, rosalind.quill@mailbox.test'}), {ok: true});
  assert.equal(uploads.length, 1, 'the uploader is called once');
  assert.ok(![...uploads[0].record.bodies.values()].some(body => /Rosalind/.test(body.toString())), 'what is uploaded is scrubbed');
  assert.match(uploads[0].meta.note, /^It stopped at the CV step; I am Candidate Candidate, /);
  assert.doesNotMatch(uploads[0].meta.note, /Rosalind|Quill|mailbox/, 'the note is scrubbed like the rest');
  assert.deepEqual(await h.route({action: 'send', note: ''}), {ok: false, refused: 'expired'}, 'nothing is held after a send');
});

test('a name inside a base64 run is cleaned, not refused; Cancel sends nothing; a planted value in the note is refused with its kind', async () => {
  const uploads = [], h = harness({uploader: {...okUploader, send: async record => { uploads.push(record); return {ok: true}; }}});
  const blocked = await h.route({action: 'submit', entries: [entry('https://jobs.example.test/x.json', JSON.stringify({blob: Buffer.from('Hello Quill, this is plain text for you to read here').toString('base64')}), 'application/json')]});   // the person's name inside a base64 run: cleaned in its decoded form (19 Oct 2026), so the report is held, not stopped
  assert.equal(blocked.ok, true);
  assert.deepEqual(await h.route({action: 'cancel'}), {ok: true});
  assert.deepEqual(await h.route({action: 'send', note: ''}), {ok: false, refused: 'expired'}, 'nothing was held');
  await h.route({action: 'submit', entries: [entry('https://jobs.example.test/apply', '<p>x</p>')]});
  assert.deepEqual(await h.route({action: 'cancel'}), {ok: true});
  assert.deepEqual(await h.route({action: 'send', note: ''}), {ok: false, refused: 'expired'});
  assert.equal(uploads.length, 0, 'Cancel sent nothing');
});

test('the trace switch is on by default and named in plain words in Settings (so ⌘K lists it by its heading) and in the wizard; the bar is explained once', () => {
  const html = read('desktop/renderer/index.html');
  assert.match(html, /<h3>Keep a trace of each form fill<\/h3>/);
  assert.match(html, /<input type="checkbox" id="welcome-trace" checked aria-label=/, 'the wizard has one checkbox, on by default');
  assert.match(html, /Stays on this Mac, sent only when you press Report in the panel and then Send \(personal details removed automatically first\), never sign-in pages, deleted when the application ends/);
  assert.equal(reportFormOn({settings: () => ({})}), true, 'on for every install that never chose');
  assert.equal(reportFormOn({settings: () => ({reportForm: false})}), false);
  assert.match(read('extension/panel-markup.js'), /Chrome shows a debugging bar while Jobadabra keeps a trace/);
  assert.match(read('extension/review.js'), /traceBarSeen/);
});

test('no panel button is a silent no-op: a click handler never calls a window hook with ?.(), and a Report press that cannot open the popup says so in the panel', () => {
  for (const file of ['extension/review.js', 'extension/panel-claude.js', 'extension/panel-written.js']) {
    const lines = code(file).split('\n').filter(line => /onclick|addEventListener\('click'/.test(line));
    for (const line of lines) assert.doesNotMatch(line, /__jobPilotto\w+\?\.\(/, `${file}: a button that calls a missing hook does nothing, silently: ${line.trim().slice(0, 80)}`);
  }
  assert.match(code('extension/review.js'), /__jobPilottoReport\.open\(\);\s*else note\('Report could not open/, 'a missing popup says so in the panel');
  assert.deepEqual(PANEL_FILES.slice(-2), ['panel-report.js', 'review.js'], 'the popup script is injected before the panel that mounts it');
});

test('one refusal sentence in the panel and the app\'s Send, and the panel names the kinds that blocked it', () => {
  const sentence = 'Jobadabra could not remove everything personal from it safely, so nothing was sent.';
  for (const file of ['extension/panel-report.js', 'desktop/lib/report-handlers.js']) assert.ok(read(file).includes(sentence), `${file}: the same sentence`);
  assert.doesNotMatch(read('extension/panel-report.js'), /nothing was kept\.'/, 'one wording: nothing was sent');
  assert.match(code('extension/panel-report.js'), /Still found: /);
  for (const kind of ['email', 'phone', 'name', 'name-in-code', 'location', 'token']) assert.match(code('extension/panel-report.js'), new RegExp(`['"]?${kind}['"]?: '`), `the panel words the kind ${kind}`);
});
