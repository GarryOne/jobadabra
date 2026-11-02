// "Tell me by" (lib/notify-channel.js): the default follows what the person has, an explicit choice drops channels that are not set up, the engine and the Always on repo are told, a
// changed address goes to the site first, and every --send command asks deliveryReady (so e-mail-only users get their messages too).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {channelsOf, deliveryReady, notifyEnv, save, sendEmail, state} from '../lib/notify-channel.js';
import {dailyArgs, mailArgs} from '../lib/pipeline-args.js';

const storage = ({settings = {}, secrets = {}} = {}) => {
  const kept = {...settings};
  return {settings: () => kept, saveSettings: patch => Object.assign(kept, patch), secret: name => secrets[name] || ''};
};
const BOT = {secrets: {TELEGRAM_BOT_TOKEN: 't'}, settings: {telegramChatId: '1'}};
const KEY = {JOBADABRA_TRIAL_KEY: 'JPF1.install-0001.tok'};
const site = (answers, asked = []) => async (url, init) => { asked.push({url, method: init?.method, key: init?.headers['x-api-key'], body: init?.body ? JSON.parse(init.body) : null}); const answer = answers.shift(); if (answer instanceof Error) throw answer; return {json: async () => answer}; };

test('with nothing chosen the channels follow what is set up: the app always, e-mail with an address, Telegram with a bot', () => {
  assert.deepEqual(channelsOf(storage()), ['app']);
  assert.deepEqual(channelsOf(storage({settings: {notifyEmail: 'a@b.co'}})), ['email', 'app']);
  assert.deepEqual(channelsOf(storage(BOT)), ['telegram', 'app']);
  assert.deepEqual(channelsOf(storage({...BOT, settings: {...BOT.settings, notifyEmail: 'a@b.co'}})), ['email', 'telegram', 'app']);
});

test('a choice drops a channel that is not set up, and e-mail only is enough to be asked to send', () => {
  assert.deepEqual(channelsOf(storage({settings: {notifyBy: ['email', 'telegram']}})), []);
  assert.deepEqual(channelsOf(storage({settings: {notifyBy: ['email', 'app'], notifyEmail: 'a@b.co'}})), ['email', 'app']);
  assert.equal(deliveryReady(storage()), false);
  assert.equal(deliveryReady(storage({settings: {notifyBy: ['email'], notifyEmail: 'a@b.co'}})), true);
  assert.equal(deliveryReady(storage({...BOT, settings: {...BOT.settings, notifyBy: ['app']}})), false, 'Telegram connected but not chosen: the app shows it');
});

test('every command that sends follows the choice: e-mail only gets --send without a bot, app only gets none with a bot', () => {
  const emailOnly = storage({settings: {notifyBy: ['email'], notifyEmail: 'a@b.co'}}), appOnly = storage({...BOT, settings: {...BOT.settings, notifyBy: ['app']}});
  assert.ok(dailyArgs(emailOnly).includes('--send') && mailArgs(emailOnly, 3).includes('--send'));
  assert.ok(!dailyArgs(appOnly).includes('--send') && !mailArgs(appOnly, 3).includes('--send'));
});

test('the engine is told the channels and, for e-mail, the install key; Telegram-only runs get no key', () => {
  const chosen = storage({settings: {notifyBy: ['email', 'app'], notifyEmail: 'a@b.co'}, secrets: {JOBADABRA_TRIAL_KEY: KEY.JOBADABRA_TRIAL_KEY}});
  assert.deepEqual(notifyEnv(chosen), {JOBADABRA_NOTIFY: 'email,app', ...KEY});
  assert.deepEqual(notifyEnv(storage({secrets: {JOBADABRA_TRIAL_KEY: 'JPF1.x.y'}})), {JOBADABRA_NOTIFY: 'app'});
  const free = storage({settings: {notifyEmail: 'a@b.co'}, secrets: {ANTHROPIC_API_KEY: 'JPF1.free.tok'}});
  assert.equal(notifyEnv(free).JOBADABRA_TRIAL_KEY, 'JPF1.free.tok');
});

