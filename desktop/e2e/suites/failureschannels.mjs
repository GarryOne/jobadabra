// The channel part of the failure checks: the Telegram digest and a bot that refuses it, the Gmail check through a fake Google, and a revoked Google sign-in. Its own Notion page, in
// parallel with activityfailures (the AI) and failuresnotion.
// Job: wait on state
import {runParts} from './activityfailures.mjs';

// Why (30 Oct 2026, bb 3/9, rule A): setup and task asks must use the stored table; any miss fails before live AI.
export const offlineAi = true;
export const realAi = false;
// Why (30 Oct 2026, bb 3/9): stored answers follow one store path (test/store.test.mjs), so the suite is pinned to the store it already ran its Notion/run-history steps on.
export const store = 'standin';   // the same stand-in as activityfailures, whose parts it runs
export const minutes = 12;
export const name = 'failureschannels';
export {hangCaps} from '../lib/failureschannels-caps.mjs';
// Why (30 Oct 2026, owner, Rule B): measured per-step hang caps replace the aggregate clock; a slow runner is not a failed state assertion.
export const aggregateBudget = false;
export const keepGoing = true;
export const notionProxy = true;   // the Jobs check behind the Telegram digest writes to Notion
export const telegram = true;
export const google = true;
export const env = {JOB_PILOTTO_E2E_HISTORY_MS: '3000', JOB_PILOTTO_E2E_RESUME_MS: '3000', JOB_PILOTTO_E2E_EXPECTS_FAILURES: '1'};
export const run = ctx => runParts(ctx, ['channels']);
