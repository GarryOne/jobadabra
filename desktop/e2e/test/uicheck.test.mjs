/* global document, getComputedStyle */
// The layout checks must catch the bug that started them: a job row whose location list ran to twenty lines (2 Oct 2026).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {chromium} from 'playwright-core';
import {LIMITS, inspect} from '../lib/uicheck.mjs';
import {DESKTOP} from '../lib/app.mjs';

const css = path.join(DESKTOP, 'renderer');
const many = 'Remote - European Union; Spain; Italy; Germany; Switzerland; Denmark; Norway; Croatia; Ireland; Stockholm; Romania; Austria; Barcelona; Netherlands; Portugal; France; Berlin; Sweden; Hungary; Estonia';
const html = (place, extra = '') => `<link rel="stylesheet" href="file://${css}/tokens.css"><link rel="stylesheet" href="file://${css}/style.css"><style>${extra}</style>
  <section class="view" data-view="jobs"><div class="job-row" style="width:420px"><div class="place"><div class="place-line"><span>${place}</span></div></div></div></section>`;

async function findings(page, markup) {
  await page.setContent(markup);
  await page.waitForTimeout(200);
  return page.evaluate(inspect, {view: 'jobs', limits: LIMITS});
}

test('a row with twenty lines of places is flagged; the fixed one is not', async () => {
  const browser = await chromium.launch({channel: 'chrome'});
  try {
    const page = await browser.newPage({viewport: {width: 1280, height: 800}});
    const old = await findings(page, html(many, '.place-line span{display:block !important;-webkit-line-clamp:unset !important;overflow:visible !important;width:110px}'));
    assert.ok(old.some(item => item.kind === 'tall-row' && item.severity === 'severe'), `the old layout was not flagged: ${JSON.stringify(old)}`);
    const fixed = await findings(page, html('Remote - European Union; Spain +18', '.place-line span{width:110px}'));
    assert.deepEqual(fixed.filter(item => item.severity === 'severe'), []);
  } finally { await browser.close(); }
});

test('a page that scrolls sideways is flagged and names the element that sticks out', async () => {
  const browser = await chromium.launch({channel: 'chrome'});
  try {
    const page = await browser.newPage({viewport: {width: 800, height: 600}});
    const wide = await findings(page, `<section class="view" data-view="jobs"><div class="card" id="wide" style="width:1000px;height:40px">x</div></section>`);
    const overflow = wide.find(item => item.kind === 'page-overflow');
    assert.ok(overflow, `a 1000px element in an 800px window was not flagged: ${JSON.stringify(wide)}`);
    assert.match(overflow.detail, /sticking out: .*card.*right edge 1008px/);
    const fine = await findings(page, `<section class="view" data-view="jobs"><div class="card" style="width:600px;height:40px">x</div></section>`);
    assert.ok(!fine.some(item => item.kind === 'page-overflow'));
  } finally { await browser.close(); }
});

test('a long status in the activity bar never widens the window (2 Oct 2026: the Interviews page scrolled sideways, 1306px in 1280px)', async () => {
  const browser = await chromium.launch({channel: 'chrome'});
  try {
    const page = await browser.newPage({viewport: {width: 1280, height: 800}});
    // A file page, not setContent: the real stylesheets only load from a file: origin.
    const file = path.join(os.tmpdir(), `jp-activity-bar-${process.pid}.html`);
    fs.writeFileSync(file, `<link rel="stylesheet" href="file://${css}/tokens.css"><link rel="stylesheet" href="file://${css}/style.css">
      <section class="app"><nav class="sidebar"></nav><main><div class="view"></div></main>
        <footer class="activity"><button class="activity-bar"><span class="activity-dot"></span><b>Last jobs check had problems</b>
          <span class="activity-step">Fri 15:55 · nothing new · click to see why</span>
          <span class="activity-meta">Gmail checked Fri 16:31 · Gmail check: 13 new email(s) read, 6 update(s) recorded</span><span class="activity-open">Details ▴</span></button></footer></section>`);
    await page.goto(`file://${file}`);
    await page.waitForTimeout(200);
    const {scroll, client, columns} = await page.evaluate(() => ({scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth,
      columns: getComputedStyle(document.querySelector('.app')).gridTemplateColumns}));
    assert.notEqual(columns, 'none', 'the real stylesheet did not load into the test page');
    const out = await page.evaluate(() => [...document.querySelectorAll('*')].filter(el => el.getBoundingClientRect().right > document.documentElement.clientWidth + 1)
      .map(el => `${el.tagName.toLowerCase()}.${el.className} → ${Math.round(el.getBoundingClientRect().right)}px`));
    assert.ok(scroll <= client, `the page is ${scroll}px wide in a ${client}px window (columns ${columns}); sticking out: ${out.join(', ')}`);
  } finally { await browser.close(); }
});

