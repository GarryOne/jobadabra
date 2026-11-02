// Fill-failure snapshots go to a PUBLIC GitHub issue: a form full of personal data must come out with none of it.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadJsdom, openPage } from './helpers/page.js';
import { SNAPSHOT_MAX, snapshotFromReport, snapshotHtml } from '../src/snapshot.js';
import { sanitize } from '../src/report.js';

const JSDOM = await loadJsdom();
const skip = JSDOM ? false : 'jsdom is not installed here (run npm install in worker/)';
const read = (path) => fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

// The user (made up): every one of these must stay out of a snapshot.
const ME = { first_name: 'Ada', last_name: 'Lovelace', email: 'ada.lovelace@example.com', phone: '+41 79 123 45 67',
  city: 'Winterthur', linkedin: 'https://www.linkedin.com/in/ada-lovelace-1815' };
const LEAKS = ['Ada', 'Lovelace', 'ada.lovelace', 'example.com', '@', '79 123', '791234567', 'Winterthur', 'ada-lovelace-1815',
  'Physics', 'I love numbers', 'sk_live', 'utm_source', 'csrf', 'Bernoulli', 'Zurich chosen'];

// A Greenhouse form after a fill: values typed in, a hidden token, the extension's own badge (it names the answer),
// a personal greeting, a cover letter, a chosen dropdown value, a link with a query string, and the Degree menu open.
const FORM = `
<form id="application-form" action="https://boards.greenhouse.io/apply?token=sk_live_abc&utm_source=ada">
  <input type="hidden" name="authenticity_token" value="csrf-9f8e7d6c5b4a39281706f5e4d3c2b1a0">
  <div class="field-wrapper"><label for="first_name">First Name</label>
    <input id="first_name" name="first_name" type="text" value="Ada" data-initial="Ada"></div>
  <div class="field-wrapper"><label for="email">Email</label><input id="email" type="email" value="ada.lovelace@example.com"></div>
  <div class="field-wrapper"><label for="phone">Phone</label><input id="phone" type="tel" value="+41 79 123 45 67"></div>
  <div class="field-wrapper"><label for="cover_letter_text">Cover letter</label><textarea id="cover_letter_text">I love numbers</textarea></div>
  <div class="education">
    <h3>Welcome back, Ada Lovelace</h3>
    <p>Questions? Write to ada.lovelace@example.com or see <a href="https://example.org/help?user=ada&sig=abcdef">help</a>.</p>
    <div class="select__container">
      <label id="degree-label" for="degree--0" class="label select__label">Degree<span aria-hidden="true">*</span></label>
      <div class="select-shell remix-css-b62m3t-container">
        <div class="select__control select__control--is-focused select__control--menu-is-open remix-css-13cymwt-control jobadabra-review" style="outline: 3px solid #d9540b" data-jobadabra-armed="Degree">
          <div class="select__value-container remix-css-hlgwow">
            <div class="select__placeholder" id="react-select-degree--0-placeholder">Select...</div>
            <div class="select__input-container" data-value="Master of Science in Physics">
              <input class="select__input" id="degree--0" role="combobox" type="text" value="" aria-expanded="true" aria-haspopup="true"
                aria-labelledby="degree-label" aria-required="true" aria-autocomplete="list" aria-controls="react-select-degree--0-listbox"
                aria-describedby="react-select-degree--0-placeholder" autocomplete="off" tabindex="0" onfocus="steal()">
            </div>
          </div>
          <div class="select__indicators"><span class="select__indicator-separator"></span>
            <div class="select__indicator select__dropdown-indicator" aria-hidden="true"><svg height="20" width="20"><path d="M4 5z"></path></svg></div></div>
        </div>
        <div class="jobadabra-badge">✈️ Click to choose: Master of Science in Physics</div>
        <div class="select__menu remix-css-menu">
          <div class="select__menu-list" role="listbox" id="react-select-degree--0-listbox" aria-multiselectable="false">
            <div class="select__option" role="option" id="react-select-degree--0-option-0" aria-selected="false">Bachelor's Degree</div>
            <div class="select__option select__option--is-focused" role="option" id="react-select-degree--0-option-1" aria-selected="true">Master's Degree</div>
            <div class="select__option" role="option" id="react-select-degree--0-option-2" aria-selected="false">Doctor of Philosophy (Ph.D.)</div>
          </div>
        </div>
      </div>
    </div>
    <div class="select__container"><label id="school-label" for="school--0">School</label>
      <div class="select__control"><div class="select__single-value">ETH Zurich chosen</div>
        <input id="school--0" role="combobox" aria-labelledby="school-label" value=""></div></div>
    <img src="https://tracker.example.net/p.gif?email=ada.lovelace@example.com"><script>window.secret = "sk_live_123"</script>
    <input type="password" name="pw" value="Bernoulli">
  </div>
  <div class="field-wrapper"><label for="location">Location (City)</label>
    <input id="location" role="combobox" aria-controls="location-menu" value="Winterthur">
    <ul id="location-menu" role="listbox"><li role="option">Winterthur, Zurich, Switzerland</li><li role="option">Winterthur, Iowa, United States</li></ul>
  </div>
</form>`;

