// A new version, beta or stable, is announced once on Telegram (release-alert.mjs): the version, links to its release and commit, which lanes released; nothing without the secrets, never the token.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {alertRelease, commitOf, parseLanes, releaseMessage} from '../../release-alert.mjs';

const env = {GITHUB_REPOSITORY: 'o/r', GITHUB_RUN_ID: '42', GH_TOKEN: 'gh', CI_ALERTS_TELEGRAM_BOT_TOKEN: 'bot-secret-token', CI_ALERTS_TELEGRAM_CHAT_ID: '7'};
const commit = {sha: 'abcdef1234567890', subject: 'Fix the wizard', date: '2026-11-01T21:53:10Z'};
const github = (answer = {sha: commit.sha, commit: {message: `${commit.subject}\n\nbody`, committer: {date: commit.date}}}, ok = true) => async url => {
  if (!url.includes('api.github.com')) return {ok: true, json: async () => ({})};
  return {ok, json: async () => answer};
};

test('a beta says its version, both lanes, the release and the commit as links, and the run', () => {
  const {text, parse_mode} = releaseMessage({kind: 'beta', tag: 'desktop-v0.8.75', commit, lanes: parseLanes('Mac=success,Windows=success'), env});
  assert.equal(parse_mode, 'HTML');
  assert.match(text, /🧪 <b>Beta 0\.8\.75 released<\/b> Offered to beta testers on Mac and Windows/);
  assert.match(text, /<a href="https:\/\/github\.com\/o\/r\/releases\/tag\/desktop-v0\.8\.75">desktop-v0\.8\.75<\/a>/);
  assert.match(text, /<a href="https:\/\/github\.com\/o\/r\/commit\/abcdef1234567890">abcdef1<\/a> Fix the wizard/);
  assert.match(text, /Committed: 2026-11-01 21:53 UTC/);
  assert.match(text, /<a href="https:\/\/github\.com\/o\/r\/actions\/runs\/42">Open the run<\/a>/);
});

test('a beta that released on one lane only says which lane missed, with a warning icon', () => {
  const {text} = releaseMessage({kind: 'beta', tag: 'desktop-v0.8.75', commit, lanes: parseLanes('Mac=success,Windows=failure'), env});
  assert.match(text, /⚠️ <b>Beta 0\.8\.75 released<\/b> Offered on Mac only; Windows did not release/);
});

test('a stable release says every app offers it, with no lane list', () => {
  const {text} = releaseMessage({kind: 'stable', tag: 'desktop-v0.8.70', commit, env});
  assert.match(text, /🚀 <b>Stable 0\.8\.70 released<\/b> Every app offers it within 10 minutes/);
  assert.doesNotMatch(text, /Mac|Windows/);
});

test('a commit that cannot be read leaves the commit lines out and still announces the release', async () => {
  assert.equal(await commitOf('desktop-v0.8.75', env, github({}, false)), null);
  assert.equal(await commitOf('desktop-v0.8.75', env, async () => { throw new Error('offline'); }), null);
  const {text} = releaseMessage({kind: 'stable', tag: 'desktop-v0.8.70', commit: null, env});
  assert.match(text, /Stable 0\.8\.70 released/);
  assert.doesNotMatch(text, /Commit:/);
});

test('the alert looks the commit up by tag, sends once to Telegram, and never prints the token', async () => {
  const sent = [];
  const fetcher = async (url, init) => {
    if (url.includes('api.telegram.org')) { sent.push({url, body: JSON.parse(init.body)}); return {ok: true}; }
    assert.match(url, /\/repos\/o\/r\/commits\/desktop-v0\.8\.75$/);
    return github()(url);
  };
  const line = await alertRelease({kind: 'beta', tag: 'desktop-v0.8.75', lanes: parseLanes('Mac=success,Windows=success'), env, fetcher});
  assert.equal(line, 'ci-alert: sent');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].body.chat_id, '7');
  assert.match(sent[0].body.text, /Fix the wizard/);
  assert.doesNotMatch(line, /bot-secret-token/);
});

test('without the Telegram secrets nothing is sent, and a tag or kind that is missing sends nothing', async () => {
  const fetcher = async () => { throw new Error('no network call expected'); };
  assert.match(await alertRelease({kind: 'beta', tag: 'desktop-v0.8.75', env: {GITHUB_REPOSITORY: 'o/r'}, fetcher: async url => url.includes('telegram') ? fetcher() : github()(url)}), /not sent \(CI_ALERTS_TELEGRAM/);
  assert.match(await alertRelease({kind: 'nightly', tag: 'x', env, fetcher}), /nothing to send/);
  assert.match(await alertRelease({kind: 'stable', tag: '', env, fetcher}), /nothing to send/);
});

test('lanes parse from the workflow\'s text', () => {
  assert.deepEqual(parseLanes('Mac=success, Windows=skipped'), [['Mac', 'success'], ['Windows', 'skipped']]);
  assert.deepEqual(parseLanes(''), []);
});