// 2 Oct 2026 (issue #36): in the icon rail (window under 1180 px) every nav label is set to font-size 0 on purpose; the check reported "text is under 10px: Focus" on every page.
test('text that is hidden on purpose with font-size 0 is not tiny; real tiny text still is', async () => {
  const browser = await chromium.launch({channel: 'chrome'});
  try {
    const page = await browser.newPage({viewport: {width: 1280, height: 800}});
    const page_ = markup => findings(page, `<section class="view" data-view="jobs">${markup}</section>`);
    const hidden = await page_('<button class="nav" style="font-size:0;width:48px;padding:10px 0"><svg width="20" height="20"></svg>Focus</button>')   // the icon gives the button its size, the label is a bare text node;
    assert.deepEqual(hidden.filter(item => item.kind === 'tiny-text'), [], JSON.stringify(hidden));
    const tiny = await page_('<p style="font-size:8px">Tiny but shown</p>');
    assert.ok(tiny.some(item => item.kind === 'tiny-text'), `real tiny text was not flagged: ${JSON.stringify(tiny)}`);
  } finally { await browser.close(); }
});

// 2 Oct 2026 (issue #47's screenshot): in the icon rail the brand text ("Jobadabra" + DEV) ran out of its 72 px box over the page title, and the "Search & commands" button was cut.
// No check saw it: the checks looked only inside the page (the sidebar is outside it), and "text cut off" only covered clipped text, not text that spills out and stays visible.
test('text that runs out of its box and stays visible is found, in the app chrome too, and an element that fits is not', async () => {
  const browser = await chromium.launch({channel: 'chrome'});
  try {
    const page = await browser.newPage({viewport: {width: 1024, height: 700}});
    const run = markup => findings(page, `<aside class="sidebar" style="width:72px"><div class="brand" style="white-space:nowrap">${markup}</div></aside><section class="view" data-view="jobs"><h1>Jobs</h1></section>`);
    const spilled = await run('Jobadabra <span class="dev-tag">DEV</span>');
    const hit = spilled.find(item => item.kind === 'spill');
    assert.ok(hit, `the spilling brand was not flagged: ${JSON.stringify(spilled)}`);
    assert.equal(hit.chrome, true, 'something in the sidebar belongs to the app, not to the page');
    assert.match(hit.detail, /sidebar|brand/);
    const fine = await run('JP');
    assert.deepEqual(fine.filter(item => item.kind === 'spill'), []);
    const inPage = await findings(page, '<section class="view" data-view="jobs"><div class="card" style="width:60px"><span style="white-space:nowrap">a long label that does not fit</span></div></section>');
    const own = inPage.find(item => item.kind === 'spill');
    assert.ok(own && !own.chrome, `a spill inside the page: ${JSON.stringify(inPage)}`);
  } finally { await browser.close(); }
});

