// A fake Windows disk for the installed-twice tests (shared by two-installs.test.js and two-installs-notice.test.js): the layout measured on a Windows runner (msix-spike.yml, two-installs).
import {detectCopies, EXE_FOLDER, STORE_IDENTITY} from '../lib/two-installs.js';

export const LOCAL = 'C:\\Users\\p\\AppData\\Local';
export const FAMILY = `${STORE_IDENTITY}_8wekyb3d8bbwe`;
export const EXE = `${LOCAL}\\Programs\\${EXE_FOLDER}\\Jobadabra.exe`;

/** The probes of a fake disk: the Packages folder's names and the files that exist. */
export const probes = ({packages = [], files = []} = {}) => ({names: dir => (dir === `${LOCAL}\\Packages` ? packages : []), isFile: file => files.includes(file)});
export const disk = {
  none: probes(),
  storeOnly: probes({packages: [FAMILY]}),
  exeOnly: probes({files: [EXE]}),
  both: probes({packages: [FAMILY], files: [EXE]}),
};
/** What detectCopies finds on the named fake disk: 'none', 'storeOnly', 'exeOnly' or 'both'. */
export const find = name => detectCopies({env: {LOCALAPPDATA: LOCAL}, probes: disk[name]});
