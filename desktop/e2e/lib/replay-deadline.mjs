// Hard replay deadlines cover awaited browser operations and teardown; failures retain case, phase and elapsed time.
const message = (name, phase, began) => `replay ${name}: ${phase} timed out after ${Date.now() - began}ms`;

/** Run an operation within ms; expiry rejects with its identity and never treats unfinished work as a pass. */
export async function replayLimit(name, ms, task) {
  if (!(ms > 0)) { const error = new Error(`${name} timed out after 0ms`); error.code = 'REPLAY_TIMEOUT'; throw error; }
  let timer;
  try {
    return await Promise.race([Promise.resolve().then(task), new Promise((_, reject) => {
      timer = setTimeout(() => { const error = new Error(`${name} timed out after ${ms}ms`); error.code = 'REPLAY_TIMEOUT'; reject(error); }, Math.max(1, ms));
    })]);
  } finally { clearTimeout(timer); }
}

/** Run one case with a fixed wall budget and separately bounded cleanup. Late awaits cannot advance to another phase.
 * body(step) and cleanup(step) supply operations; errors preserve the original failing phase, including cleanup-only failures.
 */
export async function timedReplay(item, body, cleanup, {budgetMs = ((item.expect?.seconds || 40) + 30) * 1000, cleanupMs = 5000, log = console.log} = {}) {
  const began = Date.now(), end = began + budgetMs;
  let phase = 'start', cleanupPhase = 'cleanup', expired = false, result, failure;
  const step = async (next, task, onLate) => {
    if (expired || Date.now() >= end) { const error = new Error(message(item.name, phase, began)); error.code = 'REPLAY_TIMEOUT'; throw error; }
    phase = next;
    log(`[replay ${item.name}] ${phase} +${Date.now() - began}ms`);
    const work = Promise.resolve().then(task);
    if (onLate) work.then(value => {
      if (expired || Date.now() >= end) Promise.resolve().then(() => onLate(value)).catch(() => {});
    }, () => {});
    try { return await replayLimit(`replay ${item.name}: ${phase}`, end - Date.now(), () => work); }
    catch (error) { if (error.code === 'REPLAY_TIMEOUT') expired = true; throw error; }
  };
  step.expired = () => expired || Date.now() >= end;
  try { result = await replayLimit(`replay ${item.name}: wall`, budgetMs, () => body(step)); }
  catch (error) {
    if (error.code === 'REPLAY_TIMEOUT') { expired = true; error.message = message(item.name, phase, began); }
    failure = error;
  }
  try {
    const cleanupEnd = Date.now() + cleanupMs;
    await replayLimit(`replay ${item.name}: cleanup`, cleanupMs, () => cleanup((next, task) => {
      cleanupPhase = next;
      log(`[replay ${item.name}] ${next} +${Date.now() - began}ms`);
      return replayLimit(`replay ${item.name}: ${next}`, cleanupEnd - Date.now(), task);
    }));
  } catch (error) {
    if (error.code === 'REPLAY_TIMEOUT') error.message = message(item.name, cleanupPhase, began);
    failure ||= error;
  }
  log(`[replay ${item.name}] ${failure ? 'FAIL' : 'done'} +${Date.now() - began}ms${failure ? ` ${failure.message}` : ''}`);
  if (failure) throw failure;
  return result;
}
