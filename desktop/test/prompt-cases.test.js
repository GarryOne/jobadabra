// The prompt case gate (tools/prompt-cases.mjs, tools/prompt-cases.json): a push that changes an AI prompt adds the case it fixed to that prompt's set, or says
// "Prompt-case: none <why>"; the live-set comparison is manually dispatched, never a PR check (prompt-cases.yml). Owner, 27 Oct 2026.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {ASKERS, changedPrompts, liveSets, missingCase, PROMPT_FILE, promptTexts} from '../../tools/prompt-cases.mjs';

const root = new URL('../../', import.meta.url);
const registry = JSON.parse(fs.readFileSync(new URL('tools/prompt-cases.json', root), 'utf8'));
const JS = 'import x from "y";\nexport const FACT_RULE = `use "fill" when the facts state it.\nA box with no currency is asked in the target\'s own.`;\nconst LIMIT = 3;\n';
const PY = 'SYSTEM = """You sort the emails.\nOne line each."""\nSYSTEM = WRITING_RULES + SYSTEM\nEXAMPLES = 3\n_RULES = [1]\n';

test('a prompt is a top-level string constant named *SYSTEM, *PROMPT, *RULE(S), *INSTRUCTIONS or *EXAMPLES; numbers and lists are not', () => {
  assert.deepEqual([...promptTexts(JS).keys()], ['FACT_RULE']);
  assert.deepEqual([...promptTexts(PY).keys()], ['SYSTEM'], 'EXAMPLES = 3 and _RULES = [..] are not prompts');
  assert.match(promptTexts(PY).get('SYSTEM'), /One line each[\s\S]*WRITING_RULES \+ SYSTEM/, 'a later assignment of the same prompt is part of it');
  assert.match(promptTexts(JS).get('FACT_RULE'), /target's own\.`\n$/, 'a template literal over several lines is read to its end');
});

test('only a change inside a prompt counts; an edit beside it does not', () => {
  assert.deepEqual(changedPrompts(JS, JS.replace("target's own", "job country's")), ['FACT_RULE']);
  assert.deepEqual(changedPrompts(JS, JS.replace('LIMIT = 3', 'LIMIT = 4').replace('"y"', '"z"')), []);
  assert.deepEqual(changedPrompts(PY, PY.replace('One line each.', 'Two lines each.')), ['SYSTEM']);
  assert.deepEqual(changedPrompts('', JS), ['FACT_RULE'], 'a new prompt is a change');
});

const FACT = [{file: 'worker/src/answer-facts.js', name: 'FACT_RULE'}];
const added = files => file => (files[file] || 0);

test('a prompt change with no case added to its set is refused, naming the set and its files', () => {
  const problem = missingCase(FACT, added({'worker/src/answer-facts.js': 1}), ['Reword the salary rule'], registry);
  assert.match(problem, /FACT_RULE: add the case this change fixes to the "form" set \(tools\/free-ai-form-asks\.mjs/);
});

test('it passes with a case added to the set, or with "Prompt-case: none <why>"', () => {
  assert.equal(missingCase(FACT, added({'tools/free-ai-form-asks.mjs': 4}), ['Reword'], registry), '');
  assert.equal(missingCase(FACT, added({}), ['Fix a typo\n\nPrompt-case: none a typo, no meaning changed'], registry), '');
  assert.match(missingCase(FACT, added({}), ['Fix\n\nPrompt-case: none'], registry), /add the case/, 'a bare "none" is no reason');
});

test('a prompt in no set is refused until it gets one or the commit says why', () => {
  const change = [{file: 'src/sources/board_check.py', name: 'COUNTRY_INSTRUCTIONS'}];
  assert.match(missingCase(change, added({}), ['Count jobs'], registry), /no case set protects it yet/);
  assert.equal(missingCase(change, added({}), ['Count jobs\n\nPrompt-case: none no set for board checks yet; measured on run 123'], registry), '');
});

test('the live sets a push reaches: a changed prompt of a live set or a changed case file; a set that is not live never runs', () => {
  assert.deepEqual(liveSets(FACT, ['worker/src/answer-facts.js'], registry), ['form']);
  assert.deepEqual(liveSets([], ['tools/free-ai-form-asks.mjs'], registry), ['form']);
  assert.deepEqual(liveSets([{file: 'src/ai/mail_config.py', name: 'SYSTEM'}], ['src/ai/mail_config.py'], registry), []);
  assert.deepEqual(liveSets([], ['README.md'], registry), []);
  for (const asker of ASKERS) assert.deepEqual(liveSets([], [asker], registry), ['form'], `${asker}: a changed asker re-asks every live set`);
});

test('every prompt the registry names exists in its file, and every case file exists (a renamed prompt fails here)', () => {
  for (const [set, {cases, prompts}] of Object.entries(registry.sets)) {
    for (const file of cases) assert.ok(fs.existsSync(new URL(file, root)), `${set}: ${file}`);
    for (const [file, names] of Object.entries(prompts)) {
      assert.match(file, PROMPT_FILE, file);
      const found = promptTexts(fs.readFileSync(new URL(file, root), 'utf8'));
      for (const name of names) assert.ok(found.has(name), `${set}: ${file} ${name}`);
    }
  }
});

test('the push gate runs it beside the Why check, before a PR push stops', () => {
  const hook = fs.readFileSync(new URL('tools/pre-push-check.sh', root), 'utf8');
  const at = hook.indexOf('node tools/prompt-cases.mjs --base origin/main');
  assert.ok(at > 0 && Math.abs(at - hook.indexOf('node tools/why-changed.mjs --base origin/main')) < 2000);
  assert.ok(at < hook.indexOf('case "$command" in *SHIP_PR=1*|*CI_GATES=1*)'));
});
