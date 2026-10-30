// openRun reads the panel only after the run's log has been read from Notion: a run with "Reading from Notion…" as its log shows "Completed" while the list says "With warnings" (beta run 12, 24 Oct 2026, Mac + Linux).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';

test('the panel is read after its log stopped saying it is being read', () => {
  const source = fs.readFileSync(new URL('../lib/activity-steps.mjs', import.meta.url), 'utf8');
  const open = source.slice(source.indexOf('export async function openRun'), source.indexOf('const seen = await page.evaluate'));
  assert.match(open, /await waitForDetail\(ctx, id, untilResult\)/, 'openRun looks at the panel while its log is still being read');
  assert.match(source, /waitForFunction\([^]*Reading from Notion[^]*Waiting for the log/);
  const app = fs.readFileSync(new URL('../../renderer/pages/activity-render.js', import.meta.url), 'utf8');
  for (const words of ['Reading from Notion…', 'Waiting for the log from Notion…']) assert.ok(app.includes(words), `the app no longer says "${words}": update the wait in openRun`);
});
