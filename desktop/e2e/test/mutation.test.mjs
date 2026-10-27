// Every mutant still applies to today's code exactly once (a stale mutant fails here, not silently in the weekly run), and the score reads runs right.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {applyMutant, baselineKey, issueActions, plan, score, summary} from '../lib/mutation.mjs';

const root = path.resolve(new URL('../../..', import.meta.url).pathname);
const mutants = JSON.parse(fs.readFileSync(new URL('../mutants.json', import.meta.url), 'utf8'));

test('every mutant applies to the current code exactly once, changes it, and names a suite that exists', () => {
  for (const mutant of mutants) {
    const source = fs.readFileSync(path.join(root, mutant.file), 'utf8');
    const changed = applyMutant(source, mutant);
    assert.notEqual(changed, source, mutant.id);
    assert.ok(fs.existsSync(path.join(root, 'desktop', 'e2e', 'suites', `${mutant.suite}.mjs`)), `${mutant.id}: no suite ${mutant.suite}`);
  }
  assert.equal(new Set(mutants.map(item => item.id)).size, mutants.length, 'ids are unique');
});

// The source of the steps a suite really runs: a suite that runs parts of another (failuresnotion runs activityfailures' 'notion' part) runs only those blocks.
async function stepRunBy(suite, words) {
  const own = fs.readFileSync(path.join(root, 'desktop', 'e2e', 'suites', `${suite}.mjs`), 'utf8');
  // The other split (focus / focusdismiss, 6 Oct 2026): one file, `partOf(step name)` says which half runs a step, `run = ctx => runX(ctx, ['<half>'])`.
  const half = /export const run = ctx => \w+\(ctx, \[([^\]]+)\]\)/.exec(own)?.[1].match(/'([\w-]+)'/g)?.map(word => word.slice(1, -1));
  const from = /import \{run\w+[^}]*\} from '\.\/([\w-]+)\.mjs'/.exec(own)?.[1] || suite;
  const {partOf} = await import(path.join(root, 'desktop', 'e2e', 'suites', `${from}.mjs`));
  if (half && partOf) {
    const source = fs.readFileSync(path.join(root, 'desktop', 'e2e', 'suites', `${from}.mjs`), 'utf8');
    return source.includes(words) && (partOf(words) === 'both' || half.includes(partOf(words)));
  }
  return stepsRunBy(suite).includes(words);
}
function stepsRunBy(suite) {
  const own = fs.readFileSync(path.join(root, 'desktop', 'e2e', 'suites', `${suite}.mjs`), 'utf8');
  const parts = /runParts\(ctx, \[([^\]]+)\]\)/.exec(own)?.[1].match(/'([\w-]+)'/g)?.map(word => word.slice(1, -1));
  const from = /import \{runParts\} from '\.\/([\w-]+)\.mjs'/.exec(own)?.[1] || suite;
  if (!parts) return own;
  const source = fs.readFileSync(path.join(root, 'desktop', 'e2e', 'suites', `${from}.mjs`), 'utf8');
  return [...source.matchAll(/if \(parts\.includes\('([\w-]+)'\)\) \{([^]*?)(?=\n  if \(parts\.includes\(|\nexport )/g)].filter(([, part]) => parts.includes(part)).map(([, , block]) => block).join('\n');
}

// 12 Oct 2026: raw-http-error named activityfailures, but the step that catches it (an HTML error page from Notion) had moved to failuresnotion when the suite was
// split in three: the mutant "survived" a suite that never ran that step (#354). Each mutant names the words of the step that catches it, and they must be in
// the steps its suite runs.
// 27 Oct 2026: three Focus mutants named `focus`, whose catching steps run only in its other half (focusdismiss): the guard read the whole file and passed (#1907-#1909).
test('every mutant names the step that catches it, and its suite runs that step', async () => {
  for (const mutant of mutants) {
    assert.ok(mutant.catches, `${mutant.id}: no "catches" (the words of the step that turns red when this bug is in the app)`);
    assert.ok(await stepRunBy(mutant.suite, mutant.catches), `${mutant.id}: the ${mutant.suite} suite runs no step with "${mutant.catches}"`);
  }
  assert.equal(await stepRunBy('focus', 'removes it for good'), false, 'the split model is right: focus does not run the dismissal steps');
  assert.equal(await stepRunBy('focusdismiss', 'removes it for good'), true);
  assert.ok(!stepsRunBy('activityfailures').includes('Notion answers an HTML error page'), 'the parts model is right: the AI part does not run the Notion steps');
});

test('a stale or ambiguous mutant is an error, never a silent pass', () => {
  assert.throws(() => applyMutant('abc', {id: 'x', file: 'f', find: 'zzz', replace: 'y'}), /no longer in f/);
  assert.throws(() => applyMutant('aa', {id: 'x', file: 'f', find: 'a', replace: 'b'}), /more than once/);
});

test('red kills, green survives, a red baseline makes it unknown; the score counts only judged mutants', () => {
  const list = [{id: 'm1', suite: 's', what: 'a'}, {id: 'm2', suite: 's', what: 'b'}, {id: 'm3', suite: 't', what: 'c'}];
  const result = score(list, {'baseline:s': 'success', m1: 'failure', m2: 'success', 'baseline:t': 'failure', m3: 'failure'});
  assert.deepEqual(result.rows.map(row => row.outcome), ['killed', 'survived', 'unknown']);
  assert.equal(result.score, 50);
  assert.match(summary(result), /50% of the planted code bugs caught \(1 caught, 1 missed, 1 unknown\)/);
});

test('a finding the baseline did not raise kills a mutant too: a truth check files, it does not turn the suite red', () => {
  const list = [{id: 'day', suite: 'calendar', what: 'a day is lost'}];
  const kept = score(list, {'baseline:calendar': {conclusion: 'success', findings: ['tiny-text|calendar']}, day: {conclusion: 'success', findings: ['tiny-text|calendar', 'wrong-result|calendar']}});
  assert.equal(kept.rows[0].outcome, 'killed');
  assert.match(kept.rows[0].why, /wrong-result\|calendar/);
  const same = score(list, {'baseline:calendar': {conclusion: 'success', findings: ['tiny-text|calendar']}, day: {conclusion: 'success', findings: ['tiny-text|calendar']}});
  assert.equal(same.rows[0].outcome, 'survived', 'what the baseline also raised says nothing');
});

// 27 Oct 2026: CI picks the store by run number (lib/store.mjs), so a mutant whose bug lives on one store's path was caught or missed by the date: on 25 Oct
// the Notion-path mutants ran on this Mac's store, where their code never runs, and survived (#1906 #1910). Each mutant pins the store its bug lives on.
test('every mutant pins the store its bug lives on, and a suite that pins its own store agrees', () => {
  for (const mutant of mutants) {
    assert.ok(['sqlite', 'standin'].includes(mutant.store), `${mutant.id}: "store" must be sqlite or standin, not ${mutant.store}`);
    const own = fs.readFileSync(path.join(root, 'desktop', 'e2e', 'suites', `${mutant.suite}.mjs`), 'utf8');
    const pinned = /export const store = '(\w+)'/.exec(own)?.[1];
    if (pinned) assert.equal(mutant.store, pinned, `${mutant.id}: the ${mutant.suite} suite always runs on ${pinned}`);
  }
});

test('the plan runs one baseline per suite and store, and each mutant against its own', () => {
  const list = [{id: 'a', suite: 's', store: 'sqlite'}, {id: 'b', suite: 's', store: 'standin'}, {id: 'c', suite: 's', store: 'sqlite'}];
  assert.deepEqual(plan(list), [{mutant: 'baseline', suite: 's', store: 'sqlite'}, {mutant: 'baseline', suite: 's', store: 'standin'},
    {mutant: 'a', suite: 's', store: 'sqlite'}, {mutant: 'b', suite: 's', store: 'standin'}, {mutant: 'c', suite: 's', store: 'sqlite'}]);
  const result = score(list, {[baselineKey('s', 'sqlite')]: 'success', [baselineKey('s', 'standin')]: 'failure', a: 'failure', b: 'failure', c: 'success'});
  assert.deepEqual(result.rows.map(row => row.outcome), ['killed', 'unknown', 'survived'], 'b is judged against the stand-in baseline, which was red');
});

// The result reaches someone (owner, 27 Oct 2026): a caught mutant closes its open issue, a missed one opens or bumps one, and the rate goes on the scorecard issue.
test('a run opens an issue per missed mutant, comments on a known one, closes the issue of one caught now', () => {
  const result = {rows: [{id: 'a', outcome: 'killed', why: 'the suite went red'}, {id: 'b', outcome: 'survived'}, {id: 'c', outcome: 'survived'}, {id: 'd', outcome: 'unknown'}]};
  const open = [{number: 1, title: '[mutation] a survived: no suite caught it'}, {number: 2, title: '[mutation] b survived: no suite caught it'}, {number: 4, title: '[mutation] d survived: no suite caught it'}];
  const actions = issueActions(result, open);
  assert.deepEqual(actions.close.map(item => item.number), [1]);
  assert.deepEqual(actions.comment.map(item => item.number), [2]);
  assert.deepEqual(actions.create.map(item => item.id), ['c']);
  assert.ok(!actions.close.some(item => item.number === 4), 'an unknown outcome leaves its issue open');
});
