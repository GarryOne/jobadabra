// The one-time note "Jobadabra is installed twice" (a native dialog), with one action: Windows' own Installed apps page. Detection is lib/two-installs.js.
// Why (31 Oct 2026, owner: "Root fix + note"): nothing is removed by this app; the person keeps one copy in Windows' own list.
// Why (31 Oct 2026, coordinator, after #2729): a Store copy first used on a clean PC still keeps its data in the package's own folder (JOB-165), so the text never says the copies share data.
import {detectCopies, installedTwice} from './two-installs.js';

export const APPS_SETTINGS = 'ms-settings:appsfeatures';  // Windows Settings → Apps → Installed apps

/**
 * The note's native dialog options. Takes {self: 'store' | 'exe'} (the copy that is open now). Recommends keeping the Store copy: no SmartScreen warning, the Store updates it.
 * The buttons: 0 opens Windows' Installed apps page, 1 leaves both installed.
 */
export function noticeOptions({self}) {
  const which = self === 'store'
    ? 'The one you have open is the Store copy. In the list, remove the other "Jobadabra": the one that is not from the Microsoft Store.'
    : 'The one you have open came from the website. Keep the Microsoft Store one: it updates itself, with no Windows warning. In the list, remove the "Jobadabra" that is not from the Microsoft Store (this one).';
  return {
    type: 'info', title: 'Jobadabra', message: 'Jobadabra is installed twice',
    detail: `You have the Microsoft Store version and the one from the website on this PC. Your data may be kept separately in each copy, and each has its own Start menu entry and its own updates.\n\n${which}\n\nNothing is removed unless you do it in Windows. Removing the Microsoft Store copy can also remove data kept only in it.`,
    buttons: ['Open Installed apps', 'Keep both'], defaultId: 0, cancelId: 1, noLink: true,
  };
}

/**
 * Shows the note once, without blocking the start. Takes {dialog, shell, storage, window, packaged, self, copies, platform, env}. Does nothing off Windows, from source (`packaged` false: `npm start` on a PC with both copies would name the wrong copy and set the flag in the dev folder), with a test or demo data folder
 * (JOBADABRA_USER_DATA), with one copy, or after it was asked (settings `installedTwiceAsked`, saved before the dialog opens, so a crash or a second start never asks twice).
 * Resolves to 'asked' | 'skipped' | 'failed' and never rejects. The one action opens Windows' own page; nothing is removed by this app.
 * Why (31 Oct 2026): the async dialog, not showMessageBoxSync, which would hold the whole start until someone clicked.
 */
export async function askInstalledTwice({dialog, shell, storage, window, packaged, self = process.windowsStore ? 'store' : 'exe', copies = detectCopies(), platform = process.platform, env = process.env}) {
  try {
    if (platform !== 'win32' || !packaged || env.JOBADABRA_USER_DATA || !installedTwice(copies) || storage.settings().installedTwiceAsked) return 'skipped';
    storage.saveSettings({installedTwiceAsked: true});
    const options = noticeOptions({self});
    const {response} = await (window ? dialog.showMessageBox(window, options) : dialog.showMessageBox(options));
    if (response === 0) shell.openExternal(APPS_SETTINGS);
    return 'asked';
  } catch { return 'failed'; }
}
