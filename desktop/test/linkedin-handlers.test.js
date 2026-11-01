// LinkedIn jobs, PR 1/3: the two routes the extension calls and the window's view (lib/linkedin-handlers.js). The consent page's POST saves the session; the minute
// poll learns that the switch went off; the view never carries a cookie value.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {linkedinRoutes, linkedinView, registerLinkedinHandlers} from '../lib/linkedin-handlers.js';
import {SERVICE, readSession} from '../lib/linkedin-session.js';
import {createRefresh} from '../lib/linkedin-refresh.js';

const SECRET = 'AQEDAR-fake-li-at-value';
function store(settings = {}) { const mine = {...settings}; return {settings: () => mine, saveSettings: patch => Object.assign(mine, patch)}; }
function keychain() { const items = new Map(); return {items, write: (service, value) => { items.set(service, value); return true; }, read: service => items.get(service) || null, remove: service => items.delete(service)}; }

test('the consent page\'s POST saves the session, the poll then says keep; off says revoke', () => {
  const settings = store(), kc = keychain(), routes = linkedinRoutes(settings, {keychain: kc});
  assert.deepEqual(routes.pending(), {revoke: true, refresh: false}, 'off: the extension gives its LinkedIn permissions back');
  assert.deepEqual(routes.session({cookies: [{name: 'li_at', value: SECRET, domain: '.linkedin.com'}]}), {ok: true});
  assert.deepEqual(routes.pending(), {revoke: false, refresh: false});
  assert.ok(kc.items.has(SERVICE));
});

test('a POST with nothing usable is refused and the switch stays off', () => {
  const settings = store(), routes = linkedinRoutes(settings, {keychain: keychain()});
  assert.equal(routes.session({}).ok, false);
  assert.equal(routes.session({cookies: [{name: 'bcookie', value: 'x', domain: '.linkedin.com'}]}).ok, false);
  assert.deepEqual(routes.pending(), {revoke: true, refresh: false});
});

test('the window\'s view has the state and the ask, never a cookie value', () => {
  const settings = store(), kc = keychain();
  assert.deepEqual(linkedinView(settings, {keychain: kc}), {on: false, asked: 0, declined: 0, ask: true, hasSession: false});
  linkedinRoutes(settings, {keychain: kc}).session({cookies: [{name: 'li_at', value: SECRET, domain: '.linkedin.com'}]});
  const view = linkedinView(settings, {keychain: kc});
  assert.deepEqual(view, {on: true, asked: 0, declined: 0, ask: false, hasSession: true});
  assert.equal(JSON.stringify(view).includes(SECRET), false);
});

test('registered handlers: demo mode touches no store, off deletes the item, the counters change only through the dialog\'s calls', async () => {
  const handlers = new Map(), routes = new Map(), ipcMain = {handle: (name, fn) => handlers.set(name, fn)}, server = {setVisitRoute: (path, fn) => routes.set(path, fn)};
  const settings = store(), kc = keychain();
  registerLinkedinHandlers({DEMO: false, ipcMain, server, storage: settings, openPage: async () => ({opened: true}), deps: {keychain: kc}});
  assert.deepEqual([...routes.keys()].sort(), ['/extension/linkedin-pending', '/extension/linkedin-refresh', '/extension/linkedin-session']);
  await handlers.get('linkedinJobsAsked')();
  await handlers.get('linkedinJobsAnswer')({}, 'not-now');
  assert.deepEqual((await handlers.get('linkedinJobsState')()).asked, 1);
  assert.equal((await handlers.get('linkedinJobsState')()).declined, 1);
  routes.get('/extension/linkedin-session')({cookies: [{name: 'li_at', value: SECRET, domain: '.linkedin.com'}]});
  assert.equal((await handlers.get('linkedinJobsState')()).on, true);
  await handlers.get('linkedinJobsOff')();
  assert.equal(kc.items.has(SERVICE), false);
  assert.equal((await handlers.get('linkedinJobsState')()).on, false);
  assert.deepEqual(await handlers.get('linkedinJobsConnect')(), {opened: true});
  const demo = new Map(); registerLinkedinHandlers({DEMO: true, ipcMain: {handle: (name, fn) => demo.set(name, fn)}, server, storage: {settings: () => { throw new Error('demo must not read the store'); }}, openPage: async () => { throw new Error('demo must not open Chrome'); }});
  assert.equal((await demo.get('linkedinJobsState')()).on, false);
  assert.deepEqual(await demo.get('linkedinJobsConnect')(), {opened: true});
  assert.deepEqual(await demo.get('linkedinJobsOff')(), {ok: true});
});

test("#2731 a Find jobs press asks, the extension's look hears it, its copy lands in the Keychain and the press goes on", async () => {
  const settings = store(), kc = keychain(), note = createRefresh(), routes = linkedinRoutes(settings, {keychain: kc, refresh: note});
  routes.session({cookies: [{name: 'li_at', value: SECRET, domain: '.linkedin.com'}]});
  assert.equal(routes.pending().refresh, false, 'nobody pressed: the look is only a look');
  const pressed = note.ask();   // the look just now made the extension "alive"
  assert.equal(routes.pending().refresh, true, 'the press is waiting: copy now');
  assert.deepEqual(routes.refresh({cookies: [{name: 'li_at', value: 'AQEDAR-fresh-value', domain: '.linkedin.com'}]}), {ok: true});
  assert.equal(await pressed, 'fresh');
  assert.equal(readSession({keychain: kc}).li_at, 'AQEDAR-fresh-value');
  assert.equal(routes.pending().refresh, false, 'asked once per press');
  settings.saveSettings({linkedinJobs: {on: false}});
  assert.deepEqual(routes.pending(), {revoke: true, refresh: false}, 'off never asks for a copy');
  assert.deepEqual(routes.refresh({held: false}), {ok: false, error: 'LinkedIn jobs is off'});
});
