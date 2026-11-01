// An e2e suite never writes role_keywords on their own: the app keeps one list (target_roles, 8c8bd70) and derives role_keywords from it on every save,
// so a draft with only role_keywords loses them (beta run 7: strategy and quality failed that way). Every file here that writes them goes through lib/search-roles.mjs.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {withRoles} from '../lib/search-roles.mjs';
import {withDerived} from '../../lib/target-roles.js';

const E2E = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILES = ['suites', 'lib'].flatMap(dir => fs.readdirSync(path.join(E2E, dir)).filter(name => name.endsWith('.mjs')).map(name => path.join(E2E, dir, name)));
const OTHER_LANGUAGE = new Set([]);   // role_keywords inside a Python snippet, no draft

test('every suite or lib that writes role_keywords goes through withRoles', () => {
  const offenders = FILES.filter(file => {
    const source = fs.readFileSync(file, 'utf8');
    return !OTHER_LANGUAGE.has(path.basename(file)) && !file.endsWith('search-roles.mjs') && /\brole_keywords\s*:/.test(source.replace(/\/\/.*$/gm, '')) && !/\bwithRoles\b/.test(source);
  });
  assert.deepEqual(offenders.map(file => path.relative(E2E, file)), []);
});

test('withRoles survives the app deriving role_keywords from the settings it already holds', () => {
  const held = {target_roles: [{title: 'platform engineer', also: []}], role_keywords: ['platform engineer'], jobs_board_search_queries: ['platform engineer']};
  assert.deepEqual(withDerived({...held, ...withRoles(held, ['\\bsre\\b', 'site reliability'])}).role_keywords, ['\\bsre\\b', 'site reliability']);
});
