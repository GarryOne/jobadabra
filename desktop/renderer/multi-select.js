// The multi-value control: a button that opens a checkbox list, several values ticked together, each with its count and a Clear at the foot.
// Use it where a value is "any of these" (the Jobs filters, pages/jobs-filter-menu.js); one value from a list is a <select> or a menu (components.js).
// Keyboard: ↑ ↓ Home End move, Space / Enter tick, Esc closes and gives the button back its focus; roles menuitemcheckbox + aria-checked.
// Styles: ui-menu.css (.ui-multi). Guarded by test/multi-select.test.js.
import {el, menuStep} from './components.js';
import {icon} from './icons.js';
import {multiRows} from './multi-rows.js';

// button: the control's face (its text is set by .render). Options: label (the list's name for screen readers), onToggle(id), onClear().
export function multiSelect(button, {label = 'Filters', onToggle, onClear}) {
  const list = el('div', 'ui-menu ui-multi');
  list.hidden = true;
  list.setAttribute('role', 'menu');
  list.setAttribute('aria-label', label);
  document.body.append(list);
  button.setAttribute('aria-haspopup', 'menu');
  button.setAttribute('aria-expanded', 'false');
  let state = {groups: [], selected: [], counts: {}, face: '', canClear: false};

  const items = () => [...list.querySelectorAll('button')];
  function close(refocus = false) {
    if (list.hidden) return;
    list.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    if (refocus) button.focus();
  }
  function place() {
    const box = button.getBoundingClientRect();
    list.style.top = `${Math.max(8, box.bottom + 6 + list.offsetHeight <= window.innerHeight ? box.bottom + 6 : box.top - list.offsetHeight - 6)}px`;
    list.style.left = `${Math.max(8, Math.min(box.left, window.innerWidth - list.offsetWidth - 8))}px`;
  }
  function paintList() {
    const focused = document.activeElement?.dataset?.id;
    const nodes = multiRows(state.groups, state.selected, state.counts).map(row => {
      if (row.heading) return Object.assign(el('p', 'ui-menu-heading', row.heading), {role: 'presentation'});
      const item = el('button', `ui-multi-item${row.checked ? ' is-checked' : ''}`);
      item.type = 'button';
      item.dataset.id = row.id;
      item.title = row.title;
      item.setAttribute('role', 'menuitemcheckbox');
      item.setAttribute('aria-checked', String(row.checked));
      item.append(el('span', 'ui-multi-box', row.checked ? icon('check') : null), el('span', 'ui-menu-label', row.label),
        row.count == null ? '' : el('span', 'ui-multi-count', String(row.count)));
      return item;
    });
    const clear = Object.assign(el('button', 'ui-multi-clear', 'Clear'), {type: 'button', disabled: !state.canClear});
    clear.setAttribute('role', 'menuitem');
    nodes.push(el('hr'), clear);
    list.replaceChildren(...nodes);
    if (focused) items().find(node => node.dataset.id === focused)?.focus();
  }
  list.addEventListener('click', event => {
    const item = event.target.closest('button');
    if (!item || item.disabled) return;
    if (item.classList.contains('ui-multi-clear')) onClear(); else onToggle(item.dataset.id);   // it stays open: several can be ticked
  });
  list.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); return; }
    const rows = items().filter(node => !node.disabled);
    const next = menuStep(rows.indexOf(document.activeElement), rows.length, event.key);
    if (next === null) return;
    event.preventDefault();
    rows[next].focus();
  });
  button.addEventListener('click', () => {
    if (!list.hidden) { close(); return; }
    paintList();
    list.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    place();
    (items().find(node => node.getAttribute('aria-checked') === 'true') || items()[0])?.focus();
  });
  button.addEventListener('keydown', event => { if (event.key === 'ArrowDown' && list.hidden) { event.preventDefault(); button.click(); } });
  // composedPath, not contains(target): a tick redraws the list, so the clicked row has already left the page when this runs (it would read as "outside").
  document.addEventListener('click', event => { const path = event.composedPath(); if (!list.hidden && !path.includes(list) && !path.includes(button)) close(); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && !list.hidden && !list.contains(document.activeElement)) { close(true); event.preventDefault(); } });

  return {
    // The face text, the groups, what is ticked and the counts: redrawn at once while the list is open.
    render(next) {
      state = {...state, ...next};
      button.textContent = '';
      button.append(el('span', 'ui-multi-face', state.face), icon('chevron'));
      if (!list.hidden) paintList();
    },
    close,
  };
}
