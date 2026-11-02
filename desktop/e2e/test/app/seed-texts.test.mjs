// The text helpers of lib/seed-texts.mjs through the engine's own store command, on this Mac's store and on Notion (the stand-in): a Profile line is
// rewritten and read back, a line that is not there changes nothing, and the store's text holds what was written.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {buildStandIn, startNotionFake} from '../../lib/notion-fake.mjs';
import {storeCall} from '../../lib/store-call.mjs';
import {plainTextOf, rewriteTextLines, storeText, textOf} from '../../lib/seed-texts.mjs';

const PROFILE = '# Profile\n\n## Compensation\n\nTarget: CHF 180,000 (estimate)\n- Minimum acceptable: CHF 150,000\n';
const profileWith = settings => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-seed-texts-'));
  fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify(settings));
  return profile;
};
async function check(ctx) {
  ctx.data = (entity, method, kwargs = {}) => storeCall(ctx, entity, method, kwargs);
  await ctx.data('texts', 'set', {name: 'profile', markdown: PROFILE});
  assert.equal(await rewriteTextLines(ctx, 'profile', /^\s*Target:/, 'Target: CHF 170,000 per year in Switzerland'), 1);
  assert.equal(await rewriteTextLines(ctx, 'profile', /^\s*Bonus:/, 'Bonus: none'), 0, 'a line that is not there is counted, not invented');
  const text = await textOf(ctx, 'profile');
  assert.match(text, /Target: CHF 170,000 per year in Switzerland/);
  assert.match(text, /Minimum acceptable: CHF 150,000/, 'the other lines stay');
  assert.equal(await rewriteTextLines(ctx, 'profile', /Minimum acceptable:/, 'Minimum acceptable: CHF 140,000'), 1);
  assert.match(await textOf(ctx, 'profile'), /^- Minimum acceptable: CHF 140,000$/m, 'a bullet stays a bullet');
  assert.match(await plainTextOf(ctx, 'profile'), /CHF 140,000/, 'the AI\'s text (texts.plain)');
  await ctx.data('employers', 'add', {employer: {name: 'E2E Gamma'}});
  const all = await storeText(ctx);
  assert.match(all, /E2E Gamma/);
  assert.match(all, /CHF 170,000/);
}
test('this Mac\'s store', {timeout: 60000}, () => check({profile: profileWith({store: 'sqlite'}), store: 'sqlite', token: ''}));
test('Notion (the stand-in)', {timeout: 60000}, async () => {
  const fake = await startNotionFake();
  try { await check({profile: profileWith({notionIds: await buildStandIn(fake)}), store: 'standin', token: fake.token, appEnv: {JOBADABRA_E2E_NOTION_BASE_URL: fake.url}}); }
  finally { await fake.close(); }
});
