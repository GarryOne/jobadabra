// Click-to-sort headers for a library table (Employers; any .lib-table can use it): the sort order of rows, the next state on a header click
// (first click on a text column A→Z, on a number or date column biggest first, again to reverse), and the header buttons with an arrow.
// The choice is remembered per table in localStorage. Guarded by test/table-sort.test.js.

// columns: [{key, label, tip?, type: 'words' | 'number' | 'date' | 'flag', value(row)}]. A blank value always sorts last, in either direction.
export function sortRows(rows, {key, dir}, columns) {
  const column = columns.find(c => c.key === key);
  if (!column) return rows.slice();
  const sign = dir === 'desc' ? -1 : 1;
  const blank = v => v === null || v === undefined || v === '';
  const compare = (a, b) => (column.type === 'words' ? String(a).localeCompare(String(b), undefined, {sensitivity: 'base', numeric: true}) : Number(a) - Number(b));
  return rows.map((row, index) => ({row, index, v: column.value(row)})).sort((a, b) => {
    if (blank(a.v) || blank(b.v)) return blank(a.v) === blank(b.v) ? a.index - b.index : blank(a.v) ? 1 : -1;
    return sign * compare(a.v, b.v) || a.index - b.index;
  }).map(item => item.row);
}

// A click on `key`: the same column reverses, another starts at its natural direction.
export function nextSort(current, key, columns) {
  if (current?.key === key) return {key, dir: current.dir === 'asc' ? 'desc' : 'asc'};
  const type = columns.find(c => c.key === key)?.type;
  return {key, dir: type === 'words' ? 'asc' : 'desc'};
}

export function loadSort(storageKey, columns, fallback, storage = globalThis.localStorage) {
  try {
    const saved = JSON.parse(storage.getItem(storageKey));
    if (saved && columns.some(c => c.key === saved.key) && (saved.dir === 'asc' || saved.dir === 'desc')) return {key: saved.key, dir: saved.dir};
  } catch { /* nothing saved, or a private window */ }
  return fallback;
}

export function saveSort(storageKey, sort, storage = globalThis.localStorage) {
  try { storage.setItem(storageKey, JSON.stringify(sort)); } catch { /* it still sorts, just is not remembered */ }
}

// Fills the <tr> with one header per column: a button (label + arrow) and aria-sort; `tip` on a column adds a hover/focus explanation.
export function drawHeader(tr, columns, sort, onSort) {
  tr.replaceChildren(...columns.map(column => {
    const th = document.createElement('th');
    const active = sort.key === column.key;
    th.setAttribute('aria-sort', active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none');
    const button = Object.assign(document.createElement('button'), {type: 'button', className: `sort-head${column.tip ? ' tip' : ''}`});
    if (column.tip) button.dataset.tip = column.tip;
    const arrow = Object.assign(document.createElement('span'), {className: 'sort-arrow', textContent: active ? (sort.dir === 'asc' ? '▲' : '▼') : '', ariaHidden: 'true'});
    button.append(column.label, arrow);
    button.addEventListener('click', () => onSort(column.key));
    th.append(button);
    return th;
  }));
}
