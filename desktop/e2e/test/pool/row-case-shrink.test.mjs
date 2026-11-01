// lib/row-case-shrink.mjs: a row's pages shrunk for a case folder: the CSS cut to the rules some captured state uses, one stylesheet per host, no fonts, no url(), no data: images.
// Headless Chromium, nothing from the network; skipped without Chromium.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {shrinkPages} from '../../lib/row-case-shrink.mjs';

let chromium = null;
try { ({chromium} = await import('playwright-core')); if (!fs.existsSync(chromium.executablePath())) chromium = null; } catch { /* no playwright */ }
const skip = !chromium && 'no Chromium installed';

const page = (url, body, css = '') => ({url, file: 'pages/1.html', html: `<!doctype html><html><head><style>${css}</style><link rel="stylesheet" href="https://cdn.example.net/t.css"></head><body>${body}</body></html>`});
const SHEET = '.used{color:red} .unused{color:blue} dialog.shown{display:block} @font-face{font-family:F;src:url(f.woff2)} .bg{background:url(https://x.example/i.png) no-repeat;margin:2px}'
  + ' @media (min-width:600px){.wide{width:5px} .never{width:6px}} @keyframes spin{from{opacity:0}to{opacity:1}} @import url(other.css); a:hover{color:green}';

test('rules some captured state uses stay, the rest go; a state class kept in ANY state keeps its rule; fonts, keyframes, imports and url() go', {skip}, async () => {
  const states = [page('https://jobs.example.test/a', '<p class="used">x</p><a>l</a>'), page('https://jobs.example.test/a', '<dialog class="shown" open>d</dialog><i class="bg wide"></i>')];
  const {pages, sheets} = await shrinkPages(chromium, states, [SHEET]);
  const css = [...sheets.values()].join('\n');
  for (const kept of ['.used', 'dialog.shown', '.bg', '.wide', 'a:hover']) assert.ok(css.includes(kept), `${kept} kept`);
  for (const gone of ['.unused', '.never', '@font-face', '@keyframes', '@import', 'url(', 'woff2']) assert.ok(!css.includes(gone), `${gone} gone`);
  assert.match(css, /@media \(min-width: 600px\)/);
  assert.equal(sheets.size, 1, 'one stylesheet for the host');
  for (const one of pages) {
    assert.doesNotMatch(one.html, /<style|rel="stylesheet" href="https:\/\/cdn/, 'the inline and linked sheets are replaced');
    assert.match(one.html, /<link rel="stylesheet" href="https:\/\/jobs\.example\.test\/__case\/styles\.css">/);
  }
});

test('a data: image goes from the page; the page text and structure stay', {skip}, async () => {
  const state = page('https://jobs.example.test/a', '<img src="data:image/png;base64,AAAA"><h1>Seller (m/f)</h1>');
  const {pages} = await shrinkPages(chromium, [state], []);
  assert.doesNotMatch(pages[0].html, /data:image/);
  assert.match(pages[0].html, /<h1>Seller \(m\/f\)<\/h1>/);
});

test('layoutOnly (the page budget): a rule keeps only what decides what is visible, where and how big; colours, fonts, backgrounds and a rule with nothing of that go', {skip}, async () => {
  const states = [page('https://jobs.example.test/a', '<p class="a b">x</p><i class="paint"></i>')];
  const {sheets} = await shrinkPages(chromium, states, ['.a{color:red;display:none;font-size:20px;margin:3px;background:blue} .b{color:green} .paint{color:red;box-shadow:0 0 3px #000}'], {layoutOnly: true});
  const css = [...sheets.values()].join('\n');
  assert.match(css, /\.a \{[^}]*display: none/);
  assert.match(css, /\.a \{[^}]*margin/);
  for (const gone of ['color', 'font-size', 'background', 'box-shadow', '.paint', '.b ']) assert.ok(!css.includes(gone), `${gone} gone`);
});

test('a stubbed page (--stub-page) keeps its title and the links, buttons, controls, labels and forms (the outermost of each), nothing else', {skip}, async () => {
  const body = '<header><nav><a href="/jobs">Jobs</a></nav></header><main><p>A very long job description that the replay never reads.</p><a href="/apply" class="cta">Apply now</a><form><label for="e">Email</label><input id="e" type="text"></form></main><footer>(c)</footer>';
  const states = [{...page('https://jobs.example.test/a', body), html: `<!doctype html><html><head><title>Role</title></head><body>${body}</body></html>`}, page('https://jobs.example.test/b', '<p>kept whole</p>')];
  const {pages} = await shrinkPages(chromium, states, [], {stub: [0]});
  assert.match(pages[0].html, /<title>Role<\/title>/);
  for (const kept of ['href="/jobs"', 'Apply now', '<form>', 'for="e"']) assert.ok(pages[0].html.includes(kept), `${kept} kept`);
  for (const gone of ['A very long job description', '(c)', '<header', '<footer']) assert.ok(!pages[0].html.includes(gone), `${gone} gone`);
  assert.equal((pages[0].html.match(/<label/g) || []).length, 1, 'a label inside a form is not kept twice');
  assert.match(pages[1].html, /kept whole/, 'another page is untouched');
});
