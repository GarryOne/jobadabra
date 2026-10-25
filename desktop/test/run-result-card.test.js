// One result card per run in its run panel (owner, 25 Oct 2026: "Instead of having 3 cards representing the status/result, there should be one single card…
// consistent across runs"; "It should not contradict, confuse or overwhelm"): the top, the step rows and the kind's own bottom are one frame, the top's tone is
// the pill's, its number and next step are the app's own words, and nothing is said twice.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {cleanTop, CLEAN_TOP, NUMBER, titleWithNumber, topTone} from '../renderer/run-result-card.js';
import {runPill} from '../renderer/run-status.js';
import {addedWords} from '../renderer/find-card-model.js';

const read = file => readFileSync(new URL(`../renderer/${file}`, import.meta.url), 'utf8');
const KINDS = [...read('pages/activity-basics.js').matchAll(/(\w+): \{icon: '[^']+', line: '[\w-]+', name: ("[^"]+"|'[^']+')\}/g)].map(match => match[1]);
const ENDS = {
  completed: {ok: true, result: 'what it did'},
  warned: {ok: true, warned: true, result: 'what it did'},
  unsaved: {ok: true},
  failed: {ok: false, problem: 'Claude Code is not ready: sign in again'},
  unexpected: {ok: false},
  interrupted: {ok: false, interrupted: true},
  stopped: {ok: false, stopped: 'you'},
};

test('every kind, in every end: the top\'s tone is the pill\'s, a clean top only for its kinds and never on a No result run', () => {
  assert.ok(KINDS.length >= 17, `found ${KINDS.length} kinds`);
  for (const kind of KINDS) {
    for (const [end, fields] of Object.entries(ENDS)) {
      const run = {id: 1, kind, ...fields, new: fields.ok && end !== 'unsaved' ? 2 : undefined};
      const where = `${kind}, ${end}`;
      assert.equal(topTone(run, kind), runPill({...run, kind}, {long: true})[1], `${where}: one source for the tone`);
      const top = cleanTop(run, {kind, added: 2});
      if (!CLEAN_TOP.has(kind) || end === 'unsaved') { assert.equal(top, null, where); continue; }
      assert.equal(top.tone, topTone(run, kind), `${where}: a warned run is never a green top`);
      assert.equal(top.title, addedWords(2), `${where}: the number in the app's own words`);
    }
  }
  assert.equal(cleanTop({kind: 'search', live: true}, {kind: 'search'}), null, 'a live run has no ended top');
});

test('Find jobs: the number and the next step are the Jobs card\'s and the Actions banner\'s words', () => {
  assert.deepEqual(cleanTop({kind: 'search', ok: true, new: 3, result: 'x'}, {kind: 'search', added: 3}).next, {label: 'See the 3 new jobs', view: 'jobs'});
  assert.equal(cleanTop({kind: 'search', ok: true, new: 0, result: 'x'}, {kind: 'search', added: 0}).next, null, 'nothing added: no button to an empty list');
  assert.equal(titleWithNumber('Find jobs was interrupted', 'search', 0), `Find jobs was interrupted · ${addedWords(0)}`);
  assert.equal(titleWithNumber('Gmail was not checked', 'mail', 0), 'Gmail was not checked', 'a kind without its number yet keeps its title');
  for (const kind of CLEAN_TOP) assert.ok(NUMBER[kind], `${kind}: a clean top needs its number`);
});

test('the run panel draws the top, the steps and the bottom inside one frame, with no box of their own', () => {
  const html = read('index.html');
  const frame = html.slice(html.indexOf('id="run-result"'), html.indexOf('</section>', html.indexOf('id="run-result"')));
  for (const id of ['activity-warnings', 'activity-phases', 'activity-card', 'activity-partial']) assert.match(frame, new RegExp(`id="${id}"`), `${id} is inside the one card`);
  const css = read('run-result.css');
  assert.match(css, /\.run-result > :is\(\.activity-warnings, \.ap-card, \.activity-message, \.activity-partial\) \{\s*margin: 0; border: 0; border-radius: 0;/, 'the parts lose their own boxes');
  assert.match(html, /<link rel="stylesheet" href="run-result.css">/);
});

test('nothing is said twice: the header leaves the reason to the top, the bottom leaves the number and the next step to it', () => {
  const render = read('pages/activity-render.js'), card = read('pages/activity-run-card.js'), top = read('pages/activity-result-top.js');
  assert.match(render, /!!failureHead\(\{\.\.\.run, kind: kindOf\(run\)\}\)\?\.problem\);/, 'any failure the top names: the header does not repeat its reason');
  assert.match(render, /if \(top\.next\) show\(\$\('activity-go'\), false\);/, 'the header link gives way to the top\'s next step');
  assert.match(card, /if \(target\.id !== 'activity-card'\) stats\.append\(stat\(fresh/, 'the number is the top\'s');
  assert.match(card, /view\.hidden = target\.id === 'activity-card';/, 'the bottom\'s View in Jobs is the top\'s button');
  assert.match(card, /runNewCount\(run, card\) === 0 \|\| !rows\.querySelector\('\.run-card-row'\)\)\) \{ target\.replaceChildren\(\); return \{empty: true\}; \}/,
    'a run that added nothing, or lists no rows, has no bottom: never "Nothing new since the last check" under an interrupted run');
  assert.match(top, /show\(\$\('activity-warnings-log'\), !run\?\.live \|\| /, 'every ended run\'s top offers its log');
  assert.match(top, /const alsoAgain = !run\?\.live && !!head\?\.problem && !head\?\.fix\?\.rerun && !!runButton\(kindOf\(run\)\);/, 'Run again beside a fix');
});

test('an ended search\'s drawer is its result card: no step rows, no failed-sources line; both are in its full report (owner, 25 Oct 2026)', () => {
  const render = read('pages/activity-render.js');
  assert.match(render, /const onStep = kindOf\(run\) === 'search' && !run\?\.live && split\.partial \? split\.partial : null;/, 'taken out of the problem box');
  assert.doesNotMatch(render, /partialWords\(onStep\)/, 'and not put anywhere else in the drawer');
  assert.match(render, /show\(\$\('activity-phases'\), updates\.length > 0 \|\| \(at >= 0 && !!run\?\.live\) \|\| !!tabs \|\| !!counted\);/, 'its step rows only while it runs');
});
