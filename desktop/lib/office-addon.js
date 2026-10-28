// The LibreOffice add-on inside the app: one download at a time into <data folder>/office, started when a Word CV is chosen, its steps sent
// to the window ('officeProgress' {step, share, bytes, total, started, error}) for the bar on Profile → CV (renderer/pages/office-progress.js),
// and Cancel. A LibreOffice already on the computer counts as ready. Download, checksum and unpacking: lib/office.js; the shared add-on: lib/optional-addon.js.
// Guard: test/office-addon.test.js.
import {findOffice, installOffice} from './office.js';
import {optionalAddon} from './optional-addon.js';

export function officeAddon(storage, {toWindow = () => {}, toast = () => {}, install = installOffice, find = findOffice, now = Date.now} = {}) {
  const addon = optionalAddon({dir: storage.path('office'), event: 'officeProgress', toWindow, toast, install, find, now,
    notice: {title: 'Getting LibreOffice for your Word CV', body: 'About 300 MB, only once. Follow it in Profile → CV.', target: {card: 'cv'}, tone: 'info'}});
  return {...addon, soffice: addon.path};
}
