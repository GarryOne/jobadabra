/* global document */
// Integration test (layer 1, owner 1 Nov 2026: "beta = only the critical journeys; the others run separately"): "Read the jobs on this page" on recorded fixture pages.
// The extension's own page functions (extension/visit.js and visit-page.js: extractPage, goNext, collectControls ... as they run inside a page) in a real Chromium on
// fixtures/visits, then the engine's reader (src/sources/visits.py) on what they sent. No app, no Notion, no AI, no outside site: every page is served from this machine
// and Claude's answers are stand-ins (the engine code that validates them is the real one). Moved here from the visitread e2e suite; only its bot-check step stays in e2e
// (a safety journey). What it does not cover: the popup click and Chrome's access prompt.
// Why this folder (1 Nov 2026, owner: integration tests live in desktop/integration/<layer>/): CI · Harness tests (npm test in desktop/e2e) runs ../integration/extension/*.test.mjs with the full Chromium on a PR that touches extension/, src/ or desktop/.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {after, before, test} from 'node:test';
import {python, pythonEnv} from '../../e2e/lib/python.mjs';
import {anonymous, call, callWith, launchChromium, repo, serveFixtures} from '../../e2e/lib/visit-page.mjs';

// The engine's Python on a one-off script (isolated environment: lib/python.mjs). The last stdout line is the JSON answer.
const engine = (script, ...args) => JSON.parse(execFileSync(python(), ['-c', script, ...args], {cwd: repo, encoding: 'utf8', env: pythonEnv({JOB_PILOTTO_FOLLOW_APP: '0'})}).trim().split('\n').pop());

let server, browser, base;
before(async () => {
  ({server, base} = await serveFixtures());
  browser = await launchChromium();
});
after(async () => {
  await browser?.close();
  await new Promise(done => (server ? server.close(done) : done()));
});

// Each test gets its own tab, closed at its end: no state from an earlier test.
const withPage = fnTest => async () => {
  const page = await browser.newPage();
  try { await fnTest(page); } finally { await page.close(); }
};

test('the extension reads a list page as you see it: each card\'s title, address and visible lines', withPage(async page => {
  await page.goto(`${base}/list-1.html`);
  const seen = await call(page, 'extractPage');
  assert.deepEqual(seen.cards.map(card => card.title), ['Photographe de mode', 'Assistant photographe'], 'the menu link must not count');
  assert.ok(seen.cards[0].lines.includes('Studio Lumière'), `card lines ${JSON.stringify(seen.cards[0].lines)}`);
  assert.ok(!seen.challenge && !seen.login);
}));

test('it goes to the next page of the same list, reads it, and finds no page after the last', withPage(async page => {
  await page.goto(`${base}/list-1.html`);
  const how = await call(page, 'goNext');
  assert.ok(how === 'next link' || how === 'next button', `went on by "${how}"`);
  await page.waitForURL(/list-2\.html/);
  assert.equal((await call(page, 'extractPage')).cards.length, 2, 'cards on page 2');
  assert.equal(await call(page, 'goNext'), 'none', 'after the last page it must not go on');
}));

