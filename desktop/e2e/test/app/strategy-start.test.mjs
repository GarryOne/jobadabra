// The strategy suite's start state survives the app's own save: role_keywords are derived from target_roles (8c8bd70), so the draft must carry both.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {sqliteStart} from '../strategy-start.mjs';
import {withRoles} from '../../lib/search-roles.mjs';
import {withDerived} from '../../../lib/target-roles.js';

const current = {target_roles: [{title: 'platform engineer', also: []}], role_keywords: ['platform engineer'], jobs_board_search_queries: ['platform engineer'], locations: {}};

test('the start state keeps its roles after the app derives role_keywords from target_roles', () => {
  const saved = withDerived({...current, ...sqliteStart(current, {}).search});
  assert.deepEqual(saved.role_keywords, ['data analyst', 'business intelligence', '\\bbi\\b', 'analytics engineer', 'reporting analyst']);
});

test('a role swapped through withRoles is what the app keeps', () => {
  const saved = withDerived({...current, ...withRoles(current, ['zebra wrangler'])});
  assert.deepEqual(saved.role_keywords, ['zebra wrangler']);
});
