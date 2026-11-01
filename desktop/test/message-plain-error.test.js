// A message slot never shows an AI provider's raw error, and "Fill from my CV" answers where the person can see it (issue #409).
// 12 Oct 2026: the press wrote 'Couldn't read your CV: 400 {"type":"error",…}' into the save bar, which stays hidden when nothing changed.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {plainError} from '../renderer/run-warnings.js';

const read = file => fs.readFileSync(new URL(file, import.meta.url), 'utf8');

test('a provider dump inside a sentence becomes words; the sentence before it is kept', () => {
  const credit = '400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API."},"request_id":"req_1"}';
  const cases = [
    [`Couldn't read your CV: ${credit}.`, "Couldn't read your CV: the Anthropic API spending limit was reached."],   // the JavaScript SDK's form
    [credit, 'the Anthropic API spending limit was reached'],
    ["Couldn't draft it: BadRequestError: Error code: 400 - {'type': 'error', 'error': {'type': 'invalid_request_error', 'message': 'prompt is too long'}}",
      "Couldn't draft it: prompt is too long"],                                                                        // the Python SDK's form
    ['Not saved: RateLimitError: Error code: 429', 'Not saved: the AI service is rate-limited right now'],
    ['Export failed: HTTP Error 502: <!DOCTYPE html><html>…', 'Export failed: the service was unavailable (HTTP 502). It is usually back within minutes: try again'],
    ['Saved ✓ 3 details filled in.', 'Saved ✓ 3 details filled in.'],                                                // a plain sentence stays as it is
    ['Error: Notion did not answer', 'Error: Notion did not answer'],                                                  // an app's own words keep their lead
    ['', ''],
  ];
  for (const [raw, said] of cases) assert.equal(plainError(raw), said, raw);
});

test('every message slot goes through plainError: message() is the one place a result reaches the screen', () => {
  const core = read('../renderer/pages/core.js');
  assert.match(core, /import \{plainError\} from '\.\.\/run-warnings\.js';/);
  assert.match(core, /export function message\(id, text, tone = ''\) \{[^\n]*plainError\(text\)/);
});

// The ids an element sits under in the static page, with whether each is hidden.
function ancestors(html, id) {
  const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
  const stack = [];
  for (const [, close, tag, attrs] of html.replace(/<!--[^]*?-->/g, '').matchAll(/<(\/?)([a-zA-Z][\w-]*)([^>]*)>/g)) {
    const name = tag.toLowerCase();
    if (close) { const at = stack.map(each => each.tag).lastIndexOf(name); if (at >= 0) stack.length = at; continue; }
    const own = /\bid="([^"]+)"/.exec(attrs)?.[1];
    if (own === id) return stack;
    if (!VOID.has(name)) stack.push({tag: name, id: own, hidden: /(^|\s)hidden(\s|=|$)/.test(attrs)});
  }
  return null;
}

test('"Your details" answers in its own panel ("Fill from my CV", a failed load), never in the save bar that is hidden when nothing changed', () => {
  const proposals = read('../renderer/pages/contact-proposals.js');
  const profile = read('../renderer/pages/profile.js');
  const press = proposals.slice(proposals.indexOf('export async function loadProposals'), proposals.indexOf('// After Apply'));
  const load = profile.slice(profile.indexOf('export function showContact'), profile.indexOf('$(\'contact-cv\')'));
  const slots = [...new Set([...`${press}\n${load}`.matchAll(/message\('([\w-]+)'/g)].map(match => match[1]))];
  assert.deepEqual(slots, ['contact-panel-message']);
  // The save bar's own line says something only while the bar is open: after contactDirty(true) (proposals filled in) or on Save (its button is in the bar).
  const pages = fs.readdirSync(new URL('../renderer/pages/', import.meta.url)).map(name => read(`../renderer/pages/${name}`)).join('\n');
  for (const match of pages.matchAll(/message\('contact-message', (?!'')/g)) {
    const before = pages.slice(Math.max(0, match.index - 900), match.index);
    assert.match(before, /contactDirty\(true\)|saveContact\(/, `a message to the save bar's line while it may be hidden: ${pages.slice(match.index, match.index + 90)}`);
  }
  const html = read('../renderer/index.html');
  for (const slot of slots) {
    const above = ancestors(html, slot);
    assert.ok(above, `#${slot} is in the page`);
    const panel = above.findIndex(each => each.id === 'setting-contact');
    assert.ok(panel >= 0, `#${slot} sits in the "Your details" panel`);
    const hidden = above.slice(panel + 1).filter(each => each.hidden).map(each => each.id || each.tag);
    assert.deepEqual(hidden, [], `#${slot} sits inside a hidden part of the panel (${hidden.join(' > ')})`);
  }
});

// Why (#2500, 1 Nov 2026): Your details wrote a handler's error straight into its message line, past message(), so a provider's raw error reached the
// page. The class: any renderer line that puts a result's `.error` or an exception's `.message` on screen goes through plainError (or humanError, which it uses).
test('no page puts a handler error or an exception message on screen without plainError', () => {
  const root = new URL('../renderer/', import.meta.url);
  const files = fs.readdirSync(root, {recursive: true}).filter(name => name.endsWith('.js'));
  const raw = /\.(?:textContent|innerText)\s*=\s*[^;]*(?:\?\.|\.)(?:error\b(?!\s*\?\s*'|\s*\)\s*\?)|message\b)/;
  const said = /plainError\(|humanError\(|cvError\(/;
  const found = [];
  for (const name of files) {
    fs.readFileSync(new URL(name, root), 'utf8').split('\n').forEach((line, at) => {
      if (raw.test(line) && !said.test(line)) found.push(`${name}:${at + 1}: ${line.trim().slice(0, 110)}`);
    });
  }
  assert.ok(files.length > 50, 'the renderer files were read');
  assert.ok(raw.test('note.textContent = done.error;') && said.test('note.textContent = plainError(done.error);'), 'positive control: a raw write is caught, a plainError one is not');
  assert.deepEqual(found, [], 'show these through plainError (renderer/run-warnings.js)');
});
