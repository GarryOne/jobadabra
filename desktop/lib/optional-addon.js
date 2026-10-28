// An optional large part the app downloads on first use (LibreOffice, Jobadabra's browser): one download at a time into its own folder, each step
// sent to the window (`<event>` {step, share, bytes, total, started, error}), Cancel, a failure said (never thrown at the person), and a part
// already there counts as ready. Never in the installer (CLAUDE.md "Large optional parts download on first use"). Guards: test/office-addon.test.js,
// test/background-browser-download.test.js.

/** One add-on's state/start/cancel. find(dir) -> path or null; install(dir, {signal, onProgress}) -> path. notice: the toast shown when a download starts. */
export function optionalAddon({dir, event, notice = null, toWindow = () => {}, toast = () => {}, install, find, now = Date.now}) {
  let state = {step: 'none'}, controller = null, running = null;
  const tell = next => { state = next; toWindow(event, state); };
  return {
    // -> {step: 'ready'} when the part is there, else the last step seen ('none', 'download', ..., 'failed', 'cancelled')
    state: () => (find(dir) ? {step: 'ready'} : state),
    path: () => find(dir),
    // Download and unpack once; a second call while one runs gets the same promise. -> the part's path, or null (failed or cancelled)
    start() {
      const have = find(dir);
      if (have) return Promise.resolve(have);
      if (running) return running;
      controller = new AbortController();
      const started = now(), signal = controller.signal;
      tell({step: 'download', share: 0, bytes: 0, total: 0, started});
      if (notice) toast(notice);
      running = install(dir, {signal, onProgress: step => tell({...step, started})}).then(file => { tell({step: 'ready'}); return file; }, error => {
        tell(signal.aborted ? {step: 'cancelled'} : {step: 'failed', error: String(error?.message || error).slice(0, 200)});
        return null;
      }).finally(() => { controller = null; running = null; });
      return running;
    },
    cancel() { controller?.abort(); },
  };
}

