// A checkbox with words beside it uses a shared part (.check-row, label.radio, .switch, .switch-row). A one-off label
// loses to `.panel-dialog label { display: block }` and `input { width: 100% }`: Tune my strategy drew each checkbox
// full width, centred above its words (6 Oct 2026).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const renderer = path.join(path.dirname(fileURLToPath(import.meta.url)), '../renderer');
const SHARED = ['check-row', 'radio', 'switch', 'switch-row'];
// Built in JS outside any dialog, with their own complete CSS (width: auto on the input).
const OWN_CSS = [];   // session-needs' Remember tick (ss-ask-save) went on 27 Oct 2026: Fill it in keeps the answer
const shared = classes => classes.split(/\s+/).some(name => SHARED.includes(name));

test('every checkbox label in a dialog of index.html uses a shared row', () => {
  const html = fs.readFileSync(path.join(renderer, 'index.html'), 'utf8');
  const dialogs = html.match(/<dialog[\s\S]*?<\/dialog>/g) || [];
  const labels = dialogs.flatMap(dialog => [...dialog.matchAll(/<label([^>]*)>\s*<input[^>]*type="checkbox"/g)].map(m => /class="([^"]*)"/.exec(m[1])?.[1] || ''));
  assert.ok(labels.length > 0, 'found no checkbox labels in dialogs: the pattern is stale');
  assert.deepEqual(labels.filter(classes => !shared(classes)), []);
});

test('every label the renderer builds around a checkbox uses a shared row', () => {
  const files = ['pages', '.'].flatMap(dir => fs.readdirSync(path.join(renderer, dir)).filter(f => f.endsWith('.js')).map(f => path.join(renderer, dir, f)));
  const builders = files.filter(file => fs.readFileSync(file, 'utf8').includes("type = 'checkbox'"));
  assert.ok(builders.length >= 3, `expected the checkbox builders (tune, cv-change, claude-offer), found ${builders.length}`);
  for (const file of builders) {
    const labels = [...fs.readFileSync(file, 'utf8').matchAll(/el\('label',\s*'([^']*)'/g)].map(m => m[1]);
    assert.ok(labels.length > 0, `${path.basename(file)} builds a checkbox but no label`);
    for (const classes of labels) assert.ok(shared(classes) || OWN_CSS.some(name => classes.split(/\s+/).includes(name)), `${path.basename(file)}: label '${classes}' is a one-off; use .check-row`);
  }
});
