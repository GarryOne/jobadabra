// A Start button pressed while another task runs answers at once (owner, 25 Oct 2026): the toast says the task is queued and after what, with a way to see the queue.
// One click listener for every button that starts a task (Jobs, the Actions cards, Tailor, Find jobs using your browser, Gmail check; ⌘K clicks them too), so a new
// start button is covered by listing it in TASK_BUTTONS, not by remembering to call this. Rule and look: renderer/start-busy.js. Guard: test/start-busy.test.js.
import {COMMAND_KIND, TASK_BUTTONS, kindOf} from './activity.js';
import {kindOfStartButton, queuedToast, startState} from '../start-busy.js';
import {showRunsTab} from './runs-tab.js';
import {taskName} from './runs-page.js';
import {toastMessage} from './startup.js';

// Called a moment after a press, once the task is in the queue.
export async function announceQueued(kind, {runs = () => window.pilot.runs(), toast = toastMessage} = {}) {
  const data = await runs().catch(() => null);
  if (!data?.running) return null;
  const state = startState(kind, {running: kindOf(data.running), queued: (data.queued || []).map(kindOf)});
  if (state !== 'queued') return null;
  const {title, body} = queuedToast(taskName(kind), taskName(kindOf(data.running)));
  toast({title, body, action: {label: 'View queue', run: showRunsTab}, tone: 'info'});
  return state;
}

export function initStartFeedback() {
  document.addEventListener('click', event => {
    const kind = kindOfStartButton(event.target, {taskButtons: TASK_BUTTONS, commandKind: COMMAND_KIND});
    if (kind && !event.target.closest('button')?.disabled) setTimeout(() => announceQueued(kind), 500);   // the main process queues the task a moment after the press
  });
}
