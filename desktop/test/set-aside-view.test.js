// "Set aside" rows (renderer/pages/set-aside.js) appear under both Which-is-right cards, each with Undo wired to undoSetAside, and both handlers send the
// list with their answer (the class: every card that resolves a conflict shows what its pick set aside).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';

const read = file => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

test('every Which-is-right card draws the set-aside rows and its handler sends them', () => {
  const cards = [['renderer/pages/details-to-check.js', 'lib/details-facts-handlers.js', 'facts-set-aside'], ['renderer/pages/locations-which.js', 'lib/locations-handlers.js', 'locations-set-aside']];
  for (const [screen, handler, box] of cards) {
    assert.match(read(screen), /setAsideRows\(/, screen);
    assert.match(read(screen), new RegExp(`\\$\\('${box}'\\)`), screen);
    assert.match(read('renderer/index.html'), new RegExp(`id="${box}"`), box);
    assert.match(read(handler), /setAside: /, handler);
  }
  assert.match(read('renderer/pages/set-aside.js'), /window\.pilot\.undoSetAside\(entry\.id\)/);
  assert.match(read('preload.cjs'), /undoSetAside: call\('undoSetAside'\)/);
  assert.match(read('lib/locations-handlers.js'), /ipcMain\.handle\('undoSetAside'/);
});
