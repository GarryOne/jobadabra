// The fake Google serves the fixture emails in the Gmail API's shape and refuses a revoked sign-in like Google does.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {gmailMessage, startGoogleFake} from '../../lib/google-fake.mjs';

test('an email becomes a Gmail message with headers and a base64url body', () => {
  const message = gmailMessage('e1', {from: 'a@b.test', subject: 'Hi', body: 'Thanks for applying'});
  assert.equal(message.payload.headers.find(item => item.name === 'Subject').value, 'Hi');
  assert.equal(Buffer.from(message.payload.body.data, 'base64url').toString(), 'Thanks for applying');
});

test('token, list, read and calendar answer; a revoked sign-in is invalid_grant', async () => {
  const fake = await startGoogleFake({emails: [{from: 'x@y.test', subject: 'S', body: 'B'}]});
  try {
    const token = await fetch(`${fake.url}/oauth2.googleapis.com/token`, {method: 'POST', body: 'grant_type=refresh_token'});
    assert.equal((await token.json()).access_token, 'e2e-access');
    const list = await (await fetch(`${fake.url}/gmail.googleapis.com/gmail/v1/users/me/messages?q=newer_than:2d`)).json();
    assert.deepEqual(list.messages.map(item => item.id), ['e2e1']);
    assert.equal((await (await fetch(`${fake.url}/gmail.googleapis.com/gmail/v1/users/me/messages/e2e1?format=full`)).json()).id, 'e2e1');
    assert.deepEqual((await (await fetch(`${fake.url}/www.googleapis.com/calendar/v3/calendars/primary/events`)).json()).items, []);
    fake.revoke();
    const refused = await fetch(`${fake.url}/oauth2.googleapis.com/token`, {method: 'POST'});
    assert.equal(refused.status, 400);
    assert.equal((await refused.json()).error, 'invalid_grant');
    assert.equal(fake.stats.read, 1);
  } finally { await fake.close(); }
});
