// Window navigation memory: fixed view identifiers only, surviving reloads without keeping form values.
/** Read or keep a navigation identifier for this window; unavailable storage leaves navigation usable. */
export const remembered = (key, value) => {
  try { if (value === undefined) return sessionStorage.getItem(key); sessionStorage.setItem(key, value); } catch { /* Memory is optional. */ }
  return null;
};
/** Restore only destinations still offered by the current window, with safe first-launch defaults. */
export function restoreView({document, openView, settingsPage, fallback}) {
  const view = remembered('view'), section = remembered('settingsPage');
  const offered = [...document.querySelectorAll('.view')].some(node => node.dataset.view === view);
  openView(offered ? view : fallback);
  if (offered && view === 'settings' && [...document.querySelectorAll('[data-settings-page]')].some(node => node.dataset.settingsPage === section)) settingsPage(section);
}
