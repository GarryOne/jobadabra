// Your details' fact cards read as a calm summary (owner, 21 Oct 2026: "ugly, too disorganized, too crowded"; renderer/fact-summary.js): the class test loops over
// every fact card with a many-entry profile and fails on a grid of more than two columns, a "Check" on a cell, or a card that skips the shared summary.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {install} from './tiny-dom.js';

install();
const read = file => fs.readFileSync(new URL(`../renderer/${file}`, import.meta.url), 'utf8');
const {SHOWN, shortValue, summaryLines, summaryView, eligibilityView, checkBadge, checkCount} = await import('../renderer/fact-summary.js');

const SPONSOR = 'No, I will require visa sponsorship';
const MANY = [{label: 'Nationality', value: 'British'}, {label: 'Switzerland', value: 'allowed, B permit', check: true},
  {label: 'Authorised to work in Switzerland?', value: 'Yes — B permit, EU citizen (Romania). No sponsorship needed.', check: true},
  {label: 'Authorised to work in the UK?', value: SPONSOR, check: true}, {label: 'Authorised to work in the US?', value: SPONSOR, check: true},
  {label: 'Authorised to work in Australia?', value: SPONSOR, check: true}, {label: 'Will you now or in the future require visa sponsorship?', value: 'Yes for UK, US, Australia, UAE roles; No for Switzerland and EU roles'},
  {label: 'Salary expectation, UK', value: '120000 GBP/year'}, {label: 'Empty line', value: ''}];

test('lines with the same answer and the same first words join into one, the answer once; the full words stay on hover', () => {
  const lines = summaryLines(MANY);
  const joined = lines.find(line => line.label === 'UK · US · Australia');
  assert.ok(joined, `the three sponsorship lines join: ${lines.map(line => line.label)}`);
  assert.equal(joined.value, SPONSOR);
  assert.match(joined.title, /Authorised to work in the UK\?/);
  assert.equal(lines.length, 6, 'a line with no value is left out, three become one');
  assert.equal(lines.find(line => line.label.startsWith('Will you')).title.includes('Yes for UK, US'), true, 'nothing is dropped: the whole answer is on hover');
});

test('a long value is cut at its first clause or a word, never invented', () => {
  assert.equal(shortValue('Yes — B permit, EU citizen (Romania). No sponsorship needed.'), 'Yes — B permit, EU citizen');
  assert.ok(shortValue('word '.repeat(30)).endsWith('…'));
  assert.equal(shortValue('B2'), 'B2');
});

test('class: the summary is at most two columns, shows the first few lines and folds the rest, and no cell carries a Check', () => {
  const view = summaryView(MANY);
  assert.equal(view.querySelectorAll('.ui-pill').length, 0, 'Check is counted once in the card title, never on a cell');
  const grids = view.querySelectorAll('.fact-sum-grid');
  assert.equal(grids[0].children.length, SHOWN);
  assert.equal(grids[1].hidden, true, 'the rest start folded');
  assert.match(view.textContent, /Show all 6/);
  const css = read('roomy-cards.css');
  assert.match(css, /\.fact-sum-grid \{[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/, 'two columns, no more');
  assert.doesNotMatch(css, /\.fact-sum[^{]*\{[^}]*repeat\((auto-fit|[3-9])/);
});

test('the count of lines to check is one pill "N to check" in the title, none when nothing is unclear', () => {
  assert.equal(checkCount(MANY), 3, 'joined lines count once');
  assert.equal(checkBadge(3).textContent, '3 to check');
  assert.equal(checkBadge(0), null);
});

test('class: every fact card of Your details draws through the shared summary (a new card without it fails here)', () => {
  const source = read('pages/details-read.js');
  const facts = [...source.matchAll(/draw: \(\) => drawFacts\('(\w+)'\)/g)].map(match => match[1]);
  assert.deepEqual(facts, ['eligibility', 'availability', 'languages']);
  assert.match(source, /languagesView\(lines, chipLine\) : summaryView\(lines\)/);
  assert.doesNotMatch(source, /factColumns\(factRows/, 'no per-cell grid of saved questions');
  assert.match(source, /checkBadge\(eligibility \? eligibility\.check : checkCount\(lines\)\)/);
  assert.match(source, /eligibilityView\(lines, chipLine\)/, 'Work eligibility reads as Nationality + where you may work (#2322)');
});

test('class: the fact editors and the survey editor are one aligned grid with a footer for Done', () => {
  const css = read('question-review.css');
  assert.match(css, /\[data-facts\] > \.fact-line \{ display: grid; grid-template-columns: 220px/);
  assert.match(css, /\.survey-rows \.survey-row \{ display: grid; grid-template-columns: 200px 260px/);
  assert.match(read('card-shell.css'), /\.card-done-slot:not\(:empty\) \{[^}]*border-top/);
  const survey = read('survey-rows.js');
  assert.match(survey, /\+ Add another note/, 'one Notes for the AI box, never an empty twin');
});

// Why (28 Oct 2026, owner: "let's remove these 3 fields"): neither the read view nor the editor draws an old line still asked; the editor is in test/details-facts-old-lines.test.js.
test('the 3 old ❓ eligibility lines are drawn on no Work eligibility screen', () => {
  const OLD = ['Work permit / visa', 'Authorised to work in Iasi, Romania?', 'Remote from your base for a foreign employer?'].map(label => ({label, value: '❓ your citizenship and status'}));
  const view = eligibilityView([{label: 'Nationality', value: 'Romania'}, ...OLD], lines => lines.map(line => line.text).join(' '));
  assert.doesNotMatch(view.node.textContent,/Work permit|Iasi|Remote from/);
  assert.equal(view.check, 0);
});
