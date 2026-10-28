// The panel's footer names the extension build (owner, 11 Oct 2026: a bug screenshot did not say which version ran, so the cause could not be placed on a build).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readPanel} from '../../worker/test/helpers/panel.js';

const review = readPanel();

test('the panel footer carries the extension version in its text and its tooltip', () => {
  assert.match(review, /const version = chrome\.runtime\.getManifest\(\)\.version;/);
  assert.match(review, /stateLine\.textContent = `\$\{word\} · v\$\{version\}\$\{build\?\.label \? ` · \$\{build\.label\}` : ''\}`;/, 'the version and the build stay in the footer line');
  assert.match(review, /Jobadabra extension v\$\{version\}/, 'and in its tooltip');
});
