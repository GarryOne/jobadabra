// Email vs Telegram vs both (owner, 26 Oct 2026: "a way for the user to choose his notification channel"): the Always on repo follows a Telegram-off choice, the window says why a switch
// does nothing (no address, no bot, our sender off, unsubscribed), and no screen presents Telegram as the only or a required channel. Guards renderer/notify-words.js, lib/github.js.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import * as github from '../lib/github.js';
import {state} from '../lib/notify-channel.js';
import {createStorage} from '../lib/storage.js';
import {channelLine, notes, telegramRequired} from '../renderer/notify-words.js';

const read = file => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
function repoStorage(settings = {}) {
  const storage = createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-notify-')), {encrypt: s => s, decrypt: s => s});
  storage.setSecret('ANTHROPIC_API_KEY', 'sk-ant-test');
  storage.setSecret('TELEGRAM_BOT_TOKEN', '123:bot');
  storage.saveSettings({telegramChatId: 42, setupDone: true, ...settings});
  return storage;
}

test('the Always on repo follows every choice: Telegram turned off stops Telegram there too; no choice keeps the old Telegram-only default', () => {
  const told = settings => { const {variables, removed} = github.payload(repoStorage(settings)); return variables.JOB_PILOTTO_NOTIFY ?? (removed.includes('JOB_PILOTTO_NOTIFY') ? 'removed' : 'kept'); };
  assert.equal(told({}), 'removed', 'nothing chosen: no variable, as before (pool-share test)');
  assert.equal(told({notifyBy: ['telegram', 'app']}), 'removed', 'Telegram chosen: the default already says so');
  assert.equal(told({notifyBy: ['email', 'app'], notifyEmail: 'a@b.co'}), 'email,app');
  assert.equal(told({notifyBy: ['email', 'telegram', 'app'], notifyEmail: 'a@b.co'}), 'email,telegram,app');
  assert.equal(told({notifyBy: ['app']}), 'app', 'Telegram off: GitHub must not fall back to Telegram');
});

test('the window state carries whether our sender is on and whether the person unsubscribed', async () => {
  const s = {settings: () => ({notifyEmail: 'a@b.co'}), saveSettings: () => {}, secret: name => (name === 'JOB_PILOTTO_TRIAL_KEY' ? 'JPF1.i.t' : '')};
  const answer = body => async () => ({json: async () => body});
  const off = await state(s, answer({ok: true, email: 'a@b.co', confirmed: true, sending: false, serviceOff: true}));
  assert.deepEqual([off.sending, off.serviceOff], [false, true]);
  const old = await state(s, answer({ok: true, email: 'a@b.co'}));
  assert.equal(old.sending, null, 'a site without the flag: unknown, nothing claimed');
});

test('each reason a switch does nothing is said in words, and a save error survives the refresh', () => {
  const base = {by: ['app'], telegram: false, email: '', confirmed: false, reached: true, sending: true};
  assert.match(notes(base).email, /Add your address/);
  assert.match(notes(base).telegram, /Connect/);
  assert.equal(notes(base, 'Enter your email address to be told by email.').message, 'Enter your email address to be told by email.');
  assert.match(notes({...base, email: 'a@b.co', sending: false}).email, /not switched on/i);
  assert.match(notes({...base, email: 'a@b.co', confirmed: true, serviceOff: true}).email, /stopped these emails/);
  assert.match(notes({...base, email: 'a@b.co', confirmed: true}).email, /confirmed/);
  assert.match(notes({...base, reached: false}).message, /Offline/);
});

test('Telegram is required only when e-mail is not chosen, and the Actions line names the chosen channels', () => {
  assert.equal(telegramRequired(['app']), true);
  assert.equal(telegramRequired(['email', 'app']), false);
  assert.equal(channelLine({by: ['email', 'app']}).text, 'Tell me by: Email');
  assert.equal(channelLine({by: ['email', 'telegram', 'app'], connected: true}).text, 'Tell me by: Email, Telegram');
  assert.equal(channelLine({by: ['telegram', 'app'], connected: true, blocked: true}).text, 'Telegram not delivering');
  assert.equal(channelLine({by: ['app'], connected: false}).text, 'Tell me by: app notifications only');
});

// The class: every screen that offers or requires a way to be told. Listed 26 Oct 2026: Connections (Telegram required), setup extras (Telegram only), Actions header,
// Always on "How it works", the Focus reminder tooltip, the ⌘K entry.
test('no screen presents Telegram as the only channel', () => {
  const html = read('renderer/index.html'), settings = read('renderer/pages/settings.js'), nav = read('renderer/pages/nav.js'), runs = read('renderer/pages/runs-page.js');
  assert.match(html, /class="[^"]*\bextras"[\s\S]*data-goto-settings="notify"/, 'setup extras offer e-mail next to Telegram');
  assert.doesNotMatch(html, /sends results to Telegram and/, 'Always on: results go by the chosen channel');
  assert.doesNotMatch(html, /title="Notifications and Telegram when/, 'Focus reminders: by the chosen channels');
  assert.match(settings, /id: 'telegram'[^\n]*required: \(\) => telegramRequired\(shared\.state\.notifyBy, shared\.state\.settings\.notifyBy\) \|\| !!shared\.state\.settings\.telegramChatId/, 'Telegram is required only without e-mail');
  assert.doesNotMatch(settings, /service\.required &&|service => service\.required\)/, 'required is read through isRequired()');
  assert.match(runs, /channelLine\(/, 'the Actions line shows the chosen channels');
  const card = html.match(/<div class="setting panel" id="setting-notify"[^>]*>/)?.[0] || '';
  assert.match(card, /data-keywords="[^"]*email[^"]*telegram/, '⌘K finds Notifications by "email" or "telegram"');
  assert.match(nav, /section\.dataset\.keywords/);
});

// Owner, 26 Oct 2026: "if telegram is not connected, can we show a warning and a link/button to connect it?" Telegram chosen but not connected was dropped without a word
// once e-mail was chosen too (channelsOf drops it). Every screen that shows the choice warns: the card, Connections (alert + dot), the Actions header.
test('Telegram chosen but not connected warns on the card, in Connections and on Actions, also with e-mail chosen', () => {
  const state = {by: ['email', 'app'], chosen: ['email', 'telegram', 'app'], telegram: false, email: 'a@b.co', confirmed: true, reached: true, sending: true};
  assert.match(notes(state).message, /Telegram is chosen but not connected/);
  assert.equal(notes({...state, chosen: ['email', 'app']}).message, '', 'not chosen: no warning, the Connect link stays');
  assert.equal(telegramRequired(['email', 'app'], ['email', 'telegram', 'app']), true, 'chosen: Connections asks for it');
  assert.equal(telegramRequired(['email', 'app'], ['email', 'app']), false);
  assert.deepEqual(channelLine({by: ['email', 'app'], chosen: ['email', 'telegram', 'app'], connected: false}), {text: 'Telegram not connected', dot: 'is-warn'});
  const settings = read('renderer/pages/settings.js'), runs = read('renderer/pages/runs-page.js');
  assert.match(settings, /telegramRequired\(shared\.state\.notifyBy, shared\.state\.settings\.notifyBy\)/);
  assert.match(runs, /chosen: shared\.state\.settings\.notifyBy/);
});
