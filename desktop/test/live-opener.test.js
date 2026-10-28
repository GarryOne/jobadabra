// The live view's one owner of "is this session's page open in main" (renderer/live-opener.js; owner screenshot, 28 Oct 2026: a broken picture while the app filled the form).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createLiveOpener} from '../renderer/live-opener.js';

const flush = () => new Promise(done => setTimeout(done, 0));

test('the owner\'s scenario: the card draws while the hidden form is not open yet; the next redraw asks again and the picture comes', async () => {
  const answers = [{ok: false, error: 'This application\'s hidden form is not open.'}, {ok: false, error: 'This application\'s hidden form is not open.'}, {ok: true}];
  const seen = [];
  const opener = createLiveOpener(async () => answers.shift(), result => seen.push(result));
  for (let draw = 0; draw < 4; draw++) { opener.ensure(); await flush(); }   // one redraw per state change of the session
  assert.deepEqual(seen.map(result => !!result.ok), [false, false, true]);
  assert.equal(opener.state, 'open');
  assert.equal(answers.length, 0, 'asked exactly three times: the fourth redraw found it open and asked nothing');
});

test('no second ask while one is in flight, and none after it is open', async () => {
  let asked = 0, release;
  const opener = createLiveOpener(() => { asked++; return new Promise(done => { release = done; }); }, () => {});
  opener.ensure(); opener.ensure(); opener.ensure();
  assert.equal(asked, 1);
  assert.equal(opener.state, 'opening');
  release({ok: true}); await flush();
  opener.ensure();
  assert.equal(asked, 1);
});

test('a refusal or a thrown call leaves it not open, with the reason, and is asked again next time', async () => {
  const seen = [];
  let calls = 0;
  const opener = createLiveOpener(async () => { calls++; if (calls === 1) throw new Error('ipc went away'); return {ok: false, error: 'The live page was closed before it opened.'}; }, result => seen.push(result.error));
  opener.ensure(); await flush(); opener.ensure(); await flush();
  assert.equal(opener.state, 'none');
  assert.deepEqual(seen, ['The hidden form is not open.', 'The live page was closed before it opened.']);
  assert.equal(calls, 2);
});

test('main dropped the view on its own: reset makes the next redraw ask again', async () => {
  let asked = 0;
  const opener = createLiveOpener(async () => { asked++; return {ok: true}; });
  opener.ensure(); await flush();
  opener.reset(); opener.ensure(); await flush();
  assert.equal(asked, 2);
  assert.equal(opener.state, 'open');
});
