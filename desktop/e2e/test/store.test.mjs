// Which store the app under test keeps its data in (lib/store.mjs, spec 2026-10-09-store-adapters.md P7): no token by default, CI alternating on a bit
// the AI family does not use, and only a suite that pins it on the real workspace.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {pickFamily} from '../lib/engine.mjs';
import {notionFarSide, pickStore, runToken, STORES, storeSettings} from '../lib/store.mjs';
import {E2E} from '../lib/app.mjs';
import {SUITES} from '../lib/context.mjs';
import * as quality from '../suites/quality.mjs';

test('a Mac runs on its own store (what a new install gets) unless pinned; E2E_NOTION_STANDIN=1 still means the stand-in', () => {
  assert.equal(pickStore({env: {}}), 'sqlite');
  assert.equal(pickStore({env: {E2E_STORE: 'standin'}}), 'standin');
  assert.equal(pickStore({env: {E2E_STORE: 'sqlite'}}), 'sqlite');
  assert.equal(pickStore({env: {E2E_NOTION_STANDIN: '1'}}), 'standin');
});

test('the real workspace is never picked from the environment, only by a suite', () => {
  assert.throws(() => pickStore({env: {E2E_STORE: 'notion'}}), /only for a suite that pins it/);
  assert.equal(pickStore({env: {E2E_STORE: 'sqlite'}, suiteStore: 'notion'}), 'notion');
  assert.throws(() => pickStore({suiteStore: 'cloud'}), /not "cloud"/);
});

test('CI alternates the store on bit 1, so all four family x store pairs come round in four runs', () => {
  const pairs = new Set();
  for (const run of [0, 1, 2, 3]) {
    const env = {CI: 'true', GITHUB_RUN_NUMBER: String(run), E2E_OPENAI_KEY: 'k'};
    pairs.add(`${pickFamily(env)}/${pickStore({env})}`);
  }
  assert.deepEqual([...pairs].sort(), ['claude/sqlite', 'claude/standin', 'openai/sqlite', 'openai/standin']);
  assert.equal(pickStore({env: {CI: 'true', GITHUB_RUN_NUMBER: '6', E2E_STORE: 'sqlite'}}), 'sqlite');   // a pinned gate leg
});

test('quality pins SQLite for every CI store alternation so recorded answers use one path', () => {
  assert.equal(quality.store, 'sqlite');
  for (let run = 0; run < 16; run++) {
    assert.equal(pickStore({env: {CI: 'true', GITHUB_RUN_NUMBER: String(run)}, suiteStore: quality.store}), 'sqlite', `run ${run}`);
  }
});

test('beta 3 and beta 4 quality runs use the same recorded SQLite path', () => {
  for (const run of [985, 987]) {
    assert.equal(pickStore({env: {CI: 'true', GITHUB_RUN_NUMBER: String(run)}, suiteStore: quality.store}), 'sqlite', `beta run ${run}`);
  }
});

test('every strict AI replay suite pins its store so recorded answers cover its path', async () => {
  const workflow = fs.readFileSync(new URL('../../../.github/workflows/e2e.yml', import.meta.url), 'utf8');
  const condition = workflow.match(/^\s*E2E_AI_STRICT:\s*(.+)$/m)?.[1] || '';
  const suites = [...condition.matchAll(/matrix\.suite\s*==\s*'([^']+)'/g)].map(match => match[1]);
  assert.ok(suites.length > 0, 'strict replay must name at least one suite');
  assert.ok(suites.includes('quality'), 'quality must remain covered by the strict replay guard');
  for (const name of suites) {
    const suite = await import(`../suites/${name}.mjs`);
    assert.ok(STORES.includes(suite.store), `${name}: strict replay requires an exported store pin`);
  }
});

test('only the sqlite store is written into a fresh profile; the Notion store is the app\'s default', () => {
  assert.deepEqual(storeSettings('sqlite'), {store: 'sqlite'});
  assert.deepEqual(storeSettings('standin'), {store: 'notion'}, 'a Notion run says so: the app would give an empty profile this Mac');
});

test('every suite that pins a store names a known one, and only notion-real uses the real workspace', async () => {
  for (const name of SUITES) {
    const source = fs.readFileSync(path.join(E2E, 'suites', `${name}.mjs`), 'utf8');
    const pinned = source.match(/^export const store = '([^']*)'/m)?.[1];
    if (!pinned) continue;
    assert.ok(STORES.includes(pinned), `${name}: store '${pinned}'`);
    if (pinned === 'notion') assert.equal(name, 'notion-real', `${name} pins the real Notion workspace: only notion-real may (P7: every suite runs token-free)`);
  }
});

test('Notion\'s far side is real only on the real workspace: the stand-in, or a dead local port on this Mac\'s store', () => {
  assert.equal(notionFarSide({store: 'standin', standIn: 'http://127.0.0.1:5000'}), 'http://127.0.0.1:5000');
  assert.equal(notionFarSide({store: 'sqlite'}), 'http://127.0.0.1:9');
  assert.equal(notionFarSide({store: 'notion'}), 'https://api.notion.com');
  for (const store of ['standin', 'sqlite']) assert.doesNotMatch(notionFarSide({store, standIn: store === 'standin' ? 'http://127.0.0.1:1' : ''}), /notion\.com/);
});

test('a real token in the environment reaches a run only on the real workspace', () => {
  const fromEnv = () => 'ntn_real_from_the_keychain';
  assert.equal(runToken({store: 'sqlite', fromEnv}), '');
  assert.equal(runToken({store: 'standin', standIn: {token: 'ntn_e2e_x'}, fromEnv}), 'ntn_e2e_x');
  assert.equal(runToken({store: 'sqlite', standIn: {token: 'ntn_e2e_y'}, fromEnv}), 'ntn_e2e_y', 'a SQLite suite with a stand-in to move into');
  assert.equal(runToken({store: 'notion', fromEnv}), 'ntn_real_from_the_keychain');
  assert.equal(runToken({store: 'sqlite', light: true, fromEnv}), '');
});

test('a gate\'s second store files its findings under the suite\'s own name (triage.mjs suiteOf)', async () => {
  const {suiteOf} = await import('../triage.mjs');
  assert.deepEqual(['e2e-artifacts-jobs', 'e2e-artifacts-jobs-standin', 'e2e-artifacts-windows-focusdismiss', '/tmp/x/e2e-artifacts-applycv-standin'].map(suiteOf),
    ['jobs', 'jobs', 'focusdismiss', 'applycv']);
});
