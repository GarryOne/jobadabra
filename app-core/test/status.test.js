import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatNotionRuns } from '../src/index.js';

test('/status lists the latest Notion runs, wherever they ran, the running one included', () => {
  const page = (url, props) => ({ url, properties: {
    Mode: { select: { name: props.mode } }, Status: { select: { name: props.status } }, Started: { date: { start: props.started } },
    Trigger: { select: { name: props.trigger } }, Summary: { rich_text: [{ plain_text: props.summary }] }, 'Run URL': { url: props.run || null } } });
  const text = formatNotionRuns([
    page('https://notion.so/a', { mode: 'run', status: 'Running', started: '2026-09-28T12:08:00Z', trigger: 'Manual', summary: '⏳ Scoring 12 new jobs', run: 'https://github.com/x' }),
    page('https://notion.so/b', { mode: 'insight', status: 'OK', started: '2026-09-28T11:00:00Z', trigger: 'Mac (you)', summary: 'Insight sent: Skills (AI cost $0.012)' }),
  ]);
  assert.match(text, /⏳ <a href="https:\/\/notion.so\/a">run<\/a> · 2026-09-28 12:08 UTC · GitHub\n⏳ Scoring 12 new jobs/);
  assert.match(text, /✅ <a href="https:\/\/notion.so\/b">insight<\/a> · 2026-09-28 11:00 UTC · Mac\nInsight sent: Skills$/);
  assert.equal(formatNotionRuns([]), 'No runs yet.');
});
