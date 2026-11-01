// npm run shot --theme sets JOBADABRA_THEME (main.js applyTheme reads it before the saved setting): a data-theme attribute does nothing (the CSS follows Electron's theme source), so a "light" shot was dark.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const shot = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'shot.mjs'), 'utf8');

test('shot.mjs takes --theme as a valued option and sets the app\'s JOBADABRA_THEME, the one mechanism', () => {
  assert.match(shot, /VALUED = \[[^\]]*'theme'/);
  assert.match(shot, /env\.JOBADABRA_THEME = option\('theme'\)/);
  assert.doesNotMatch(shot, /\{theme: option/, 'not a second path through settings.json');
  assert.match(shot, /--theme <light\|dark>/, 'documented in the header');
});
