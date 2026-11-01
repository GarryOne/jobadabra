// Both live paths seed the SAME job state for the posting (lib/seed-data.mjs seedLivePosting): tracked, Saved, no drafted kit, nothing invented. A kit on the
// Electron path only made the extension skip its eligibility stop there (Teamtailor, 11 Oct 2026: Electron filled, plain node stopped, on the same verdict).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {KIT_SECTION, DESCRIPTION_SECTION, seedLivePosting} from '../../lib/seed-data.mjs';

const E2E = path.resolve(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), '..');
const read = file => fs.readFileSync(path.join(E2E, file), 'utf8');

test('the live posting is a fresh job: tracked and Saved, with no kit, description or invented location', async () => {
  const calls = [];
  const ctx = {data: async (entity, method, kwargs) => { calls.push({entity, method, kwargs}); return method === 'create' ? {id: 'j1'} : {}; }};
  await seedLivePosting(ctx, {url: 'https://jobs.example.org/42', title: 'Engineer', company: 'Example'});
  const create = calls.find(call => call.method === 'create');
  assert.deepEqual(create.kwargs, {job: {url: 'https://jobs.example.org/42', title: 'Engineer', company: 'Example', location: ''}, stage: 'Saved'});
  const sections = calls.filter(call => call.method === 'set_section').map(call => call.kwargs.name);
  assert.equal(sections.includes(KIT_SECTION), false, 'a kit makes the extension skip the eligibility stop');
  assert.equal(sections.includes(DESCRIPTION_SECTION), false, 'a fixture description is not the real posting\'s');
});

test('both live paths seed the posting through seedLivePosting before Apply', () => {
  // Plain node: the runner seeds the offline app's own store, before its Apply.
  const row = read('lib/live-row.mjs');
  const seeded = row.indexOf('seedLivePosting('), pressed = row.indexOf("call('applyOne'");
  assert.ok(seeded > 0 && seeded < pressed, 'lib/live-row.mjs presses Apply without seeding the posting as the Electron path does');
  // Electron: lib/apply-live.mjs presses Apply on the posting the apply suite seeded; the suite gives the live posting no kit.
  const suite = read('suites/apply.mjs');
  assert.match(suite, /form === live \? seedLivePosting\(ctx, live\)/, 'suites/apply.mjs seeds the live posting another way than seedLivePosting');
  // ...and its wait for the seeded jobs accepts the live posting without a kit (18:20, 11 Oct 2026: it waited for a kit the fresh job never has, and the Electron leg failed).
  assert.match(suite, /job\.url === url && \(job\.kit \|\| url === liveUrl\)/, 'suites/apply.mjs waits for a kit on the live posting, which a fresh job never has');
});
