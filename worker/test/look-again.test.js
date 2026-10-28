// A page judged without a form is looked at again (extension/fill-flow.js watchForFields): when fields come (a late form), or when a frame
// appears on a page that had none (a bot check injected seconds after the load: SmartRecruiters, twin, 9 Oct 2026, judged "empty page" at 3 s).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const flow = fs.readFileSync(new URL('../../extension/fill-flow.js', import.meta.url), 'utf8');
const steps = fs.readFileSync(new URL('../../extension/fill-flow-steps.js', import.meta.url), 'utf8');
const reads = fs.readFileSync(new URL('../../extension/page-reads.js', import.meta.url), 'utf8');   // pageShape (moved out of fill-flow.js)

test('the page shape counts visible frames, and a frame that appears later makes the page be judged again', () => {
  assert.match(reads, /frames: \[\.\.\.document\.querySelectorAll\('iframe'\)\]\.filter\(el => \{ const box = el\.getBoundingClientRect\(\); return box\.width > 40 && box\.height > 40; \}\)\.length/);
  assert.match(flow, /const hadHosts = seenHosts === null \? \(await pageShape\(tab\.id\)\)\?\.frameHosts \|\| \[\] : seenHosts/);
  assert.match(steps, /watchForFields\(tab, jobUrl, undefined, botCheck \? 60 : 10, counts\?\.frameHosts \|\| \[\], \(\) => markPage\(tab\.id, role, pressed, kind\)\)/, 'the baseline is what the judgment saw');
  assert.match(flow, /const newHost = \(shape\?\.frameHosts \|\| \[\]\)\.some\(host => !hadHosts\.includes\(host\)\);/, 'a frame whose host shows up later is new');
  assert.match(flow, /const framed = newHost \|\| \(!!shape && await frameBecameCandidate\(tab\.id\)\);/, 'a frame that became a form-frame candidate later is new too');
  // Whichever way the frame came (a new host, or one that grew into a candidate), a kept answer for the page shape never saw it (Ocado, 11 Oct 2026: the Apply press opened a form frame, the kept "posting" was served again).
  assert.match(flow, /if \(framed\) await forgetKind\(/, 'a kept answer for the shape never saw that frame');
  assert.doesNotMatch(flow, /framed && !newHost/, 'a new frame host is no exception');
  assert.match(flow, /if \(!shape \|\| \(shape\.fields \+ shape\.textareas \+ shape\.files < 2 && !framed\)\) continue;/);
  const watch = flow.slice(flow.indexOf('async function watchForFields'), flow.indexOf('export async function consider'));
  assert.ok(watch.indexOf('const framed') < watch.indexOf('await consider(live, jobUrl)'), 'judged again after the frame');
});

test('the watch keeps a page whose only change is its query string, and logs why it ends', () => {
  const watch = flow.slice(flow.indexOf('async function watchForFields'), flow.indexOf('export async function consider'));
  assert.match(watch, /a\.origin === b\.origin && a\.pathname\.replace\(\/\\\/\+\$\/, ''\) === b\.pathname\.replace/);
  assert.match(watch, /if \(!live \|\| !samePage\(live\.url\)\)/);
  for (const line of ['watching a page judged without a form', 'watch ended: the tab moved on', 'watch ended: no form and no new frame']) assert.ok(watch.includes(line), line);
});
