/* global document */
// Press a task's button on the Actions page the way a person does: the smaller tasks sit in the collapsed "More" group (renderer/more-group.js), so it is opened first when the button is inside it.
// Guard: test/nav-click-class.test.mjs (a direct click on a card that can sit under More fails).
export async function pressTask(page, selector, options = {}) {
  const inMore = await page.evaluate(sel => !!document.querySelector(`#actions-more-list ${sel}`), selector);
  if (inMore && await page.locator('#actions-more-list').isHidden()) await page.click('#actions-more-head');
  await page.click(selector, options);
}
