// Guard dialog row labels against inheriting the vertical margins meant for stacked fields.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';

const source = file => readFileSync(new URL(`../renderer/${file}`, import.meta.url), 'utf8');
const css = ['components.css', 'style.css', 'card-shell.css'].map(source).join('\n');
const rules = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .flatMap(([, selectors, body]) => selectors.split(',').map(selector => ({selector: selector.trim(), body})));
const classes = attrs => (attrs.match(/\bclass="([^"]*)"/)?.[1] || '').split(/\s+/);

// Deliberately limited to literal tag/class/id selectors and descendant/child combinators.
// Responsive grids count as inline even when their narrow layout stacks the same label.
function matches(node, selector) {
  const parts = selector.replace(/>/g, ' > ').trim().split(/\s+/);
  const simple = (item, part) => item && /^[\w.#-]+$/.test(part)
    && [...part.matchAll(/(^[\w-]+)|([.#])([\w-]+)/g)].every(([, tag, kind, name]) =>
      tag ? item.tag === tag : kind === '.' ? item.classes.includes(name) : item.id === name);
  let at = node;
  if (!simple(at, parts.pop())) return false;
  while (parts.length) {
    const part = parts.pop();
    at = at.parent;
    if (part === '>') { if (!simple(at, parts.pop())) return false; }
    else {
      while (at && !simple(at, part)) at = at.parent;
      if (!at) return false;
    }
  }
  return true;
}

function missingInlineLabels(html) {
  const nodes = [], stack = [];
  for (const [, closing, tag, attrs] of html.replace(/<!--[\s\S]*?-->/g, '').matchAll(/<(\/?)([\w-]+)\b([^>]*)>/g)) {
    if (closing) { while (stack.length && stack.pop().tag !== tag) { /* close through this element */ } continue; }
    const node = {tag, classes: classes(attrs), id: attrs.match(/\bid="([^"]*)"/)?.[1], parent: stack.at(-1)};
    nodes.push(node);
    if (!/^(?:input|br|img|hr|meta|link|source|wbr|area|base|embed|param|track|col)$/.test(tag)) stack.push(node);
  }
  const ancestor = (node, predicate) => { for (let at = node.parent; at; at = at.parent) if (predicate(at)) return at; };
  const row = (node, flexOnly = false) => node && rules.some(rule => matches(node, rule.selector)
    && (flexOnly ? /display:\s*(?:inline-)?flex\b/ : /display:\s*(?:(?:inline-)?flex|grid)\b/).test(rule.body)
    && !/flex-direction:\s*column/.test(rule.body));
  return nodes.filter(node => node.tag === 'label'
    && ancestor(node, at => at.tag === 'dialog' && at.classes.includes('panel-dialog'))
    && nodes.some(control => /^(?:input|select)$/.test(control.tag) && ancestor(control, at => at === node))
    && (row(node) || row(node.parent, true)) && !node.classes.some(cls => ['inline-label', 'task-count-field'].includes(cls)))
    .map(node => node.id || node.classes.join('.') || 'unclassed label');
}

test('dialog labels wrapping controls in rows opt out of stacked margins', () => {
  assert.deepEqual(missingInlineLabels(source('index.html')), []);
});

test('dialog row builders also opt out of stacked margins', () => {
  for (const file of ['pages/actions.js', 'pages/cv-change.js', 'pages/tune.js', 'pages/strategy-review.js']) {
    const text = source(file);
    // actions.js assigns className after createElement; the other builders use el(tag, class).
    const labels = [...text.matchAll(/el\('label', '([^']*)'\)|label\.className = '([^']*)'/g)];
    assert.ok(labels.length, `found row labels in ${file}`);
    for (const [, direct, assigned] of labels) assert.deepEqual(missingInlineLabels(
      `<dialog class="panel-dialog"><label class="${direct || assigned}"><input></label></dialog>`), [], file);
  }
});

test('inline margins reset separately from the stacked label rule', () => {
  const shared = source('components.css');
  for (const cls of ['inline-label', 'task-count-field']) assert.ok(rules.some(rule =>
    rule.selector === `.panel-dialog label.${cls}` && /\bmargin:\s*0\s*[;}]/.test(`${rule.body}}`)), `${cls} clears stacked margins in the shared rule`);
  assert.match(shared, /\.panel-dialog label\s*\{[^}]*margin:\s*var\(--sp-4\) 0 var\(--sp-2\)/);
});

test('guard catches wrapping and parent rows while allowing stacked fields', () => {
  assert.equal(missingInlineLabels('<dialog class="panel-dialog triage-dialog"><label class="triage-n"><input></label></dialog>').length, 1);
  assert.equal(missingInlineLabels('<dialog class="panel-dialog"><div class="inline"><label><select></select></label><button></button></div></dialog>').length, 1);
  assert.deepEqual(missingInlineLabels('<dialog class="panel-dialog triage-dialog"><label class="triage-n inline-label"><input></label><label>Name<input></label><div class="form-grid"><label>Country<select></select></label></div></dialog>'), []);
  assert.deepEqual(missingInlineLabels('<label class="triage-n"><input></label>'), []);
  assert.deepEqual(missingInlineLabels('<dialog class="panel-dialog"><label class="task-count-field"><input></label></dialog>'), []);
});
