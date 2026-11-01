// LinkedIn refresh journey (#2731), registered by journeys.test.js so the shared scenario file stays within its size limit: the person's own session expires, they sign in again in Chrome, and
// the next Find jobs reads with the new session. Real path: the extension's minute look (extension/linkedin-session.js) -> the app's routes (lib/linkedin-handlers.js) -> Keychain -> the step.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {revokeIfOff} from '../../extension/linkedin-session.js';
import {linkedinRoutes} from '../lib/linkedin-handlers.js';
import {createRefresh} from '../lib/linkedin-refresh.js';
import {linkedinStep} from '../lib/linkedin-headless.js';
import * as session from '../lib/linkedin-session.js';

test('scenario: a LinkedIn session that expired, then Chrome signs in again: the next Find jobs reads with the new session, not the Keychain\'s old one (#2731)', async () => {
  const mine = {}, storage = {settings: () => mine, saveSettings: patch => Object.assign(mine, patch)}, items = new Map();
  const keychain = {write: (service, value) => { items.set(service, value); return true; }, read: service => items.get(service) || null, remove: service => items.delete(service)};
  const note = createRefresh(), routes = linkedinRoutes(storage, {keychain, refresh: note});
  routes.session({cookies: [{name: 'li_at', value: 'FAKE-expired-session', domain: '.linkedin.com'}]});   // the consent page copied it once, long ago
  const chromeJar = [{name: 'li_at', value: 'FAKE-new-session', domain: '.linkedin.com'}, {name: 'bcookie', value: 'x', domain: '.linkedin.com'}];   // the person signed in again in Chrome
  const chrome = {storage: {local: {get: async () => ({linkedinGranted: {cookies: true, origin: true}}), remove: async () => {}}}, permissions: {contains: async () => true}, cookies: {getAll: async () => chromeJar}};
  const call = async (config, path, init) => (path === '/extension/linkedin-pending' ? routes.pending() : routes.refresh(JSON.parse(init.body)));   // the loopback, without a socket
  await revokeIfOff({chrome, call, config: {}});   // an earlier minute look: the extension is alive
  const sets = [], browser = {ready: () => true, start: async () => ({}), send: async (method, params) => { if (method === 'Storage.setCookies') sets.push(params.cookies); return method === 'Target.createTarget' ? {targetId: 'T'} : {}; }};
  const step = linkedinStep({storage, browser, run: async () => [{jobs: 0, fits: 0}], end: () => {}, searches: async () => [{name: 'LinkedIn: role', url: 'https://www.linkedin.com/jobs/search/?keywords=role'}],
    readSession: () => session.readSession({keychain}), refresh: options => note.ask(options), port: 1, token: 't', pause: async () => {}, now: () => 0});
  await revokeIfOff({chrome, call, config: {}});   // the next minute look hears "copy now" and answers while the press waits
  assert.equal((await step).state, 'done');
  assert.equal(sets[0].find(cookie => cookie.name === 'li_at').value, 'FAKE-new-session', 'the hidden browser got the cookies Chrome holds now');
  assert.equal(JSON.stringify(sets).includes('expired'), false);
});
