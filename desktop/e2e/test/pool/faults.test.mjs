// A step that breaks a service on purpose proves something only if the service then failed (#306: a kit-draft failure that never fired was filed as a product bug).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {startAiProxy} from '../../lib/ai-proxy.mjs';
import {startGoogleFake} from '../../lib/google-fake.mjs';
import {faultCheck, NEVER_FIRED, tally} from '../../lib/faults.mjs';
import {createRunner} from '../../lib/runner.mjs';

test('the runner says when a step armed a fault that never fired, and only then', async () => {
  const proxy = await startAiProxy(), google = await startGoogleFake();
  try {
    const runner = createRunner(() => null, {keepGoing: true, faultTally: () => tally([proxy, google])});
    const call = () => fetch(`${proxy.url}/v1/messages`, {method: 'POST', body: '{}'}).then(answer => answer.text());
    await runner.run('armed, served, failed', async () => { proxy.setMode('server-error'); await call(); proxy.setMode('pass'); throw new Error('the card said Completed'); });
    await runner.run('armed, never served, failed', async () => { proxy.setMode('server-error'); proxy.setMode('pass'); throw new Error('a form was opened'); });
    await runner.run('armed, never served, passed', async () => { google.revoke(); google.pass(); });
    await runner.run('google revoked and asked', async () => { google.revoke(); await fetch(`${google.url}/oauth2.googleapis.com/token`, {method: 'POST'}); google.pass(); });
    await runner.run('no fault, failed', async () => { throw new Error('plain failure'); });
    await runner.run('flagged faults, nothing armed, failed', async () => { throw new Error('flagged'); }, {faults: true});
    const [served, unserved, vacuous, asked, plain, flagged] = runner.results;
    assert.equal(served.note, 'the card said Completed');
    assert.match(unserved.note, /^a form was opened \[harness check: the fault this step set up never fired/);
    assert.equal(unserved.faultNeverFired, true);
    assert.equal(vacuous.status, 'passed');
    assert.equal(vacuous.faultNeverFired, true);
    assert.equal(asked.faultNeverFired, undefined);
    assert.equal(plain.note, 'plain failure');
    assert.ok(flagged.note.includes(NEVER_FIRED));
  } finally { await proxy.close(); await google.close(); }
});

test('faultCheck: armed during the step (or a faults step) and nothing served', () => {
  assert.equal(faultCheck({armed: 0, failed: 0}, {armed: 1, failed: 0}), NEVER_FIRED);
  assert.equal(faultCheck({armed: 0, failed: 0}, {armed: 1, failed: 2}), '');
  assert.equal(faultCheck({armed: 1, failed: 0}, {armed: 1, failed: 0}), '');
  assert.equal(faultCheck({armed: 1, failed: 0}, {armed: 1, failed: 0}, {faults: true}), NEVER_FIRED);
  assert.equal(faultCheck(undefined, undefined), '');
});
