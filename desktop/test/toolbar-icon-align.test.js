// A secondary button in a toolbar row is one flex row, so icon, label and pill share a centre line, through one shared rule, never one rule per button id (owner, 30 Oct 2026: Export's icon sat high while the triage button's did not).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';

const read = name => fs.readFileSync(new URL(`../renderer/${name}`, import.meta.url), 'utf8');

test('the toolbar has one rule that puts the icon, label and pill of every direct secondary button on one centre line', () => {
  assert.match(read('style.css'), /\.toolbar > button\.secondary \{[^}]*display: inline-flex; align-items: center/);
});

test('no toolbar button gets its own icon-alignment rule by id', () => {
  const perId = read('style.css').match(/^#(?:triage-open|jobs-export|add-open) \.icon \{[^}]*\}$/gm) || [];
  assert.deepEqual(perId, []);
});

test('the toolbar buttons that carry an icon are direct children of the toolbar, so the shared rule reaches them', () => {
  const html = read('index.html');
  for (const id of ['triage-open', 'jobs-export', 'add-open']) {
    const tag = html.match(new RegExp(`<button[^>]*id="${id}"[^>]*>`))?.[0];
    assert.ok(tag, `${id} exists`);
    const before = html.slice(0, html.indexOf(tag));
    const toolbar = before.lastIndexOf('<div class="toolbar">');
    assert.ok(toolbar >= 0, `${id} follows a toolbar`);
    const between = before.slice(toolbar).replace(/<!--[\s\S]*?-->/g, '');
    const open = (between.match(/<(?:div|span|label|select|details|section|a|p)\b/g) || []).length;
    const closed = (between.match(/<\/(?:div|span|label|select|details|section|a|p)>/g) || []).length;
    assert.equal(open - closed, 1, `${id} sits directly in the toolbar: only the toolbar's own div is open before it, no wrapper element`);
  }
});
