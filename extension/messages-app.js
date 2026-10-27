// The extension worker's messages from the page: the site password for a sign-in page and the form review relay to the app (moved out of background.js, 8 Oct 2026).
// A group of createXMessages: each returns a function that answers the messages it owns and returns undefined for any other. A FLOW FILE (docs/flows/applying.md).
// Guards: the credentials and review tests in desktop/test and the matrix (npm run flows).
import {bindSession, sessionOf} from './tab-identity.js';
import {api} from './flow.js';
import {accountStep} from './account-step.js';
import {formReady} from './form-ready.js';
import {roleOf} from './account.js';
import {settings} from './flow.js';
import {isStopped, stopFromApp} from './stop.js';
import {decide} from './log.js';

/** Relay form reports without letting an empty child document replace the tab's application state. */
export function createAppMessages(ctx) {
  const {bootId, jobOf} = ctx;
  let frameSaid = false;   // one metadata-only diagnostic per worker, not a log on every frame poll
  return function messages_app(message, sender, reply) {
    // A sign-in or sign-up page in a tab the app opened: its empty password boxes are filled from the Keychain (owner, 8 Oct 2026),
    // as a browser's password manager would. The site is Chrome's own tab address, not the page's word; the value goes into the
    // boxes only, never back to the page's scripts or the panel.
    if (isStopped() && (message?.type === 'sitePassword' || message?.type === 'review')) { reply({filled: 0, matched: null, stopped: true}); return true; }   // stopped by the person (stop.js): no password typed, no judgment, no report
    if (message?.type === 'sitePassword' && sender.tab) {
      accountStep(sender.tab, sender.frameId).then(reply, () => reply({filled: 0}));
      return true;
    }
    if (message?.type === 'review' && sender.tab) {
      // Why (2026-10-27, owner, Applying flicker): all-frame injection lets helper frames report "reading" with zero fields under the same tab/session. Only the top document may clear the app's form state with an empty page report.
      // Frames with application fields or account state still report normally, including their watches and commands; no host or widget-name rule decides this.
      if (Number.isInteger(sender.frameId) && sender.frameId > 0 && !(Number(message.payload?.total) > 0) && !message.payload?.account) {
        if (!frameSaid) { frameSaid = true; decide('panel', 'empty child-frame review ignored: form state stays with its document', {tab: sender.tab.id, frame: sender.frameId, fields: Number(message.payload?.total) || 0}).catch(() => {}); }
        reply({matched: null, frame: true});
        return true;
      }
      formReady(sender.tab, sender.frameId, message.payload).catch(() => {});   // the AI may veto "Ready to submit" (form-ready.js); never blocks the report
      (async () => {
        const config = await settings();
        if (config.workerUrl && !config.workerUrl.startsWith('http://127.0.0.1')) return {matched: null};  // your own Worker: no app
        // The session this tab belongs to travels with it (next pages, tabs it opens): the app uses it instead of guessing.
        const carried = await sessionOf(sender.tab.id);
        const answer = await api(config, '/extension/review', {method: 'POST', body: JSON.stringify({...(message.payload || {}), tab: sender.tab.id, boot: await bootId(), job: await jobOf(sender.tab), session: carried,
          role: await roleOf(sender.tab.id, sender.tab.url)})});   // the page type by the one rule (an account page never counts as the form's progress)
        await bindSession(sender.tab.id, answer?.matched, carried);
        await stopFromApp(answer);   // the app's Stop button: its answer to any report carries the request (stop.js)
        return answer;
      })().then(reply, () => reply({matched: null}));
      return true;  // the reply comes later
    }
    return undefined;   // not one of this group's messages: the next group looks
  };
}
