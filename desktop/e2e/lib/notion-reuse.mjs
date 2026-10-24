/* global window */
// A suite whose Notion page already holds a workspace connects to it the way a reconnecting user does: as a profile that already has one saved.
// 16 Oct 2026 (owner, "Always start new"): a profile with NO saved workspace (settings.notionIds empty) never reuses an existing Jobadabra page, it builds a new one beside it
// (desktop/lib/notion-workspace.js `fresh`); 17 Oct 2026 every e2e suite that seeded "from the existing workspace" failed with "Notion did not connect: missing Job Pilotto, found []".
// The placeholder is replaced by the real ids when the connect succeeds (main.js notionConnect). Guard: desktop/test/notion-fresh.test.js (the rule), e2e/lib/seed.mjs (the seed).
export const RECONNECT = {notionIds: {RECONNECT: 'the suite workspace'}};
export const connectExisting = (page, token) => page.evaluate(async ({token, patch}) => {
  await window.pilot.saveSettings(patch);
  return window.pilot.notionConnect(token);
}, {token, patch: RECONNECT});
