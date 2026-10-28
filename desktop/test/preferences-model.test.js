// Preferences from the Profile's outline (renderer/preferences-model.js): this Mac's Markdown and Notion's blocks give the same fields; a control
// writes back only its own cell or line, a missing field is added as one line, and nothing of the page is lost.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {outline} from '../lib/store/markdown-page.js';
import {FIELDS, chipsOf, fieldChange, languagesOf, languagesText, modesOf, modesText, readProfile, workloadOf, workloadText} from '../renderer/preferences-model.js';

// Notion's shape of a Profile page (the template's blocks, made-up values).
const row = (id, ...cells) => ({id, type: 'table_row', cells});
const NOTION_OUTLINE = [
  {id: 'd0', type: 'callout', text: 'The AI scorer reads this page at every run to judge how well each job fits. Fields marked ❓ are still open.'},
  {id: 'd1', type: 'heading_1', text: 'Hard constraints'},
  {id: 'd2', type: 'paragraph', text: 'Jobs that break these are filtered out before any AI scoring.'},
  {id: 'd3', type: 'table', header: true, rows: [row('r0', 'Constraint', 'Value'), row('r1', 'Countries', 'Switzerland (anywhere), plus Berlin, London, or remote roles'),
    row('r2', 'Home base', 'Zurich today; open to relocating'), row('r3', 'Work mode', 'On-site, hybrid or remote'), row('r4', 'Work permit / visa', 'EU citizen; no sponsorship needed in the EU'),
    row('r4b', 'Nationality', 'Romania'), row('r5', 'Languages I can work in', 'English (fluent), German (B1)'), row('r6', 'Minimum seniority', 'Senior'), row('r7', 'Workload', '❓ full-time or a percentage'),
    row('r8', 'Recruiter listings', '❓ allow, down-rank or exclude')]},
  {id: 'd4', type: 'heading_1', text: 'Compensation'},
  {id: 'd5', type: 'bulleted_list_item', text: 'Target: CHF 150k gross'},
  {id: 'd6', type: 'bulleted_list_item', text: 'Minimum acceptable: CHF 130k gross'},
  {id: 'd7', type: 'heading_1', text: 'Summary (from CV)'},
  {id: 'd8', type: 'paragraph', text: 'Site reliability engineer with 8 years of AWS, Kubernetes and observability.'},
];

const LOCAL = `# Hard constraints\n\nJobs that break these are filtered out before any AI scoring.\n\n| Constraint | Value |\n|---|---|\n| Countries | Switzerland (anywhere), plus Berlin, London, or remote roles |\n| Home base | Zurich today; open to relocating |\n| Work mode | On-site, hybrid or remote |\n| Work permit / visa | EU citizen; no sponsorship needed in the EU |\n| Nationality | Romania |\n| Languages I can work in | English (fluent), German (B1) |\n| Minimum seniority | Senior |\n| Workload | ❓ full-time or a percentage |\n| Recruiter listings | ❓ allow, down-rank or exclude |\n\n# Compensation\n\n- Target: CHF 150k gross\n- Minimum acceptable: CHF 130k gross\n\n# Summary (from CV)\n\nSite reliability engineer with 8 years of AWS, Kubernetes and observability.\n`;

test('this Mac and Notion: the same fields, other rows and rest', () => {
  const shapes = [readProfile(outline(LOCAL)), readProfile(NOTION_OUTLINE)];
  for (const read of shapes) {
    assert.equal(read.fields.countries.value, 'Switzerland (anywhere), plus Berlin, London, or remote roles');
    assert.equal(read.fields.seniority.value, 'Senior');
    assert.equal(read.fields.nationality.value, 'Romania', 'Your details\' Nationality, not an other row (#2322)');
    assert.equal(read.fields.workload.open, true, '❓ = not set');
    assert.equal(read.fields.workload.value, '');
    assert.equal(read.fields.target.value, 'CHF 150k gross');
    assert.equal(read.fields.relocation, null, 'not on the page');
    assert.deepEqual(read.other.map(item => item.label), ['Recruiter listings']);
    assert.ok(read.rest.some(entry => /Site reliability engineer/.test(entry.text || '')));
  }
  assert.deepEqual(Object.keys(shapes[0].fields), FIELDS.map(field => field.key));
});

test('a control writes its own cell or line; a missing field is one new line after the known sections', () => {
  const read = readProfile(outline(LOCAL));
  assert.deepEqual(fieldChange(FIELDS.find(f => f.key === 'seniority'), read.fields.seniority, 'Staff or higher'),
    {op: 'cell', id: read.fields.seniority.id, index: 1, value: 'Staff or higher', was: 'Senior'});
  const target = fieldChange(FIELDS.find(f => f.key === 'target'), read.fields.target, 'CHF 160k');
  assert.deepEqual([target.op, target.value], ['text', 'Target: CHF 160k']);
  const relocation = fieldChange(FIELDS.find(f => f.key === 'relocation'), null, 'Yes', read.anchor);
  assert.deepEqual(relocation, {op: 'insert', after: read.anchor, key: 'relocation', lines: ['Relocation: Yes']});
  assert.equal(fieldChange(FIELDS.find(f => f.key === 'seniority'), read.fields.seniority, '').value, '❓', 'emptied: not set again');
});

test('chips, languages, work modes and workload read and write their text', () => {
  assert.deepEqual(chipsOf('Switzerland, Germany; Austria'), ['Switzerland', 'Germany', 'Austria']);
  assert.deepEqual(languagesOf('English (fluent), German (B1), Romanian'), [{name: 'English', level: 'fluent'}, {name: 'German', level: 'B1'}, {name: 'Romanian', level: ''}]);
  assert.equal(languagesText([{name: 'French', level: 'Native'}, {name: ' ', level: 'B1'}]), 'French (Native)');
  assert.deepEqual(modesOf('On-site, hybrid or remote'), ['On-site', 'Hybrid', 'Remote']);
  assert.equal(modesText(['Remote', 'Hybrid']), 'Hybrid, Remote');
  assert.deepEqual(workloadOf('80–100%'), {min: '80', max: '100'});
  assert.equal(workloadText({min: '50', max: '100'}), '50–100%');
  assert.equal(workloadText({min: '', max: ''}), '');
});
