// Whether the extension may reload itself (extension/tab-report.js): for a newer version the app reports, or the panel's Reload. Guard: desktop/test/extension-self-reload.test.js.

/**
 * latest/running: the version the app reports and the one this copy runs; reloadedFor: the version it last reloaded for; busy: a fill or a site read is under way;
 * owned: this is the hidden browser's copy; panel: the person pressed Reload in the panel (no version compare).
 * Why (2026-10-28, e2e proof of Background automation, measured): a reload makes Chrome register the copy as "unpacked" and disable it (reason 16777216) when developer mode is off,
 * so the hidden browser's copy never fills again. In a development checkout the app reports a stamped version above that copy's base 0.9, so it reloaded itself at its first report.
 * The app already writes a fresh copy at every start of that browser, so it never needs the reload.
 */
export function mayReloadSelf({latest, running, reloadedFor = '', busy = false, owned = false, panel = false, newer}) {
  if (owned || busy) return false;
  if (panel) return true;
  return !!latest && newer(latest, running) && reloadedFor !== latest;
}
