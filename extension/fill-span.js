// One awaited step of a tab's fill: logged as a span and counted as a wait by the application's silent dead-end clock (ladder/silence.js waiting()), so a slow Mac is not called silent.
import {span} from './log.js';
import {waiting} from './ladder/silence.js';

/** Run `run` as the fill's own wait for this tab (named in the log like span()); a tab-less call only logs. Guard: worker/test/silence-own-steps.test.js. */
export const ownSpan = (tabId, name, run) => waiting(tabId, () => span(name, run));
