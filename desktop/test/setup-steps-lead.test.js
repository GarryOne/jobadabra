// Setup steps: the lead under a title is one short line (facts as chips, detail in a fold), a single/small input is a centered card, the done banner is one quiet line.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {CV_FILES} from '../renderer/cv-files.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'renderer');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const html = read('index.html');
const steps = [...html.matchAll(/<div class="step" data-step="(\w+)">([\s\S]*?)(?=\n    <div class="step" data-step=|\n  <\/div>\n)/g)];

test('the lead under every setup title is one short line; longer wording sits in a fold', () => {
  assert.ok(steps.length >= 4, 'found the steps');
  for (const [, name, body] of steps) {
    for (const lead of body.matchAll(/<p class="muted (?:subtitle|magic-sub)"[^>]*>([^<]*)</g)) assert.ok(lead[1].length <= 90, `${name}: a lead of ${lead[1].length} characters: ${lead[1]}`);
  }
});

test('a single/small input is a centered card: the CV step is a magic card with one real button', () => {
  const cv = steps.find(([, name]) => name === 'cv')[2];
  assert.match(cv, /class="magic-stage"/);
  assert.match(cv, /data-magic/);
  assert.equal([...cv.matchAll(/class="[^"]*magic-go[^"]*"/g)].length, 1, 'one magic button');
  assert.match(cv, /id="cv-choose"/);
});

test('the done banner is one quiet line, not the old green alert box, and names the right step', () => {
  assert.doesNotMatch(html, /class="alert tone-good review-mode"/);
  assert.match(html, /<div class="review-mode" id="review-mode" hidden>/);
  // The strategy reference is numbered from the sidebar at runtime, including Welcome.
  assert.match(html, /replace your strategy at <span data-step-reference="draft">/);
});

test('the CV card names the accepted kinds from the one shared constant, which the main-side picker reads too', () => {
  assert.ok(CV_FILES.label && CV_FILES.extensions.length);
  assert.match(read('pages/activity-panel.js'), /CV_FILES\.label/);
  assert.match(fs.readFileSync(path.join(root, '..', 'lib', 'setup-handlers.js'), 'utf8'), /CV_FILES\.extensions/);
});
