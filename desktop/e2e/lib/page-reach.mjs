// Which suites READ a page's elements: the link the code → suite map cannot give (it records what ran, not what a suite checks). Tests: test/page-reach.test.mjs
// Job: pick the suites
// Why (31 Oct 2026, #2694): the app opens Focus in every suite, so focus-suggestions.js ran in 23 of them at the same breadth; the "shared code" rule gave a changed Focus row to the
// settings smoke alone and no `focus` step ran. A file names the elements it draws into (`$('focus-suggestions-list')`), a suite names the ones it looks at
// (`#focus-suggestions-list`): the suites whose source quotes one of them read the file (lib/coverage-pick.mjs stepsCovering `reads`).
import {checkedText} from './pr-suites.mjs';
import {MAX_USERS} from './plan.mjs';

const HEX = /^[0-9a-f]{3,8}$/i;   // #fff, #ececec: a colour, not an element
const ID_CALL = /(?:\$|getElementById|byId)\(\s*['"`]([A-Za-z][\w-]*)['"`]\s*\)/g;
const ID_ATTR = /\bid=["']([A-Za-z][\w-]*)["']/g;
const ID_SELECTOR = /#([A-Za-z][\w-]*)/g;

// The element ids a file draws into or a suite looks at: `$('x')`, `getElementById('x')`, `id="x"`, `#x` in a selector or a style rule. Comments are not read.
export function elementIds(text) {
  const out = new Set(), source = String(text || '').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
  for (const pattern of [ID_CALL, ID_ATTR, ID_SELECTOR]) for (const [, id] of source.matchAll(pattern)) if (!HEX.test(id)) out.add(id);
  return out;
}

// files: {repo path: text} (the changed app files). sources: {suites/x.mjs | lib/y.mjs: text}. users: {e2e file: [suites that import it, itself included]} (lib/import-graph.mjs suitesUsing).
// -> {repo path: [suites]}: the suites whose own code, or code they import, quotes an id the file draws. A file that draws nothing named (the main process, a model) has none.
// An id more than `maxUsers` suites quote is the app's chrome (the nav, the toast: 24 of 32 suites), and so is a file more than `maxUsers` suites read (style.css, index.html: every
// suite quotes some id in them; measured on the 9 app-touching PRs of 31 Oct 2026: #2670 went from 1 suite to 9): as a line more than that many suites run is shared code, they name no reader.
export function suitesReading(files, sources, users, maxUsers = MAX_USERS) {
  const quoted = {};   // id -> suites
  for (const [file, text] of Object.entries(sources)) for (const id of elementIds(checkedText(text))) for (const suite of users[file] || []) (quoted[id] ||= new Set()).add(suite);
  const out = {};
  for (const [file, text] of Object.entries(files)) {
    const readers = new Set();
    for (const id of elementIds(text)) if (quoted[id]?.size <= maxUsers) for (const suite of quoted[id]) readers.add(suite);
    if (readers.size && readers.size <= maxUsers) out[file] = [...readers].sort();
  }
  return out;
}