test('filters: the page\'s own controls are listed for Claude, never Easy Apply, Sign in or Save; only its place step is kept and applied, a forbidden one refused', withPage(async page => {
  await page.goto(`${base}/filters.html`);
  const controls = await call(page, 'collectControls');
  const labels = controls.map(control => control.label);
  assert.ok(!labels.some(label => /easy apply|sign in|save/i.test(label)), `a forbidden control was listed: ${JSON.stringify(labels)}`);
  const when = controls.find(control => /date posted/i.test(control.label));
  const remote = controls.find(control => /remote/i.test(control.label));
  const where = controls.find(control => /city/i.test(control.label));
  assert.ok(when && remote && where && when.options.includes('Past week'), `controls ${JSON.stringify(controls)}`);
  // What the engine keeps of Claude's answer (src/ai/visit_filters.py, with a stand-in for the model): only listed controls, and since 4af2670 (owner, 7 Oct
  // 2026: "filter only by location") only steps for the place: a date step ("for": "other") and an unlisted control are dropped.
  const planned = engine(`import json, sys
from types import SimpleNamespace
from src.ai import visit_filters
controls = json.loads(sys.argv[1])
answer = {'why': 'Geneva', 'steps': [{'control': sys.argv[2], 'action': 'select', 'value': 'Past week', 'for': 'other'}, {'control': sys.argv[3], 'action': 'type', 'value': 'Genève', 'for': 'place'},
  {'control': 'easy', 'action': 'click', 'value': '', 'for': 'place'}]}
client = SimpleNamespace(messages=SimpleNamespace(create=lambda **k: SimpleNamespace(content=[SimpleNamespace(type='text', text=json.dumps(answer))], usage=SimpleNamespace(input_tokens=1, output_tokens=1))))
print(json.dumps(visit_filters.plan({'url': 'https://x', 'title': 't', 'controls': controls}, {'role_keywords': ['photographe'], 'locations': {'top_tier': ['Genève']}}, client=client)))`, JSON.stringify(controls), when.id, where.id);
  assert.ok(planned.steps.length === 1 && planned.steps[0].value === 'Genève', `the engine kept ${JSON.stringify(planned.steps)}: only the place step, never a date step or an unlisted control`);
  await page.evaluate(() => { document.getElementById('easy').dataset.jpControl = 'sneaky'; });
  const done = await callWith(page, 'applyFilters', [...planned.steps, {control: 'sneaky', action: 'click', value: ''}]);
  const state = await page.evaluate(() => ({when: document.getElementById('when').value, where: document.getElementById('where').value, applied: document.body.dataset.applied || ''}));
  assert.equal(state.where, 'Genève', `the place filter was not set: ${JSON.stringify(state)}`);
  assert.notEqual(state.when, 'Past week', 'a date filter was set: only the place is filtered (4af2670)');
  assert.ok(!state.applied && !done.at(-1).ok, 'Easy Apply was pressed: it must be refused even when asked');
}));

test('filters: a place typed in a suggest box is picked from its suggestions before the search is sent (Van Cleef, 7 Oct 2026)', withPage(async page => {
  await page.goto(`${base}/combobox.html`);
  const box = (await call(page, 'collectControls')).find(control => control.label === 'Location');
  assert.ok(box, 'the suggest box was not listed');
  const done = await callWith(page, 'applyFilters', [{control: box.id, action: 'type', value: 'geneva'}]);
  const searched = await page.evaluate(() => document.body.dataset.searched);
  assert.ok(done[0]?.picked === 'Geneva' && searched === 'Geneva', `picked ${JSON.stringify(done)}, the form sent ${searched}: typed text alone filters nothing`);
}));

test('filters: a plain box with its own suggestion list gets its place picked too, never a link already on the page (7 Oct 2026)', withPage(async page => {
  await page.goto(`${base}/plainsuggest.html`);
  const box = (await call(page, 'collectControls')).find(control => control.label === 'City');
  assert.ok(box, 'the box was not listed');
  const done = await callWith(page, 'applyFilters', [{control: box.id, action: 'type', value: 'Geneva'}]);
  const state = await page.evaluate(() => ({searched: document.body.dataset.searched, office: document.body.dataset.office || ''}));
  assert.ok(done[0]?.picked === 'Geneva' && state.searched === 'Geneva' && !state.office, `picked ${JSON.stringify(done)}, page ${JSON.stringify(state)}`);
}));

