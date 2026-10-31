// Playwright's test runner for one suite (lib/report.mjs starts it with E2E_SUITE): only for the HTML report; the suite's logic stays in lib/suite-main.mjs.
// Local: an HTML report in the suite's artifacts folder. CI: a blob per suite (E2E_BLOB_DIR), merged into one report for the run by the workflow's report job.
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url)), E2E = path.resolve(HERE, '..');
const suite = process.env.E2E_SUITE || 'default';
const artifacts = process.env.E2E_ARTIFACTS || path.join(E2E, 'artifacts', suite);
const windows = process.platform === 'win32';
const reporter = process.env.CI ? [['blob', {outputDir: process.env.E2E_BLOB_TMP || path.join(E2E, 'blob-report'), fileName: `${windows ? 'windows-' : ''}${suite}${process.env.E2E_BROWSER ? `-${process.env.E2E_BROWSER}` : ''}.zip`}], ['line']]
    : [['html', {outputFolder: path.join(artifacts, 'report'), open: 'never'}], ['line']];

export default {
  testDir: HERE,
  testMatch: 'suite.spec.mjs',
  workers: 1,
  retries: 0,   // a suite has one try and it is the verdict (31 Oct 2026, owner)
  timeout: 0,   // the suite has its own budget and hard stop (lib/runner.mjs, suite.mjs)
  outputDir: path.join(os.tmpdir(), `jp-e2e-results-${suite}`),
  reporter,
};
