// Actions keyed on a Notion page, on a store without pages (9 Oct 2026 sweep): each falls back to the app's own view instead of doing
// nothing or opening something else. Read from the source (these pages need a window); the parity scan covers the Notion side.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';

const read = file => fs.readFileSync(new URL(`../renderer/pages/${file}`, import.meta.url), 'utf8');

test('Interviews find their job by the store\'s id too', () => {
  // The matching itself is pure and tested on a SQLite-shaped list: test/jobs-view-interview.test.js.
  assert.match(read('interview-lists.js'), /jobForPage = pageId => jobOfApplication\(jobList\(\), pageId\)/);
});

test('In conversation opens the job\'s page; a mail card\'s job and a ready prep kit open it too', () => {
  assert.match(read('jobs-talking.js'), /job\.notion_url \? window\.pilot\.openNotion\(job\.notion_url, event\.metaKey\) : openJobPanel\(job\)\)/);
  const mail = read('activity-mail.js');
  assert.match(mail, /if \(kitReady\.has\(id\)\) return \{label: 'Open prep kit', run: event => \(found\.notion_url \? .* : \(openView\('jobs'\), openJobPanel\(found, 'prep'\)\)\)\}/);
  assert.match(mail, /else if \(found\.page_id\) \{ openView\('jobs'\); openJobPanel\(found\); \}/);
});

test('Focus: a ready prep kit and a reply/booking item open the job\'s page without Notion', () => {
  const focus = read('focus.js');
  assert.match(focus, /run === 'open' \? event => \(item\.notion_url \? openLink\(item\.notion_url, event\) : \(openView\('jobs'\), openJobPanel\(jobOf\(\), 'prep'\)\)\)/);
  assert.match(focus, /\(item\.notion_url \|\| item\.job_url\)\) \{\n    actions\.append\(focusButton\('Open'/);
  assert.match(focus, /primary\.run === 'open' \? event => \(item\.notion_url \? window\.pilot\.openNotion\(item\.notion_url, event\?\.metaKey\)\n      : \(openView\('jobs'\), openJobPanel\(/);
});

test('Focus\'s full funnel link opens Reports → Funnel without a Notion page; the prep dialog opens the kit on the job\'s page', () => {
  const focus = read('focus.js');
  assert.match(focus, /full\.textContent = funnel\.notion_url \? full\.dataset\.notionLabel : 'Open in Reports';\n  show\(full, true\);/);
  assert.match(focus, /else \{ openView\('reports'\); loadReports\('funnel'\); \}/);
  const prep = read('prep.js');
  assert.match(prep, /show\(\$\('prep-open'\), !!\(current\.notion_url \|\| jobUrl\)\)/);
  assert.match(prep, /openJobPanel\(\{url, title: current\.job, company: current\.company \|\| current\.via\}, 'prep'\)/);
  assert.match(read('activity-mail.js'), /notion_url: found\.notion_url, url: found\.url, badge: ''/);
});
