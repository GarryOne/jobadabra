// LinkedIn jobs, PR 1/3 (spec docs/superpowers/specs/2026-10-31-linkedin-headless-design.md, "Chrome Web Store"): the extension reads only the LinkedIn sign-in cookies,
// only after the person's click on its own consent page, sends them only to the app, and gives its LinkedIn permissions back when the switch is off.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {LINKEDIN, connect, readCookies, revokeIfOff, startLinkedinSession} from '../../extension/linkedin-session.js';

const manifest = JSON.parse(fs.readFileSync(new URL('../../extension/manifest.json', import.meta.url), 'utf8'));
const JAR = [{name: 'li_at', value: 'AQEDfake', domain: '.linkedin.com', path: '/', secure: true, httpOnly: true}, {name: 'JSESSIONID', value: '"ajax:1"', domain: '.www.linkedin.com'},
  {name: 'bcookie', value: 'v=2&x', domain: '.linkedin.com'}, {name: 'lidc', value: 'b=1', domain: '.linkedin.com'}];
function fakeChrome({granted = true, held = false, jar = JAR} = {}) {
  const log = [];
  return {log, permissions: {request: async asked => { log.push(['request', asked]); return granted; }, contains: async asked => { log.push(['contains', asked]); return held; }, remove: async asked => { log.push(['remove', asked]); return true; }},
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
  assert.deepEqual(chrome.log.map(entry => entry[0]), ['request', 'getAll']);
  assert.deepEqual(chrome.log[0][1], LINKEDIN);
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

test('the minute look gives the permissions back only when the app says off; an app that does not answer takes nothing', async () => {
  const off = fakeChrome({held: true});
  assert.deepEqual(await revokeIfOff({config: {}, chrome: off, call: async () => ({revoke: true})}), {revoked: true});
  assert.deepEqual(off.log.at(-1), ['remove', LINKEDIN]);
  const on = fakeChrome({held: true});
  assert.deepEqual(await revokeIfOff({config: {}, chrome: on, call: async () => ({revoke: false})}), {revoked: false});
  assert.equal(on.log.some(entry => entry[0] === 'remove'), false);
  const silent = fakeChrome({held: true});
  assert.deepEqual(await revokeIfOff({config: {}, chrome: silent, call: async () => { throw new Error('app closed'); }}), {revoked: false});
  assert.equal(silent.log.some(entry => entry[0] === 'remove'), false);
  const none = fakeChrome({held: false});
  assert.deepEqual(await revokeIfOff({config: {}, chrome: none, call: async () => { throw new Error('must not call: nothing is held'); }}), {held: false});
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
