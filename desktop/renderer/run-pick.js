// Which run the one run panel shows (drawer and Actions → Runs; owner, 25 Oct 2026): the run picked stays picked while it goes queued → running → done,
// and a generic "Details" opens the running task, else the next queued one, else the latest finished run. Pure; guarded by test/run-view.test.js.
export const idOf = run => (run?.id == null ? '' : String(run.id));

// The run a generic "Details" opens (never a switch of a panel already open: the caller keeps its id).
export function defaultRun({running = null, queued = [], runs = []} = {}) {
  if (running) return {...running, live: true};
  if (queued.length) return {...queued[0], waiting: true, place: 1};
  return runs[0] || null;
}

// The run behind a kept selection, wherever it is now: still queued (its ticket id), running, or finished. A queued ticket that started is the run
// whose `ticket` it was (lib/pipeline-queue.js keeps it on the record), so a run picked while queued stays picked once it runs and ends.
export function findRun({running = null, queued = [], runs = []} = {}, selected) {
  if (selected == null || selected === '') return null;
  const id = String(selected);
  const at = queued.findIndex(ticket => idOf(ticket) === id);
  if (at >= 0) return {...queued[at], waiting: true, place: at + 1};
  if (running && (idOf(running) === id || String(running.ticket ?? '') === id)) return {...running, live: true};
  return runs.find(run => idOf(run) === id) || runs.find(run => String(run.ticket ?? '') === id) || null;
}

// The run the panel shows: the picked one, else the default. The id to keep is the run's own once its ticket started.
export function pickRun(data, selected) {
  const found = findRun(data, selected);
  const run = found || defaultRun(data);
  return {run, keep: found ? idOf(found) : selected ?? null};
}

// What a queued run waits for, in words, and its place when there is more than one in the queue (the queue runs one at a time, in order).
export function queueWords(run, {running = null, queued = []} = {}, nameOf = kind => kind) {
  if (!run?.waiting) return {waiting: '', place: ''};
  const before = run.place > 1 ? queued[run.place - 2] : running;
  return {waiting: before ? `Waiting for ${nameOf(before.kind)} to finish` : 'Waiting to start',
    place: queued.length > 1 ? `${run.place} of ${queued.length} in the queue` : ''};
}
