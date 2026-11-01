// The Free AI form-answer cases (tools/free-ai-form-cases.mjs): built from the extension's real ask, fictional data only, every expectation names a field that is asked.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {formCases} from '../../tools/free-ai-form-cases.mjs';
import {APPLICANTS} from '../../tools/free-ai-form-applicants.mjs';

const demo = name => fs.readFileSync(new URL(`../../desktop/demo/${name}`, import.meta.url), 'utf8');

test('each case carries the real answer prompt, the demo profile, its fields and an expectation for a field that is asked', async () => {
  const cases = await formCases({profile: demo('profile.md'), answers: demo('answers.md')});
  assert.ok(cases.length >= 10);
  for (const item of cases) {
    const system = item.params.system.map(block => block.text).join('\n');
    assert.match(system, /You fill in a job application form/, `${item.id}: the app's own instructions`);
    // A case with its own fictional applicant (tools/free-ai-form-applicants.mjs) carries that applicant's profile instead of the demo's.
    if (item.applicant) assert.ok(system.includes(APPLICANTS[item.applicant].profile.split('\n').find(line => line.length > 40)), `${item.id}: its own applicant's profile`);
    else assert.match(system, /Alex Morgan/, `${item.id}: the fictional demo profile`);
    const asked = JSON.parse(item.params.messages[0].content.match(/<form_fields>\n([\s\S]*?)\n<\/form_fields>/)[1]).map(f => f.field);
    for (const id of Object.keys(item.expect)) assert.ok(asked.includes(id), `${item.id}: expects ${id}, which is not asked`);
    assert.equal(item.params.output_config.format.type, 'json_schema');
  }
});

test('the cases cover each kind of ask users hit: choice, legal, demographic with and without a decline option, contact, written, knockout', async () => {
  const cases = await formCases({profile: demo('profile.md'), answers: demo('answers.md')});
  const wanted = new Set(Object.values(Object.fromEntries(cases.flatMap(c => Object.entries(c.expect).map(([k, v]) => [`${c.id}.${k}`, v.category || (v.empty ? 'empty' : 'value')])))));
  for (const kind of ['legal', 'demographic', 'contact', 'written', 'value', 'empty']) assert.ok(wanted.has(kind), kind);
});
