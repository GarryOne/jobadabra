/* global document */
// Open Actions → Runs, where the run list lives since 25 Oct 2026 (the drawer shows one run), with every row loaded.
export async function openRunsList(page, {all = true} = {}) {
  await page.click('.nav[data-view="actions"]');
  await page.click('[data-actions-tab="runs"]');
  await page.waitForFunction(() => !document.getElementById('actions-runs')?.hidden && !!document.querySelector('#actions-runs #activity-recent'), null, {timeout: 10000});
  for (let i = 0; all && i < 10 && await page.locator('#activity-all:visible').count(); i++) await page.click('#activity-all');
}
