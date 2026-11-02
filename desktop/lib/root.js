// Where the pipeline, config, tools and extension live: the repo when developing, the app's
// Resources/pilot folder when packaged (electron-builder extraResources, see package.json).
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const packaged = !!process.resourcesPath && !process.defaultApp && !process.env.JOBADABRA_DEV;
export const ROOT = packaged ? path.join(process.resourcesPath, 'pilot')
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
