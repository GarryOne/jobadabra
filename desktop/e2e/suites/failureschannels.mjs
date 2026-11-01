// The channel part of the failure checks: the Gmail check through a fake Google (night journey J16). Its own Notion page, in parallel with activityfailures (the AI) and failuresnotion.
// Why (R2, 1 Nov 2026, owner: "only the critical e2e/user journeys"): the Telegram digest moved to desktop/integration/store/run-channels.test.mjs, with the same Gmail check against the same fake Google.
// Job: wait on state
import {runParts} from './activityfailures.mjs';

// Stored answers cover the channel scenarios; pin their Notion stand-in to keep one replay path.
export const offlineAi = true;
export const realAi = false;
export const aiAnswers = 'backbone';
export const store = 'standin';

export const minutes = 12;
export const name = 'failureschannels';
import {hangCapsFor} from '../lib/hang-caps.mjs'; export const hangCaps = hangCapsFor('failureschannels');
// Why (30 Oct 2026, owner, Rule B): measured per-step hang caps replace the aggregate clock; a slow runner is not a failed state assertion.
export const aggregateBudget = false;
export const keepGoing = true;
export const notionProxy = true;   // the Gmail check logs its run row to Notion
export const google = true;
export const env = {JOB_PILOTTO_E2E_HISTORY_MS: '3000', JOB_PILOTTO_E2E_RESUME_MS: '3000', JOB_PILOTTO_E2E_EXPECTS_FAILURES: '1'};
export const run = ctx => runParts(ctx, ['channels']);
