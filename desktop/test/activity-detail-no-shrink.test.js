// The Recent activity detail is a scrolling flex column: its boxes must not shrink (issue #119).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

test('children of .ap-detail keep their height instead of shrinking to a sliver', () => {
  const css = fs.readFileSync(path.join(here, '../renderer/style.css'), 'utf8');
  assert.match(css, /(\.activity-panel|:is\(\.activity-panel, \.actions-runs\)) \.ap-detail > \*\s*\{[^}]*flex-shrink:\s*0/);   // shared with Actions → Runs
});
