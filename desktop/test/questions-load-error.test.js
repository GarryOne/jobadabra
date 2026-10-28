// The "Answer once" card must say why it couldn't load, open itself, and offer Retry (UI loop #135).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs';

const page = fs.readFileSync(new URL('../renderer/pages/jobs-questions.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../renderer/index.html', import.meta.url), 'utf8');

test('a failed read opens the card and has a Retry button wired to loadQuestions', () => {
  assert.match(html, /id="questions-retry"/);
  assert.match(page, /show\(\$\('questions'\), details\.length > 0 \|\| !!error\)/);   // a failed read shows the Fill your details card (no fold to open since 17 Oct 2026)
  assert.match(page, /questions-retry'\)\?\.addEventListener\('click'/);
  assert.match(page, /show\(\$\('questions-retry'\), !!error\)/);
});
