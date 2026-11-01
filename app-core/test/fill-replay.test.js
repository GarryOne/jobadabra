// Replay tests: every form-fill failure becomes a fixture (app-core/test/fixtures/fill/<name>.html + .json, made from its
// issue's snapshot by tools/fill-fixture.mjs), and the extension's real fill (extension/page/fill.js) runs on it here.
// A fix is proven against the form that failed, not a guess. How: .claude/skills/record-applying-sites/SKILL.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadJsdom, openPage, userClick } from './helpers/page.js';

const JSDOM = await loadJsdom();
const skip = JSDOM ? false : 'jsdom is not installed here (run npm install in worker/)';
const DIR = new URL('./fixtures/fill/', import.meta.url);
const fixtures = fs.readdirSync(DIR).filter((name) => name.endsWith('.json')).sort()
  .map((name) => ({ name: name.slice(0, -5), spec: JSON.parse(fs.readFileSync(new URL(name, DIR), 'utf8')),
    html: fs.readFileSync(new URL(name.replace(/\.json$/, '.html'), DIR), 'utf8') }));
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// A question named the same way, give or take the page's trailing marks ("Rendre mon profil visible pour :" is "… pour"; 20 Oct 2026, a read
// question stayed red on its colon).
const same = (a, b) => { const plain = (text) => String(text || '').replace(/[\s:*]+$/, '').replace(/\s+/g, ' ').trim(); return plain(a) === plain(b); };

// The field the fill answers, as fill.js names it: the marked element's id/name, a radio group as "radio:<name>".
function fieldOf(window, spec) {
  if (spec.field) return spec.field;
  const el = window.document.querySelector('[data-jp-field]');
  assert.ok(el, 'the fixture marks its failing field with data-jp-field');
  return el.type === 'radio' ? `radio:${el.name}` : el.id || el.name;
}

// Replays one fixture: fill the answer; a dropdown the fill armed gets the user's click (a trusted mousedown), as in
// Chrome; returns what the form ended with: the option picked, the radio checked, the value, and the fill's trace row.
async function replay(spec, html) {
  const window = openPage(JSDOM, html, { url: `https://${spec.site}/replay` });
  const picked = [];
  window.document.addEventListener('click', (event) => {
    const option = event.target.closest?.('[role=option], [class*=option]');
    if (option) picked.push(option.textContent.replace(/\s+/g, ' ').trim());
  }, true);
  // The page's own behaviour for a group of pressable buttons: a click presses this one and releases its siblings (React does it on the real page).
  for (const button of window.document.querySelectorAll('button[aria-pressed]')) {
    button.addEventListener('click', () => {
      for (const other of button.parentElement.querySelectorAll('button[aria-pressed]')) other.setAttribute('aria-pressed', 'false');
      button.setAttribute('aria-pressed', 'true');
    });
  }
  const field = fieldOf(window, spec);
  const summary = await window.__jobPilottoExtensionFill([{ field, value: spec.answer, question: spec.label, source: 'kit' }], {}, null, '', false);
  const armed = window.document.querySelector('[data-jobpilotto-armed]');
  if (armed) {
    userClick(window, armed);
    for (let waited = 0; waited < 5000 && window.__jobPilottoArmedCount() && !picked.length; waited += 50) await wait(50);
  }
  const radio = window.document.querySelector('input[type=radio]:checked');
  const input = window.document.getElementById(field) || window.document.querySelector(`[name="${field}"]`);
  return {
    picked: picked[0] ?? null,
    // A group of pressable buttons (Yes/No): the one pressed now.
    pressed: window.document.querySelector('button[aria-pressed=true]')?.textContent.replace(/\s+/g, ' ').trim() ?? null,
    checked: radio ? (radio.labels?.[0]?.textContent || radio.value).replace(/\s+/g, ' ').trim() : null,
    value: input && !/^(radio|checkbox)$/.test(input.type) && input.getAttribute('role') !== 'combobox' ? input.value : null,
    trace: (summary.trace || []).find((row) => same(row.label, spec.label)) || null,
    // The fill's trace names the field by its question (not one of its choices) and knows whether it is required.
    traced: (summary.trace || []).some((row) => same(row.label, spec.label)),
    // Read: traced as a question the reader understood, not as one it missed (a reading failure's fixture is red until fixed).
    read: (summary.trace || []).some((row) => same(row.label, spec.label) && !/^question (on the page not read|text not found)/.test(row.reason || '')),
    required: !!(summary.trace || []).find((row) => same(row.label, spec.label))?.required,
    error: summary.error || null,
  };
}

test('every fixture has a readable spec and a scrubbed snapshot (the repo is public)', () => {
  assert.ok(fixtures.length >= 1);
  for (const { name, spec, html } of fixtures) {
    assert.match(name, /^[a-z0-9.-]+--[a-z0-9-]+$/, `${name}: <site>--<label-slug>`);
    assert.ok(spec.site && spec.label && spec.source, `${name}: site, label and source`);
    assert.ok(/^(synthetic|issue #\d+)$/.test(spec.source), `${name}: source is "synthetic" or "issue #<n>"`);
    assert.ok(/data-jp-field/.test(html), `${name}: the failing field is marked data-jp-field`);
    // Identifiers (Greenhouse's question_15024092008) may hold long numbers; texts and values may not.
    const texts = html.replace(/\s(id|name|for|class|aria-(labelledby|describedby|controls|owns|activedescendant|errormessage))="[^"]*"/g, '');
    assert.ok(!/[\w.+-]+@[\w-]+\.[\w.]+|https?:\/\/|\+?\d[\d ()./-]{5,}\d|<script|\son\w+=|\shref=|\ssrc=|\sstyle=/i.test(texts),
      `${name}: an email, URL, phone-like number, script, handler, link or style in the snapshot`);
  }
});

for (const { name, spec, html } of fixtures) {
  test(`replay ${name} (${spec.source}): ${spec.label}`, { skip }, async () => {
    assert.ok(spec.answer !== undefined && spec.expect && Object.keys(spec.expect).length,
      `${name}.json needs "answer" (a representative value, never the user's real one) and "expect" ({picked|checked|value})`);
    const result = await replay(spec, html);
    assert.equal(result.error, null);
    for (const [key, want] of Object.entries(spec.expect)) {
      assert.equal(result[key], want, `${name}: expected ${key} "${want}", got ${JSON.stringify(result)}`);
    }
  });
}
