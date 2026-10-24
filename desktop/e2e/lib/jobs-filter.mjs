// Jobs page e2e: show exactly one filter of the Show menu (the multi-select, renderer/multi-select.js) through its own buttons, as a person would.
// Ticks the wanted one first, then unticks the others (unticking the last one would fall back to New matches).
export async function showFilter(page, id) {
  await page.click('#filter-status');
  const checked = await page.$$eval('.ui-multi [aria-checked="true"]', nodes => nodes.map(node => node.dataset.id));
  if (!checked.includes(id)) await page.click(`.ui-multi [data-id="${id}"]`);
  for (const other of checked) if (other !== id) await page.click(`.ui-multi [data-id="${other}"]`);
  await page.keyboard.press('Escape');
}
