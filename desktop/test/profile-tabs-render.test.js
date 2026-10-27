// Settings → Profile's tabs really render from each store's outline (tiny DOM, test/tiny-dom.js): this Mac's Markdown and Notion's blocks give the
// same tab, with no textarea and no ❓ on screen (owner, 16 Oct 2026), and an answer typed and saved is one block edit of that store's page.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {outline} from '../lib/store/markdown-page.js';
import {pageBar, pressSave} from './page-bar.js';
import {install} from './tiny-dom.js';

const body = install();
const demo = file => fs.readFileSync(new URL(`../demo/${file}`, import.meta.url), 'utf8');
const row = (id, ...cells) => ({id, type: 'table_row', cells});
// Notion's shape of the owner's pages (16 Oct 2026 screenshots): a title heading, tables with a header row, plain bullets, an intro paragraph.
const NOTION = {
  answers: [{id: 'h0', type: 'heading_1', text: '📝 Application Answers — Standard Form Fields'}, {id: 'c0', type: 'callout', text: 'Fields marked ❓ are still open.'},
    {id: 'h1', type: 'heading_2', text: 'Eligibility'}, {id: 't1', type: 'table', header: true, rows: [row('r0', 'Question', 'Answer'),
      row('r1', 'Authorised to work in [your home country/region]?', '❓'), row('r2', 'Remote from your base for a foreign employer?', 'Yes')]},
    {id: 'h2', type: 'heading_2', text: 'Availability and pay'}, {id: 't2', type: 'table', header: true, rows: [row('r3', 'Question', 'Answer'),
      row('r4', 'Salary expectation — Switzerland', '❓ (salary is not a priority; estimated floor CHF 48,000 a year)'), row('r5', 'If a salary field is optional', 'Leave blank')]},
    {id: 'b1', type: 'bulleted_list_item', text: 'GitHub: ❓'}, {id: 'b2', type: 'bulleted_list_item', text: 'Website / portfolio: ❓ optional'}],
  knowledge: [{id: 'p0', type: 'paragraph', text: 'What Jobadabra learned from your form fills, used by every later kit and fill.'},
    {id: 'k1', type: 'bulleted_list_item', text: '[jobs.example.test · answer] Name :: Field ID x asks for last name only. → "Doe"'},
    {id: 'k2', type: 'bulleted_list_item', text: '[any · option] Salutation: the form offers Mr / Ms'}],
};
NOTION.profile = [{id: 'p1', type: 'heading_1', text: 'Hard constraints'}, {id: 'p2', type: 'callout', text: 'Fields marked ❓ are still open.'},
  {id: 'p3', type: 'table', header: true, rows: [row('q0', 'Constraint', 'Value'), row('q1', 'Countries', 'Switzerland, Germany'), row('q2', 'Work mode', 'Hybrid or remote'),
    row('q3', 'Languages I can work in', 'English (fluent), German (B1)'), row('q4', 'Workload', '❓ full-time or a percentage'), row('q5', 'Minimum seniority', '❓')]},
  {id: 'p4', type: 'heading_1', text: 'Compensation'}, {id: 'p5', type: 'bulleted_list_item', text: 'Target: ❓'},
  {id: 'p6', type: 'heading_1', text: 'Summary (from CV)'}, {id: 'p7', type: 'paragraph', text: 'Engineer with 8 years of AWS.'}];
const LOCAL = {answers: outline(demo('answers.md')), knowledge: outline(demo('knowledge.md')), profile: outline(demo('profile.md'))};
// Every tab of Settings → Profile drawn from an outline: a new one is added here (the class, not the case).
const TABS = {answers: {load: 'loadApplicationAnswers', file: 'application-answers', body: 'answers-body'},
  preferences: {load: 'loadPreferences', file: 'job-preferences', body: 'preferences-body'}};   // Strategy's Job preferences (was this page's tab)

