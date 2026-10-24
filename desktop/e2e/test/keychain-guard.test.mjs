// lib/keychain-guard.mjs: the run's proof that the owner's real Keychain was not touched (names and dates only, never a secret).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {guarded, keychainChanges, parseItems, snapshot} from '../lib/keychain-guard.mjs';

const item = (service, date) => `keychain: "/Users/x/Library/Keychains/login.keychain-db"\nversion: 512\nclass: "genp"\nattributes:\n    "acct"<blob>="job-pilotto"\n    "mdat"<timedate>=0x32303236313030383134303533345A00  "${date}\\000"\n    "svce"<blob>="${service}"\n`;
const dump = items => items.map(([service, date]) => item(service, date)).join('');

test('only Jobadabra items, by service and modification date', () => {
  const items = parseItems(dump([['job-pilotto.sites.password', '20261008140534Z'], ['other.app.token', '20261001000000Z']]));
  assert.deepEqual([...items], [['job-pilotto.sites.password', '20261008140534Z']]);
});

test('an added, modified or removed item is named; an untouched Keychain says nothing', () => {
  const before = new Map([['job-pilotto.sites.password', '20261008140534Z'], ['job-pilotto.career5.successfactors.eu.password', '20260928000000Z']]);
  assert.deepEqual(keychainChanges(before, new Map(before)), []);
  const after = new Map([['job-pilotto.sites.password', '20261009010000Z'], ['job-pilotto.e2e.recruitee.com.password', '20261009010000Z']]);
  assert.deepEqual(keychainChanges(before, after), ['job-pilotto.sites.password: modified (20261008140534Z -> 20261009010000Z)',
    'job-pilotto.e2e.recruitee.com.password: added (20261009010000Z)', 'job-pilotto.career5.successfactors.eu.password: removed']);
});

test('a Mac outside CI only; never asks for a secret (no -d, no -w)', () => {
  assert.equal(guarded({}, 'darwin'), true);
  assert.equal(guarded({CI: 'true'}, 'darwin'), false);
  assert.equal(guarded({}, 'linux'), false);
  let args = null;
  snapshot({env: {}, platform: 'darwin', exec: (_, given) => { args = given; return ''; }});
  assert.deepEqual(args, ['dump-keychain']);
});
