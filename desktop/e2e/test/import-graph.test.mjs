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

// #2043 (26 Oct 2026): src/ai/schema_notes.py changed the scoring prompt; quality watches score.py, which imports it, yet quality never ran on the PR.
// A watched Python file's own imports (within the repo) are watched too.
import {watchesWithImports} from '../lib/import-graph.mjs';

test('a file a watched Python file imports from its own folder is watched too (#2043: schema_notes.py → quality)', () => {
  const files = {
    'src/ai/score.py': 'from .. import run_counts, store\nfrom . import cost, engine, schema_notes, score_not_a_job\nfrom .models import MAIN_MODEL\nimport json\n',
    'src/ai/schema_notes.py': 'from .models import MAIN_MODEL\n',
    'src/ai/models.py': 'X = 1\n', 'src/ai/cost.py': '', 'src/ai/engine/__init__.py': 'from .core import run\n', 'src/ai/engine/core.py': '',
    'src/run_counts.py': '', 'src/store.py': '', 'src/ai/score_not_a_job.py': '', 'src/ai/mail.py': 'from . import cost\n',
  };
  const read = file => (file in files ? files[file] : null);
  const out = watchesWithImports({quality: ['src/ai/score.py', 'desktop/lib/pipeline.js'], mailreading: ['src/ai/mail.py']}, read);
  assert.deepEqual(out.quality.sort(), ['desktop/lib/pipeline.js', 'src/ai/cost.py', 'src/ai/engine/', 'src/ai/models.py',
    'src/ai/schema_notes.py', 'src/ai/score.py', 'src/ai/score_not_a_job.py'], 'its own folder only: src/run_counts.py and src/store.py are not followed; a package is its folder');
  assert.deepEqual(out.mailreading.sort(), ['src/ai/cost.py', 'src/ai/mail.py']);
});

// 26 Oct 2026 audit: followed through every hop, mailreading's 4 files became 56 (all of src/ai) and 8 of 32 PRs ran it on lines it never reads
// (#2068 decide.py, #2060/#2056/#2063 score.py). One hop: what a watched file imports itself; deeper lines are the code → suite map's.
test('only the files a watched file imports itself are watched, not their imports', () => {
  const files = {'src/ai/mail.py': 'from . import cost\n', 'src/ai/cost.py': 'from . import decide\n', 'src/ai/decide.py': ''};
  const out = watchesWithImports({mailreading: ['src/ai/mail.py']}, file => (file in files ? files[file] : null));
  assert.deepEqual(out.mailreading.sort(), ['src/ai/cost.py', 'src/ai/mail.py']);
});

test('the real tree: the audited PRs pick the watched suites their files reach, and only those', async () => {
  const {suiteFacts} = await import('../plan-run.mjs');
  const facts = await suiteFacts();
  const watches = watchesWithImports(facts.watches);
  const pick = files => suitesFor(files, facts.all, {watches, cadence: {}}).filter(suite => ['mailreading', 'quality'].includes(suite));
  assert.ok(watches.mailreading.length < 25, `mailreading watches ${watches.mailreading.length} files: the import closure is back`);
  assert.deepEqual(pick(['src/ai/decide.py', 'src/sources/careers.py']), [], '#2068: neither suite reads decide.py');
  assert.deepEqual(pick(['src/ai/score.py', 'src/ai/score_search.py']), ['quality'], '#2060: a scoring change runs quality only');
  assert.deepEqual(pick(['src/ai/interviews.py']), [], 'an interviews change runs neither');
  assert.deepEqual(pick(['src/ai/schema_notes.py']), ['quality'], '#2043 still: score.py imports it');
  assert.deepEqual(pick(['src/ai/providers/anthropic_api.py']), ['mailreading'], '#2077 broke main\'s mailreading (#2086): the providers the mail check imports');
  assert.deepEqual(pick(['src/ai/mail_lines.py']), ['mailreading']);
});

test('every file a suite watches, imports included, starts pr-suites.yml (else the plan never runs: #2043)', async () => {
  const {suiteFacts} = await import('../plan-run.mjs');
  const facts = await suiteFacts();
  const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
  const yml = (await import('node:fs')).readFileSync(path.join(repo, '.github', 'workflows', 'pr-suites.yml'), 'utf8');
  const globs = [...yml.split('\npermissions:')[0].matchAll(/^\s+- '([^']+)'/gm)].map(m => m[1]);
  const starts = file => globs.some(glob => (glob.endsWith('/**') ? file.startsWith(glob.slice(0, -2)) : file === glob));
  const watched = watchesWithImports(facts.watches);
  assert.ok(watched.quality.includes('src/ai/schema_notes.py'), 'positive control');
  const missing = Object.entries(watched).flatMap(([suite, files]) => files.filter(file => !starts(file.endsWith('/') ? `${file}x.js` : file)).map(file => `${suite}: ${file}`));
  assert.deepEqual(missing, [], 'add these to pr-suites.yml paths');
});
