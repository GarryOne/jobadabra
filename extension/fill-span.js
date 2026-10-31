// One awaited step of a tab's fill: logged as a span and counted as a wait by the application's silent dead-end clock (ladder/silence.js waitingSpan), so a slow Mac is not called silent.
import {span} from './log.js';
import {waitingSpan} from './ladder/silence.js';

/** Run `run` as the fill's own wait for this tab (named in the log like span()); a tab-less call only logs. Guard: worker/test/silence-own-steps.test.js. */
export const ownSpan = (tabId, name, run) => waitingSpan(span, tabId, name, run);
