// A persisted background handoff stops the real fill entry before page reads, navigation, consent handling or refilling after reload.
import assert from 'node:assert/strict';
import {test} from 'node:test';

test('manual CAPTCHA state freezes consider after reload and worker recreation, while an unbound owned tab fails closed', async () => {
  const keep = globalThis.chrome;
  let row = {session: 'manual', tab: 42, manualRequired: true}, bound = true, touched = 0;
  globalThis.chrome = {
    storage: {
      local: {get: async () => ({backgroundOwner: 'owned', backgroundApplySessions: {manual: row}}), set: async () => {}},
      session: {get: async () => bound ? {'session:42': 'manual'} : {}},
    },
    scripting: {executeScript: async () => { touched++; throw new Error('the manual page must not be read or changed'); }},
    tabs: {get: async () => { touched++; throw new Error('the manual page must not be read or changed'); }},
    runtime: {getManifest: () => ({version: '0'})},
  };
  try {
    const {consider} = await import('../../extension/fill-flow.js');
    const tab = {id: 42, url: 'https://jobs.example.test/app#jobpilotto-fill=manual'};
    await consider(tab, tab.url);
    assert.equal(touched, 0);
    row = {...row}; // a fresh runtime reads the same persisted override
    await consider(tab, tab.url);
    assert.equal(touched, 0);
    bound = false;
    await consider(tab, tab.url);
    assert.equal(touched, 0, 'no session authority in the dedicated browser is never permission to fill');
  } finally { globalThis.chrome = keep; }
});