test('a link whose address is template code (DHL, 7 Oct 2026) is never offered to Claude nor followed as the next page', withPage(async page => {
  await page.goto(`${base}/unstick.html`);
  await page.evaluate("document.querySelector('nav').insertAdjacentHTML('afterbegin', '<a href=\\'/global/${getUrl(linkEle,\\' onclick=\\'document.body.dataset.broken = 1; return false\\'>Next</a>')");
  const href = await page.evaluate("document.querySelector('nav a').getAttribute('href')");
  assert.ok(href.includes('${getUrl'), `the planted link is ${href}`);
  const ways = await call(page, 'collectWays');
  assert.ok(!ways.ways.some(way => way.href.includes('getUrl') || way.href.includes('%7BgetUrl')), `offered: ${JSON.stringify(ways.ways.map(way => way.href))}`);
  await call(page, 'goNext');
  assert.ok(!(await page.evaluate('document.body.dataset.broken')), 'the template link was clicked as the next page');
}));

test('one posting: its main text is read for "Jobs we couldn\'t read", without the menu or footer; a sign-in page sends only why', withPage(async page => {
  await page.goto(`${base}/posting.html`);
  const read = await call(page, 'postingText');
  assert.ok(!read.blocked && read.text.startsWith('Client Advisor') && read.text.includes('Mandarin a plus') && !/All jobs|Imprint/.test(read.text) && read.title === 'Client Advisor - Geneva | Maison', `read ${JSON.stringify(read).slice(0, 400)}`);
  await page.goto(`${base}/posting-login.html`);
  const login = await call(page, 'postingText');
  assert.ok(login.blocked === 'login' && !login.text, `sign-in page ${JSON.stringify(login)}`);
}));

test('a job list drawn in a frame by another site is found (not the cookie or video frame), and resetting the filters is never a way on (7 Oct 2026)', withPage(async page => {
  await page.route('https://**/*', route => route.fulfill({status: 200, contentType: 'text/html', body: '<html><body>framed</body></html>'}));
  await page.goto(`${base}/framed.html`);
  const frame = await call(page, 'jobFrame');
  await page.unroute('https://**/*');
  assert.equal(frame, 'https://jobs.solique.example/maison/de/');
  const labels = (await call(page, 'collectWays')).ways.map(way => way.label);
  assert.ok(!labels.some(label => /zurücksetzen/.test(label)) && labels.includes('Weitere Stellen'), `ways ${JSON.stringify(labels)}`);
}));

test('filters: a place typed in English is picked in the site\'s own spelling ("geneva" -> "Genève (GE)", Decathlon, 8 Oct 2026)', withPage(async page => {
  await page.goto(`${base}/frenchsuggest.html`);
  const box = (await call(page, 'collectControls')).find(control => /Région/.test(control.label));
  assert.ok(box, 'the box was not listed');
  const done = await callWith(page, 'applyFilters', [{control: box.id, action: 'type', value: 'geneva'}]);
  const searched = await page.evaluate(() => document.body.dataset.searched);
  assert.ok(done[0]?.picked === 'Genève (GE)' && searched === 'Genève (GE)', `picked ${JSON.stringify(done)}, sent ${searched}`);
}));

test('any site: where the quick guess reads nothing, Claude\'s recipe from the page outline reads the jobs and finds the next page', withPage(async page => {
  await page.goto(`${base}/odd.html`);
  assert.equal((await call(page, 'extractPage')).cards.length, 0, 'this page must need the adaptive path');
  const outline = await call(page, 'pageOutline');
  const tiles = outline.groups.find(group => /tile/.test(group.selector));
  assert.ok(tiles && outline.pager.some(item => item.label === '→ Suivante'), `outline ${JSON.stringify(outline).slice(0, 400)}`);
  // Claude's answer stands in here; what the engine keeps of it is the real code (src/ai/visit_reader.py).
  const recipe = engine(`import json, sys
from types import SimpleNamespace
from src.ai import visit_reader
outline = json.loads(sys.argv[1])
answer = {'group': sys.argv[2], 'title': -1, 'company': 1, 'place': 2, 'link': 0, 'next': '→ Suivante', 'why': 'tiles'}
reply = SimpleNamespace(content=[SimpleNamespace(type='text', text=json.dumps(answer))], usage=SimpleNamespace(input_tokens=1, output_tokens=1))
print(json.dumps(visit_reader.understand(outline, SimpleNamespace(messages=SimpleNamespace(create=lambda **k: reply)))))`, JSON.stringify(outline), tiles.id);
  const cards = await callWith(page, 'cardsByRecipe', recipe);
  assert.equal(cards.map(card => card.title).join('|'), 'Vendeuse confirmée|Conseiller de vente horlogerie|Photographe produit e-shop');
  assert.equal(cards[1].lines[1], 'Boutique Lac');
  assert.equal(await callWith(page, 'nextByRecipe', recipe), 'recipe', 'the next page was not reached by the recipe');
  await page.waitForURL(/odd-2\.html/);
  assert.equal((await callWith(page, 'cardsByRecipe', recipe)).length, 3, 'cards on page 2 by the same recipe');
}));

