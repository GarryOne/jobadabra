// Popup journey (#962), registered by journeys.test.js so the shared scenario file stays within its size limit: a kept pick with no effect on record is asked again.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {pickDismiss} from '../lib/popup-pick.js';

const claude = (button, sent = [], effect = 'closes_only') => ({messages: {create: async request => { sent.push(request); return {stop_reason: 'end_turn', content: [{type: 'text', text: JSON.stringify({button, effect})}]}; }}});
const popup = {text: 'Bleiben Sie auf dem Laufenden mit unserem Newsletter!', buttons: ['Jetzt anmelden', 'Nein, danke']};

// #962: a pick kept before the effect floor (c8e0113) had no effect on record and was pressed anyway for up to 30 days.
test('scenario: a popup pick kept before the closes_only floor (no effect on record) is asked again, never pressed blind (#962)', async () => {
  const files = {}, storage = {readText: name => files[name] ?? null, writeText: (name, text) => { files[name] = text; }}, sent = [];
  await pickDismiss(storage, popup, {client: claude('Nein, danke', sent)});
  const kept = JSON.parse(storage.readText('popup-picks.json')), [key] = Object.keys(kept);
  assert.equal(kept[key].e, 'closes_only', 'the effect is kept with the pick');
  delete kept[key].e;   // what an older install holds
  storage.writeText('popup-picks.json', JSON.stringify(kept));
  assert.deepEqual(await pickDismiss(storage, popup, {client: claude('Jetzt anmelden', sent, 'declines_consent')}), {button: '', how: 'ai'});
  assert.equal(sent.length, 2, 'asked again');
  assert.deepEqual(await pickDismiss(storage, popup, {client: claude('x', sent)}), {button: '', how: 'kept'}, 'a kept "none" needs no effect');
});
