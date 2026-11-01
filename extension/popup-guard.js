// The worker side of the popup guard's gate (page/guard-gate.js → guard-bridge.js → here): the fill, between its stages, asked whether the page changed under it. A layer over the form's
// controls (on-top.js, by occlusion) is closed with the AI's non-agreeing button (consent.js closePopupOrLayer, popup-pick.js, kept per popup, at most 3 tries) and the fill goes on; one nothing
// closes holds it ({held: true}). The decision lives here, never in the page. Imported by flow.js for its message listener. Guard: app-core/test/dialog-after-fill.test.js, recorded cases.
import {decide} from './log.js';
import {closePopupOrLayer} from './consent.js';
import {clearBeforeFill, layerOnTop} from './dialog-after-fill.js';

export async function answerGate(tabId, {close = closePopupOrLayer, look = layerOnTop, say = decide} = {}) {
  const out = await clearBeforeFill(tabId, {close, look});
  if (out.closed.length) say('fill', 'closed a dialog during the fill', {label: out.closed[0].slice(0, 40), tab: tabId});
  return {held: out.held, layer: out.layer};
}
if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (message?.type !== 'jobpilotto-gate' || !sender?.tab?.id) return false;
    answerGate(sender.tab.id).then(out => reply({held: out.held})).catch(() => reply({held: false}));
    return true;   // the answer comes later
  });
}
