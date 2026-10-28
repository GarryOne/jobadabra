// The window's calls for Jobadabra's browser (lib/background-browser-download.js): its state, start the download, Cancel. DEMO downloads nothing.
/** The window's calls for Jobadabra's browser: its state, start the download (never in DEMO), Cancel. Guard: test/ipc.test.js. */
export function registerBackgroundBrowserHandlers({ipcMain, addon, DEMO = false}) {
  ipcMain.handle('backgroundBrowserState', () => addon.state());
  ipcMain.handle('backgroundBrowserStart', () => { if (!DEMO) addon.start(); return addon.state(); });
  ipcMain.handle('backgroundBrowserCancel', () => { addon.cancel(); return true; });
}