test('a home page is not a job list: the quick guess says so, and the engine finds the job list from its own links', withPage(async page => {
  await page.goto(`${base}/home.html`);
  const seen = await call(page, 'extractPage');
  const plausible = await callWith(page, 'plausible', seen.cards);
  assert.ok(!plausible, `the home page looked like a job list: ${JSON.stringify(seen.cards)}`);
  const found = engine(`import json, sys, tempfile, pathlib
from unittest import mock
from src.sources import visits
with mock.patch.object(visits, 'STORE', pathlib.Path(tempfile.mkdtemp()) / 'v.json'):
    print(json.dumps(visits.job_page(sys.argv[1], sys.argv[2])))`, seen.url.replace('127.0.0.1', 'maison-rive.example'), seen.html);
  assert.match(found || '', /\/joboffers\/en$/, `found ${found}, the Careers link expected`);
}));

test('a cookie banner over the list is closed with the least consent offered ("Reject all", not "Accept all"), a sign-in box never touched', withPage(async page => {
  await page.goto(`${base}/consent.html`);
  assert.ok(await page.isVisible('#cookie-banner'), 'the fixture\'s banner is not showing: the test would prove nothing');
  const pressed = await call(page, 'closeConsent');
  const state = await page.evaluate('({choice: window.choice || null, signin: !!window.pressedSignIn, banner: !!document.querySelector("#cookie-banner")})');
  assert.ok(pressed === 'Reject all' && state.choice === 'reject' && !state.banner, `pressed "${pressed}", page ${JSON.stringify(state)}`);
  assert.ok(!state.signin, 'a box with a password field was pressed');
  assert.ok(!(await call(page, 'closeConsent')), 'a second call pressed something on a page with no banner left');
}));

test('a consent message drawn in an iframe is closed from inside the frame, with the least consent', withPage(async page => {
  await page.goto(`${base}/consent-frame.html`);
  const frame = page.frames().find(each => each !== page.mainFrame());
  assert.ok(frame && await frame.isVisible('text=Reject all'), 'the fixture\'s framed banner is not showing: the test would prove nothing');
  assert.ok(!(await call(page, 'closeConsent')), 'the main page pressed something: the banner is in the frame');
  const pressed = await frame.evaluate(`(${anonymous('closeConsent')})()`);
  const choice = await page.evaluate('window.choice || null');
  assert.ok(pressed === 'Reject all' && choice === 'reject', `pressed "${pressed}" in the frame, choice ${choice}`);
}));

test('a page that draws nothing is seen as blank (said and stopped, not skipped as silent); a list page is not', withPage(async page => {
  await page.goto(`${base}/blank.html`);
  assert.ok((await call(page, 'extractPage')).blank, 'the blank page was not seen as blank');
  await page.goto(`${base}/list-1.html`);
  assert.ok(!(await call(page, 'extractPage')).blank, 'a list page was taken for blank');
}));

