// The strategy tests name the Search settings page's sections as the product writes them (src/notion/search_settings.py SECTIONS): 8c8bd70 renamed
// "Roles to look for" to "Target roles" and the e2e suite kept the old heading (beta run 9, 22 Oct: "still lacks Roles to look for").
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {START} from './strategy-start.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const headings = [...fs.readFileSync(path.join(ROOT, 'src', 'notion', 'search_settings.py'), 'utf8').matchAll(/^\s+\('([^']+)', '(?:search|preferences)',/gm)].map(match => match[1]);
const read = (...parts) => fs.readFileSync(path.join(ROOT, 'desktop', ...parts), 'utf8').replace(/\/\/.*$/gm, '');
// The Notion strategy test and the 3 journey steps that stay in the e2e suite (suites/strategy.mjs) both name page sections.
const suite = [read('integration', 'store', 'strategy-notion-integration.test.mjs'), read('e2e', 'suites', 'strategy.mjs')].join('\n');

test('every section the strategy tests start from is a heading the page has', () => {
  assert.ok(headings.length > 15, 'read the page\'s headings');
  assert.deepEqual(Object.keys(START).filter(name => !headings.includes(name)), []);
});

test('every section the Notion strategy test and the e2e suite read or set on the page by name is a heading the page has', () => {
  const named = [...suite.matchAll(/(?:notion|before|found|page|after)\['([^']+)'\]|setSection\([^,]+,[^,]+,\s*'([^']+)'/g)].map(match => match[1] || match[2]);
  assert.ok(named.length >= 3, 'found the test\'s section names');
  assert.deepEqual([...new Set(named)].filter(name => !headings.includes(name)), []);
});
