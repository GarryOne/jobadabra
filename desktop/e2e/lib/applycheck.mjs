// The apply suite's judgements as pure functions of what was read from a form, so each one can be shown to fail on a wrong input (test/applycheck.test.mjs).
// `actual` is readForm()'s answer: {field id: {type, value, checked, files: [{name, size}], ai}}.

// Every kit answer is in its field (a checkbox: ticked), and what the person must decide (legal consents) is untouched, kit or no kit.
export function fillProblems({expected = {}, left = [], actual}) {
  const problems = [];
  for (const [id, want] of Object.entries(expected)) {
    const got = actual[id];
    if (!got) problems.push(`${id}: the form has no such field`);
    else if (want === true ? !got.checked : got.value !== want) problems.push(`${id}: expected ${want === true ? 'ticked' : `"${want}"`}, the form has ${got.type === 'checkbox' ? (got.checked ? 'ticked' : 'unticked') : `"${got.value}"`}`);
  }
  for (const id of left) {
    const got = actual[id];
    if (got && (got.checked || (got.type !== 'checkbox' && got.value))) problems.push(`${id}: a legal field must be left to the person, but it was filled`);
  }
  return problems;
}

// The CV is in the form's file field: the right name, the right size.
export function cvProblems(actual, cv, id = 'resume') {
  const files = actual[id]?.files || [];
  if (!files.length) return [`${id}: no CV attached`];
  return files[0].name === cv.name && files[0].size === cv.size ? [] : [`${id}: attached ${files[0].name} (${files[0].size} bytes), expected ${cv.name} (${cv.size} bytes)`];
}

// A Submit that was clicked, or a submit event, on this form's page. Must be none.
export function submitProblems(fired, formPath) {
  return fired.filter(item => String(item.form).startsWith(formPath)).map(item => `${item.kind} on Submit at ${item.form}: the extension must never submit`);
}

// Fields the extension highlighted as AI-written (data-jobpilotto-ai): `ai` must all be marked, `plain` must not be (a short fact from your details is not an AI answer).
export function highlightProblems({actual, ai = [], plain = []}) {
  return [...ai.filter(id => !actual[id]?.ai).map(id => `${id}: an AI-written answer is not highlighted`),
    ...plain.filter(id => actual[id]?.ai).map(id => `${id}: highlighted as AI-written, but it is a plain fact`)];
}

// What the panel says is left for the person (its "Left for you" items) must name each of `wanted` (a part of the item's text, case-insensitive).
// A ticked consent box (ticked by default, owner 17 Oct 2026) is no longer left for the person: the panel must not list it.
export function notLeftProblems(items, unwanted) {
  return unwanted.filter(part => items.some(item => item.toLowerCase().includes(part.toLowerCase()))).map(part => `the panel still lists "${part}" as left for you, although the box was ticked (it lists: ${items.join(' | ')})`);
}
export function leftProblems(items, wanted) {
  return wanted.filter(part => !items.some(item => item.toLowerCase().includes(part.toLowerCase()))).map(part => `the panel does not list "${part}" as left for you (it lists: ${items.join(' | ') || 'nothing'})`);
}
