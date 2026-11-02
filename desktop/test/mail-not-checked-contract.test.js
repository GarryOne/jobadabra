// The engine's words for "this Gmail check read nothing, and why" (src/ai/mail.py NOT_CHECKED, written into the run's Notion row) and the app's
// (lib/run-result.js MAIL_SKIPPED, its summary) are one list: a row's warning that says the summary again is dropped from its details (#314).
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import {MAIL_SKIPPED, MAIL_SKIPPED_OPENAI} from '../lib/run-result.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const python = process.env.JOBADABRA_CHECK_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');

test('the engine and the app say why a Gmail check read nothing in the same words', () => {
  const run = spawnSync(python, ['-c', 'import json; from src.ai import mail; print(json.dumps([mail.NOT_CHECKED, mail.NOT_CHECKED_OPENAI], ensure_ascii=False))'],
    {cwd: path.join(here, '../..'), encoding: 'utf8', env: {...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8'}});
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(JSON.parse(run.stdout), [MAIL_SKIPPED, MAIL_SKIPPED_OPENAI]);   // Claude's words and OpenAI's
});
