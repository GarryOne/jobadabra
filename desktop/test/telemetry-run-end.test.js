// A run that ends badly is reported as failed only when it failed: one stopped from outside is not (desktop/lib/telemetry-handlers.js runFailure).
// Why: 20 Oct 2026, private issues #28 and #34 were runs the person stopped, filed as failures with their last ordinary line as the error.
import test from 'node:test';
import assert from 'node:assert/strict';
import {runFailure} from '../lib/telemetry-handlers.js';

test('a run stopped from outside (no exit code, not the watchdog) is not a failed run', () => {
  assert.equal(runFailure({code: null, timedOut: false, tail: ['Enriched 100 of 100 job(s); 0 failed']}), null);
});

test('the watchdog and a non-zero exit are failed runs, with their error line', () => {
  assert.deepEqual(runFailure({code: 124, timedOut: 'no output for 16 min', tail: ['AI budget: $0.00']}),
    {error: 'stopped by the app: no output for 16 min', timedOut: 'no output for 16 min', cutOff: false});
  assert.equal(runFailure({code: 1, timedOut: false, tail: ['Traceback (most recent call last):', 'TypeError: x', 'done']}).error, 'TypeError: x');
  assert.equal(runFailure({code: null, timedOut: 'no output for 31 min', tail: []}).error, 'stopped by the app: no output for 31 min');
});

// Sentry 2C (24 Oct 2026): a store call keeps its stdout private, so a failure with a quiet stderr had an empty tail and the event read "run_failed · src.stores call:".
test('a failed run with no tail still says its error kind, never an empty error', () => {
  assert.equal(runFailure({code: 1, timedOut: false, tail: [], errorKind: 'OperationalError'}).error, 'OperationalError');
  assert.equal(runFailure({code: 1, timedOut: false, tail: []}).error, 'exit 1, no error line');
});

test('every captured kind gets a non-empty message, even from empty fields', async () => {
  const sentry = await import('../lib/sentry.js');
  for (const kind of sentry.CAPTURED) {
    for (const fields of [{}, {error: ''}, {message: ''}, {warning: ''}, {action: ''}, {error: '', message: '', job: 'src.stores call'}]) {
      const event = sentry.buildEvent(kind, fields, {});
      const text = event.message ?? event.exception.values[0].value;
      assert.ok(String(text).replace(/^[^:]*:\s*/, '').trim(), `${kind} ${JSON.stringify(fields)} -> "${text}"`);
    }
  }
});

test('a private run reports only the type of its failure, never the message', async () => {
  const {errorKindOf} = await import('../lib/pipeline-run.js');
  assert.equal(errorKindOf('{"error": "OperationalError: no such column ada@example.com"}\n'), 'OperationalError');
  assert.equal(errorKindOf('{"error": "not callable: events.put"}'), '');
  assert.equal(errorKindOf('garbage'), '');
});
