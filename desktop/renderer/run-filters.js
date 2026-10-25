// Actions → Runs' filters (owner, 25 Oct 2026: "visible task/status/date filters"): which runs the list keeps by task, status and date. Pure: the
// window passes how a run's kind and status pill are told. Guarded by test/run-view.test.js.
export const STATUS = [['', 'Any status'], ['queued', 'Queued'], ['running', 'Running'], ['ok', 'Completed'], ['warn', 'With warnings'], ['failed', 'Failed']];
export const DATES = [['', 'Any time'], ['today', 'Today'], ['7', 'Last 7 days'], ['30', 'Last 30 days']];

// The list's filters: one object, read by the list and set by its menus.
export const listFilter = {kind: '', status: '', date: ''};

// A run's status for the filter, from its pill's tone (renderer/run-status.js runPill): queued and running first, then how it ended.
export const statusOf = (run, toneOf) => (run?.waiting ? 'queued' : run?.live ? 'running' : {bad: 'failed', warn: 'warn'}[toneOf(run)] || 'ok');

const startOfDay = now => new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
// A queued or running run has no end yet: it is always in any date range.
function inDate(run, date, now) {
  if (!date || run?.waiting || run?.live) return true;
  const at = Date.parse(run?.endedAt || run?.startedAt || '');
  if (Number.isNaN(at)) return true;
  return date === 'today' ? at >= startOfDay(now) : at >= startOfDay(now) - (Number(date) - 1) * 86400000;
}

export function filterBy(runs, {kind = '', status = '', date = ''} = {}, {kindOf = run => run?.kind || 'search', toneOf = () => 'good', now = new Date()} = {}) {
  return (runs || []).filter(run => (!kind || kindOf(run) === kind) && (!status || statusOf(run, toneOf) === status) && inDate(run, date, now));
}

// The words on a filter's button ("Status: Failed"), and whether any filter is on.
export const labelOf = (options, value) => (options.find(([key]) => key === value) || options[0])[1];
export const anyFilter = filter => !!(filter.kind || filter.status || filter.date);
