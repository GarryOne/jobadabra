// The one switch for the fill ladder's repair rung: it acts for every user unless the kill switch (chrome.storage repairAct: false) is set (owner, 15 Oct 2026: "I want the repair for real users").
// Until then it acted only in the e2e harness (ladderAct); the floors that keep a repair from changing an answer live in page/repair-act.js. Guard: app-core/test/fill-climb.test.js.
export const repairActs = config => config?.repairAct !== false;
