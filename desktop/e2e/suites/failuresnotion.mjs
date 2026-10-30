// The Notion part of the failure checks: a Jobs check while Notion is busy, answers an HTML error page, or is gone; a Save that Notion refuses. Its own Notion page, in parallel
// with activityfailures (the AI) and failureschannels (Telegram, Gmail, Google): the three halve the wall-clock time of the old single suite.
import {runParts} from './activityfailures.mjs';

// Why (30 Oct 2026, ap, main run 40985357367): every declared ask uses the stored backbone table without a live key.
export const offlineAi = true;
// Why (30 Oct 2026, ap, main run 40985357367): the real-model guard catches any escape while testing Notion faults.
export const realAi = false;
export const aiAnswers = 'backbone';   // answers its AI from the stored table in every workflow (plan-run.mjs puts it in the matrix)
export const minutes = 12;
export const name = 'failuresnotion';
// Notion's own failures (429, 500, a refused write) on the app's Notion calls: it runs on Notion, the stand-in, with the fault proxy in front (P7).
export const store = 'standin';
export const keepGoing = true;
export const notionProxy = true;
export const env = {JOB_PILOTTO_E2E_HISTORY_MS: '3000', JOB_PILOTTO_E2E_RESUME_MS: '3000', JOB_PILOTTO_E2E_EXPECTS_FAILURES: '1'};
export const run = ctx => runParts(ctx, ['notion']);