for (const [store, items] of Object.entries({sqlite: LOCAL, notion: NOTION})) {
  test(`${store}: Application answers shows the review banner, the saved answers and the website questions, with no textarea and no ❓`, async () => {
    const sent = [];
    const calls = {textOutline: async name => ({ok: true, items: items[name], store, link: null}),
      textEdit: async (name, changes) => { sent.push([name, changes]); return {ok: true, items: items[name], store}; }};
    globalThis.window.pilot = new Proxy(calls, {get: (all, key) => all[key] || (() => null)});   // any other call: nothing
    const node = globalThis.document.createElement('div');
    node.id = 'answers-body';
    body.replaceChildren(node);
    const {loadApplicationAnswers} = await import('../renderer/pages/application-answers.js');
    await loadApplicationAnswers();
    node.querySelectorAll('.segmented button').find(button => button.dataset.view === 'all').click();
    const text = node.textContent;
    assert.equal(node.querySelectorAll('textarea').length, 0, 'no textarea');
    assert.ok(!text.includes('❓'), 'no ❓ on screen');
    assert.match(text, /\d+ questions? needs? your review/, 'one banner instead of the Needs review list');
    assert.match(text, /Website-specific questions/);
    assert.match(text, /Not set/);
    // Saved answers: one card, a header per section, one line per answer with no button (owner's mockup, 17 Oct 2026).
    const saved = node.querySelector('.qa-saved');
    assert.ok(saved.querySelectorAll('.qa-group').length, 'section headers drawn');
    assert.equal(saved.querySelectorAll('.qa-row button.qa-add').length, 0, 'no per-row button');
    // Needs review: an optional row is not in it (owner, 17 Oct 2026).
    assert.ok(node.querySelector('#answers-review-go'), 'the banner opens the question review (pages/question-review.js)');
    node.querySelectorAll('.segmented button').find(button => button.dataset.view === 'review').listeners.click[0]();   // the Needs review list
    assert.ok(!/portfolio/i.test(node.querySelector('.is-review').textContent), 'an optional row is not in Needs review');
    node.querySelector('.qa-add').click();
    const field = node.querySelector('.qa-edit input');
    field.value = 'Yes, EU citizen';
    field.dispatch('input');
    assert.equal((await pageBar(node)).hidden, false, 'the save bar shows a draft');
    await pressSave(node);
    assert.equal(sent.length, 1);
    const [[name, [change]]] = sent;
    assert.equal(name, 'answers');
    assert.ok(change.op === 'cell' ? change.value === 'Yes, EU citizen' && change.index === 1 : /Yes, EU citizen$/.test(change.value), JSON.stringify(change));
  });
}

for (const [store, items] of Object.entries({sqlite: LOCAL, notion: NOTION})) {
  for (const [name, {load, file, body: bodyId}] of Object.entries(TABS)) {
    test(`${store}: the ${name} tab has no textarea and no ❓ on screen`, async () => {
      const calls = {textOutline: async text => ({ok: true, items: items[text], store, link: null})};
      globalThis.window.pilot = new Proxy(calls, {get: (all, key) => all[key] || (() => null)});
      const node = globalThis.document.createElement('div');
      node.id = bodyId;
      body.replaceChildren(node);
      await (await import(`../renderer/pages/${file}.js`))[load]();
      assert.ok(node.textContent.length > 50, 'it drew something');
      assert.equal(node.querySelectorAll('textarea').length, 0);
      assert.ok(!node.textContent.includes('❓'), node.textContent.match(/.{0,40}❓.{0,40}/)?.[0]);
    });
  }
}

test('Job preferences: a workload typed writes only its own cell, on the Notion shape; Countries are Locations\' (Strategy), not drawn here', async () => {
  const sent = [];
  globalThis.window.pilot = new Proxy({textOutline: async () => ({ok: true, items: NOTION.profile, store: 'Notion'}),
    textEdit: async (name, changes) => { sent.push([name, changes]); return {ok: true, items: NOTION.profile}; }}, {get: (all, key) => all[key] || (() => null)});
  const node = globalThis.document.createElement('div');
  node.id = 'preferences-body';
  body.replaceChildren(node);
  await (await import('../renderer/pages/job-preferences.js')).loadPreferences();
  assert.equal(node.querySelectorAll('.chip .x').filter(button => button.ariaLabel === 'Remove Germany').length, 0, 'no Countries chips here');
  const minimum = node.querySelectorAll('input').find(input => input.ariaLabel === 'Workload (minimum %)');
  minimum.value = '60';
  minimum.listeners.input[0]();
  await pressSave(node);
  assert.deepEqual(sent, [['profile', [{op: 'cell', id: 'q4', index: 1, value: '60%', was: '❓ full-time or a percentage'}]]]);
});
