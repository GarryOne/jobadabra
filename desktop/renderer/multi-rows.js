// The multi-value control's rows (multi-select.js), as data: no window needed. Guarded by test/multi-select.test.js.
// The rows the list draws, from groups [{name, options: [{id, label, title}]}], the ticked ids and the counts {id: n}: a pure step, tested without a window.
export function multiRows(groups, selected, counts = {}) {
  const ticked = new Set(selected);
  return groups.flatMap(group => [{heading: group.name},
    ...group.options.map(option => ({id: option.id, label: option.label, title: option.title || '', checked: ticked.has(option.id),
      count: counts[option.id] ?? null}))]);
}
