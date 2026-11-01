// The repos' owner is named once (lib/repos.js) and the app survives the move to an organization: a real 301 from the old path is followed by the
// updater, and the engine name follows the API's new full_name. Spec: docs/superpowers/specs/2026-11-01-github-org-move-design.md.
import assert from 'node:assert/strict';
import http from 'node:http';
import {test} from 'node:test';
import * as github from '../lib/github.js';
import {pinned, resolveEngineRepo, currentEngineRepo, ENGINE_REPO} from '../lib/engine-repo.js';
import {ENGINE, STARTER, STARTER_CANDIDATES, OLD_STARTER, OWNER, OWNER_PATTERN} from '../lib/repos.js';
import {REPO, check, resetLimit} from '../lib/updater.js';

test('the updater, the engine and the starter all take their owner from lib/repos.js', () => {
  assert.equal(REPO, ENGINE);
  assert.equal(ENGINE_REPO, ENGINE);
  assert.ok(ENGINE.startsWith(`${OWNER}/`));
  assert.deepEqual(STARTER_CANDIDATES, [STARTER, OLD_STARTER], 'newest name first, then the one that exists today');
  assert.equal(STARTER, 'jobadabra/jobadabra-user-template');
});

test('the starter is whichever candidate GitHub shows as a template: works before the rename, after it, and offline', async () => {
  const template = names => async url => {
    const name = url.replace('https://api.github.com/repos/', '');
    return names.includes(name) ? {ok: true, json: async () => ({is_template: true})} : {ok: false, status: 404, json: async () => ({})};
  };
  assert.equal(await github.resolveStarter(template([OLD_STARTER])), OLD_STARTER, 'before the rename only the old template answers');
  assert.equal(await github.resolveStarter(template([STARTER, OLD_STARTER])), STARTER, 'after it the new name wins, the old one redirecting');
  assert.equal(await github.resolveStarter(template([OLD_STARTER])), OLD_STARTER, 'and it follows a change back');
  const offline = async () => { throw new Error('offline'); };
  assert.equal(await github.resolveStarter(offline), OLD_STARTER, 'unanswered: the old name, never an unverified one');
  assert.equal(await github.resolveStarter(template([STARTER])), STARTER);
  assert.equal(await github.resolveStarter(offline), STARTER, 'unanswered after a good answer: the last one found');
  assert.ok(!/GarryOne|jobadabra/.test(await github.createUrl(template([STARTER]))), 'the link names the new template only');
  // After the rename the API answers the OLD name with a 301 to the new repo: the link must carry the API's name, never the old one (item 15 of the spec).
  const redirected = async url => (url.endsWith(`/${STARTER}`) ? {ok: false, status: 404} : {ok: true, json: async () => ({is_template: true, full_name: STARTER})});
  assert.equal(await github.resolveStarter(redirected), STARTER, 'an old name that redirects resolves to the new template');
  assert.match(await github.createUrl(redirected), /template_name=jobadabra-user-template&template_owner=jobadabra/);
  let seen;
  await github.resolveStarter(async (url, options) => { seen = options; return {ok: false}; }, 'tok');
  assert.equal(seen.headers.Authorization, 'Bearer tok', 'the user\'s token keeps the lookup off the anonymous limit');
  assert.ok(seen.signal, 'a stalled network cannot hold the setup reply for minutes');
});

test('the updater follows the 301 GitHub answers on the old path after a transfer (a real HTTP round trip)', async () => {
  const release = {tag_name: 'desktop-v9.9.9', name: '9.9.9', body: '', html_url: 'https://example.test/r',
    assets: [{name: 'Jobadabra-9.9.9-arm64.zip', browser_download_url: 'https://dl/zip', size: 1}]};
  const seen = [];
  const server = http.createServer((request, response) => {
    seen.push(request.url);
    if (request.url === `/repos/${REPO}/releases/latest`) { response.writeHead(301, {Location: '/repos/jobadabra/jobadabra/releases/latest'}); return response.end(); }
    if (request.url === '/repos/jobadabra/jobadabra/releases/latest') { response.writeHead(200, {'Content-Type': 'application/json'}); return response.end(JSON.stringify(release)); }
    response.writeHead(404); response.end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const saved = {e2e: process.env.JOBADABRA_E2E, url: process.env.JOBADABRA_E2E_UPDATES_URL};
  process.env.JOBADABRA_E2E = '1';
  process.env.JOBADABRA_E2E_UPDATES_URL = `http://127.0.0.1:${server.address().port}`;
  try {
    resetLimit();
    const offer = await check('0.1.0', {platform: 'darwin'});
    assert.equal(offer?.version, '9.9.9', 'the release behind the redirect is offered');
    assert.deepEqual(seen, [`/repos/${REPO}/releases/latest`, '/repos/jobadabra/jobadabra/releases/latest']);
  } finally {
    for (const [key, value] of [['JOBADABRA_E2E', saved.e2e], ['JOBADABRA_E2E_UPDATES_URL', saved.url]]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await new Promise(resolve => server.close(resolve));
  }
});

test('a transfer reaches the user\'s Always-on workflows: the API names the new owner, and a file an older app wrote is rewritten', async () => {
  const before = currentEngineRepo();
  try {
    const moved = async () => new Response(JSON.stringify({full_name: 'jobadabra/jobadabra'}), {status: 200});
    assert.equal(await resolveEngineRepo(moved), true);
    const old = `jobs:\n  run:\n    uses: ${OWNER}/jobadabra/.github/workflows/daily.yml@main\n    with:\n      code_repository: ${OWNER}/jobadabra\n`;
    const out = pinned(old);
    assert.match(out, /uses: jobadabra\/jobadabra\/\.github\/workflows\/daily\.yml@/);
    assert.match(out, /code_repository: jobadabra\/jobadabra$/m);
    assert.ok(OWNER_PATTERN.includes(OWNER), 'the current owner is always matched');
  } finally {
    await resolveEngineRepo(async () => new Response(JSON.stringify({full_name: before}), {status: 200}));
  }
});
