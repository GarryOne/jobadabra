// What "Remove this session" asks when its job is still Applying in Notion: was it submitted?
export function submitted(company) {
  return {
    message: `Did you submit the application to ${company || 'this company'}?`,
    detail: 'Yes: it is marked Applied.\nNo: it goes back to Kit ready, so it doesn\'t stay stuck as Applying.\n\nYou can change it later in Jobs.',
    buttons: ['Yes, I submitted it', 'No, not submitted', 'Cancel'],
  };
}

// "Cancel application": what goes, asked once (the form's answers are lost with its tab).
export function cancel(company) {
  return {
    message: `Cancel the ${company ? `${company} application` : 'application'}?`,
    detail: 'Claude stops, the form tab closes in Chrome (what was filled there is lost), and the job goes back to ' +
      'Kit ready, so you can apply again later. Nothing is submitted.',
    buttons: ['Cancel application', 'Keep it'],
  };
}


// The words of the "you're quitting while something works" dialogs (native macOS/Windows dialogs: a title, a few
// lines, buttons). Short, one line per thing that would stop, and what happens to it.
const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;
const SHOWN = 4;

// "• N26" per session (the company: the job title is long and the list only has to be recognised), then "+ 2 more".
// Two at one company get their job title too ("Canonical · Site Reliability Engineer").
export function sessionLines(sessions, label) {
  const names = sessions.map(label);
  const twice = name => names.filter(other => other === name).length > 1;
  const lines = sessions.slice(0, SHOWN).map((session, i) => `•  ${twice(names[i]) && session.title ? `${names[i]} · ${session.title}` : names[i]}`);
  if (sessions.length > SHOWN) lines.push(`•  and ${sessions.length - SHOWN} more`);
  return lines;
}

const AFTER = 'Filled forms stay in Chrome. After restarting, open Application sessions to review them.';
// Why (2026-10-28, owner: "Always close it"): the hidden browser closes with the app, so its forms do not stay anywhere.
const afterOf = sessions => sessions.some(session => session.background) ? 'The hidden browser closes with the app. Applications it was filling start again next time.' : AFTER;

// Only Claude sessions are working (the queue is empty): keep them, or stop them and quit.
export function sessionsOnly(sessions, label) {
  const one = sessions.length === 1;
  return {
    message: one ? 'Claude is still filling an application' : `Claude is still filling ${sessions.length} applications`,
    detail: `${sessionLines(sessions, label).join('\n')}\n\nQuitting stops ${one ? 'it' : 'them'} where ${one ? 'it is' : 'they are'}. ${afterOf(sessions)}`,
    buttons: ['Keep working', 'Stop and quit'],
  };
}

// Searches, queued jobs and/or sessions: quit when they finish, quit now, or stay.
export function working({busy = null, queue = [], sessions = [], important = [], taskName, label}) {
  const lines = important.map(what => `•  ${what}: quitting now can leave it half done`);
  if (busy) lines.push(`•  ${taskName(busy.kind)} is running`);
  if (queue.length) lines.push(`•  ${plural(queue.length, 'task', 'tasks')} waiting: ${queue.map(job => taskName(job.kind)).join(', ')}`);
  if (sessions.length) lines.push(`•  Claude is filling ${plural(sessions.length, 'application', 'applications')}: ${sessions.slice(0, SHOWN).map(label).join(', ')}${sessions.length > SHOWN ? '…' : ''}`);
  if (important.length && !busy && !queue.length && !sessions.length) {   // only an export, a Notion setup…: no jobs to run again
    return {message: 'Jobadabra is still working', detail: `${lines.join('\n')}\n\nQuit when done: closes by itself once it finishes.\n` +
      'Quit now: it stops where it is; start it again after.', buttons: ['Quit when done', 'Quit now', 'Cancel']};
  }
  return {
    message: 'Jobadabra is still working',
    detail: `${lines.join('\n')}\n\nQuit when done: closes by itself once these finish.\n` +
      `Quit now: stops them, and the jobs you started run again next time. What's saved stays saved.` +
      (sessions.length ? `\n\n${afterOf(sessions)}` : ''),
    buttons: ['Quit when done', 'Quit now', 'Cancel'],
  };
}
