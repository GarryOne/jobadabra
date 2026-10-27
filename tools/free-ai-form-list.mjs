// The invented forms of the Free AI form-answer eval, with what a right answer is for the demo applicant (desktop/demo/profile.md, answers.md). Data only, no worker import,
// so the desktop tests read it without the worker's packages (#2207: the desktop CI job has no @anthropic-ai/sdk). Built into requests by tools/free-ai-form-cases.mjs.
export const field = (id, label, type, options, required = true) => ({field: id, label, type, required, ...(options ? {options} : {})});
// rests: the demo lines (desktop/demo/profile.md, answers.md) an expected answer rests on; desktop/test/free-ai-eval.test.js fails when the demo stops saying one
// (16 -> 17 Oct 2026: the demo gained a saved gender and a second notice period, and two cases kept expecting the old answers).
export const FORMS = [
  {id: 'permit', fields: [field('sponsor', 'Will you now or in the future require sponsorship to work in Switzerland?', 'radio', ['Yes', 'No'])],
    expect: {sponsor: {value: ['No']}}, rests: ['Work permit: EU citizen (no sponsorship needed in Switzerland or the EU)']},
  {id: 'hybrid', fields: [field('hybrid', 'Are you comfortable working hybrid from our Zurich office?', 'radio', ['Yes', 'No'])],
    expect: {hybrid: {value: ['Yes']}}, rests: ['**Work mode:** Hybrid']},
  {id: 'notice', fields: [field('notice', 'Notice period', 'select', ['Immediately', '1 month', '2 months', '3 months', 'More than 3 months'])],
    expect: {notice: {value: ['2 months', '3 months'], use: 'propose'}}, rests: ['Notice period: 2 months', '| Notice period / earliest start | 3 months |']},   // the saved facts disagree: the applicant picks
  {id: 'german', fields: [field('german', 'German level', 'select', ['None', 'A1-A2', 'B1', 'B2', 'C1', 'Native'])],
    expect: {german: {value: ['B1']}}, rests: ['German (B1)']},
  {id: 'consent', fields: [field('privacy', 'I agree to the processing of my personal data as described in the privacy notice.', 'checkbox')],
    expect: {privacy: {empty: true, category: 'legal'}}},
  {id: 'gender-saved', fields: [field('gender', 'Gender (voluntary)', 'select', ['Female', 'Male', 'Non-binary', 'Prefer not to say'], false)],
    expect: {gender: {value: ['Male'], category: 'demographic'}}, rests: ['- Gender identity: Man']},   // the survey's own answer beats the general "decline" row
  {id: 'religion-decline', fields: [field('religion', 'Religion or belief (voluntary)', 'select', ['Christian', 'Muslim', 'Jewish', 'No religion', 'Prefer not to say'], false)],
    expect: {religion: {value: ['Prefer not to say'], category: 'demographic'}}},   // nothing saved for it: the decline option
  {id: 'salutation', fields: [field('salutation', 'Salutation', 'radio', ['Mr', 'Ms'])],
    expect: {salutation: {empty: true, category: 'demographic'}}},
  {id: 'name', fields: [field('first', 'First name', 'text'), field('last', 'Last name', 'text')],
    expect: {first: {value: ['Alex'], category: 'contact'}, last: {value: ['Morgan'], category: 'contact'}}, rests: ['# Alex Morgan']},
  {id: 'salary', fields: [field('pay', 'Salary expectation (CHF per year)', 'text')],
    expect: {pay: {match: '1[34]\\d'}}},
  {id: 'why', fields: [field('why', 'Why do you want to work with us?', 'textarea')],
    expect: {why: {category: 'written', match: '\\w{3}'}}},
  {id: 'record', fields: [field('record', 'Do you have a criminal record?', 'radio', ['Yes', 'No'])],
    expect: {record: {empty: true}}},
  {id: 'mixed', fields: [field('sponsor', 'Do you need a visa to work in Switzerland?', 'radio', ['Yes', 'No']), field('start', 'Earliest start date', 'text'),
    field('src', 'How did you hear about us?', 'select', ['Website', 'Friend', 'Job board', 'Other']), field('terms', 'I confirm that all information is true and complete.', 'checkbox')],
    expect: {sponsor: {value: ['No']}, terms: {empty: true, category: 'legal'}}, rests: ['Work permit: EU citizen (no sponsorship needed in Switzerland or the EU)']},
];
