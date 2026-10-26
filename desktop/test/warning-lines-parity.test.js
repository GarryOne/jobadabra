// The panel (renderer/run-warnings.js) and the engine (src/warning_lines.py) call the same lines warnings: one list of cases, read by both (tests/test_warning_lines.py).
// A run that logs a warning the engine does not record shows "Completed" in the list and "Completed with warnings" in the panel (beta 2, 25 Oct 2026).
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {runWarnings} from '../renderer/run-warnings.js';

const {cases} = JSON.parse(readFileSync(new URL('../../tests/fixtures/warning_lines.json', import.meta.url), 'utf8'));

test('the panel calls exactly the fixture lines warnings that the engine records', () => {
  for (const {line, warning} of cases) assert.equal(runWarnings([line]).length > 0, warning, line);
});
