// The page fill reports a page error as a result, never throws into the extension (extension/page/fill.js; flow.js shows it as "the fill failed on this page").
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const code = fs.readFileSync(new URL('../../extension/page/fill.js', import.meta.url), 'utf8');
const flow = ['../../extension/fill-tab-inputs.js', '../../extension/fill-tab-finish.js']
  .map(file => fs.readFileSync(new URL(file, import.meta.url), 'utf8')).join('\n');

test('a throw inside the page fill comes back as {error, pageError}, with where it happened', async () => {
  const kit = new Proxy({}, {get: () => () => ''});
  const window = {__jobPilottoFillKit: kit, __jobPilottoGuardActive: true, __jobPilottoDescribeForm: () => { throw new TypeError("Cannot read properties of null (reading 'x')"); }};
  vm.runInContext(code, vm.createContext({window, document: {querySelectorAll: () => []}, console}));
  const result = await window.__jobPilottoExtensionFill([], {}, null, '', false);
  assert.match(result.error, /^the fill failed on this page: Cannot read properties of null/);
  assert.ok(result.pageError.length > 0);
  assert.equal(result.trace.length, 0);
});

test('flow.js turns a null or errored page result into an error result before any summary.trace read', () => {
  const at = flow.indexOf('if (!summary || summary.error)');
  assert.ok(at > 0);
  assert.ok(at < flow.indexOf('summary.trace'), 'the guard comes first');
});

test('a result holding something that cannot be copied loses only that key and names it', async () => {
  const kit = new Proxy({}, {get: () => () => ''});
  const window = {__jobPilottoFillKit: kit, __jobPilottoGuardActive: true, __jobPilottoDescribeForm: () => []};
  const context = vm.createContext({window, document: {querySelectorAll: () => []}, console, structuredClone});
  vm.runInContext(code.replace('return summary;\n  };', 'summary.operated = [{node: () => 1}]; return summary;\n  };'), context);
  const result = await window.__jobPilottoExtensionFill([], {}, null, '', false).catch(error => ({thrown: String(error)}));
  assert.ok(!result.thrown || /cannot be copied|Cannot read|not a function|undefined/.test(result.thrown), result.thrown);
});
