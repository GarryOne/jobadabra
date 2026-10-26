// Settings → Profile: a tab drawn from one or more texts' outlines (Application answers: the standard answers + Form knowledge; Preferences: the
// Profile), edited block by block on every store (IPC textOutline / textEdit, lib/text-outline-handlers.js). This module owns the loading, the pending
// changes per text, saved through the page's one save bar (save-bar.js; owner, 18 Oct 2026: one bar per page, no bar of its own since D's swap);
// a tab only draws and calls change(name, change).
// A change to the same block replaces the earlier one. Guarded by test/profile-tabs-render.test.js.
import {plainError} from '../run-warnings.js';
import {el, loadingCard} from '../components.js';
import {keep, swr} from '../swr.js';
import {pageSaveBar} from '../save-bar.js';
import {inDraft, sink} from '../strategy-sink.js';
import {changeFor, shown} from '../answers-model.js';
import {input, labelled} from './website-rules.js';

const keyOf = change => (change.op === 'append' || change.op === 'insert' ? `${change.op}:${change.key}` : `${change.op}:${change.id}:${change.index ?? ''}`);

// names: the texts the tab shows; draw(view, body) with view = {items: {name: outline}, store, link: {name: url}, change, undo, dirty, redraw}.
// onReset: called when the drafts end (Discard, a save, a load), so the tab drops its own draft state. bar/tab/label: the page's one save bar
// (save-bar.js pageSaveBar: Profile's profileBar, Strategy's), the tab it sits on and the card's name in "N unsaved changes in <label>".
export function outlineTab(id, names, body, draw, {onReset = () => {}, onChange = () => {}, bar, tab = '', label = ''} = {}) {
  // No page bar yet (Strategy before its cards are drawn, a unit test): the shared bar in this card, never buttons of its own.
  bar ||= pageSaveBar({host: body.parentNode, area: label || 'this card', words: 'Your changes are kept as a draft until you save.'});
  const pending = Object.fromEntries(names.map(name => [name, new Map()]));
  let state = {items: {}, store: '', link: {}};
  const size = () => names.reduce((sum, name) => sum + pending[name].size, 0);
  let source = null;
  const cacheKey = () => `outline:${names.join('+')}${inDraft() ? ':draft' : ''}`;   // the setup's draft Profile never shares the saved one's cached read
  const follow = () => { source?.changed(); onChange(size()); };

  const view = () => ({...state, redraw, dirty: size,
    change(name, change) { pending[name].set(keyOf(change), change); follow(); },
    undo(name, change) { pending[name].delete(keyOf(change)); follow(); }});
  function redraw() { body.replaceChildren(); draw(view(), body); follow(); }
  const clear = () => { for (const name of names) pending[name].clear(); onReset(); };

  // Every text's changes, one textEdit each; a failed one keeps its changes. -> the errors.
  async function saveTexts() {
    const errors = [];
    for (const name of names.filter(each => pending[each].size)) {
      const answer = await sink.textEdit(name, [...pending[name].values()]).catch(error => ({ok: false, error: error.message}));
      if (answer.items) { state.items[name] = answer.items; pending[name].clear(); keep(cacheKey(), {ok: true, results: names.map(each => ({ok: true, items: state.items[each], store: state.store, link: state.link[each]}))}); }
      if (!answer.ok) errors.push(answer.error);
    }
    if (!errors.length) onReset();
    redraw();
    return errors;
  }
  source = bar.register({id: `outline-${id}`, tab, label, count: size, discard: () => { clear(); redraw(); },
    save: async () => { const errors = await saveTexts(); return errors.length ? {ok: false, error: errors.join(' ')} : {ok: true}; }});

  return {
    async load() {
      const settle = (results, kept) => {
        state = {items: Object.fromEntries(names.map((name, i) => [name, results[i].items])), store: results[0].store,
          link: Object.fromEntries(names.map((name, i) => [name, results[i].link]))};
        if (kept) clear();
        if (!size()) redraw();   // a refresh never redraws under the person's edits
      };
      await swr(cacheKey(), async () => {
        const results = await Promise.all(names.map(name => sink.textOutline(name).catch(error => ({ok: false, error: error.message}))));
        const failed = results.find(result => !result.ok);
        return failed ? {ok: false, error: failed.error} : {ok: true, results};
      }, {
        loading: () => body.replaceChildren(loadingCard('Reading it from your store…')),
        paint: (answer, kept) => settle(answer.results, kept),
        fail: failed => body.replaceChildren(el('p', 'message error', `Couldn't read it: ${plainError(failed.error)}`)),
      });
    },
    redraw: () => redraw(),
    items: name => state.items[name] || [],
    dirty: () => size() > 0,
  };
}

// One row or line of a text as its label and one input (a line without a label is its own text); `typed` keeps the drafts by item id.
export function lineInput(view, name, item, typed) {
  const original = item.value;
  const field = input(typed.get(item.id) ?? original, text => {
    const change = changeFor(item, text);
    if (text === original) { typed.delete(item.id); view.undo(name, change); } else { typed.set(item.id, text); view.change(name, change); }
  }, {placeholder: item.hint ? `e.g. ${shown(item.hint)}` : 'Not set', ariaLabel: item.label || 'Line'});
  return labelled(item.label ? shown(item.label) : '', field, !item.label);
}
