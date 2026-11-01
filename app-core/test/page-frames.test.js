// Frame candidates (extension/ladder/rung3-frames.js): the iframes of a page that could hold its application form, by structure only. The page-kind AI picks
// the form among them by index; the frame's full address (with its token) never leaves the extension. Shape of Datadog's careers page (10 Oct 2026):
// a posting with no form of its own and one Greenhouse iframe far down the page.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadJsdom, openPage } from './helpers/page.js';

const JSDOM = await loadJsdom();
const PAGE = `<main><h1>Strategic Account Executive</h1><p>About the job</p>
  <iframe id="grnhse_iframe" src="https://job-boards.greenhouse.io/embed/job_app?for=acme&token=123"></iframe>
  <iframe id="consent" src="https://consent.example.net/banner"></iframe>
  <iframe id="insecure" src="http://forms.example.org/apply"></iframe>
  <iframe id="same" src="https://careers.example.com/inner"></iframe>
  <iframe id="hidden" src="https://hidden.example.org/apply" hidden></iframe>
  <iframe id="blank"></iframe></main>`;
const SIZES = { grnhse_iframe: [650, 2432], consent: [300, 60], insecure: [650, 900], same: [650, 900], hidden: [650, 900] };

function open() {
  const window = openPage(JSDOM, PAGE, { url: 'https://careers.example.com/detail/1' });
  window.Element.prototype.getBoundingClientRect = function () { const [width, height] = SIZES[this.id] || [100, 20]; return { left: 0, top: 0, width, height, right: width, bottom: height }; };
  return window;
}

test('only a big, visible, https frame of another host is a candidate; its address stays whole inside the extension', { skip: !JSDOM }, () => {
  const window = open();
  const found = Array.from(window.__jobPilottoFrames.frameCandidates());
  assert.equal(found.length, 1);
  assert.equal(found[0].host, 'job-boards.greenhouse.io');
  assert.equal(found[0].path, '/embed/job_app');
  assert.equal(found[0].src, 'https://job-boards.greenhouse.io/embed/job_app?for=acme&token=123');   // kept for opening the frame
  assert.deepEqual([found[0].width, found[0].height], [650, 2432]);
});

test('what would go to the AI (host, path, size) holds no query string or token', { skip: !JSDOM }, () => {
  const window = open();
  const sent = Array.from(window.__jobPilottoFrames.frameCandidates()).map(({ host, path, width, height }) => ({ host, path, width, height }));
  assert.ok(!/token|\?/.test(JSON.stringify(sent)));
});

test('a page with no frame has no candidate, and the biggest frame comes first', { skip: !JSDOM }, () => {
  const none = openPage(JSDOM, '<main><p>No frames</p></main>', { url: 'https://careers.example.com/x' });
  assert.equal(none.__jobPilottoFrames.frameCandidates().length, 0);
  const window = open();
  window.document.body.insertAdjacentHTML('beforeend', '<iframe id="small" src="https://other.example.org/form"></iframe>');
  SIZES.small = [400, 300];
  assert.deepEqual(Array.from(window.__jobPilottoFrames.frameCandidates()).map((item) => item.host), ['job-boards.greenhouse.io', 'other.example.org']);
});
