import test from 'node:test';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {branch, title} from '../lib/dev-marker.js';

test('the window title says DEV and the branch only when running from source', () => {
  assert.equal(title(false, 'main'), 'Jobadabra');
  assert.equal(title(true, 'dev-marker'), 'Jobadabra · DEV · dev-marker');
  assert.equal(title(true, ''), 'Jobadabra · DEV');
});

test('no git (a packaged app, a copy without .git): no branch, no crash', () => {
  assert.equal(branch('/', () => { throw new Error('not a git repository'); }), '');
  assert.equal(branch('/', () => 'main\n'), 'main');
});

// Owner, 8 Oct 2026: the twin and the DEV app looked alike in the Dock and the title bar ("so that we can distinguish").
test('a live-test twin says TWIN where a source run says DEV: title, Dock badge, sidebar tag', async () => {
  const {mark} = await import('../lib/dev-marker.js');
  assert.equal(mark({}), 'DEV');
  assert.equal(mark({JOBADABRA_TWIN: '1'}), 'TWIN');
  assert.equal(title(true, 'main', 'TWIN'), 'Jobadabra · TWIN · main');
  assert.equal(title(false, '', 'TWIN'), 'Jobadabra · TWIN');        // a twin is never mistaken for the installed app either
  assert.equal(title(false, '', 'DEV'), 'Jobadabra');
  const read = file => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
  assert.match(read('main.js'), /app\.dock\?\.setBadge\(devMarker\.mark\(\)\)/);
  assert.match(read('main.js'), /mark: devMarker\.mark\(\)/);
  assert.match(read('renderer/pages/core.js'), /textContent: shared\.state\.about\.mark \|\| 'DEV'/);
});
