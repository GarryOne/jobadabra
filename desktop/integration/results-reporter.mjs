// A node:test reporter that writes one JSON result file for /admin/operations/integrations (owner, 1 Nov 2026): {v: 1, layer, platform, ms, tests: [{name, file, ok, ms, failure?}]}.
// Used with `--test-reporter=./integration/results-reporter.mjs --test-reporter-destination=<file>` beside the readable reporter; INTEGRATION_LAYER and INTEGRATION_PLATFORM name the job.
// A suite is not a test, a skipped test is not counted, and the parent of a failing subtest is left out (the subtest is listed itself). Guard: desktop/test/integration-results-reporter.test.js.
import path from 'node:path';

// Repo-relative whatever the working folder is (desktop/ for the app layer, desktop/e2e/ for the others): from the last /desktop/ segment on.
const repoPath = file => { const full = String(file || '').split(path.sep).join('/'), at = full.lastIndexOf('/desktop/'); return at >= 0 ? full.slice(at + 1) : full; };

const first = text => String(text || '').split('\n').find(line => line.trim()) || '';

export default async function* results(source) {
  const started = Date.now(), tests = [];
  for await (const {type, data} of source) {
    if (type !== 'test:pass' && type !== 'test:fail') continue;
    if (data.details?.type === 'suite' || data.skip || data.todo) continue;
    const error = data.details?.error;
    if (type === 'test:fail' && error?.code === 'ERR_TEST_FAILURE' && /subtests? failed/.test(error.message || '')) continue;
    tests.push({name: data.name, file: repoPath(data.file), ok: type === 'test:pass', ms: Math.round(data.details?.duration_ms || 0),
      ...(type === 'test:fail' ? {failure: first(error?.cause?.message || error?.message || String(error || '')).slice(0, 220)} : {})});
  }
  yield `${JSON.stringify({v: 1, layer: process.env.INTEGRATION_LAYER || 'app', platform: process.env.INTEGRATION_PLATFORM || process.platform, ms: Date.now() - started, tests})}\n`;
}
