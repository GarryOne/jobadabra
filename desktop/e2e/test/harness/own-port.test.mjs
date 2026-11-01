// A launched test app always has its own port, never the production one (owner, 29 Oct 2026: a test app held 47111 for 27 h).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {DEFAULT_APP_PORT, freePort, ownPortEnv} from '../../lib/own-port.mjs';

test('a test app with no port named gets a free one that is not 47111; a named port is kept', async () => {
  for (let tries = 0; tries < 20; tries++) {
    const {JOB_PILOTTO_PORT} = await ownPortEnv({});
    assert.match(JOB_PILOTTO_PORT, /^\d+$/);
    assert.notEqual(Number(JOB_PILOTTO_PORT), DEFAULT_APP_PORT);
  }
  assert.deepEqual(await ownPortEnv({JOB_PILOTTO_PORT: '48123'}), {JOB_PILOTTO_PORT: '48123'});
  assert.notEqual(await freePort(), DEFAULT_APP_PORT);
});
