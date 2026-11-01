// LinkedIn jobs, PR 1/3 (spec docs/superpowers/specs/2026-10-31-linkedin-headless-design.md, "Chrome Web Store"): the extension reads only the LinkedIn sign-in cookies,
// only after the person's click on its own consent page, sends them only to the app, and gives its LinkedIn permissions back when the switch is off.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {LINKEDIN, connect, readCookies, refreshSession, revokeIfOff, startLinkedinSession} from '../../extension/linkedin-session.js';

const manifest = JSON.parse(fs.readFileSync(new URL('../../extension/manifest.json', import.meta.url), 'utf8'));
const JAR = [{name: 'li_at', value: 'AQEDfake', domain: '.linkedin.com', path: '/', secure: true, httpOnly: true}, {name: 'JSESSIONID', value: '"ajax:1"', domain: '.www.linkedin.com'},
  {name: 'bcookie', value: 'v=2&x', domain: '.linkedin.com'}, {name: 'lidc', value: 'b=1', domain: '.linkedin.com'}];
function fakeChrome({granted = true, had = {}, jar = JAR, stored = {}} = {}) {
  const log = [], store = {...stored};
  return {log, store, permissions: {request: async asked => { log.push(['request', asked]); return granted; }, remove: async asked => { log.push(['remove', asked]); return true; },
    contains: async asked => { log.push(['contains', asked]); return asked.permissions ? !!had.cookies : !!had.origin; }},
    storage: {local: {get: async key => ({[key]: store[key]}), set: async values => Object.assign(store, values), remove: async key => { delete store[key]; }}},
    cookies: {getAll: async filter => { log.push(['getAll', filter]); return jar; }}, alarms: {create: (name, info) => log.push(['alarm', name, info]), onAlarm: {addListener: fn => log.push(['listener', typeof fn])}}};
}

test('only li_at and JSESSIONID leave the cookie jar, with their host and nothing else', async () => {
  const chrome = fakeChrome();
  assert.deepEqual(await readCookies(chrome), [{name: 'li_at', value: 'AQEDfake', domain: '.linkedin.com'}, {name: 'JSESSIONID', value: '"ajax:1"', domain: '.www.linkedin.com'}]);
  assert.deepEqual(chrome.log.find(entry => entry[0] === 'getAll')[1], {domain: 'linkedin.com'});
});

test('a click on the consent page: Chrome\'s permission first, then the two cookies, then one POST to the app', async () => {
  const chrome = fakeChrome(), calls = [];
  const done = await connect({chrome, config: {x: 1}, call: async (config, path, init) => { calls.push({path, init}); return {ok: true}; }});
  assert.deepEqual(done, {ok: true});
  assert.deepEqual(chrome.log.map(entry => entry[0]).filter(kind => kind !== 'contains'), ['request', 'getAll']);
  assert.deepEqual(chrome.log.find(entry => entry[0] === 'request')[1], LINKEDIN);
  assert.deepEqual(chrome.store.linkedinGranted, {cookies: true, origin: true}, 'both grants were added by this consent');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, '/extension/linkedin-session');
  assert.deepEqual(JSON.parse(calls[0].init.body), {cookies: [{name: 'li_at', value: 'AQEDfake', domain: '.linkedin.com'}, {name: 'JSESSIONID', value: '"ajax:1"', domain: '.www.linkedin.com'}]});
});

test('not allowed, or not signed in to LinkedIn: nothing is read or sent, and the page says why', async () => {
  const denied = fakeChrome({granted: false});
  assert.deepEqual(await connect({config: {}, chrome: denied, call: async () => { throw new Error('must not call'); }}), {ok: false, why: 'denied'});
  assert.equal(denied.log.some(entry => entry[0] === 'getAll'), false, 'no cookie read without the permission');
  const signedOut = fakeChrome({jar: [JAR[2]]});
  assert.deepEqual(await connect({config: {}, chrome: signedOut, call: async () => { throw new Error('must not call'); }}), {ok: false, why: 'signed-out'});
});

test('the minute look gives back only what this consent added, and only when the app says off; an app that does not answer takes nothing', async () => {
  const off = fakeChrome({stored: {linkedinGranted: {cookies: true, origin: true}}});
  assert.deepEqual(await revokeIfOff({config: {}, chrome: off, call: async () => ({revoke: true})}), {revoked: true});
  assert.deepEqual(off.log.at(-1), ['remove', {permissions: ['cookies'], origins: ['https://www.linkedin.com/*']}]);
  assert.equal(off.store.linkedinGranted, undefined, 'the note is cleared with the grant');
  const on = fakeChrome({stored: {linkedinGranted: {cookies: true, origin: true}}});
  assert.deepEqual(await revokeIfOff({config: {}, chrome: on, call: async () => ({revoke: false})}), {revoked: false});
  assert.equal(on.log.some(entry => entry[0] === 'remove'), false);
  const silent = fakeChrome({stored: {linkedinGranted: {cookies: true, origin: true}}});
  assert.deepEqual(await revokeIfOff({config: {}, chrome: silent, call: async () => { throw new Error('app closed'); }}), {revoked: false});
  assert.equal(silent.log.some(entry => entry[0] === 'remove'), false);
});

