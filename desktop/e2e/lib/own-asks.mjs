// The one rule for "a replay is on its recording" (cc, 14 Oct 2026): every ask THE BUILD makes is answered from the memo (no extra ask) and every site request is served. A memo key the build
// never asks does not count against it: a fix drops or reshapes an ask, and the old build's answers stay in the memo as the control of every verdict (verify-judge.mjs). A run that
// answered nothing of a memo that has asks is not on it (it stopped before the AI). Pure. Used by replay-records.mjs isSame and verify-judge.mjs onRecording. Guard: e2e/test/harness/own-asks.test.mjs.
export const onOwnAsks = (network, liveAsks) => !!(network && network.extra === 0 && network.notRecorded === 0 && (network.hit > 0 || !liveAsks));
