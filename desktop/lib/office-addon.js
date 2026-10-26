// The LibreOffice add-on inside the app: one download at a time into <data folder>/office, started when a Word CV is chosen, its steps sent
// to the window ('officeProgress' {step, share, bytes, total, started, error}) for the bar on Profile → CV (renderer/pages/office-progress.js),
// and Cancel. A LibreOffice already on the computer counts as ready. Download, checksum and unpacking: lib/office.js.
// Guard: test/office-addon.test.js.
import {findOffice, installOffice} from './office.js';

export function officeAddon(storage, {toWindow = () => {}, toast = () => {}, install = installOffice, find = findOffice, now = Date.now} = {}) {
  const dir = storage.path('office');
  let state = {step: 'none'}, controller = null, running = null;
  const tell = next => { state = next; toWindow('officeProgress', state); };
  return {
    // -> {step: 'ready'} when soffice is there, else the last step seen ('none', 'download', ..., 'failed', 'cancelled')
    state: () => (find(dir) ? {step: 'ready'} : state),
    soffice: () => find(dir),
    // Download and unpack once; a second call while one runs gets the same promise. -> soffice path, or null (failed or cancelled)
    start() {
      const have = find(dir);
      if (have) return Promise.resolve(have);
      if (running) return running;
      controller = new AbortController();
      const started = now(), signal = controller.signal;
      tell({step: 'download', share: 0, bytes: 0, total: 0, started});
      toast({title: 'Getting LibreOffice for your Word CV', body: 'About 300 MB, only once. Follow it in Profile → CV.', target: {card: 'cv'}, tone: 'info'});
      running = install(dir, {signal, onProgress: step => tell({...step, started})}).then(file => { tell({step: 'ready'}); return file; }, error => {
        tell(signal.aborted ? {step: 'cancelled'} : {step: 'failed', error: String(error?.message || error).slice(0, 200)});
        return null;
      }).finally(() => { controller = null; running = null; });
      return running;
    },
    cancel() { controller?.abort(); },
  };
}

