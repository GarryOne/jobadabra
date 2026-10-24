// tools/pr-assets.mjs hosts a PR's images in the repo that owns the PR: --repo=<owner/repo> beats GITHUB_REPOSITORY, which beats the public repo (owner, 24 Oct 2026).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {imageUrl, parseArgs} from '../../tools/pr-assets.mjs';

test('the target repo is --repo, else GITHUB_REPOSITORY, else the public repo; the tag and files are the rest', () => {
  assert.deepEqual(parseArgs(['t', 'a.png', 'b.png', '--repo=GarryOne/jobadabra-web'], {GITHUB_REPOSITORY: 'x/y'}), {tag: 't', files: ['a.png', 'b.png'], repo: 'GarryOne/jobadabra-web'});
  assert.equal(parseArgs(['t', 'a.png'], {GITHUB_REPOSITORY: 'x/y'}).repo, 'x/y');
  assert.equal(parseArgs(['t', 'a.png'], {}).repo, 'GarryOne/jobadabra');
  assert.deepEqual(parseArgs(['--repo=a/b', 't', 'a.png'], {}).files, ['a.png']);
});

test('the template tells a private-repo PR to host its images in the private repo', async () => {
  const {readFileSync} = await import('node:fs');
  assert.match(readFileSync(new URL('../../tools/pr-body-template.md', import.meta.url), 'utf8'), /--repo=GarryOne\/jobadabra-web/);
});

test('image URLs use github.com/<repo>/raw/<tag>/<file>, which renders in a private repo (raw.githubusercontent.com does not)', () => {
  assert.equal(imageUrl('GarryOne/jobadabra-web', 'pr-assets-x', 'after 1440.png'), 'https://github.com/GarryOne/jobadabra-web/raw/pr-assets-x/after%201440.png');
  assert.ok(!/raw\.githubusercontent/.test(imageUrl('a/b', 't', 'f.png')));
});

test('the template names the site shot tool', async () => {
  const {readFileSync} = await import('node:fs');
  assert.match(readFileSync(new URL('../../tools/pr-body-template.md', import.meta.url), 'utf8'), /page-shot\.mjs/);
});
