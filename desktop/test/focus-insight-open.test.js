// Focus → Suggestions: today's insight, Your week and a rejection lesson open their page when the store has one, else the same thing in the app:
// an insight in Reports (the weekly report on Weekly), a rejection on its job's Review tab. Never a missing button on a store without pages.
// (Was the Insight card's button, pages/focus.js renderInsight, until Suggestions replaced the card: 28 Oct 2026.)
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';

const page = fs.readFileSync(new URL('../renderer/pages/focus-suggestions.js', import.meta.url), 'utf8');
const run = page.slice(page.indexOf('export const RUN = {'), page.indexOf('\n};', page.indexOf('export const RUN = {')));
const engine = fs.readFileSync(new URL('../../src/suggestions.py', import.meta.url), 'utf8');

test('the button is drawn for every insight with somewhere to go, not only with a Notion page', () => {
  assert.match(run, /open_insight: \(action, event\) => \(action\.link \? openLink\(action\.link, event\) : \(openView\('reports'\), loadReports\('insights'\)\)\)/);
  assert.match(run, /read_week: \(action, event\) => \(action\.link \? openLink\(action\.link, event\) : \(openView\('reports'\), loadReports\('weekly'\)\)\)/);
  assert.match(run, /: \(openView\('jobs'\), openJobPanel\(\{url: action\.url, title: action\.title, company: action\.company\}, 'review'\)\)\)/);
  // Every entry draws its buttons, whatever its link: the engine always gives today's insight, Your week and a rejection one.
  assert.match(page, /for \(const \[i, action\] of entry\.actions\.entries\(\)\)/);
  for (const action of ["'do': 'open_insight', 'link'", "'do': 'read_week', 'link'", "'do': 'open_rejection', 'link'"]) assert.ok(engine.includes(action), action);
});
