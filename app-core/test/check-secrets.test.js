// A deploy that leaves the Worker without the secrets its schedules need fails (5-6 Oct 2026: a fresh Worker had none, and every scheduled start was refused).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {missing, REQUIRED} from '../scripts/check-secrets.mjs';

test('the schedules\' secrets are named when missing', () => {
  assert.deepEqual(missing([]), Object.keys(REQUIRED));
  assert.deepEqual(missing(['GITHUB_TOKEN', 'TELEGRAM_BOT_TOKEN', 'OWNER_CHAT_ID', 'OTHER']), []);
  assert.deepEqual(missing(['TELEGRAM_BOT_TOKEN', 'OWNER_CHAT_ID']), ['GITHUB_TOKEN']);
});