test('a snapshot of a form full of personal data leaks none of it, and keeps the structure a replay needs', { skip }, () => {
  const window = openPage(JSDOM, FORM);
  const secrets = Object.values(ME);
  const degree = window.__jobadabraSnapshots([{ label: 'Degree', field: 'degree--0' }], secrets).Degree;
  const html = snapshotFromReport(degree);  // as the Worker writes it into the issue
  for (const leak of LEAKS) assert.ok(!html.includes(leak), `"${leak}" leaked:\n${html}`);
  assert.ok(!/href|src=|style=|onfocus|data-value|data-initial|data-jobadabra|jobadabra-review|<script|<img|<path|value="/.test(html), html);
  // What a replay needs: the label, the combobox and its aria wiring, react-select's classes, the open menu's options.
  assert.match(html, /<label id="degree-label" for="degree--0" class="label select__label">/);
  assert.match(html, /<input class="select__input" id="degree--0" role="combobox" type="text" aria-expanded="true"[^>]*aria-controls="react-select-degree--0-listbox"[^>]*data-jp-field>/);
  assert.match(html, /class="select__control select__control--is-focused select__control--menu-is-open remix-css-13cymwt-control"/);
  for (const option of ["Bachelor's Degree", "Master's Degree", 'Doctor of Philosophy (Ph.D.)']) assert.ok(html.includes(option.replace("'", "'")), option);
  if (process.env.SHOW_SNAPSHOT) console.log(html);
  assert.ok(html.length <= SNAPSHOT_MAX);

  // A search box the user typed their city into: the text and the options it brought up are hidden.
  const location = snapshotFromReport(window.__jobadabraSnapshots([{ label: 'Location (City)', field: 'location' }], secrets)['Location (City)']);
  assert.ok(!location.includes('Winterthur'), location);
  assert.match(location, /\[redacted\], Iowa, United States/);

  // Whole-form snapshots too (every field at once): still nothing personal.
  const all = snapshotHtml(window.__jobadabraScrubSnapshot(window.eval(`(${toTreeSource})(document.body)`), secrets));
  assert.match(all, /First Name/);
  assert.match(all, /Welcome back, \[redacted\] \[redacted\]/);  // the greeting, without the name
  for (const leak of LEAKS) assert.ok(!all.includes(leak), `"${leak}" leaked from the whole form:\n${all}`);
});

// The page's raw tree, as snapshot.js reads it (attributes as written), for the whole-form check above.
const toTreeSource = `function toTree(el) {
  if (el.nodeType === 3) return el.nodeValue;
  if (el.nodeType !== 1) return null;
  const a = {}; for (const attr of Array.from(el.attributes)) a[attr.name] = attr.value;
  return {t: el.tagName.toLowerCase(), a, c: Array.from(el.childNodes, toTree).filter(x => x != null)};
}`;

test('the page captures the Degree menu as it opened (before typing filtered it), for "no option matched"', { skip }, async () => {
  const window = openPage(JSDOM, FORM.replace('data-jobadabra-armed="Degree"', ''));
  const { userClick } = await import('./helpers/page.js');
  await window.__jobadabraExtensionFill([{ field: 'degree--0', value: 'Astronaut' }], {}, null, '', false);
  userClick(window, window.document.querySelector('[data-jobadabra-armed]'));
  await new Promise((resolve) => setTimeout(resolve, 200));
  const kept = window.__jobadabraMenuSnapshots?.Degree;
  assert.ok(kept, 'the menu snapshot was kept when the answer matched no option');
  const html = snapshotFromReport(window.__jobadabraSnapshots([{ label: 'Degree', field: 'degree--0' }], Object.values(ME)).Degree);
  assert.ok(html.includes("Master's Degree") && !html.includes('Astronaut') && !html.includes('Lovelace'), html);
});

test('the Worker scrubs every report again: an untrusted tree with scripts, handlers and personal data comes out clean', () => {
  const evil = { t: 'div', a: { onclick: 'x()', style: 'x', class: 'a b', 'data-token': 'sk_live_1', id: 'q<1>`' }, c: [
    { t: 'script', a: {}, c: ['alert(1)'] }, { t: 'img', a: { src: 'https://x' }, c: [] },
    { t: 'a', a: { href: 'javascript:alert(1)' }, c: ['mail ada.lovelace@example.com, call +41 79 123 45 67, see https://x.io/?t=1'] },
    '```\n<script>alert(1)</script>', { t: 'input', a: { type: 'hidden', value: 'csrf' }, c: [] },
    { t: 'input', a: { type: 'text', value: 'Ada', 'data-jp-field': '' }, c: [] },
    { t: 'textarea', a: {}, c: ['I love numbers'] }, { t: 'x-widget', a: { role: 'listbox' }, c: [{ t: 'option', a: { value: 'MSc' }, c: ['MSc'] }] },
    { t: 'IFRAME', a: {}, c: [] }, { t: '"><b', a: {}, c: [] }, 42, null] };
  const html = snapshotFromReport(evil);
  for (const leak of ['onclick', 'style', 'sk_live', '<script', 'src=', 'href', 'ada.lovelace', '79 123', 'x.io', '```', 'csrf',
    'value="Ada"', 'I love numbers', 'iframe', '"><b', '`']) assert.ok(!html.includes(leak), `"${leak}" in:\n${html}`);
  assert.match(html, /<x-widget role="listbox">/);
  assert.match(html, /<option value="MSc">MSc<\/option>/);
  assert.match(html, /&lt;script&gt;/);  // text is escaped, never markup
});

test('snapshots are capped at 8 KB: a long list keeps its first entries and the failing field', () => {
  const options = Array.from({ length: 400 }, (_, i) => ({ t: 'div', a: { role: 'option', class: 'select__option' }, c: [`Country number ${i}`] }));
  const tree = { t: 'div', a: {}, c: [{ t: 'label', a: { for: 'country' }, c: ['Country'] },
    { t: 'div', a: { role: 'listbox' }, c: [...options.slice(0, 350), { t: 'input', a: { id: 'country', role: 'combobox', 'data-jp-field': '' }, c: [] }, ...options.slice(350)] }] };
  const html = snapshotFromReport(tree);
  assert.ok(html.length <= SNAPSHOT_MAX && html.length > 1000);
  assert.match(html, /data-jp-truncated="\d+"/);
  assert.match(html, /id="country"[^>]*data-jp-field/);
  assert.match(html, /Country number 0</);
});

test('reports carry the scrubbed snapshot as HTML; a report without one is unchanged', () => {
  const report = { site: 'job-boards.greenhouse.io', version: '0.9.0', fields: [
    { label: 'Degree', type: 'combobox', reason: 'dropdown clicked, but no option matched',
      snapshot: { t: 'div', a: {}, c: [{ t: 'input', a: { id: 'degree', role: 'combobox', value: 'Ada', 'data-jp-field': '' }, c: [] }, 'ada.lovelace@example.com'] } },
    { label: 'Visa', type: 'combobox', reason: 'dropdown that opens only on a real click' }] };
  const clean = sanitize(report);
  assert.equal(clean.fields[0].snapshot, '<div>\n <input id="degree" role="combobox" data-jp-field>\n [email]\n</div>\n');
  assert.ok(!('snapshot' in clean.fields[1]));
});

test('the scrubber is the same in the page script and the Worker (extension/sync.sh copies it)', () => {
  const block = (source, indent) => {
    const start = source.indexOf(`${indent}// <scrub>`), end = source.indexOf(`${indent}// </scrub>`);
    assert.ok(start >= 0 && end > start);
    return source.slice(start, end).split('\n').map((line) => line.replace(new RegExp(`^${indent}`), '')).join('\n');
  };
  assert.equal(block(read('app-core/src/snapshot.js'), ''), block(read('extension/page/snapshot.js'), '  '),
    'app-core/src/snapshot.js differs from extension/page/snapshot.js: run extension/sync.sh');
});
