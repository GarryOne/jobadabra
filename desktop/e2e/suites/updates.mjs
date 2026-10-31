/* global document, window */
// The update flow (6 Oct 2026, item 13 of the e2e plan): which release the app offers, on which channel, read through the app's own updater (lib/updater.js) from a fake
// GitHub release list (lib/releases-fake.mjs). No Notion: the app runs in "trying" mode with a key saved. The install itself (swapping the app) is not run.
export const name = 'updates';
export const notion = false;
export const releases = true;
export const keepGoing = true;
export const minutes = 8;
export const macos = true;   // runs on a macOS runner: the updater offers only Mac and Windows installers (lib/updater.js asset)

const STABLE = '99.0.0', BETA = '99.1.0', UNAPPROVED = '99.2.0';

export async function run(ctx) {
  const {page, releases: server} = ctx;
  await ctx.run('the app is set up without Notion (trying mode): a key saved, setup done', async () => {
    await page.evaluate(async () => {
      await window.pilot.saveSecret('ANTHROPIC_API_KEY', 'sk-ant-api03-e2e-updates-not-a-real-key-000000000000000000000000000000000000000000000000');
      await window.pilot.saveSettings({setupDone: true, wizardStep: 'draft', setupFurthest: 'draft', betaChannel: false});
    });
    await page.reload();
    await page.waitForSelector('.view:not([hidden])', {timeout: 60000});
  }, {critical: true});

  const check = async (beta, list) => {
    server.set(list);
    await page.evaluate(on => window.pilot.saveSettings({betaChannel: on}), beta);
    const before = server.stats.lists;
    const result = await page.evaluate(() => window.pilot.updateCheck());
    if (server.stats.lists === before) throw new Error('the app did not read the fake release list: the check was not run (still "from source"?)');   // the positive control
    if (!result?.ok) throw new Error(`the update check failed: ${result?.text}`);
    return result.offer;
  };

  await ctx.run('a newer stable release is offered to everyone, in the menu foot', async () => {
    const offer = await check(false, [server.release(STABLE)]);
    if (offer?.version !== STABLE) throw new Error(`expected ${STABLE} on offer, got ${JSON.stringify(offer?.version ?? null)}`);
    await page.waitForFunction(version => !document.getElementById('nav-update')?.hidden && document.getElementById('nav-update-text').textContent.includes(version), STABLE, {timeout: 10000})
      .catch(() => { throw new Error('the menu foot does not show the update'); });
  });

  await ctx.run('an approved beta is offered only on the beta channel', async () => {
    const list = [server.release(BETA, {prerelease: true, approved: true}), server.release('0.0.1')];
    const off = await check(false, list);
    if (off) throw new Error(`with the beta channel off the app offered ${off.version}`);
    const on = await check(true, list);
    if (on?.version !== BETA) throw new Error(`with the beta channel on, expected ${BETA}, got ${JSON.stringify(on?.version ?? null)}`);
  });

  await ctx.run('a pre-release the gate has not approved is never offered, even on the beta channel', async () => {
    const offer = await check(true, [server.release(UNAPPROVED, {prerelease: true}), server.release('0.0.1')]);
    if (offer) throw new Error(`an unapproved build was offered on the beta channel: ${offer.version}`);
  });
}
