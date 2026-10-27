// Stop's messages (extension/stop.js): the popup's and the panel's Stop buttons, the person's own start again (the panel's Fill, the popup's "Apply on this page" and "Read this board", Fill anyway, Take over
// with Claude), and what a stopped worker refuses to do (Claude's fill, a tailored CV, a read of a job list, arming a tab). A group of createXMessages (background.js): it answers the
// messages it owns and returns undefined for any other. Also registers Chrome's own "Cancel" on the debugging bar and the note to the app. Guard: desktop/test/extension-stop.test.js.
import {api, settings} from './flow.js';
import {isStopped, onStarted, onStopped, restart, startTab, stopAll, watchDebugger} from './stop.js';

const PERSON_STARTS = ['panelFill', 'applyHere', 'fillAnyway', 'panelTakeOver', 'visitRead'];   // the person pressing a button that starts the work again
const REFUSED = ['claudeFill', 'panelReviewAnswer', 'armTab'];   // what acts or spends: nothing while stopped (the password and the review reports: messages-app.js)

export function createStopMessages() {
  watchDebugger();
  onStopped(async reason => {   // the app learns it at once: its session says "Stopped", the Stop button it asked for is answered (desktop/lib/server.js /extension/event)
    const config = await settings();
    if (!config.workerUrl || config.workerUrl.startsWith('http://127.0.0.1')) await api(config, '/extension/event', {method: 'POST', body: JSON.stringify({type: 'stopped', reason: String(reason).slice(0, 80)})});
  });
  onStarted(async (tab, who) => {   // ...and that the person started again on a tab: that tab's session leaves "Stopped" (desktop/lib/stop-all.js startForm)
    const config = await settings();
    if (!config.workerUrl || config.workerUrl.startsWith('http://127.0.0.1')) await api(config, '/extension/event', {method: 'POST', body: JSON.stringify({type: 'started', tab, who: String(who).slice(0, 40)})});
  });
  return function messages_stop(message, sender, reply) {
    if (message?.type === 'stop') {
      stopAll(String(message.reason || 'the person pressed Stop')).then(done => reply({ok: true, ...done}), () => reply({ok: false}));
      return true;
    }
    if (PERSON_STARTS.includes(message?.type)) {   // the group that owns the message answers it
      const was = restart(`the person pressed ${message.type}`);
      startTab(Number.isInteger(message.tabId) ? message.tabId : sender?.tab?.id, message.type, was);   // the page's own Stop, on the tab it was pressed for (the popup names it; its own tab is not the page)
      return undefined;
    }
    if (isStopped() && REFUSED.includes(message?.type)) { reply({ok: false, stopped: true}); return true; }
    return undefined;
  };
}
