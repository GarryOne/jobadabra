// Tailoring happens in the app, never on the form's panel (owner, 27 Oct 2026: "Send me to the app"; "I don't think the extension is that smart to adapt on the fly and replace the
// general CV with the tailored one"), and the panel draws no CV row at all (owner, 27 Oct 2026: "let's remove the line with "general CV attached… Tailor in Jobadabra""): every Tailor in the
// window marks the job and restarts the job's open form when the CV is ready. The browser test is desktop/e2e/test/panel-tailor.test.mjs; the journey step is in e2e/lib/apply-cv-steps.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {readPanel} from '../../worker/test/helpers/panel.js';
import {restartFormsOf} from '../lib/tailored-restart.js';

const read = path => fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

test('a tailored CV restarts only the job\'s live form tabs: open in Chrome, not submitted, not stopped, same job', () => {
  const sessions = [
    {id: 'a', kind: 'form', url: 'https://jobs.example/1'},                        // restarted
    {id: 'b', kind: 'form', url: 'https://jobs.example/1', outcome: 'submitted'},  // the person's: submitted
    {id: 'c', kind: 'form', url: 'https://jobs.example/1', stuck: 'stopped'},      // the person's Stop
    {id: 'd', kind: 'form', url: 'https://jobs.example/1'},                        // its tab is closed
    {id: 'e', kind: 'form', url: 'https://jobs.example/2'},                        // another job
    {id: 'f', kind: 'claude', url: 'https://jobs.example/1'}];                     // not a form tab
  const reloaded = [];
  const ids = restartFormsOf({}, 'J1', {sessions, tabOpen: id => id !== 'd', reload: id => reloaded.push(id), tailoredFor: url => (url.endsWith('/1') ? 'J1' : 'J2')});
  assert.deepEqual(ids, ['a']);
  assert.deepEqual(reloaded, ['a']);
  assert.deepEqual(restartFormsOf({}, '', {sessions, tabOpen: () => true, reload: () => assert.fail('no code, no reload'), tailoredFor: () => ''}), []);
});

test('the panel never tailors: no extension file asks the app to tailor or add a job, and the routes for it are gone from the app', () => {
  const dir = new URL('../../extension/', import.meta.url);
  for (const name of fs.readdirSync(dir).filter(name => name.endsWith('.js'))) assert.doesNotMatch(fs.readFileSync(new URL(name, dir), 'utf8'), /'tailor-cv'|'add-job'|panelTailor|panelAddJob/, `extension/${name}`);
  for (const path of ['desktop/lib/server.js', 'desktop/lib/server-hooks.js', 'desktop/lib/cv-handlers.js']) assert.doesNotMatch(read(path), /tailor-cv|add-job|setTailorHandler|setAddJobHandler/, path);
});

test('every Tailor in the window marks the job as being tailored (the panel says so) and restarts its open form when done: one IPC, every caller passes the job\'s address', () => {
  const handlers = read('desktop/lib/cv-handlers.js');
  assert.match(handlers, /ipcMain\.handle\('tailorCv', async \(_, code, name, url\)[\s\S]*?tailoring\.add\(key\)[\s\S]*?restartFormsOf\(storage, code\)[\s\S]*?tailoring\.delete\(key\)/);
  assert.doesNotMatch(read('desktop/lib/kit-handlers.js'), /ipcMain\.handle\('tailorCv'/, 'one handler only');
  const callers = ['desktop/renderer/pages/session-form-card.js', 'desktop/renderer/pages/jobs-render.js', 'desktop/renderer/job-drawer/tab-documents.js'];
  const found = fs.readdirSync(new URL('../renderer/', import.meta.url), {recursive: true}).filter(name => name.endsWith('.js'))
    .filter(name => fs.readFileSync(new URL(`../renderer/${name}`, import.meta.url), 'utf8').includes('pilot.tailorCv(')).map(name => `desktop/renderer/${name.replaceAll('\\', '/')}`).sort();
  assert.deepEqual(found, [...callers].sort(), 'a new Tailor caller joins this list and passes the job\'s address');
  for (const path of callers) assert.match(read(path), /pilot\.tailorCv\(job\.code, `\$\{job\.title\} · \$\{job\.company\}`, (job\.url|\[job\.url, item\.url\])\)/, path);
});

// From the old tailor-status test (1da1158, 19 Oct 2026): a panel control that asks the app says its progress and failure on the panel.
const OWN = new Set(['panelFill', 'panelReviewAnswer', 'panelTakeOver', 'panelClaudeAuto', 'panelTip', 'panelGoTab', 'panelReload', 'panelReloading', 'panelStepNow', 'panelApply', 'panelBuild', 'panelJob', 'panelAllowed', 'panelCloseTab', 'panelFillOne', 'panelShowTab']);
test('every panel control that asks the app goes through ask(), which says progress and failure on the panel', () => {
  const root = new URL('../../extension/', import.meta.url);
  const sources = fs.readdirSync(root).filter(f => /^(review|panel-.*)\.js$/.test(f)).map(f => fs.readFileSync(new URL(f, root), 'utf8'));
  const sent = new Set(sources.flatMap(text => [...text.matchAll(/send\(\{type: '(panel\w+)'/g)].map(m => m[1])));
  const viaAsk = new Set(sources.flatMap(text => [...text.matchAll(/ask\([^\n]*?\{type: '(panel\w+)'/g)].map(m => m[1])));
  assert.deepEqual([...viaAsk].sort(), ['panelOpenApp'], 'the asking controls found (Open in Jobadabra)');
  for (const type of sent) assert.ok(OWN.has(type), `${type} asks the app straight from the panel: route it through ask() or show its own progress/failure, then list it in OWN`);
});

test('the panel draws no CV row and no "Tailor in Jobadabra"; "Open in Jobadabra" is centred', () => {
  const markup = read('extension/panel-markup.js'), review = readPanel();
  assert.doesNotMatch(markup, /class="tailor"|\.tailor\b|Tailor in Jobadabra/);
  assert.doesNotMatch(review, /\.t-btn|\.t-text|show: 'tailor'/);
  assert.match(markup, /\.actions \{ border-top: 1px solid var\(--line\); padding-top: 6px; justify-content: center; \}/);
});
