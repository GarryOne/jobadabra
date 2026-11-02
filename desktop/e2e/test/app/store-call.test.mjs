// The suites' one way to the person's data (lib/store-call.mjs): the engine's own store command, on this Mac's store and on Notion (the stand-in), with the same calls.
// Runs the real engine (python3 with the repo's requirements); no Notion but the local stand-in, no key.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {buildStandIn, startNotionFake} from '../../lib/notion-fake.mjs';
import {storeCall, storeEnv} from '../../lib/store-call.mjs';
import {paceFile} from '../../../lib/notion-pace.js';

const profileWith = settings => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-store-call-'));
  fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify(settings));
  return profile;
};
const JOB = {url: 'https://boards.e2e.test/job/store-call-1', title: 'Senior Site Reliability Engineer', company: 'E2E Seam AG', location: 'Zurich, Switzerland'};

// The same round trip on a store: a job saved, then found in the list, its kit section written and read back.
async function roundTrip(ctx) {
  const made = await storeCall(ctx, 'applications', 'create', {job: JOB, stage: 'Saved'});
  assert.ok(made?.id, `create answered ${JSON.stringify(made)}`);
  const listed = await storeCall(ctx, 'applications', 'list', {});
  assert.deepEqual(listed.filter(item => item.url === JOB.url).map(item => [item.title, item.stage]), [[JOB.title, 'Saved']]);
  await storeCall(ctx, 'applications', 'set_section', {app_id: made.id, name: '🧾 Job description', markdown: 'Run production on Kubernetes.'});
  assert.match(await storeCall(ctx, 'applications', 'section', {app_id: made.id, name: '🧾 Job description'}), /Kubernetes/);
}

test('this Mac\'s store: the engine\'s store, in the profile\'s data folder, with no Notion at all', async () => {
  const profile = profileWith({store: 'sqlite'});
  const env = storeEnv({profile});
  assert.equal(env.JOBADABRA_STORE, 'sqlite');
  assert.equal(env.NOTION_TOKEN, undefined);
  await roundTrip({profile, store: 'sqlite', token: ''});
  assert.ok(fs.readdirSync(path.join(profile, 'data')).some(name => name.endsWith('.sqlite')), 'the data is in the profile\'s own data folder');
});

test('Notion (the stand-in): the same calls, with the run\'s token and the workspace the app connected to', async () => {
  const fake = await startNotionFake();
  try {
    const ids = await buildStandIn(fake);
    const profile = profileWith({notionIds: ids});
    await roundTrip({profile, store: 'standin', token: fake.token, appEnv: {JOBADABRA_E2E_NOTION_BASE_URL: fake.url, JOBADABRA_E2E_NOTION_STANDIN: '1'}});
    assert.equal(fake.dump().find(item => item.title === 'Job Tracker')?.rows, 1, 'the job is a row of the stand-in\'s Job Tracker, not anywhere else');
  } finally { await fake.close(); }
});

test('a Notion store the app has not connected yet is said, not guessed', () => {
  assert.throws(() => storeEnv({profile: profileWith({}), token: ''}), /not connected yet/);
});

test('only the in-memory Notion store opts the engine out of the real service clock', () => {
  const profile = profileWith({store: 'notion', notionIds: {}});
  const given = {profile, token: 'fixture', notionUrl: 'http://127.0.0.1:12345'};
  assert.equal(storeEnv({...given, standIn: true}).JOBADABRA_E2E_NOTION_STANDIN, '1');
  assert.equal(storeEnv(given).JOBADABRA_E2E_NOTION_STANDIN, undefined, 'a local fault proxy may still forward to real Notion');
});

test('seed subprocesses use the app environment marker even when the context store label is notion', async t => {
  const fake = await startNotionFake();
  const clock = paceFile(fake.token);
  t.after(async () => { await fake.close(); fs.rmSync(clock, {force: true}); });
  const profile = profileWith({store: 'notion', notionIds: await buildStandIn(fake)});
  const result = await storeCall({profile, store: 'notion', token: fake.token,
    appEnv: {JOBADABRA_E2E_NOTION_BASE_URL: fake.url, JOBADABRA_E2E_NOTION_STANDIN: '1'}}, 'applications', 'list');
  assert.deepEqual(result, []);
  assert.equal(fs.existsSync(clock), false, 'the seed process must inherit the app marker instead of reclassifying the store label');
});

test('never anyone\'s real data: only a temp profile, HOME there, and the engine does not follow an app set up on this computer', () => {
  assert.throws(() => storeEnv({profile: os.homedir()}), /not a temp profile/);
  const profile = profileWith({store: 'sqlite'});
  const env = storeEnv({profile});
  assert.deepEqual([env.HOME, env.JOBADABRA_FOLLOW_APP, env.JOBADABRA_DATA_DIR], [profile, '0', path.join(profile, 'data')]);
});
