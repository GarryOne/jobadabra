// The Notion part of the failure checks: a Save that Notion refuses is never shown as saved (step in lib/run-parts.mjs), on its own Notion page. Notion busy / HTML
// error page / connection gone under a run are integration/store/run-faults-notion.test.mjs; the former activityfailures suite left e2e on 1 Nov 2026.
import {runParts} from '../lib/run-parts.mjs';

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
