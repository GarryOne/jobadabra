// Own the hidden browser's Apply tabs in the installed extension so a hand-off keeps the very same live tab.
const KEY = 'backgroundApplySessions';
const MODES = new Set(['fill', 'auto']);

/** Keep one persistent browser-window record per application session; never clear a manual CAPTCHA override automatically. */
export function createBackgroundSession({chrome = globalThis.chrome, parseMark} = {}) {
  const all = async () => (await chrome.storage.local.get(KEY))[KEY] || {};
  const save = async rows => chrome.storage.local.set({[KEY]: rows});

  let tail = Promise.resolve();
  const serial = work => { const result = tail.then(work); tail = result.catch(() => {}); return result; };
  async function start(command) { const result = await serial(() => startOne(command)); if (result.manualRequired && result.reason === 'captcha_runtime' && !result.revealedAt) await reveal(command.session); return result; }
  async function startOne({session, url, mode}) {
    const id = String(session || ''), target = String(url || '');
    if (!id || !target || !MODES.has(mode) || typeof parseMark !== 'function' || parseMark(target) !== id) return {ok: false, error: 'invalid background session'};
    const rows = await all(), old = rows[id];
    if (old) {
      const live = Number.isInteger(old.tab) ? await chrome.tabs.get(old.tab).catch(() => null) : null;
      if (!live || parseMark(live.url) !== id) return {ok: false, error: 'The owned application tab is no longer open.'};
      // A runtime challenge must remain visible across worker/app restarts; preflight challenges stay queued for manual review.
      return {ok: true, reused: true, manualRequired: old.manualRequired === true, reason: old.manualReason || '', revealedAt: old.revealedAt || 0, window: old.window, tab: old.tab};
    }
    const tabs = await chrome.tabs.query({});
    let tab = tabs.find(each => parseMark(each.url) === id) || null;
    let win = tab ? await chrome.windows.get(tab.windowId).catch(() => null) : null;
    if (!tab) {
      rows[id] = {session: id, mode, url: target, manualRequired: false, state: 'starting', startedAt: Date.now()};
      await save(rows);
      // Why (2026-10-28, measured): a minimized headless tab repainted 2 of 5 page changes, a normal unfocused one all 5; the live view needs every frame.
      win = await chrome.windows.create({url: target, focused: false}).catch(() => null);
      tab = win?.tabs?.[0] || null;
    }
    if (!win || !tab) return {ok: false, error: 'hidden browser window could not be opened'};
    rows[id] = {session: id, mode, window: win.id, tab: tab.id, url: target, manualRequired: false, startedAt: Date.now()};
    await save(rows);
    return {ok: true, reused: !!tabs.find(each => parseMark(each.url) === id), window: win.id, tab: tab.id};
  }

  async function requireManual(session, reason = 'needs_user') { return serial(() => manualOne(session, reason)); }
  async function manualOne(session, reason) {
    const id = String(session || ''), rows = await all(), row = rows[id];
    if (!row) return false;
    if (row.manualRequired) return true;
    rows[id] = {...row, manualRequired: true, manualReason: String(reason).slice(0, 80), manualAt: Date.now()};
    await save(rows);
    return true;
  }

  async function reveal(session) {
    const row = (await all())[String(session || '')];
    if (!row) return false;
    const tab = await chrome.tabs.get(row.tab).catch(() => null);
    if (!tab || typeof parseMark !== 'function' || parseMark(tab.url) !== String(session)) return false;
    const winId = tab.windowId;
    const shown = await chrome.windows.update(winId, {state: 'normal', focused: true}).catch(() => null);
    if (shown) await patch(session, {revealedAt: Date.now()});
    return !!shown;
  }

  async function mayContinue(session) {
    const row = (await all())[String(session || '')];
    return !!row && row.manualRequired !== true && !row.reviewReady && !row.attempt;
  }

  async function inspect(session) { return (await all())[String(session || '')] || null; }

  async function observe(session, role, botCheck) {
    const row = await inspect(session);
    if (!row) return '';
    if (botCheck) return row.formSeen || row.attempt ? 'captcha_runtime' : 'captcha_preflight';
    if (role === 'account') return 'sign_in_required';
    if (role === 'form') await patch(session, {formSeen: true});
    return '';
  }

  async function patch(session, change) { return serial(async () => { const rows = await all(), id = String(session || ''); if (!rows[id]) return false; rows[id] = {...rows[id], ...change, manualRequired: rows[id].manualRequired === true}; await save(rows); return true; }); }
  async function closeSession(session) {
    const row = await inspect(session); if (!row) return false;
    await requireManual(session, 'cancelled');
    const tab = await chrome.tabs.get(row.tab).catch(() => null);
    if (!tab || parseMark(tab.url) !== String(session)) return false;
    await chrome.tabs.remove(row.tab); return true;
  }
  return {start, requireManual, reveal, mayContinue, inspect, observe, patch, closeSession, all};
}
