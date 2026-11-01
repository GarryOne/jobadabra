// The automatic refill starts when what the AI is asked changes, not when one file name changes (lib/prompt-sources.mjs, refill-trigger.mjs; owner, 15 Oct 2026: #904's worker field list and #912's cv_facts rule changed asks, no refill ran).
// A real git repo in a temp folder: a change to the worker's field list or cv_facts rule triggers it, a score-only baseline change and an unrelated file do not.
import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {LADDER_BASELINE, PROMPT_SOURCES, sourcesChanged, WORKER_AND_PAGE_SOURCES} from '../../lib/prompt-sources.mjs';
import {PROMPT_FILES} from '../../lib/ladder-fingerprint.mjs';

const here = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..'), repoRoot = path.resolve(here, '..', '..', '..');
const trigger = path.join(here, '..', 'refill-trigger.mjs');

test('every ladder prompt file and the worker\'s ask-building files are sources, and each exists', () => {
  for (const item of PROMPT_FILES) assert.ok(PROMPT_SOURCES.includes(item.file), `${item.file} builds a ladder prompt: a change to it must be able to refill`);
  for (const file of WORKER_AND_PAGE_SOURCES) assert.ok(fs.existsSync(path.join(repoRoot, file)), `${file} is listed as a prompt source but does not exist: update lib/prompt-sources.mjs`);
  assert.ok(PROMPT_SOURCES.includes('worker/src/cv-facts.js') && PROMPT_SOURCES.includes('worker/src/extension.js'), 'the worker\'s field list and cv_facts rule');
});

test('sourcesChanged names the files whose content differs', () => {
  const file = 'worker/src/cv-facts.js';
  assert.deepEqual(sourcesChanged({[file]: 'a'}, {[file]: 'b'}), [file]);
  assert.deepEqual(sourcesChanged({[file]: 'a'}, {[file]: 'a'}), []);
  assert.deepEqual(sourcesChanged({}, {[file]: 'a'}), [file], 'a file new in the merge');
});

// A temp repo with every source file and a baseline; each commit changes one thing. -> what refill-trigger.mjs prints for the last commit.
function triggerFor(change) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-trigger-')), git = (...args) => execFileSync('git', args, {cwd: dir, stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8'});
  try {
    git('init', '-q'); git('config', 'user.email', 't@example.com'); git('config', 'user.name', 't'); git('config', 'commit.gpgsign', 'false');
    const write = (file, body) => { fs.mkdirSync(path.dirname(path.join(dir, file)), {recursive: true}); fs.writeFileSync(path.join(dir, file), body); };
    for (const file of PROMPT_SOURCES) write(file, `// ${file}\n`);
    const baseline = score => JSON.stringify({promptFingerprint: {rung2: 'a', rung3: 'b'}, fixtures: {x: score}});
    write(LADDER_BASELINE, baseline(1)); write('README.md', 'x'); git('add', '-A'); git('commit', '-qm', 'before');
    const before = git('rev-parse', 'HEAD').trim(); fs.copyFileSync(path.join(dir, LADDER_BASELINE), path.join(dir, 'before.json'));
    change(write, baseline); git('add', '-A'); git('commit', '-qm', 'merge');
    const out = spawnSync(process.execPath, [trigger, path.join(dir, 'before.json'), path.join(dir, LADDER_BASELINE), before], {cwd: dir, encoding: 'utf8'});
    return out.stdout.trim().split('\n');
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
}

test('a change only to the worker\'s field list triggers the refill', () => {
  const said = triggerFor(write => write('worker/src/extension.js', '// a field with multiple: true\n'));
  assert.equal(said.at(-1), 'changed');
  assert.match(said.join('\n'), /worker\/src\/extension\.js/);
});

test('a change only to the cv_facts rule triggers the refill', () => assert.equal(triggerFor(write => write('worker/src/cv-facts.js', '// years from roles\n')).at(-1), 'changed'));
test('a change to the page-side field read triggers the refill', () => assert.equal(triggerFor(write => write('extension/page/fill-read.js', '// multiple\n')).at(-1), 'changed'));
test('a ladder prompt fingerprint change still triggers it', () => assert.equal(triggerFor((write, baseline) => write(LADDER_BASELINE, baseline(1).replace('"a"', '"a2"'))).at(-1), 'changed'));
test('a score-only baseline change does not trigger it', () => assert.deepEqual(triggerFor((write, baseline) => write(LADDER_BASELINE, baseline(2))), ['same']));
test('a change to an unrelated file does not trigger it', () => assert.deepEqual(triggerFor(write => write('worker/src/scheduler.js', '// cron\n')), ['same']));

// A hand-kept list goes stale the next time someone adds a prompt file (today's incident again): a file under worker/src or extension/ that BUILDS an AI ask must be in PROMPT_SOURCES.
// "Builds an ask" = its code (comments stripped) defines a prompt or rule constant, an output schema, a system/messages array or a prompt tag the AI reads. A file that only mentions those words is no source.
const BUILDS_AN_ASK = [/\b[A-Z][A-Z0-9_]*(INSTRUCTIONS|_RULE|_PROMPT|_SCHEMA)\s*=/, /\bconst\s+(SCHEMA|schema)\s*=/, /\boutput_config\b/, /\bsystem\s*:\s*[\[`'"]/, /\bmessages\s*:\s*\[/, /<(profile|standard_answers|cv_facts|search_preferences)>/];
const codeOf = text => text.split('\n').filter(line => !/^\s*(\/\/|\*|\/\*)/.test(line)).map(line => line.replace(/\s\/\/ .*$/, '')).join('\n');
function walk(dir, found = []) {
  for (const item of fs.readdirSync(path.join(repoRoot, dir), {withFileTypes: true})) {
    const rel = `${dir}/${item.name}`;
    if (item.isDirectory()) { if (!['node_modules', 'test', 'tests', 'vendor', 'icons'].includes(item.name)) walk(rel, found); } else if (/\.m?js$/.test(item.name)) found.push(rel);
  }
  return found;
}

test('a file under worker/src or extension/ that builds an AI ask is a prompt source (a new prompt file cannot slip past the refill trigger)', () => {
  const builders = [...walk('worker/src'), ...walk('extension')].filter(file => { const code = codeOf(fs.readFileSync(path.join(repoRoot, file), 'utf8')); return BUILDS_AN_ASK.some(pattern => pattern.test(code)); });
  assert.ok(builders.includes('worker/src/extension.js') && builders.includes('worker/src/answer-facts.js'), `the detector must see the known builders (found ${builders.join(', ')})`);
  const missing = builders.filter(file => !PROMPT_SOURCES.includes(file));
  assert.deepEqual(missing, [], `${missing.join(', ')} build an AI ask but are not in PROMPT_SOURCES (desktop/e2e/lib/prompt-sources.mjs) nor the workflow's push paths: a change to them would not refill the recordings`);
});

test('the detector itself: a prompt constant, a schema and a system array count; a comment or a word in prose does not', () => {
  const hits = text => BUILDS_AN_ASK.some(pattern => pattern.test(codeOf(text)));
  assert.equal(hits('export const FACT_RULE = `use`;'), true);
  assert.equal(hits('const schema = {type: "object"};'), true);
  assert.equal(hits('const call = {system: [{type: "text"}]};'), true);
  assert.equal(hits('// FACT_RULE = in a comment\nconst x = 1;'), false);
  assert.equal(hits('const label = "the system is fine";'), false);
});
