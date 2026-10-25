// A changed e2e helper runs the suites that import it (beta of 25 Oct 2026: #1941 changed lib/apply-cv-steps.mjs and activity-states.mjs, and the PR run skipped apply and cardstates).
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import {suitesUsing} from '../lib/import-graph.mjs';
import {suitesFor} from '../lib/plan.mjs';

const files = {
  'suites/a.mjs': "import {x} from '../lib/one.mjs';", 'suites/b.mjs': "import {y} from '../two.mjs';", 'suites/c.mjs': "import '../lib/shared.mjs';",
  'lib/one.mjs': "import {z} from './deep.mjs';", 'lib/deep.mjs': '', 'two.mjs': "import {z} from './lib/deep.mjs';", 'lib/shared.mjs': '', 'lib/unused.mjs': '',
};

test('a helper reaches the suites that import it, directly or through another helper', () => {
  const used = suitesUsing('', files);
  assert.deepEqual(used['lib/deep.mjs'].sort(), ['a', 'b']);
  assert.deepEqual(used['lib/one.mjs'], ['a']);
  assert.equal(used['lib/unused.mjs'], undefined);
});

test('suitesFor adds the few suites that use a changed helper, never a helper everyone uses', () => {
  const all = ['a', 'b', 'c', 'settings'], uses = suitesUsing('', files);
  assert.deepEqual(suitesFor(['desktop/e2e/lib/deep.mjs'], all, {uses}), ['a', 'b', 'settings']);
  const wide = {'lib/layout.mjs': ['a', 'b', 'c', 'd']};
  assert.deepEqual(suitesFor(['desktop/e2e/lib/layout.mjs'], [...all, 'd'], {uses: wide}), ['settings']);
});

test('the real tree: the helpers #1941 changed point at the suites that use them', () => {
  const used = suitesUsing(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
  assert.ok(used['lib/apply-cv-steps.mjs'].includes('apply'));
  assert.ok(used['activity-states.mjs'].includes('cardstates'));
});
