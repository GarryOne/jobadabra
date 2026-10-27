// The replay/live checks' page reader (lib/replay-truth.mjs readTab) on real DOM shapes: one question is one required control, however its options are named (cc, 13 Oct 2026:
// pool run 38325149096 on NICE's Greenhouse form counted 16 empty against the panel's 8: a required fieldset of required checkboxes with per-option ids and a []-name was read
// as the fieldset plus every option). Headless Chromium; skipped where playwright has no browser.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {test} from 'node:test';
import {readTab} from '../lib/replay-truth.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
let chromium = null;
try { ({chromium} = await import('playwright-core')); if (!fs.existsSync(chromium.executablePath())) chromium = null; } catch { /* no playwright */ }

const PAGE = `<!doctype html><html><body><form>
  <div class="field"><label for="first">First name*</label><input id="first" required value="Ada"></div>
  <div class="field"><label id="q1-label" for="q1">Do you require visa sponsorship?*</label>
    <div><input id="q1" role="combobox" aria-autocomplete="list" aria-required="true" aria-labelledby="q1-label" value=""></div>
    <input required tabindex="-1" aria-hidden="true" value="" style="opacity:0;height:1px"></div>
  <fieldset id="q2[]" aria-required="true"><legend>Pick the three factors that matter most *</legend>
    <div><input type="checkbox" required id="q2[]_1" name="q2[]" value="1"><label for="q2[]_1">Hybrid work model</label></div>
    <div><input type="checkbox" required id="q2[]_2" name="q2[]" value="2"><label for="q2[]_2">Meaningful challenges</label></div>
    <div><input type="checkbox" required id="q2[]_3" name="q2[]" value="3"><label for="q2[]_3">Salary</label></div></fieldset>
  <fieldset><legend>Your pronouns *</legend>
    <label><input type="checkbox" required name="q3[]" value="a"> she/her</label><label><input type="checkbox" required name="q3[]" value="b" checked> they/them</label></fieldset>
  <div class="question"><span>Languages you speak *</span>
    <label><input type="checkbox" required name="q4[]" value="en"> English</label><label><input type="checkbox" required name="q4[]" value="de"> German</label></div>
  <fieldset><legend>Worked here before? *</legend>
    <label><input type="radio" required name="q5-yes" value="yes"> Yes</label><label><input type="radio" required name="q5-no" value="no"> No</label></fieldset>
  <label><input type="checkbox" required name="privacy"> I accept the privacy notice</label>
</form></body></html>`;

test('one question is one required control: a required fieldset with required options, a shared []-name, options with their own names', {skip: !chromium && 'no playwright browser'}, async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(PAGE);
    const {required} = await readTab(page, []);
    const empty = required.filter(one => one.empty).map(one => one.name);
    assert.equal(required.length, 7, JSON.stringify(required));   // first name, visa, factors, pronouns, languages, worked here, privacy
    assert.equal(empty.length, 5, JSON.stringify(empty));   // all but the first name and the pronouns (one ticked)
    assert.ok(empty.some(name => /three factors/.test(name)) && empty.some(name => /Worked here/.test(name)), JSON.stringify(empty));   // a group is named by its question
  } finally { await browser.close(); }
});

test('a segmented Yes/No (option roles around hidden native radios) is one control per question, answered by the one picked (recorded segmented-radio-wrapper-1)', {skip: !chromium && 'no playwright browser'}, async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(path.join(here, '..', 'recorded', 'segmented-radio-wrapper-1', 'form.html')).href);
    for (const one of await page.locator('[role=radiogroup]').all()) await one.locator('[role=radio] label').first().click();   // what a person clicks: the segment's label
    const questions = (await readTab(page, [])).required.filter(one => !['First name', 'Last name', 'Email'].includes(one.name));
    assert.equal(questions.length, 2, JSON.stringify(questions));
    assert.deepEqual(questions.filter(one => one.empty), [], JSON.stringify(questions));
  } finally { await browser.close(); }
});

// A form a person cannot see is not theirs to fill (pool run 40497749589, 27 Oct 2026: a careers page's closed floating sidebar, opacity 0 and no pointer events, held two
// iframes with a contact form; the live check counted their 15 empty required boxes against the panel's 0 and called the panel's "ready" false).
const frameForm = `<form><input required aria-label="Surname"><input type=email required aria-label="Mail"></form>`;
const sidebarPage = style => `<!doctype html><html><body><form><input required aria-label="First name" value="Ada"></form>
  <div id="side" style="position:fixed;bottom:0;left:0;width:400px;height:300px;${style}"><iframe style="border:0;width:100%;height:100%" srcdoc='${frameForm}'></iframe></div></body></html>`;

test('required boxes of a frame a person cannot see (opacity 0, hidden, zero size) are not counted; a shown frame still is', {skip: !chromium && 'no playwright browser'}, async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const counted = async style => { await page.setContent(sidebarPage(style)); await page.waitForTimeout(300); return (await readTab(page, [])).required.filter(one => one.empty).map(one => one.name); };
    assert.deepEqual(await counted('opacity:0;pointer-events:none'), [], 'opacity 0 sidebar');
    assert.deepEqual(await counted('visibility:hidden'), [], 'visibility hidden');
    assert.deepEqual(await counted('display:none'), [], 'display none');
    assert.deepEqual(await counted('width:0;height:0;overflow:hidden'), [], 'zero size');
    assert.equal((await counted('')).length, 2, 'a shown frame counts its two empty required boxes');
  } finally { await browser.close(); }
});