test('saving a new address asks the site first and keeps nothing when the site says no; a taken address is said in words', async () => {
  const s = storage({secrets: KEY.JOBADABRA_TRIAL_KEY ? {JOBADABRA_TRIAL_KEY: KEY.JOBADABRA_TRIAL_KEY} : {}}), asked = [];
  const refused = await save(s, {by: ['email', 'app'], email: 'Me@Example.com', marketing: true}, site([{ok: false, error: 'taken'}], asked));
  assert.equal(refused.ok, false);
  assert.match(refused.error, /already has a Jobadabra account/);
  assert.equal(s.settings().notifyEmail, undefined);
  assert.equal(s.settings().notifyBy, undefined);
  const saved = await save(s, {by: ['email', 'app'], email: 'Me@Example.com', marketing: true}, site([{ok: true}], asked));
  assert.equal(saved.ok, true);
  assert.deepEqual([s.settings().notifyEmail, s.settings().notifyBy, s.settings().notifyMarketing], ['me@example.com', ['email', 'app'], true]);
  assert.deepEqual(asked[1], {url: 'https://www.jobadabra.top/api/account/email', method: 'PUT', key: KEY.JOBADABRA_TRIAL_KEY, body: {email: 'me@example.com', marketing: true}});
});

test('e-mail cannot be chosen without an address, and a switch change alone does not call the site', async () => {
  const s = storage({secrets: {JOBADABRA_TRIAL_KEY: KEY.JOBADABRA_TRIAL_KEY}, settings: {notifyEmail: 'a@b.co'}}), asked = [];
  assert.equal((await save(storage(), {by: ['email'], email: ''}, site([]))).ok, false);
  assert.equal((await save(s, {by: ['app'], email: 'a@b.co'}, site([], asked))).ok, true);
  assert.deepEqual(asked, []);
  assert.deepEqual(s.settings().notifyBy, ['app']);
});

test('the window state shows the site\'s address and confirmation, and the kept address when offline', async () => {
  const s = storage({secrets: {JOBADABRA_TRIAL_KEY: KEY.JOBADABRA_TRIAL_KEY}, settings: {notifyEmail: 'kept@b.co'}});
  const online = await state(s, site([{ok: true, email: 'kept@b.co', confirmed: true, marketing: false}]));
  assert.deepEqual([online.email, online.confirmed, online.marketing, online.reached], ['kept@b.co', true, false, true]);
  const offline = await state(s, site([new Error('offline')]));
  assert.deepEqual([offline.email, offline.reached, offline.marketing], ['kept@b.co', false, true]);
});

test('an e-mail the app sends itself needs e-mail chosen, and never throws', async () => {
  const asked = [], on = storage({secrets: {JOBADABRA_TRIAL_KEY: KEY.JOBADABRA_TRIAL_KEY}, settings: {notifyEmail: 'a@b.co'}});
  assert.equal(await sendEmail(on, {subject: 'Few <new> jobs', text: 'a & b'}, site([{ok: true}], asked)), true);
  assert.equal(asked[0].body.html, '<b>Few &lt;new&gt; jobs</b>\na &amp; b');
  assert.equal(asked[0].body.kind, 'activity', 'the app\'s own notices wait for the digest');
  assert.equal(await sendEmail(on, {subject: 's', text: 't'}, site([new Error('offline')])), false);
  assert.equal(await sendEmail(storage(), {subject: 's', text: 't'}, site([])), false);
});

test('the digest cadence (daily or weekly) goes to the site with the address; anything else is ignored', async () => {
  const s = storage({secrets: {JOBADABRA_TRIAL_KEY: KEY.JOBADABRA_TRIAL_KEY}, settings: {notifyEmail: 'a@b.co'}}), asked = [];
  assert.equal((await save(s, {by: ['email'], email: 'a@b.co', cadence: 'weekly'}, site([{ok: true}], asked))).ok, true);
  assert.deepEqual([asked[0].body, s.settings().notifyCadence], [{email: 'a@b.co', cadence: 'weekly'}, 'weekly']);
  await save(s, {by: ['email'], email: 'a@b.co', cadence: 'hourly'}, site([{ok: true}], asked));
  assert.equal(asked.length, 1, 'an unknown cadence is not sent');
  assert.equal((await state(s, site([{ok: true, email: 'a@b.co', cadence: 'weekly'}], []))).cadence, 'weekly');
  assert.equal((await state(storage({settings: {}}), site([{ok: false}], []))).cadence, 'daily');
});