// #94: "400 {"type":"error",…,"request_id":…}" was shown in the CV card and filed only as a CSS spill. Technical text shown to a person is severe, whatever its size;
// technical text shown on purpose (a log block, a code sample, a terminal, a technical-log toggle) and an ordinary sentence about an error are not.
test('technical text shown to a person is a severe error-shown finding; logs, code and plain sentences are not', async () => {
  const browser = await chromium.launch({channel: 'chrome'});
  try {
    const page = await browser.newPage({viewport: {width: 1280, height: 800}});
    const raw = '400 {"type":"error","error":{"type":"invalid_request_error","message":"You have reached your specified API usage limits."},"request_id":"req_011"}';
    const shown = await findings(page, `<section class="view" data-view="jobs"><p id="cv-message" class="message">${raw}</p></section>`);
    const hits = shown.filter(item => item.kind === 'error-shown');
    assert.equal(hits.length, 1, JSON.stringify(shown));
    assert.equal(hits[0].severity, 'severe');
    assert.match(hits[0].detail, /p#cv-message\.message shows technical text to the person: "400 \{"type":"error"/);
    for (const markup of [`<pre>${raw}</pre>`, `<code>TypeError: x is undefined</code>`, `<details open><summary>Technical log</summary><div>${raw}</div></details>`, `<textarea>${raw}</textarea>`,
      `<p>Couldn't read your CV: the Anthropic API spending limit was reached (back on 2026-11-01).</p>`, `<p>The AI service had an error; try again in a minute.</p>`]) {
      const quiet = await findings(page, `<section class="view" data-view="jobs">${markup}</section>`);
      assert.deepEqual(quiet.filter(item => item.kind === 'error-shown'), [], markup);
    }
    const stack = await findings(page, `<section class="view" data-view="jobs"><div class="toast">Error: boom\n    at render (file:///app/renderer/pages/jobs.js:12:5)</div></section>`);
    assert.equal(stack.filter(item => item.kind === 'error-shown').length, 1, 'a stack trace is caught');
  } finally { await browser.close(); }
});

// #97: the tip ticker (style.css .ss-tip-text, a 20 s scroll) was caught mid-scroll and reported as clipped text. The AI review is now told what moves and what is cut on purpose.
test('what is moving and what is clipped on purpose are facts for the AI review', async () => {
  const {motionFacts} = await import('../lib/uicheck.mjs');
  const browser = await chromium.launch({channel: 'chrome'});
  try {
    const page = await browser.newPage({viewport: {width: 1280, height: 800}, reducedMotion: 'no-preference'});   // the app stops the ticker for reduced motion (style.css)
    const sheet = name => fs.readFileSync(path.join(css, name), 'utf8');   // inlined: a file:// sheet under setContent does not reliably apply
    await page.setContent(`<style>${sheet('tokens.css')}</style><style>${sheet('style.css')}</style>
      <div class="ss-tips" style="width:400px"><span class="ss-tip-chip">Worth trying</span><div class="ss-tip-frame"><span class="ss-tip-text">The employer's own career page is usually the freshest source of openings for you</span></div></div>
      <p style="width:120px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">A long headline that is cut on purpose</p>
      <p style="width:120px;white-space:nowrap;overflow:hidden">A long line cut by accident</p>`);
    await page.waitForTimeout(300);
    const facts = await page.evaluate(motionFacts);
    assert.ok(facts.moving.some(item => /ss-tip-text/.test(item)), JSON.stringify(facts));
    assert.ok(facts.clippedOnPurpose.some(item => /cut on purpose/.test(item)), JSON.stringify(facts));
    assert.ok(!facts.clippedOnPurpose.some(item => /by accident/.test(item)), 'a cut without an ellipsis, clamp or mask is not "on purpose"');
  } finally { await browser.close(); }
});

// 4 Oct 2026, the owner: "if I resize to the lowest vertically I cannot access the menu items at the bottom; there is no scroll". The column did scroll, but its scrollbar was hidden and
// the wheel does not scroll a drag area, so nothing showed it. The Finder never looked at the smallest height; now it does, and says what is wrong in plain words.
const menu = (css, buttons = 14) => `<style>body{margin:0}.sidebar{width:200px;height:100vh;display:flex;flex-direction:column;${css}}.sidebar button{height:40px;flex:none}</style>
  <nav class="sidebar">${Array.from({length: buttons}, (_, n) => `<button>Item ${n}</button>`).join('')}</nav>`;
const menuFindings = async (page, markup) => { await page.setContent(markup); await page.waitForTimeout(100); return (await page.evaluate(inspect, {view: 'jobs', limits: LIMITS})).filter(item => ['unreachable-control', 'hidden-scroll'].includes(item.kind)); };

test('a menu cut off by the window: nothing to scroll is unreachable, a scroll with no scrollbar is hidden, a visible scrollbar is fine', async () => {
  const browser = await chromium.launch({channel: 'chrome'});
  try {
    const page = await browser.newPage({viewport: {width: 1024, height: 400}});
    const stuck = await menuFindings(page, menu('overflow:hidden'));
    assert.deepEqual(stuck.map(item => item.kind), ['unreachable-control']);
    assert.match(stuck[0].detail, /cut off at this window size and nothing scrolls/);
    const quiet = await menuFindings(page, menu('overflow-y:auto;scrollbar-width:none'));
    assert.deepEqual(quiet.map(item => item.kind), ['hidden-scroll']);
    assert.match(quiet[0].detail, /scrolls with no visible scrollbar/);
    assert.deepEqual(await menuFindings(page, menu('overflow-y:auto;scrollbar-width:thin')), [], 'a visible scrollbar tells the person it scrolls');
    assert.deepEqual(await menuFindings(page, menu('overflow-y:auto', 3)), [], 'a menu that fits is fine');
  } finally { await browser.close(); }
});

test('the real menu at the smallest window height: the old hidden-scrollbar column is flagged, the current one is reachable', async () => {
  const browser = await chromium.launch({channel: 'chrome'});
  try {
    const page = await browser.newPage({viewport: {width: 1024, height: 640}});
    const open = async extra => {
      await page.goto(`file://${css}/index.html`);
      await page.waitForTimeout(300);
      await page.evaluate(styles => { for (let e = document.querySelector('.sidebar'); e; e = e.parentElement) e.hidden = false; document.querySelectorAll('.nav[hidden]').forEach(nav => { nav.hidden = false; });   /* the longest menu: Interviews and Reports shown once they have content */ const tag = document.createElement('style'); tag.textContent = styles; document.head.append(tag); }, extra);
      return (await page.evaluate(inspect, {view: 'jobs', limits: LIMITS})).filter(item => ['unreachable-control', 'hidden-scroll'].includes(item.kind));
    };
    const old = await open('.sidebar{overflow-y:auto !important;scrollbar-width:none !important}.sidebar .nav-scroll{display:contents !important}');
    assert.ok(old.some(item => item.kind === 'hidden-scroll' || item.kind === 'unreachable-control'),   // which of the two depends on the machine's font metrics: both say the column cuts buttons off with no way to scroll
       `the owner's bug was not flagged: ${JSON.stringify(old)}`);
    assert.deepEqual(await open(''), [], 'the current menu keeps the bottom buttons in view and the list scrolls with a scrollbar');
  } finally { await browser.close(); }
});

// CONTENT SHOWN IN THE WRONG FORM (5 Oct 2026 is the reference case: a Jobs check's digest as raw Telegram text above its own card).
// The checks must catch that case AND others of the same type, and stay quiet on clean screens.
const DIGEST = '✈️ Jobadabra · 🆕 1 new · top 1 of 1<br>1 open · 1 📍<br>1. Senior Site Reliability Engineer (https://boards.e2e.test/job/1791157080)<br>&nbsp;&nbsp;E2E Acme · Zurich<br>Tap a job number to mark it applied, save or dismiss it.';
const ITEMS = 'Senior Site Reliability Engineer at E2E Acme in Zurich, hybrid, strong match on Kubernetes, Terraform, AWS and service level objectives; no salary stated; English only; posted two days ago by the platform team';
const kinds = async (page, body) => (await findings(page, `<section class="view" data-view="jobs">${body}</section>`)).map(item => item.kind);
const withChrome = async run => { const browser = await chromium.launch({channel: 'chrome'}); try { await run(await browser.newPage({viewport: {width: 1280, height: 800}})); } finally { await browser.close(); } };

test('the reference case: a raw digest marked as a fallback, above its card, is flagged three ways', () => withChrome(async page => {
  const found = await kinds(page, `<div id="activity-result" data-fallback="search">${DIGEST}</div><div class="run-card"><div>${ITEMS}</div></div><div class="note"><div>${ITEMS}</div></div>`);
  for (const kind of ['card-fallback', 'raw-markup', 'duplicate-content']) assert.ok(found.includes(kind), `${kind} missing: ${found}`);
}));

// The owner's find of 5 Oct 2026, word for word: a finished "Search analysis" on the Actions page as the chat message it was written for.
const WEEKLY = '📊 Search analysis:\n\n📊 Search analysis · last 7 days\nNot enough data yet: 0 jobs found, 0 applications sent\n💡 Begin by running a market search to understand regional demand for SRE and platform engineering roles matching your profile.\n'
  + 'The market scan has found no open positions yet. No applications have been sent, so there is no reply or interview data.\n🔧 Change next week\n• Run a market search in Jobs to populate eligible roles\n🎯 Run a market search in Jobs to find eligible roles.\n'
  + 'Full report in Notion (https://app.notion.com/p/Not-enough-data-yet-0-jobs-found-0-applications-sent-3f0699c9deff819d851ee04ec0dee5ae)';
const pre = text => `<div id="command-answer" style="white-space:pre-wrap">${text}</div>`;

test('the chat report of 5 Oct 2026 shown as plain text is caught with and without the window\'s own marker', () => withChrome(async page => {
  assert.ok((await kinds(page, pre(WEEKLY))).includes('raw-markup'), 'with no marker, the text itself gives it away');
  assert.ok((await kinds(page, pre(WEEKLY).replace('<div ', '<div data-fallback="weekly" '))).includes('card-fallback'), 'with the marker, it is a card-fallback');
  assert.ok((await kinds(page, '<div style="white-space:pre-wrap">Not enough data yet.\nFull report in Notion (https://app.notion.com/p/abc)</div>')).includes('raw-markup'), 'a labelled bare link alone is enough');
}));

test('the new checks stay quiet on screens that are fine', () => withChrome(async page => {
  // icon-led rows that are separate elements (a list), a link written as a link, a sentence with an address in it, and a card
  assert.deepEqual(await kinds(page, '<ul><li>📨 Apply to 5 more jobs</li><li>📬 Answer the recruiter</li><li>🎤 Prepare Friday\'s interview</li></ul>'), []);
  assert.deepEqual(await kinds(page, '<p>Full report in <a href="https://app.notion.com/p/abc">Notion</a></p>'), []);
  assert.deepEqual(await kinds(page, '<p>Open the page (https://app.notion.com/p/abc) to see everything, then come back.</p>'), []);
  assert.deepEqual(await kinds(page, '<div class="run-card"><div class="insight-card"><h3>📊 Search analysis · last 7 days</h3><p>Not enough data yet</p><p>💡 Begin with a market search</p></div></div>'), []);
}));

test('the same type, other forms: Markdown, HTML typed out, an entity, an insight shown as text', () => withChrome(async page => {
  assert.ok((await kinds(page, '<p>**Focus next:** apply to 3 roles in Zurich</p>')).includes('raw-markup'));
  assert.ok((await kinds(page, '<p>Your &lt;b&gt;weekly&lt;/b&gt; review is ready</p>')).includes('raw-markup'));
  assert.ok((await kinds(page, '<p>Search &amp;amp; apply</p>')).includes('raw-markup'));
  assert.ok((await kinds(page, '<p>See [the job](https://boards.e2e.test/job/1)</p>')).includes('raw-markup'));
  assert.ok((await kinds(page, '<pre data-fallback="insight">Skills\nGo appears in 40%\nAdd it to your CV</pre>')).includes('card-fallback'));
  assert.ok((await kinds(page, `<div class="warn"><div>${ITEMS}</div></div><div class="warn2"><div>${ITEMS} again</div></div>`)).includes('duplicate-content'));
}));

test('a finished Search analysis opened to an empty pane is an empty-result finding (5 Oct 2026); a drawn card is not', () => withChrome(async page => {
  assert.ok((await kinds(page, '<div id="activity-panel" data-empty-result="weekly"><h2>Search analysis</h2><details><summary>Technical log</summary></details></div>')).includes('empty-result'));
  assert.ok(!(await kinds(page, '<div id="activity-panel"><h2>Search analysis</h2><div class="run-card"><div class="insight-card">The report</div></div></div>')).includes('empty-result'));
}));

test('a card whose message ran together is a card-unstructured finding (the Search analysis of 5 Oct 2026); a split one is not', () => withChrome(async page => {
  const joined = '5 interviews from 20 applications. Finding: Recruiter-sourced applications went 5 of 5. You sent 5 applications. Worked Change next week Focus Send kits. Full report in Notion (https://app.notion.com/p/abc)';
  assert.ok((await kinds(page, `<div class="run-card"><div class="insight-card"><h3>Last 7 days</h3><p>${joined}</p></div></div>`)).includes('card-unstructured'));
  assert.ok(!(await kinds(page, '<div class="run-card"><div class="insight-card"><h3>5 interviews from 20 applications</h3><p>You sent 5 applications.</p><ul><li>Recruiter channel: 5 of 5</li></ul></div></div>')).includes('card-unstructured'));
}));

test('clean screens stay quiet: a card alone, a technical log, a box inside a box, two different texts', () => withChrome(async page => {
  const quiet = ['card-fallback', 'raw-markup', 'duplicate-content'];
  const of = found => found.filter(kind => quiet.includes(kind));
  assert.deepEqual(of(await kinds(page, `<div class="run-card"><div>${ITEMS}</div></div>`)), []);
  assert.deepEqual(of(await kinds(page, `<details open><pre>${DIGEST}\n**bold** &amp;</pre></details><p>4 new jobs · Finished 01:38</p>`)), []);
  assert.deepEqual(of(await kinds(page, `<div class="outer"><div class="inner">${ITEMS}</div></div>`)), []);
  assert.deepEqual(of(await kinds(page, `<div><div>${ITEMS}</div></div><div><div>Interview with Northwind on Thursday at ten: prepare the system design story, the incident review and three questions about the on-call rotation and team size</div></div>`)), []);
  assert.deepEqual(of(await kinds(page, '<p>Applied · Saved &amp; ready</p>'.replace('&amp;', '&'))), []);
}));

test('rows of one list that look alike are not duplicates; a box printed twice outside a list still is (#288)', () => withChrome(async page => {
  const row = text => `<div class="job-card"><div class="role">${text}</div></div>`;
  const alike = 'Senior Infrastructure Engineer Kubernetes New E2E Acme Zurich Switzerland hybrid platform reliability on-call terraform observability';
  assert.ok(!(await kinds(page, [row(alike), row(`${alike} Berlin`), row(`${alike} Basel`)].join(''))).includes('duplicate-content'), 'three rows of the same class');
  assert.ok((await kinds(page, `<div class="warn"><div>${ITEMS}</div></div><div class="warn2"><div>${ITEMS} again</div></div>`)).includes('duplicate-content'), 'two boxes of different classes, still caught');
}));

test('with the Recent activity panel open, the page behind it is not compared with the panel (#284)', () => withChrome(async page => {
  const behind = `<section class="card actions-result">${ITEMS}</section>`;
  assert.ok((await kinds(page, `${behind}<div class="other-box">${ITEMS} again</div>`)).includes('duplicate-content'), 'no panel: two boxes in sight are compared');
  assert.ok(!(await kinds(page, `${behind}<div id="activity-panel"><pre id="activity-message">${ITEMS}</pre></div>`)).includes('duplicate-content'), 'panel open: the page behind it is not what is read');
}));

test('technical text inside an on-purpose log is not shown to the person; the same text in plain view still is (#298)', () => withChrome(async page => {
  const trace = 'Traceback (most recent call last): RuntimeError: Forbidden: bot was blocked by the user';
  assert.ok(!(await kinds(page, `<div id="activity-panel"><h2>Jobs check</h2><p>Not delivered: Telegram blocked the bot.</p><details open><summary>Full log</summary><pre>${trace}</pre></details></div>`)).includes('error-shown'), 'a log folded in details');
  assert.ok(!(await kinds(page, `<div id="activity-panel"><h2>Jobs check</h2><div class="tech-log">${trace}</div></div>`)).includes('error-shown'), 'a block marked technical');
  assert.ok((await kinds(page, `<div id="activity-panel"><h2>Jobs check</h2><p>${trace}</p></div>`)).includes('error-shown'), 'the same words in a plain paragraph');
}));

// #404-#409 (12 Oct 2026): one raw API error was filed six times, as div.view, div.settings-layout and div.settings-pages (each container's whole text was read,
// hidden parts included), and the element that held it was never named. The finding names the element that holds the words, once, and only what a person can see.
test('technical text is one finding naming the element that holds it, never its containers; hidden text is not shown to anyone', () => withChrome(async page => {
  const raw = 'Couldn\'t read your CV: 400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low."},"request_id":"req_1"}.';
  const nested = level => `<div class="settings-layout">\n  <nav>Overview Profile</nav>\n  <div class="settings-pages">\n    <div class="panel"><h3>Your details</h3>\n      ${level}\n    </div>\n  </div>\n</div>`;
  const shown = await findings(page, `<section class="view" data-view="jobs">${nested(`<p id="contact-panel-message" class="message">${raw}</p>`)}</section>`);
  const hits = shown.filter(item => item.kind === 'error-shown');
  assert.equal(hits.length, 1, JSON.stringify(hits));
  assert.match(hits[0].detail, /^p#contact-panel-message\.message shows technical text/);
  const hidden = await findings(page, `<section class="view" data-view="jobs">${nested(`<div class="save-bar" hidden><span id="contact-message" class="message">${raw}</span></div>`)}</section>`);
  assert.deepEqual(hidden.filter(item => item.kind === 'error-shown'), [], 'text in a hidden bar is shown to no one (a press that answers there is the probe\'s silent-control)');
  const split = await findings(page, `<section class="view" data-view="jobs">${nested('<p id="split" class="message">Not saved: Error code: <b>429</b></p>')}</section>`);
  assert.deepEqual(split.filter(item => item.kind === 'error-shown').map(item => item.detail.split(' ')[0]), ['p#split.message'], 'words split over two elements are still one finding, on the element that holds them all');
}));

test('a result card and the run\'s own open log say the same words on purpose and are not a duplicate (#282, #283); two plain boxes still are', () => withChrome(async page => {
  const card = `<div class="run-card">${ITEMS}</div>`;
  assert.ok(!(await kinds(page, `${card}<pre id="log" class="log">${ITEMS}</pre>`)).includes('duplicate-content'), 'the log');
  assert.ok(!(await kinds(page, `${card}<details open><summary>Full log</summary><pre class="log">${ITEMS}</pre></details>`)).includes('duplicate-content'), 'a log in details');
  assert.ok((await kinds(page, `<div class="warn"><div>${ITEMS}</div></div><div class="warn2"><div>${ITEMS} again</div></div>`)).includes('duplicate-content'), 'plain boxes');
}));

// Icons alone only on secondary buttons (owner, 18 Oct 2026: "let's leave icons only for secondary buttons"): a primary with no words is flagged on any view;
// a primary with words (and an icon) and an icon-only secondary are not.
test('a primary button with only an icon is flagged; with its words, or a secondary icon button, it is not', () => withChrome(async page => {
  const svg = '<svg width="16" height="16" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6"/></svg>';
  assert.ok((await kinds(page, `<button class="primary" aria-label="Fill now" title="Fill now">${svg}</button>`)).includes('icon-only-primary'));
  assert.ok(!(await kinds(page, `<button class="primary with-icon">${svg}<span>Fill now</span></button>`)).includes('icon-only-primary'));
  assert.ok(!(await kinds(page, `<button class="secondary icon-btn" aria-label="Done" title="Done: delete it">${svg}</button>`)).includes('icon-only-primary'));
}));
