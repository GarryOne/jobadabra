// A site that refuses the phone number's writing ("This Phone Number Format is not Allowed", HelloFresh, 11 Oct 2026): the number is typed again in another writing,
// at most twice per box. The site's own error text goes to the AI (phase "format", lib/format-judge.js), which names one writing from a fixed list; the page script builds
// the text (page/browser-form-fastpath.js __jobadabraRetypeAs) from the number we typed, so no value ever goes to the AI. Called by form-ready.js when the judge says
// the page shows an error about what was entered. Guard: desktop/test/format-judge.test.js, desktop/e2e/recorded/phone-format-refused-1.
import {apiFor} from './flow.js';
import {decide} from './log.js';

export const MAX_WRITINGS = 2;
const run = (tab, frameId, func, args = []) => chrome.scripting.executeScript({target: {tabId: tab.id, frameIds: [frameId ?? 0]}, func, args, world: 'MAIN'}).then(rows => rows?.[0]?.result).catch(() => undefined);

// -> how many boxes were typed again in another writing (a count only).
export async function retryRefusedFormats(tab, frameId, config) {
  const refused = await run(tab, frameId, () => window.__jobadabraRefusedPhones?.() || []);
  let again = 0;
  for (const item of refused || []) {
    if ((item.tried || []).length >= MAX_WRITINGS) continue;
    const answer = await apiFor(tab.id, config, '/extension/account-judge', {method: 'POST', body: JSON.stringify({phase: 'format', label: item.label, message: item.message, tried: item.tried || []})}).catch(() => null);
    if (!answer?.format) continue;
    const done = await run(tab, frameId, (field, format) => window.__jobadabraRetypeAs?.(field, format) || false, [item.field, answer.format]);
    decide('fill', `a site refused the phone number's writing: typed again as ${answer.format}`, {done: !!done, times: (item.tried || []).length + 1}).catch(() => {});   // the writing's name, never the number
    if (done) again += 1;
  }
  return again;
}
