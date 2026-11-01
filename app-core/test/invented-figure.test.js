// A number the AI types into a text box must come from what it was given (17 Oct 2026, Hadrian: "How many years of experience do you have with AWS?" typed "4 years of hands-on AWS"
// while the profile says 8 years and no line says 4). Otherwise it is only proposed. Guard: app-core/src/answer-facts.js floorInventedFigure.
import test from 'node:test';
import assert from 'node:assert/strict';
import { floorInventedFigure } from '../src/answer-facts.js';

const given = 'Senior SRE with 8 years running Kubernetes on AWS. Acme Cloud 2022 - Present. Notice period: 3 months.';
const fill = (value, extra = {}) => ({ field: 'f', value, use: 'fill', category: 'normal', ...extra });
const floor = (answer, label = 'How many years of experience do you have with AWS?', type = 'text', env = {}) => floorInventedFigure(answer, label, given, type, env);

test('a number the facts never state is only proposed', () => {
  assert.equal(floor(fill('4 years of hands-on AWS at Acme Cloud')).use, 'propose');
  assert.equal(floor(fill('I led a team of 12'), 'Describe your experience', 'textarea').use, 'propose');
});

test('a number in the facts or in the question is typed', () => {
  assert.equal(floor(fill('8 years, mostly on EKS')).use, 'fill');
  assert.equal(floor(fill('3 months')).use, 'fill');
  assert.equal(floor(fill('Since 2022')).use, 'fill');
  assert.equal(floor(fill('5'), 'Rate yourself from 1 to 5').use, 'fill');
});

test('answers with no number, other boxes and other kinds are left alone', () => {
  assert.equal(floor(fill('Kubernetes and Terraform')).use, 'fill');
  assert.equal(floor(fill('4'), 'Years with AWS', 'number').use, 'fill');
  assert.equal(floor(fill('+41 79 555 01 23', { category: 'contact' })).use, 'fill');
  assert.equal(floor(fill('CHF 181000', { fact: 'salary' })).use, 'fill');
  assert.equal(floor(fill('CHF 181000', { converted: { from: 'CHF', to: 'USD' } })).use, 'fill');
  assert.equal(floor(fill('• Add: one project with 40 users', { category: 'written' })).use, 'fill');
  assert.equal(floor(fill('4 years'), undefined, 'text', { test: true }).use, 'fill');
  assert.equal(floor(fill('4 years', { use: 'propose' })).use, 'propose');
});
