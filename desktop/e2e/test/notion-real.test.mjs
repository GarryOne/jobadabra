// notion-real, the one suite on real Notion (suites/notion-real.mjs): it takes its own (borrowed) token or none, never the wizard's fallback, since its
// `fresh` start empties the page the token sees; run-all loads the borrowed token's Keychain item; and it is run by name only (dropped by the e2e audit, 26 Oct 2026), pinned, and cleans its page.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {notionToken} from '../lib/context.mjs';
import {tokenSuites} from '../run-all.mjs';
import * as suite from '../suites/notion-real.mjs';

test('the real workspace takes its own token or none, never the fallback', () => {
  const env = {E2E_NOTION_TOKEN: 'ntn_wizard', E2E_NOTION_TOKEN_FAILURESNOTION: 'ntn_own'};
  assert.equal(notionToken('failuresnotion', {own: true, env}), 'ntn_own');
  assert.equal(notionToken('notionreal', {own: true, env}), '', 'no own token: none, so the suite is skipped (or fails under E2E_REQUIRE_SECRETS)');
  assert.equal(notionToken('jobs', {env}), 'ntn_wizard', 'other suites keep the Mac fallback');
});

test('run-all loads the borrowed token for notion-real, and every other suite its own', () => {
  assert.deepEqual(tokenSuites(['notion-real', 'jobs'], {'notion-real': 'failuresnotion'}), ['failuresnotion', 'jobs']);
  assert.deepEqual(tokenSuites(['notion-real', 'failuresnotion'], {'notion-real': 'failuresnotion'}), ['failuresnotion']);
});

test('notion-real pins the real workspace, borrows a hyphen-free token, runs by name from an emptied page and cleans it', () => {
  assert.equal(suite.store, 'notion');
  assert.match(suite.notionTokenOf, /^[a-z0-9]+$/, 'a GitHub secret name cannot hold a hyphen');
  assert.equal(suite.cadence, 'manual');
  assert.equal(suite.fresh, true);
  assert.equal(suite.notionPage, 'Job Pilotto E2E — Failures Notion');
  const context = fs.readFileSync(new URL('../lib/context.mjs', import.meta.url), 'utf8');
  assert.ok(context.indexOf('ctx.root.title !== notionPage') < context.indexOf('clearRoot(token'), 'the page is checked before fresh empties it');
  const source = fs.readFileSync(new URL('../suites/notion-real.mjs', import.meta.url), 'utf8');
  assert.match(source, /finally \{[\s\S]*emptyPage\(ctx\)[\s\S]*left\) throw/, 'the cleanup runs in a finally and fails when anything is left');
});

test('the borrowed token belongs to a suite that no longer holds a real token', async () => {
  const lender = await import(`../suites/${suite.notionTokenOf}.mjs`);
  assert.equal(lender.store, 'standin', `${suite.notionTokenOf} must stay on the stand-in while notion-real uses its token`);
});
