// The offline app answers a sign-in page from an item that exists and never makes one (lib/offline-site-password.mjs). Pure: a fake storage and fake Keychain reads.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {offlineSitePassword} from '../../lib/offline-site-password.mjs';

const storage = () => ({settings: () => ({siteAccounts: {}})});

test('a seeded item is the account to sign in with, with ITS email, whatever the applicant\'s email is and whichever host the posting is on (Adnovum: posting on one host, login on another)', async () => {
  const answer = async (applicantEmail, itemEmail, peek = false) => {
    const handler = offlineSitePassword(storage(), {read: () => ({ok: true, password: 'pw-1234'}), emailOf: () => itemEmail, email: async () => ({email: applicantEmail})});
    return handler({host: 'login.other-host.example.test', peek});
  };
  const same = await answer('me+jp@x.test', 'me+jp@x.test');
  assert.deepEqual([same.mode, same.password, same.email], ['sign-in', 'pw-1234', 'me+jp@x.test']);
  const fake = await answer('ada.tester@example.test', 'me+jp@x.test');   // the applicant's fake email: the account is still signed in with, under its own email
  assert.deepEqual([fake.mode, fake.password, fake.email], ['sign-in', 'pw-1234', 'me+jp@x.test']);
  assert.deepEqual(await answer('ada.tester@example.test', 'me+jp@x.test', true), {ok: true, mode: 'sign-in', email: 'me+jp@x.test'});
});

test('no item: not ok, nothing made, and a peek only says the mode', async () => {
  const handler = offlineSitePassword(storage(), {read: () => ({ok: false}), emailOf: () => '', email: async () => ({email: 'a@x.test'})});
  assert.deepEqual(await handler({host: 'x.example.test'}), {ok: false});
  assert.deepEqual(await handler({host: 'x.example.test', peek: true}), {ok: true, mode: 'sign-up', email: 'a@x.test'});
});
