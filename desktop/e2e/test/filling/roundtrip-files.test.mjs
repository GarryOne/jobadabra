// Round-trip file comparisons accept only unchanged bytes or a store drop recorded by the current launch.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {currentLaunchLog} from '../../lib/app-log.mjs';
import {roundTripFileDifferences} from '../../lib/roundtrip-files.mjs';

const drop = '[files] local copies dropped, the store has them {"files":["profile.md","answers.md"]}\n';

function launchLog(t, text) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'roundtrip-files-'));
  t.after(() => fs.rmSync(profile, {recursive: true, force: true}));
  fs.mkdirSync(path.join(profile, 'logs'));
  fs.writeFileSync(path.join(profile, 'logs', 'app.log'), text);
  return currentLaunchLog(profile);
}

for (const name of ['profile.md', 'answers.md']) {
  const before = {[name]: 'exported-digest'};
  test(`${name}: identical bytes pass`, () => {
    assert.deepEqual(roundTripFileDifferences(before, {...before}, ''), []);
  });

  test(`${name}: a missing local copy passes with a drop in this launch`, t => {
    const log = launchLog(t, '[app] start current\n' + drop + '[migrate] startup moves finished {"moved":1}\n');
    assert.deepEqual(roundTripFileDifferences(before, {[name]: null}, log), []);
  });

  test(`${name}: a drop in an earlier launch cannot justify a missing copy`, t => {
    const log = launchLog(t, '[app] start old\n' + drop + '[app] start current\n[migrate] startup moves finished {"moved":0}\n');
    assert.deepEqual(roundTripFileDifferences(before, {[name]: null}, log), [`files.${name} "exported-digest" -> null`]);
  });

  test(`${name}: a missing copy without a drop fails and names the file`, () => {
    assert.deepEqual(roundTripFileDifferences(before, {[name]: null}, ''), [`files.${name} "exported-digest" -> null`]);
  });

  test(`${name}: changed bytes fail even with a drop in this launch`, t => {
    const log = launchLog(t, '[app] start current\n' + drop);
    assert.deepEqual(roundTripFileDifferences(before, {[name]: 'different-digest'}, log), [`files.${name} "exported-digest" -> "different-digest"`]);
  });
}


test('Windows CRLF drop lines justify missing local copies in this launch', t => {
  const log = launchLog(t, '[app] start current\r\n' +
    '[files] local copies dropped, the store has them {"files":["profile.md","answers.md"]}\r\n' +
    '[migrate] startup moves finished {"moved":1}\r\n');
  assert.deepEqual(roundTripFileDifferences(
    {'profile.md': 'profile-digest', 'answers.md': 'answers-digest'},
    {'profile.md': null, 'answers.md': null}, log), []);
});
