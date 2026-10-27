// The one-time "stronger letters with your own key" hint (owner, 16 Oct 2026): quality words only, shown once, on every screen that shows AI-written text.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {HINT, TEXT, hintWanted as wanted, usingFree} from '../renderer/ai-engine-view.js';

const renderer = fileURLToPath(new URL('../renderer/', import.meta.url));
const files = dir => fs.readdirSync(dir, {withFileTypes: true}).flatMap(e => (e.isDirectory() ? files(path.join(dir, e.name)) : e.name.endsWith('.js') ? [path.join(dir, e.name)] : []));

test('the hint is for Free AI only, and only until shown once', () => {
  assert.equal(wanted({aiFree: true}), true);
  assert.equal(wanted({aiTrial: true, aiEngine: 'api'}), true);
  assert.equal(wanted({aiFree: true, ownKeyHintSeen: true}), false, 'once');
  assert.equal(wanted({aiFree: true, aiEngine: 'cli'}), false, 'a later pick of another engine wins');
  assert.equal(wanted({}), false, 'an own key: nothing to say');
  assert.equal(usingFree({aiFree: true, aiEngine: 'codex'}), false);
});

test('every screen that shows an AI-written letter or kit shows the hint (the class, not one screen)', () => {
  // The producers: the profile letter draft, the prep kit built, the application kit in the drawer.
  const producers = files(renderer).filter(file => /pilot\.coverLetterDraft\(|pilot\.interviewPrep\(|function preparationView/.test(fs.readFileSync(file, 'utf8')));
  assert.ok(producers.length >= 3, `found ${producers.map(f => path.basename(f))}`);
  for (const file of producers) assert.match(fs.readFileSync(file, 'utf8'), /own-key-hint\.js/, `${path.basename(file)} shows the hint`);
});

test('the words are about quality: no number, never extra applications', () => {
  for (const text of [HINT.text, TEXT.ownQuality]) {
    assert.doesNotMatch(text, /\d|%|percent|more applications|extra applications|free 20/i, text);
  }
  assert.match(TEXT.ownQuality, /^Better letters and interview prep; uses your own subscription or key\.$/);
  assert.equal(HINT.text, 'Free AI wrote this, and it is a bit weaker than Pro\'s AI. Want stronger letters? Connect your Claude account or ChatGPT.');   // + the weaker line, owner 27 Oct 2026
});

test('Settings → Connections → AI shows the quality line under the Claude / ChatGPT cards', () => {
  const src = fs.readFileSync(new URL('../renderer/pages/ai-engine.js', import.meta.url), 'utf8');
  assert.match(src, /familyCards\(\), el\('p', 'muted small engine-quality', TEXT\.ownQuality\)/);
});
