// Tailoring happens in the app, never on the form's panel (owner, 27 Oct 2026: "Send me to the app"; "I don't think the extension is that smart to adapt on the fly and replace the
// general CV with the tailored one"): the panel's "Tailor in Jobadabra" opens the session page at its Tailor button, every Tailor in the window marks the job as being tailored and
// restarts the job's open form when the CV is ready. The browser test is desktop/e2e/test/panel-tailor.test.mjs; the journey step is in e2e/lib/apply-cv-steps.mjs.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {restartFormsOf} from '../lib/tailored-restart.js';
import {showTailor} from '../renderer/pages/session-show-tailor.js';

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

const fakeDoc = (nodes) => {
  const made = {};
  for (const [id, hidden] of Object.entries(nodes)) {
    const node = {id, hidden, focused: false, dataset: {}, scrolled: false, classList: {list: new Set(['secondary']), add(c) { this.list.add(c); }, remove(c) { this.list.delete(c); }, replace(a, b) { if (this.list.delete(a)) this.list.add(b); }}, offsetWidth: 1,
      addEventListener() {}, focus() { this.focused = true; }, scrollIntoView() { this.scrolled = true; }, closest() { return made.card; }};
    made[id === 'ss-before-cv' ? 'card' : 'button'] = node;
  }
  return {made, doc: {getElementById: id => Object.values(made).find(node => node.id === id) || null}};
};

test('the session page lands on its Tailor button (focused, its card pulsed), the card when no button is offered, nothing when the card never shows', async () => {
  const offered = fakeDoc({'ss-before-cv': false, 'ss-before-cv-btn': false});
  assert.equal(await showTailor('s1', {doc: offered.doc, later: fn => fn()}), 'button');
  assert.ok(offered.made.button.focused && offered.made.card.scrolled && offered.made.card.classList.list.has('palette-flash'), 'the CV row pulses in view, its Tailor button takes focus');
  assert.ok(offered.made.button.classList.list.has('primary') && offered.made.button.dataset.suggested === 's1', 'Tailor is the row\'s main (solid) button for this session');
  const tailored = fakeDoc({'ss-before-cv': false, 'ss-before-cv-btn': true});
  assert.equal(await showTailor('s1', {doc: tailored.doc, later: fn => fn()}), 'card');
  assert.ok(!tailored.made.button.focused && tailored.made.card.classList.list.has('palette-flash'), 'no hidden button takes focus');
  let clock = 0;
  const never = fakeDoc({'ss-before-cv': true, 'ss-before-cv-btn': true});
  assert.equal(await showTailor('s1', {doc: never.doc, wait: 1000, every: 100, now: () => clock, later: fn => { clock += 100; fn(); }}), '');
});

test('"Tailor in Jobadabra" travels panel → worker → the open route → the window with show: tailor, and the session page reveals Tailor for it', () => {
  assert.match(read('extension/review.js'), /\$\('\.t-btn'\)\.onclick = event => session && ask\([^\n]*type: 'panelOpenApp', session: session\.id, show: 'tailor'/);
  assert.match(read('extension/messages-panel.js'), /message\.show === 'tailor' \? \{show: 'tailor'\}/);
  assert.match(read('desktop/lib/server.js'), /openHandler\(String\(session \|\| ''\), show === 'tailor' \? 'tailor' : ''\)/);
  assert.match(read('desktop/lib/ext-server-handlers.js'), /setOpenHandler\(\(id, show = ''\)[\s\S]*?toWindow\('session', 'open', \{id, show\}\)/);
  assert.match(read('desktop/renderer/pages/session-log.js'), /event === 'open'[^\n]*payload\.show === 'tailor'[^\n]*showTailor\(payload\.id\)/);
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
  assert.deepEqual([...viaAsk].sort(), ['panelOpenApp'], 'the asking controls found (Open in Jobadabra and Tailor in Jobadabra)');
  for (const type of sent) assert.ok(OWN.has(type), `${type} asks the app straight from the panel: route it through ask() or show its own progress/failure, then list it in OWN`);
});

test('the suggested Tailor stays the main button only on the session the panel opened, and stops being it once pressed', () => {
  const card = read('desktop/renderer/pages/session-form-card.js');
  assert.match(card, /const suggested = button\.dataset\.suggested === item\.id;[\s\S]*?classList\.toggle\('primary', suggested\)[\s\S]*?classList\.toggle\('secondary', !suggested\)/);
  assert.match(card, /button\.onclick = async \(\) => \{\n\s*delete button\.dataset\.suggested;/);
});