test('Gitar on #2694: cookies the options page (Open in my browser) or every-site access already held are never taken back', async () => {
  const chrome = fakeChrome({had: {cookies: true, origin: true}});
  await connect({config: {}, chrome, call: async () => ({ok: true})});
  assert.deepEqual(chrome.store.linkedinGranted, {cookies: false, origin: false}, 'nothing was added by this consent');
  const quiet = await revokeIfOff({config: {}, chrome, call: async () => ({revoke: true})});   // #2731: this consent still looks (for a refresh); an "off" answer takes nothing it did not add
  assert.deepEqual(quiet, {revoked: true});
  assert.equal(chrome.log.some(entry => entry[0] === 'remove'), false);
  assert.equal(chrome.store.linkedinGranted, undefined);
  const partly = fakeChrome({had: {cookies: true, origin: false}});
  await connect({config: {}, chrome: partly, call: async () => ({ok: true})});
  assert.deepEqual(await revokeIfOff({config: {}, chrome: partly, call: async () => ({revoke: true})}), {revoked: true});
  assert.deepEqual(partly.log.at(-1), ['remove', {origins: ['https://www.linkedin.com/*']}], 'only the origin this consent added');
  const never2 = fakeChrome();
  assert.deepEqual(await revokeIfOff({config: {}, chrome: never2, call: async () => { throw new Error('no consent ever happened here: no call'); }}), {held: false});
});

test('the look starts one alarm a minute, and the manifest declares the origin and keeps cookies optional', () => {
  const chrome = fakeChrome();
  startLinkedinSession({chrome});
  assert.deepEqual(chrome.log.find(entry => entry[0] === 'alarm').slice(1), ['linkedin-session', {delayInMinutes: 1, periodInMinutes: 1}]);
  assert.ok(manifest.optional_host_permissions.includes('https://www.linkedin.com/*'), 'the exact origin is declared, so a reviewer sees it');
  assert.ok(manifest.optional_permissions.includes('cookies'));
  assert.equal((manifest.permissions || []).includes('cookies'), false, 'cookies is never a required permission');
  assert.equal((manifest.host_permissions || []).some(host => /linkedin/.test(host)), false, 'no required host access to LinkedIn');
});

test('the consent page shows the warning line and what is read before the button, and has no inline script', () => {
  const html = fs.readFileSync(new URL('../../extension/linkedin.html', import.meta.url), 'utf8');
  assert.ok(html.includes('LinkedIn may limit accounts it thinks are automated; we read slowly and only your job searches.'));
  assert.ok(html.indexOf('li_at') < html.indexOf('id="allow"'), 'what is read is told before the button');
  assert.ok(html.includes('127.0.0.1') && html.includes('Keychain'));
  assert.equal(/<script(?![^>]*src=)/.test(html), false, 'Chrome extension pages allow no inline script');
});

test('#2731 a Find jobs press wants a fresh copy: the look sends the two cookies again, to the app only, and never asks for a permission', async () => {
  const chrome = fakeChrome({had: {cookies: true, origin: true}, stored: {linkedinGranted: {cookies: true, origin: true}}}), calls = [];
  const answer = await revokeIfOff({config: {}, chrome, call: async (config, path, init) => { calls.push({path, body: init.body}); return path === '/extension/linkedin-pending' ? {revoke: false, refresh: true} : {ok: true}; }});
  assert.deepEqual(answer, {revoked: false});
  assert.deepEqual(calls.map(call => call.path), ['/extension/linkedin-pending', '/extension/linkedin-refresh']);
  assert.deepEqual(JSON.parse(calls[1].body), {cookies: [{name: 'li_at', value: 'AQEDfake', domain: '.linkedin.com'}, {name: 'JSESSIONID', value: '"ajax:1"', domain: '.www.linkedin.com'}]});
  assert.equal(chrome.log.some(entry => entry[0] === 'request' || entry[0] === 'remove'), false, 'a refresh never asks for or gives back a permission');
  const plain = [];
  await revokeIfOff({config: {}, chrome: fakeChrome({stored: {linkedinGranted: {cookies: true, origin: true}}}), call: async (config, path) => { plain.push(path); return {revoke: false, refresh: false}; }});
  assert.deepEqual(plain, ['/extension/linkedin-pending'], 'no press, no cookie read');
});

test('#2731 refresh: signed out in Chrome sends an empty list; a grant the person took back sends only {held: false} and reads no cookie', async () => {
  const bodies = [], call = async (config, path, init) => { bodies.push(JSON.parse(init.body)); return {ok: true}; };
  await refreshSession({config: {}, chrome: fakeChrome({had: {cookies: true, origin: true}, jar: [JAR[2]]}), call});
  assert.deepEqual(bodies[0], {cookies: []}, 'only li_at and JSESSIONID count: bcookie is not sent');
  const gone = fakeChrome({had: {cookies: false, origin: false}});
  await refreshSession({config: {}, chrome: gone, call});
  assert.deepEqual(bodies[1], {held: false});
  assert.equal(gone.log.some(entry => entry[0] === 'getAll'), false, 'no cookie read without the grants');
});
