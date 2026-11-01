// A suite's seeds through the store (lib/seed-data.mjs), on this Mac's store and on Notion (the stand-in): what is written reads back as the app reads it.
// Runs the real engine (python3 with the repo's requirements); no Notion but the local stand-in, no key.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {buildStandIn, startNotionFake} from '../../lib/notion-fake.mjs';
import {addInterview, addKitJob, addTrackedJob, DESCRIPTION_SECTION, KIT_SECTION, removeJobsByUrl, stageOf} from '../../lib/seed-data.mjs';
import {storeCall} from '../../lib/store-call.mjs';
import {kitOf} from '../../../lib/store/kit-section.js';   // a leaf module: no app imports (test/harness/installed-only.test.mjs)

const KIT = {answers: [{field: 'question_2001', question: 'Years of experience with Terraform', answer: '6'}], cover_letter: '', check_before_sending: []};
const URL = 'https://boards.greenhouse.io/e2e/jobs/4001001';

const contextOn = async store => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-seed-data-'));
  if (store === 'sqlite') {
    fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({store: 'sqlite'}));
    const ctx = {profile, store, token: ''};
    return {ctx: {...ctx, data: (entity, method, kwargs) => storeCall(ctx, entity, method, kwargs)}, close: async () => {}};
  }
  const fake = await startNotionFake();
  fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({notionIds: await buildStandIn(fake)}));
  const ctx = {profile, store, token: fake.token, appEnv: {JOB_PILOTTO_E2E_NOTION_BASE_URL: fake.url}};
  return {ctx: {...ctx, data: (entity, method, kwargs) => storeCall(ctx, entity, method, kwargs)}, close: () => fake.close()};
};

for (const store of ['sqlite', 'standin']) {
  test(`${store}: a seeded job reads back as the app reads it: its stage, its kit (the section's last json fence) and its posting; removing it removes it`, async () => {
    const {ctx, close} = await contextOn(store);
    try {
      const made = await addKitJob(ctx, {title: 'Senior SRE', company: 'E2E Greenhouse Labs', url: URL, kit: KIT, description: 'Run production on Kubernetes.'});
      assert.equal(await stageOf(ctx, URL), 'Kit ready');
      assert.deepEqual(kitOf(await ctx.data('applications', 'section', {app_id: made.id, name: KIT_SECTION})), KIT);
      assert.match(await ctx.data('applications', 'section', {app_id: made.id, name: DESCRIPTION_SECTION}), /Kubernetes/);
      assert.equal((await ctx.data('applications', 'get', {url: URL})).fit, 80);
      assert.equal(await removeJobsByUrl(ctx, [URL, 'https://not.tracked/1']), 1);
      assert.equal(await stageOf(ctx, URL), '');
    } finally { await close(); }
  });
}

for (const store of ['sqlite', 'standin']) {
  test(`${store}: a tracked job with its next interview, and an interview linked to it, read back from the store`, async () => {
    const {ctx, close} = await contextOn(store);
    try {
      const job = await addTrackedJob(ctx, {role: 'Senior SRE', company: 'E2E Acme', url: 'https://boards.e2e.test/cal/acme', nextInterview: '2026-10-13T23:30:00Z'});
      assert.match(String((await ctx.data('applications', 'get', {url: 'https://boards.e2e.test/cal/acme'})).next_interview), /^2026-10-1[34]/);
      const made = await addInterview(ctx, {name: 'E2E Acme · Recruiter screen', day: '2026-10-12', round: 'Recruiter screen', overall: 'positive', applicationId: job.id, transcript: '[00:00:03] Recruiter: Hello.'});
      const back = await ctx.data('interviews', 'get', {interview_id: made.id});
      assert.deepEqual([back.title, back.round, back.overall, String(back.app_id).replace(/-/g, '')], ['E2E Acme · Recruiter screen', 'Recruiter screen', 'positive', String(job.id).replace(/-/g, '')]);
      assert.match(back.transcript, /Recruiter: Hello/);
    } finally { await close(); }
  });
}
