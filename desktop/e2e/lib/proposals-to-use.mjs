// Which proposed answers a harness run takes the way the person's "Use" press does (17 Oct 2026: a held run stopped at "1 of 9 required left" because nothing accepted the AI's proposals, so
// a Workday test account never got past My Information). Pure: states are the app's review states ({id, proposals: [{label, value, options}]}), `done` the "<id> <label>" keys already used.
// A menu's proposal is taken only when one of the form's own choices says it (the window asks the AI to map the rest: not here); a proposal with no value (a contact key) is not taken.
// Guard: test/ai/proposals-to-use.test.mjs.
export function proposalsToUse(states, done = new Set()) {
  const use = [], skipped = [];
  for (const state of states || []) for (const item of state.proposals || []) {
    const key = `${state.id} ${item.label}`;
    if (done.has(key) || !String(item.value || '').trim()) continue;
    if (item.options?.length) {
      const same = item.options.find(option => option.trim().toLowerCase() === item.value.trim().toLowerCase());
      if (!same) { skipped.push({id: state.id, label: item.label, why: 'no choice of the form says it'}); continue; }
      use.push({id: state.id, label: item.label, value: same, key});
    } else use.push({id: state.id, label: item.label, value: item.value, key});
  }
  return {use, skipped};
}
