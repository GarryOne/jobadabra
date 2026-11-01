// The judges' sketch (account-fill.js accountSketch), taken once the one control reader is in that script world (page/read-back.js and the typed-box rule it uses,
// page/typed-check.js): the panel's world has them, the page's own world has them once a fill ran, a page judged before any fill gets them here, so the form judge, the account
// step and the closer look see each control's state as the panel and the fill do (spec docs/superpowers/specs/2026-10-12-fill-ladder.md, amendment 4). Guard: app-core/test/read-back.test.js.
import {accountSketch} from './account-fill.js';

export const READER_FILES = ['page/typed-check.js', 'page/read-back.js'];

// tabId, frameId, world ('MAIN' or none) -> the sketch, or undefined.
export async function sketchOf(tabId, frameId = 0, world) {
  const target = {tabId, frameIds: [frameId ?? 0]}, inWorld = world ? {world} : {};
  const run = more => chrome.scripting.executeScript({target, ...inWorld, ...more}).then(rows => rows?.[0]?.result).catch(() => undefined);
  if (!(await run({func: () => !!window.__jobPilottoReadBack}))) await run({files: READER_FILES});
  return run({func: accountSketch});
}
