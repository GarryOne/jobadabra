// The collapsible panel: the whole head bar toggles (not only the chevron); CV check uses it.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';

const read = f => readFileSync(new URL(`../renderer/${f}`, import.meta.url), 'utf8');

test('the whole head bar is the toggle, with keyboard and aria', () => {
  const body = read('components.js');
  assert.match(body, /bar\.addEventListener\('click'/);
  assert.match(body, /setAttribute\('role', 'button'\)/);
  assert.match(body, /aria-expanded/);
  assert.match(body, /event\.key !== 'Enter' && event\.key !== ' '/);
});
test('collapsed keeps only the bar', () => {
  assert.match(read('components.css'), /\.panel\.is-collapsed > :not\(\.panel-top\) \{ display: none/);
});
test('every panel that opts in is wired through the shared function', () => {
  assert.match(read('profile-fold.js'), /collapsiblePanel\(panel, panel\.id/);   // every Profile card, through renderer/profile-fold.js
});

// The class (owner, 17 Oct 2026): every chevron fold is a whole bar, never only its small arrow.
const listing = (dir) => readdirSync(new URL(`../renderer/${dir}`, import.meta.url)).filter(f => f.endsWith('.js')).map(f => `${dir}${f}`.replace(/^\.\//, ''));
const sources = ['', 'pages/', 'job-drawer/'].flatMap(d => listing(d || './'));
// Each file that draws a chevron fold, and how its whole bar toggles. A new file with a chevron fails here until it is listed.
const CHEVRON_FILES = {
  'components.js': 'collapsiblePanel + toggleOnBar',
  'page-parts.js': 'reviewList: the whole detail row and the Reviewed line toggle (a <details> summary)',
  'pages/application-answers.js': 'toggleOnBar',
  'pages/activity-mail.js': 'the fold is one full-width button',
  'interview-insight.js': 'the bar folds, the arrow bubbles',
  'pages/jobs-fit.js': 'Collapse button, not a fold bar',
  'pages/jobs-render.js': 'the fit cell opens the breakdown',
  'pages/session-next-step.js': 'a link line, not a fold',
  'funnel-view.js': 'a separator arrow, not a fold',
  'job-drawer/header.js': 'previous / next buttons, not a fold',
  'pages/question-review.js': 'the arrow on Confirm & next, not a fold',
  'question-nav.js': 'previous / next arrows and the list button, not a fold',
  'pages/experience.js': 'native <details>: the whole job row toggles',
  'gaps-rows.js': 'native <details>: the whole Reviewed line toggles',
  'cv-check-view.js': 'native <details>: the whole summary row toggles',
  'multi-select.js': 'a dropdown button: its chevron turns down, the whole button opens the list',
  'survey-rows.js': 'native <details>: the whole Saved preferences row toggles',
};
test('every file that draws a chevron is accounted for', () => {
  const found = sources.filter(f => /(icon|control)\('chevron'/.test(read(f)));
  assert.deepEqual(found.sort(), Object.keys(CHEVRON_FILES).sort());
});
test('rows with their own chevron button toggle on the whole bar, with the pointer cursor', () => {
  assert.match(read('components.js'), /export function toggleOnBar/);
  assert.match(read('components.css'), /\.is-bar-toggle \{ cursor: pointer; \}/);
  assert.match(read('pages/application-answers.js'), /toggleOnBar\(head, toggle\)/);
  assert.match(read('pages/activity.js'), /toggleOnBar\(document\.querySelector\('#activity-warnings \.ap-warn-head'\)/);
});
test('long detail cards start closed, forms stay open; Work history starts open (owner, 18 Oct 2026, mockup 09)', () => {
  assert.match(read('pages/profile.js'), /foldProfilePanels\(\{closed: new Set\(\['setting-experience-sources', 'setting-details-profile'\]\)\}\)/);
});

// Owner, 18 Oct 2026: Edit on a card redraws it and removes its own button, so the click reached the bar with a detached target and folded the card.
test('a control that left the page during its own click still does not toggle the bar', async () => {
  (await import('./tiny-dom.js')).install();
  const {isInteractiveTarget} = await import('../renderer/components.js');
  const bar = {}, button = {matches: sel => sel.includes('button'), closest: () => null}, text = {matches: () => false, closest: () => null};
  assert.equal(isInteractiveTarget(button, bar, {composedPath: () => [button, {matches: () => false}, bar]}), true);
  assert.equal(isInteractiveTarget(text, bar, {composedPath: () => [text, bar]}), false);
});
test('every collapsible bar ends in one right-side group: loose buttons and the chevron after the title', () => {
  const body = read('components.js'), css = read('components.css');
  assert.match(body, /actions\.prepend\(\.\.\.loose\)[\s\S]*actions\.append\(icon\('chevron'/);
  assert.match(css, /\.panel-actions \{[^}]*margin-left: auto/);
});
