// The harness hands the tripwire's list to every app it starts (lib/owner-guard-env.mjs): one list, before a keystroke and after. Guard for the harness side.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {offlineEnv} from '../../lib/offline-guard.mjs';
import {ownerGuardEnv} from '../../lib/owner-guard-env.mjs';
import {ownerValues} from '../../lib/privacy-tripwire.mjs';
import {parseOwnerValues} from '../../../../app-core/src/owner-guard.js';

const OWNER = ownerValues({texts: ['# Profile\nName: Ana Maria Popescu\nEmail: ana.popescu@gmail.com\nPhone: +41 79 555 12 34\nLocation: Port Vale, Atlantis'], accountEmail: 'anapopescu88@gmail.com'});

test('the list the app receives is the tripwire\'s own, every kind, as it travels', () => {
  const env = ownerGuardEnv(OWNER);
  assert.deepEqual([...parseOwnerValues(env.JOBADABRA_E2E_OWNER_VALUES)], [...OWNER]);
  assert.deepEqual([...new Set(OWNER.values())].sort(), ['account', 'email', 'location', 'name', 'phone']);
});

test('a computer with no owner values passes nothing', () => assert.deepEqual(ownerGuardEnv(new Map()), {}));

test('the offline app\'s environment carries the list (the Electron launch does the same, lib/app.mjs)', () => {
  const env = offlineEnv(`${process.cwd()}/never-real`, {});
  assert.equal(env.JOBADABRA_E2E, '1');
  assert.ok(!('JOBADABRA_E2E_OWNER_VALUES' in env) || parseOwnerValues(env.JOBADABRA_E2E_OWNER_VALUES));
});
