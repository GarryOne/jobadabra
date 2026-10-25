// The list pill, the Recent activity header pill and the Actions result card's pill come from one function (runPill): a run that worked but warned reads
// "With warnings" in all three, for every way an AI provider can fail and for Claude and OpenAI runs alike (18 Oct 2026: the beta run's OpenAI rate-limit turn was
// "With warnings" in the list and plain "Completed" in the result card).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {runPill, runStatus, runWarned} from '../renderer/run-status.js';
import {activitySource} from './activity-source.js';

const FAILURE_MODES = {
  'rate limit': 'Warning: API unavailable (RateLimitError), 3 job(s) left for the next check',
  'server error': 'Warning: API unavailable (InternalServerError: HTTP Error 500), 3 job(s) not scored',
  'invalid key': 'Warning: AI key refused (AuthenticationError), 3 job(s) not read by AI',
  'no credit': 'AI limit reached: credit balance is too low, 3 job(s) not scored',
};
// How each engine family leaves its trace: the warning only in the log, only in the page's report, or only as the row's flag.
const ENGINES = {
  claude: warning => ({ok: true, kind: 'search', log: ['Searching job boards', warning]}),
  openai: warning => ({ok: true, kind: 'search', warned: false, log: ['OpenAI: retrying (attempt 3 of 3)', warning]}),
  'openai, report only': warning => ({ok: true, kind: 'search', warned: false, log: ['See the run page'], report: [warning]}),
  'row flag only': () => ({ok: true, kind: 'search', warned: true, log: []}),
};

test('every failure mode × engine: the list pill, the header pill and the result card pill agree', () => {
  for (const [mode, line] of Object.entries(FAILURE_MODES)) {
    for (const [engine, make] of Object.entries(ENGINES)) {
      const run = make(line);
      const where = `${mode} / ${engine}`;
      assert.equal(runWarned(run), true, `${where}: warned`);
      const list = runPill(run), header = runPill(run, {long: true});
      assert.deepEqual(list.slice(0, 2), ['With warnings', 'warn'], where);
      assert.deepEqual(header.slice(0, 2), ['Completed with warnings', 'warn'], where);
      assert.deepEqual(list.slice(0, 2), runStatus(run, runWarned(run)).slice(0, 2), `${where}: the list's own call`);
    }
  }
});

test('a clean run is Completed everywhere; a failed one is not warned', () => {
  assert.deepEqual(runPill({ok: true, new: 2, log: ['Searching']}, {long: true}).slice(0, 2), ['Completed', 'good']);
  assert.deepEqual(runPill({ok: true, log: ['Searching']}, {long: true}).slice(0, 2), ['No result', 'neutral'], 'nothing saved is not Completed (owner, 25 Oct 2026)');
  assert.deepEqual(runPill({ok: false, log: ['Warning: x']}).slice(0, 2), ['Failed', 'bad']);
});

test('no screen draws a finished run\'s pill by hand: they all call runPill', () => {
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../renderer/pages');
  const source = activitySource() + fs.readFileSync(path.join(dir, 'runs-page.js'), 'utf8');
  assert.equal((source.match(/runPill\(/g) || []).length >= 3, true, 'list, header and result card call runPill');
  assert.equal(/\['Completed', 'good'\]/.test(source), false, 'a hand-written Completed pill');
  assert.equal(/\bruns?Status\(/.test(source), false, 'a screen calls runStatus directly instead of runPill');
});
