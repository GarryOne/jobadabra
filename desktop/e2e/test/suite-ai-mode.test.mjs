// Every suite that stubs AI calls declares whether the rest may reach a real model (`export const realAi`); one that declares false is checked by the harness (lib/suite-main.mjs).
import {loadAppModule} from '../lib/app-module.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
const {propose} = await loadAppModule('contact-from-cv.js');
import {storedAnswer} from '../lib/ai-answers.mjs';

const SUITES = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'suites');
const sources = fs.readdirSync(SUITES).filter(file => file.endsWith('.mjs')).map(file => [file, fs.readFileSync(path.join(SUITES, file), 'utf8')]);
// Follow sibling suite imports too: a wrapper inherits its runner's stubs, but not its exported AI mode.
function requiresMode(source, graph = new Map(sources), seen = new Set(), imported = false) {
  // Imported fault helpers do not own every answer; imported canned installers do (runApply's wrapper was missed).
  if ((imported ? /\.setCanned\(/ : /\.(setMode|setCanned)\(/).test(source)) return true;
  return [...source.matchAll(/from ['"]\.\/([^'"]+\.mjs)['"]/g)].some(([, file]) => {
    if (seen.has(file) || !graph.has(file)) return false;
    seen.add(file);
    return requiresMode(graph.get(file), graph, seen, true);
  });
}
const declared = source => /^export const realAi = (true|false|process\.env\.LIVE \? true : false);/m.exec(source)?.[1];

test('a suite that installs or imports AI stubs declares its own realAi mode', () => {
  const missing = sources.filter(([, source]) => requiresMode(source) && !declared(source)).map(([file]) => file);
  assert.deepEqual(missing, [], `add "export const realAi = false;" (every AI call is a stand-in: the harness fails the run if one reaches a real model) or "= true" (some calls go on to the real model, metered): ${missing.join(', ')}`);
});

test('a declaration is a boolean or explicit live-mode choice, and employers declares false', () => {
  for (const [file, source] of sources) if (/export const realAi\b/.test(source)) assert.ok(declared(source), `${file}: realAi must be a literal true or false`);
  assert.equal(declared(sources.find(([file]) => file === 'employers.mjs')[1]), 'false');
});

test('the harness runs the real-AI check for a suite declaring false', () => {
  assert.match(fs.readFileSync(path.join(SUITES, '..', 'lib', 'suite-main.mjs'), 'utf8'), /await runAiGuards\(suite, ctx, runAlways\)/);
  assert.match(fs.readFileSync(path.join(SUITES, '..', 'lib', 'no-real-ai.mjs'), 'utf8'), /suite\.realAi === false\) await runAlways\(/);
});


test('a wrapper importing a stubbing suite must declare its own AI mode', () => {
  const wrapper = "import {runApply} from './apply.mjs'; export const run = ctx => runApply(ctx);";
  const graph = new Map([['apply.mjs', 'proxy.setCanned(answer);']]);
  assert.equal(requiresMode(wrapper, graph), true);
  graph.set('middle.mjs', wrapper);
  assert.equal(requiresMode("export {run} from './middle.mjs';", graph), true);
  graph.set('cycle.mjs', "export {run} from './cycle.mjs';");
  assert.equal(requiresMode("export {run} from './cycle.mjs';", graph), false);
  assert.equal(requiresMode("import {run} from './unrelated.mjs';", graph), false);
});

// A missing suite declaration must not send the seeded CV's contact ask to a hash cache or live AI.
for (const name of ['focus', 'focusdismiss']) test(`${name}: setup contact proposals use the existing reviewed answer`, async () => {
  const suite = await import(`../suites/${name}.mjs`);
  const wanted = ['phone', 'salutation', 'street', 'postal_code', 'place_of_origin', 'birth_date', 'linkedin', 'github', 'website'];
  const client = {messages: {create: async (body, options) => {
    const answer = storedAnswer({url: '/v1/messages', body, headers: options.headers}, {E2E_AI_ANSWERS: suite.aiAnswers || 'off'});
    assert.ok(answer.reply, 'the setup ask must be answered before cache or transport');
    return answer.reply;
  }}};
  assert.deepEqual(await propose(client, Buffer.from('%PDF-test-fixture'), wanted), {proposals: []});
});
