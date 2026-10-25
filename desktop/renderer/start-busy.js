// What a Start button says while another task runs (owner, 25 Oct 2026: "when I apply to Find jobs it doesn't do anything (because there is another task in the process)";
// "We should handle this properly"). One rule for every button that starts a run: its task waiting behind another turns the button into
// "Queued · starts after <task>" (the short form on small buttons), and the press answers with a toast. Pure functions; pages/runs-page.js applies them.
// Guarded by: test/start-busy.test.js.
export const queuedText = (afterName, small = false) => (small ? `Queued · after ${afterName}` : `Queued · starts after ${afterName}`);
export const queuedToast = (kindName, afterName) => ({title: `${kindName} is queued`, body: `It starts when ${afterName} ends.`});

// The tasks the Mac runs, as the buttons see them: {running: kind|null, queued: [kind]}. -> 'running' | 'queued' | null for a button of `kind`.
export function startState(kind, {running = null, queued = []} = {}) {
  if (running === kind) return 'running';
  return queued.includes(kind) ? 'queued' : null;
}

// Every selector that starts a task, by kind (the Actions cards are found by data-command; renderer/pages/activity-basics.js TASK_BUTTONS lists the rest).
// A press on one of these, from a click or from ⌘K, is answered by pages/start-feedback.js.
export const FIND_CARD_BUTTONS = '.find-card .find-again, .find-card .magic-go';
export const kindOfStartButton = (node, {taskButtons, commandKind}) => {
  if (!node?.closest) return null;
  const card = node.closest('[data-command]');
  if (card && commandKind[card.dataset.command]) return commandKind[card.dataset.command];
  if (node.closest(FIND_CARD_BUTTONS)) return 'search';
  for (const [kind, ...selectors] of taskButtons) if (selectors.some(selector => node.closest(selector))) return kind;
  return null;
};

// A button waiting behind another task says so (and gets its own text back when it starts); a button with an icon inside keeps its look and only gets the title.
export function applyQueuedLook(node, state, afterName) {
  if (state === 'queued' && afterName) {
    if (!node.children?.length) {
      if (node.dataset.text0 === undefined) node.dataset.text0 = node.textContent;
      node.textContent = queuedText(afterName, node.classList?.contains('small') || node.dataset.text0.length < 6);
    }
    node.title = `Waiting for ${afterName} to end: it starts by itself`;
  } else if (node.dataset.text0 !== undefined) { node.textContent = node.dataset.text0; delete node.dataset.text0; }
}