test('a page with no job list yet lists its ways on for Claude (never Sign in); the step Claude picks shows the jobs', withPage(async page => {
  await page.goto(`${base}/unstick.html`);
  assert.equal((await call(page, 'extractPage')).cards.length, 0, 'the fixture already shows jobs: the test would prove nothing');
  const found = await call(page, 'collectWays');
  const labels = found.ways.map(way => way.label);
  assert.ok(labels.includes('See all jobs') && !labels.includes('Sign in'), `ways ${JSON.stringify(labels)}`);
  assert.ok(found.text.includes('Discover our open positions'), 'the page\'s first lines are missing');
  const see = found.ways.find(way => way.label === 'See all jobs');
  const done = await callWith(page, 'applyFilters', [{control: see.id, action: 'click', value: ''}]);
  const after = await call(page, 'extractPage');
  assert.ok(done[0]?.ok && after.cards.length === 3, `step ${JSON.stringify(done)}, then ${after.cards.length} jobs`);
}));

test('a second round of ways on never gives one id to two elements: the step Claude names is the one clicked (Fust, 7 Oct 2026)', withPage(async page => {
  await page.goto(`${base}/unstick.html`);
  await call(page, 'collectControls');
  await call(page, 'collectWays');
  await page.evaluate("document.querySelector('nav').insertAdjacentHTML('afterbegin', '<a href=\\'/occasionen\\'>Occasionen</a>')");   // the page changed between rounds
  const second = await call(page, 'collectWays');
  const ids = await page.evaluate("[...document.querySelectorAll('[data-jp-control]')].map(node => node.dataset.jpControl)");
  assert.equal(new Set(ids).size, ids.length, `ids given twice: ${JSON.stringify(ids)}`);
  const see = second.ways.find(way => way.label === 'See all jobs');
  assert.equal(await page.evaluate(`document.querySelector('[data-jp-control="${see.id}"]').innerText`), 'See all jobs', `id ${see.id} names another element`);
}));

test('the engine keeps the pages of one visit as one feed (three jobs, each with its own employer and place, no duplicate) and reads the job data of an employer page without fetching', withPage(async page => {
  const pages = [];
  for (const file of ['list-1.html', 'list-2.html']) { await page.goto(`${base}/${file}`); pages.push(await call(page, 'extractPage')); }
  await page.goto(`${base}/employer.html`);
  const employer = await call(page, 'extractPage');
  const store = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-visitread-')), 'visits.json');
  const result = engine(`import json, sys
from unittest import mock
from pathlib import Path
from src.sources import visits, ats
pages, employer, store = json.loads(sys.argv[1]), json.loads(sys.argv[2]), sys.argv[3]
with mock.patch.object(visits, 'STORE', Path(store)), mock.patch.object(visits.careers, 'get_text', side_effect=AssertionError('fetched')):
    results = [visits.read(p['url'].replace('127.0.0.1', 'portal.example'), p['html'], p['cards'], p['title'], session='s1') for p in pages]
    jobs = ats.FETCHERS['visit'](results[-1]['feed'])
    own = visits.read(employer['url'].replace('127.0.0.1', 'jobs.example'), employer['html'], employer['cards'], employer['title'])
print(json.dumps({'added': [r['added'] for r in results], 'jobs': [[j['title'], j.get('employer'), j['location']] for j in jobs],
                  'own': [[j['title'], j['location']] for j in own['jobs']]}))`, JSON.stringify(pages), JSON.stringify(employer), store);
  assert.deepEqual(result.added, [2, 1], `new per page ${JSON.stringify(result.added)}, expected 2 then 1 (one card repeats)`);
  const byTitle = Object.fromEntries(result.jobs.map(([title, company, place]) => [title, [company, place]]));
  assert.ok(byTitle['Retoucheur photo']?.[0] === 'Maison Rive' && /Lausanne/.test(byTitle['Retoucheur photo']?.[1] || ''), `employer and place: ${JSON.stringify(byTitle)}`);
  assert.equal(result.own[0]?.[0], 'Photographe produit', `the employer page's job data: ${JSON.stringify(result.own)}`);
}));
