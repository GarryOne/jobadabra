// Always on gives the GitHub repo the Google sign-in too (lib/google-keys.js, lib/github.js payload).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {googleSecrets} from '../lib/google-keys.js';
import * as github from '../lib/github.js';

test('the Google sign-in is read whole or not at all', () => {
  const all = {'jobadabra.google.client-id': 'id', 'jobadabra.google.client-secret': 'secret', 'jobadabra.google.refresh-token': 'token'};
  assert.deepEqual(googleSecrets(service => all[service] || ''), {GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'secret', GOOGLE_REFRESH_TOKEN: 'token'});
  assert.deepEqual(googleSecrets(service => (service.endsWith('refresh-token') ? '' : all[service])), {});
});

test('the allowed parts go with the sign-in when known, and are left out when not', () => {
  const all = {'jobadabra.google.client-id': 'id', 'jobadabra.google.client-secret': 'secret', 'jobadabra.google.refresh-token': 'token', 'jobadabra.google.scopes': 'gmail'};
  assert.equal(googleSecrets(service => all[service] || '').GOOGLE_SCOPES, 'gmail');
  assert.ok(!('GOOGLE_SCOPES' in googleSecrets(service => (service.endsWith('scopes') ? '' : all[service]))));
});

test('Always on sends the extra secrets (the Google sign-in) with the app\'s own keys', () => {
  const storage = {settings: () => ({}), saveSettings: () => {}, secret: name => (name === 'NOTION_TOKEN' ? 'ntn' : ''), readText: () => ''};
  github.setExtraSecrets(() => ({GOOGLE_REFRESH_TOKEN: 'token', GOOGLE_CLIENT_ID: ''}));
  try {
    const {secrets} = github.payload(storage);
    assert.equal(secrets.GOOGLE_REFRESH_TOKEN, 'token');
    assert.equal(secrets.NOTION_TOKEN, 'ntn');
    assert.ok(!('GOOGLE_CLIENT_ID' in secrets));  // empty values are not sent
  } finally { github.setExtraSecrets(() => ({})); }
});

test("an installed app pins the user's repo to its own release (workflow and code); a source checkout keeps main", () => {
  const storage = {settings: () => ({}), saveSettings: () => {}, secret: () => '', readText: () => ''};
  github.setEngineRef('desktop-v0.4.1');
  try {
    const daily = github.payload(storage).files['.github/workflows/daily.yml'];
    assert.match(daily, /uses: GarryOne\/jobadabra\/\.github\/workflows\/daily\.yml@desktop-v0\.4\.1/);
    assert.match(daily, /code_ref: desktop-v0\.4\.1/);
    assert.doesNotMatch(daily, /@main|code_ref: main/);
  } finally { github.setEngineRef('main'); }
  assert.match(github.payload(storage).files['.github/workflows/mail.yml'], /mail\.yml@main[\s\S]*code_ref: main/);
});
