// One sticky save bar per page (Profile, Strategy) for every edited field on it (owner, 18 Oct 2026, UI redesign D2): it counts the drafts of every card on
// every tab, says where they are ("3 unsaved changes in Your details and Experience"), marks those tabs with a dot, and its two buttons act on all of them:
// "Discard all" (asks first when drafts sit on more than one tab) and "Save all changes" (saveLabel: a page's own scope, e.g. Strategy's "Save strategy changes"). A field that fails its check names its tab and field and nothing is
// saved; a save that fails part-way keeps the failed drafts and names them, never a blanket "Saved". Leaving the page or closing the window with drafts asks
// first (leave() for nav.js guardLeave; beforeunload + lib/unsaved-guard.js for the window). Actions with their own button (read the CV again, an AI review)
// are not drafts and never go through here. Cards register a source; the card shell is card-shell.js. Guarded by test/save-bar.test.js.
import {el} from './components.js';

// "Your details", "Your details and Experience", "CV, Your details and Experience".
export function scopeText(labels) {
  const list = [...new Set(labels.filter(Boolean))];
  return list.length < 2 ? list[0] || '' : `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
}
export const countText = n => `${n} unsaved change${n === 1 ? '' : 's'}`;

const bars = new Set();
export const anyUnsaved = () => [...bars].some(bar => bar.count() > 0);
let unloadHooked = false;
function hookUnload() {   // the window's close or reload: held while a bar has drafts; the main process asks (lib/unsaved-guard.js)
  if (unloadHooked) return;
  unloadHooked = true;
  window.addEventListener?.('beforeunload', event => { if (!anyUnsaved()) return; event.preventDefault?.(); event.returnValue = ''; });
}

// host: where the bar sits (the end of the page; it sticks to the bottom, above Application sessions). tabs: {key: label} of the page's tabs; tabButton(key):
// the tab's button (gets .has-drafts); openTab(key): shows a tab (a failed field's tab opens). words: the muted line ("The extension uses them from the next form").
export function pageSaveBar({host, tabs = {}, tabButton = () => null, openTab = () => {}, words = '', savedWords = 'Saved ✓', area = 'this page', saveLabel = 'Save all changes'}) {
  const sources = [];
  let busy = false, holding = null;
  const node = el('div', 'save-bar page-save-bar');
  node.setAttribute('role', 'region');
  node.setAttribute('aria-label', 'Unsaved changes');
  node.hidden = true;
  const title = el('b', 'save-bar-title', '');
  const lead = el('div', 'save-bar-words');
  lead.append(title, el('span', 'muted small', words));
  const note = el('span', 'message');
  note.setAttribute('role', 'status');
  const discard = Object.assign(el('button', 'secondary', 'Discard all'), {type: 'button'});
  const save = Object.assign(el('button', 'primary', saveLabel), {type: 'button'});
  const actions = el('div', 'save-bar-actions');
  actions.append(note, discard, save);
  node.append(lead, actions);
  host?.append(node);

  const pending = () => sources.filter(source => source.count() > 0);
  const count = () => sources.reduce((sum, source) => sum + source.count(), 0);
  const tabsWith = list => [...new Set(list.map(source => source.tab).filter(key => key && key in tabs))];
  const where = (source, field = '') => [tabs[source.tab], source.label, field].filter(Boolean).join(' · ');
  const say = (text, tone = '') => { note.textContent = text; note.className = `message${tone ? ` ${tone}` : ''}`; };
  function follow() {
    const open = pending(), n = count(), keys = tabsWith(open);
    for (const key of Object.keys(tabs)) tabButton(key)?.classList.toggle('has-drafts', keys.includes(key));
    if (n) title.textContent = `${countText(n)}${keys.length ? ` in ${scopeText(keys.map(key => tabs[key]))}` : ''}`;
    node.hidden = !n && !holding;
    save.disabled = discard.disabled = busy || !n;
  }

  // Check every draft first: one bad field saves nothing (all drafts stay) and its tab opens on it.
  async function saveAll() {
    if (busy || !count()) return {ok: true, failed: []};
    clearTimeout(holding); holding = null;
    busy = true; follow(); say('Saving…');
    const open = pending();
    const invalid = [];
    for (const source of open) {
      const check = source.validate ? await Promise.resolve().then(source.validate).catch(error => ({ok: false, error: error.message})) : {ok: true};
      if (check && check.ok === false) invalid.push({source, result: check});
    }
    const failed = invalid.length ? invalid : [];
    let saved = 0;
    if (!invalid.length) {
      for (const source of open) {
        const result = await Promise.resolve().then(source.save).catch(error => ({ok: false, error: error.message}));
        if (result?.ok) saved++; else failed.push({source, result: result || {}});
      }
    }
    busy = false;
    if (failed.length) {
      const lines = failed.map(({source, result}) => `${where(source, result.field)}: ${result.error || 'couldn\'t save it'}`);
      say(`${invalid.length ? 'Nothing saved. ' : ''}${lines.join(' · ')}${saved ? ` (${saved === 1 ? 'the other change was' : 'the other changes were'} saved)` : ''}`, 'error');
      const first = failed[0];
      if (first.source.tab) openTab(first.source.tab);
      first.source.reveal?.(first.result.field);
    } else {
      say(savedWords, 'ok');
      holding = setTimeout(() => { holding = null; say(''); follow(); }, 2500);   // "Saved ✓" a moment, then the bar leaves
    }
    follow();
    return {ok: !failed.length, failed: failed.map(({source, result}) => ({id: source.id, tab: source.tab, field: result.field || '', error: result.error || ''}))};
  }

  function discardAll({ask = true} = {}) {
    const open = pending(), keys = tabsWith(open);
    if (!open.length) return true;
    if (ask && keys.length > 1 && !globalThis.confirm?.(`Discard your unsaved changes in ${scopeText(keys.map(key => tabs[key]))}?`)) return false;
    for (const source of open) source.discard();
    say('');
    follow();
    return true;
  }

  // nav.js guardLeave(view, bar.leave): true lets the move go; with drafts it asks (Keep editing / Discard all / Save all changes) and calls proceed() after.
  let dialog = null;
  function leave(proceed) {
    if (!count()) return true;
    if (!dialog) {
      dialog = el('dialog', 'panel-dialog');
      const form = el('form');
      form.method = 'dialog';
      const foot = el('div', 'dialog-foot');
      for (const [cls, value, label] of [['ghost', 'keep', 'Keep editing'], ['secondary', 'discard', 'Discard all'], ['primary', 'save', saveLabel]]) {
        foot.append(Object.assign(el('button', cls, label), {value}));
      }
      form.append(el('h2', '', 'Save your changes?'), el('p', 'dialog-lead', ''), foot);
      dialog.append(form);
      document.body.append(dialog);
    }
    dialog.querySelector('.dialog-lead').textContent = `${title.textContent} on ${area}. Leave without them, or save them first.`;
    dialog.returnValue = '';
    dialog.onclose = async () => {
      if (dialog.returnValue === 'discard' && discardAll({ask: false})) proceed();
      if (dialog.returnValue === 'save' && (await saveAll()).ok) proceed();
    };
    dialog.showModal?.();
    return false;
  }

  discard.addEventListener('click', () => discardAll());
  save.addEventListener('click', () => saveAll());
  const bar = {
    node, count, changed: follow, saveAll, discardAll, leave,
    // A card's drafts: count() how many it holds now; save() writes them and clears them on success → {ok, error, field}; discard() drops them and redraws
    // the card's read view; validate() (optional) → {ok:false, field, error} before anything is saved; reveal(field) (optional) shows and focuses the field.
    register(source) {
      for (const need of ['id', 'count', 'save', 'discard']) if (!source?.[need]) throw new Error(`save-bar source needs ${need}`);
      sources.push(source);
      follow();
      return {changed: follow};
    },
    unsavedIn: () => tabsWith(pending()),
  };
  bars.add(bar);
  hookUnload();
  return bar;
}
