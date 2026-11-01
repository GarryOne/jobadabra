// The privacy tripwire (lib/privacy-tripwire.mjs; owner's rule: tests never touch the owner's real data; 11 Oct 2026: the plan's claude -p carries the signed-in
// account, and a held fill on a real site typed the owner's first name, guessed from the account e-mail, into the fake applicant's form). After every held fill of a
// live run, what the page holds in its fields is compared with the owner's own values (his app's profile and answers, the Claude account e-mail and the name words in
// it); a match fails the run and deletes what it saved (capture, candidate, evidence). Values are compared on this Mac and never printed: only kinds and field labels.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import {appProfileTexts} from '../../lib/capture-page.mjs';
import {coverage, coverageLine, matchesOwner, ownerValues, pageFields, tripwire} from '../../lib/privacy-tripwire.mjs';

const E2E = path.resolve(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), '..');
// An invented owner (never the real one): what his app's files and his Claude account would give.
const OWNER = ownerValues({texts: ['# Profile\nName: Ana Maria Popescu\nEmail: ana.popescu@gmail.com\nPhone: +41 79 555 12 34'], accountEmail: 'anapopescu88@gmail.com'});

test('the owner\'s values: profile emails, phone digits, name words, and the account e-mail with the name words read off it', () => {
  const kinds = [...OWNER.values()];
  assert.ok(kinds.includes('email') && kinds.includes('phone') && kinds.includes('name') && kinds.includes('account'));
  assert.ok(OWNER.has('anapopescu88@gmail.com'), 'the account e-mail itself');
  assert.ok([...OWNER.keys()].some(value => value === 'anapopescu'), 'the name read off the account e-mail (letters only, 3+)');
});

test('a typed value that is the owner\'s is caught, whatever the field; the fake applicant\'s are not; only kinds and labels come back', () => {
  const typed = [
    {label: 'First name', value: 'Test'}, {label: 'Last name', value: 'Candidate'}, {label: 'Email', value: 'test.candidate@example.com'},
    {label: 'Preferred name', value: 'Ana'}, {label: 'Contact email', value: 'ANA.POPESCU@gmail.com'}, {label: 'Mobile', value: '079 555 12 34'},
    {label: 'Cover note', value: 'Hello, I am anapopescu88@gmail.com'}, {label: 'City', value: 'Anaheim'},
  ];
  const found = matchesOwner(typed, OWNER);
  assert.deepEqual(found.map(hit => hit.label).sort(), ['Contact email', 'Cover note', 'Mobile', 'Preferred name']);
  assert.ok(found.every(hit => Object.keys(hit).sort().join() === 'kind,label'), 'never the value');
  assert.deepEqual(matchesOwner(typed.slice(0, 3), OWNER), [], 'the fake applicant passes');
});

test('a match fails the run, deletes what it saved, and says which kinds in which fields without a value', async () => {
  const saved = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-tripwire-')), candidate = path.join(saved, 'candidate'), evidence = path.join(saved, 'evidence');
  for (const dir of [candidate, evidence]) { fs.mkdirSync(dir); fs.writeFileSync(path.join(dir, 'page.html'), '<p>x</p>'); }
  const page = {typed: async () => [{label: 'Preferred name', value: 'Ana'}]};
  const result = await tripwire(page, {values: OWNER, saved: [candidate, evidence]});
  assert.equal(result.ok, false);
  assert.match(result.reason, /privacy tripwire: name typed into "Preferred name"/);
  assert.doesNotMatch(result.reason, /Ana\b/);
  assert.equal(fs.existsSync(candidate) || fs.existsSync(evidence), false, 'the run\'s saved files are gone');
  const clean = await tripwire({typed: async () => [{label: 'First name', value: 'Test'}]}, {values: OWNER, saved: [saved]});
  assert.equal(clean.ok, true);
  assert.equal(fs.existsSync(saved), true, 'a clean run keeps its files');
});

test('without the owner\'s values (a CI runner, a fresh Mac) the tripwire still runs on the account e-mail, and says what it checked', () => {
  const none = ownerValues({texts: [], accountEmail: ''});
  assert.equal(none.size, 0);
  assert.ok(ownerValues({texts: [], accountEmail: 'x.y@example.org'}).size >= 1);
});

// 12 Oct 2026: with no profile sent, a plan-path model typed the account holder's country and city (from the signed-in account) into a test form; the tripwire
// knew only names, e-mails and phones. Its location comes from the same files (a "Location:", "City:", "Country:", "Street:" line), all invented here.
const PLACED = ownerValues({texts: ['## Contact details\n- Full name: Zorana Vrabcova\n- Location: Port Vale, Atlantis\n- Street: 12 Harbour Lane'], accountEmail: ''});

test('the owner\'s location is caught in any field, accents and case aside, as a whole word; the fake applicant\'s place is not', () => {
  assert.ok([...PLACED.values()].includes('location'));
  const typed = [{label: 'Country', value: 'ATLÁNTIS'}, {label: 'City', value: 'Port Vale'}, {label: 'Address', value: '12 Harbour Lane, flat 3'},
    {label: 'Where are you based?', value: 'Zurich, Switzerland'}, {label: 'Ocean', value: 'Atlantic'}, {label: 'Note', value: 'Portvalet'}];
  assert.deepEqual(matchesOwner(typed, PLACED).map(hit => `${hit.kind}:${hit.label}`), ['location:Country', 'location:City', 'location:Address']);
  const sameAsFake = ownerValues({texts: ['- Location: Zurich, Switzerland'], accountEmail: ''});
  assert.deepEqual(matchesOwner([{label: 'City', value: 'Zurich'}], sameAsFake), [], 'a place the fake applicant shares is the fake\'s, not a leak');
});

test('the app\'s own contact details (draft.json) count as the owner\'s, for a person whose Profile lives in Notion', () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-tripwire-app-'));
  fs.writeFileSync(path.join(folder, 'draft.json'), JSON.stringify({draft: {contact: {full_name: 'Zorana Vrabcova', email: 'zv@stand-in.test', phone: '+99 555 010 2030', location: 'Port Vale, Atlantis'}}}));
  const values = ownerValues({texts: appProfileTexts([folder]), accountEmail: ''});
  assert.deepEqual([...new Set(values.values())].sort(), ['email', 'location', 'name', 'phone']);
  assert.equal(matchesOwner([{label: 'Country', value: 'Atlantis'}], values).length, 1);
  // The imported CV: its location and each job's "city, country" place; a one-part place (a work mode) is not read. The Profile's "Home base" row is.
  fs.mkdirSync(path.join(folder, 'cv'));
  fs.writeFileSync(path.join(folder, 'cv', 'cv.json'), JSON.stringify({name: 'Zorana Vrabcova', location: 'Lumen', jobs: [{company: 'X', roles: [{place: 'Old Harbour, Borduria'}, {place: 'Remote'}]}]}));
  const withCv = ownerValues({texts: [...appProfileTexts([folder]), '| Home base | Glimmer; open to relocating |\n| Countries | Syldavia (anywhere) |'], accountEmail: ''});
  for (const place of ['Old Harbour', 'Borduria', 'Glimmer']) assert.equal(matchesOwner([{label: 'Where', value: place}], withCv).length, 1, `${place}: a place of the person's`);
  for (const value of ['Remote', 'Syldavia', 'Lumen']) assert.equal(matchesOwner([{label: 'Where', value}], withCv).length, value === 'Lumen' ? 1 : 0, `${value}`);
});

test('the tripwire says what it checks and what it could not find: a missing location is said, never a silent "clean"', async () => {
  assert.match(coverageLine(PLACED), /^privacy tripwire: checks name, location; NOT FOUND on this computer: email, phone$/);
  assert.match(coverageLine(OWNER), /checks .*name.*; NOT FOUND on this computer: location/);
  const result = await tripwire({typed: async () => [{label: 'First name', value: 'Test'}]}, {values: OWNER});
  assert.deepEqual([result.ok, result.missing], [true, ['location']]);
  for (const file of ['lib/apply-live.mjs', 'lib/live-row.mjs']) assert.match(fs.readFileSync(path.join(E2E, file), 'utf8'), /coverageLine\(owner\)/, `${file} says what its tripwire checks`);
});

// Every live run goes through runLive (lib/apply-live.mjs), which calls the tripwire after its held fill; anything else that opens a live posting must go through it.
// Left out on purpose: twin.mjs (the owner's own twin app: his real details are its point, docs/live-test.md); lib/page-replay.mjs and lib/row-replay.mjs (offline:
// fake pages and the fake applicant, no real site).
test('every live run passes the tripwire: runLive calls it, and every opener of a live posting goes through runLive', () => {
  const files = ['', 'lib', 'suites'].flatMap(dir => fs.readdirSync(path.join(E2E, dir)).filter(f => f.endsWith('.mjs')).map(f => (dir ? `${dir}/${f}` : f)));
  const text = file => fs.readFileSync(path.join(E2E, file), 'utf8');
  assert.match(text('lib/apply-live.mjs'), /tripwire\(/, 'runLive does not call the tripwire');
  const openers = files.filter(f => /livePosting\(/.test(text(f)) && !['lib/live-posting.mjs', 'lib/apply-live.mjs'].includes(f));
  for (const file of openers) assert.match(text(file), /runLive\(/, `${file} opens a live posting without runLive (the tripwire)`);
});

let chromium = null;
try { ({chromium} = await import('playwright-core')); if (!fs.existsSync(chromium.executablePath())) chromium = null; } catch { /* no playwright */ }

test('in a real page: fields in the page, a shadow root and a frame are read and cleared; a password field is never read', {skip: !chromium && 'no Chromium'}, async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.route('https://jobs.example.org/**', route => route.fulfill({contentType: 'text/html', body: route.request().url().endsWith('/frame')
      ? '<label for="c">City of birth</label><input id="c" value="Popescu town">'
      : `<label for="f">First name</label><input id="f" value="Test"><label for="n">Preferred name</label><input id="n" value="Ana">
         <label for="p">Password</label><input id="p" type="password" value="Ana">
         <div id="host"></div><iframe src="https://jobs.example.org/frame"></iframe>
         <script>document.getElementById('host').attachShadow({mode: 'open'}).innerHTML = '<input aria-label="Contact email" value="ana.popescu@gmail.com">';</script>`}));
    await page.goto('https://jobs.example.org/apply');
    await page.frames()[1]?.waitForLoadState().catch(() => {});
    const result = await tripwire(pageFields(page), {values: OWNER});
    assert.equal(result.ok, false);
    for (const label of ['Preferred name', 'Contact email', 'City of birth']) assert.match(result.reason, new RegExp(`"${label}"`));
    assert.doesNotMatch(result.reason, /Password/, 'a password field is never read');
    const after = await tripwire(pageFields(page), {values: OWNER});
    assert.equal(after.ok, true, `cleared: ${after.reason || ''}`);
    assert.equal(await page.inputValue('#f'), 'Test', 'the fake applicant\'s value stays');
  } finally { await browser.close(); }
});

// 11 Oct 2026: the end-of-run picture (LIVE_CAPTURE_DIR/end.png) keeps on disk what a text scan cannot see: a hit deletes it with the capture folder, and the reason says so.
test('a match deletes the end-of-run screenshot with the capture folder and says screenshots went', async () => {
  const capture = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-tripwire-'));
  fs.writeFileSync(path.join(capture, 'end.png'), 'png bytes');
  const page = {typed: async () => [{label: 'Preferred name', value: 'Ana'}]};
  const result = await tripwire(page, {values: OWNER, saved: [capture]});
  assert.equal(result.ok, false);
  assert.equal(fs.existsSync(path.join(capture, 'end.png')), false);
  assert.match(result.reason, /screenshots/);
});

// 15 Oct 2026: a Mac whose profile e-mail IS the signed-in account's printed "NOT FOUND on this computer: email" while the address was checked (stored as kind 'account'). The value
// is the same, so the kind stays 'email'; and a different account e-mail still adds its own 'account'.
test('the profile e-mail that is also the account e-mail is reported as checked, and is still matched', () => {
  const same = ownerValues({texts: ['Email: ana.popescu@gmail.com\nName: Ana Popescu'], accountEmail: 'ana.popescu@gmail.com'});
  assert.equal(same.get('ana.popescu@gmail.com'), 'email');
  assert.ok(!coverage(same).missing.includes('email'), coverageLine(same));
  assert.equal(matchesOwner([{label: 'Contact', value: 'Ana.Popescu@gmail.com'}], same).length > 0, true, 'still a hit');
  const apart = ownerValues({texts: ['Email: ana.popescu@gmail.com'], accountEmail: 'anapopescu88@gmail.com'});
  assert.equal(apart.get('ana.popescu@gmail.com'), 'email');
  assert.equal(apart.get('anapopescu88@gmail.com'), 'account');
  assert.ok(!coverage(ownerValues({texts: [], accountEmail: 'x.y@example.org'})).checks.includes('email'), 'an account e-mail alone is not claimed as a profile e-mail');
});

// 15 Oct 2026 (arbeitnow, a location hit with its files already deleted and no way to say where the value came from): the hit's line names the control and where the
// value came from (answer / kit / page suggestion / unknown), never the value, before the files go.
test('a hit says which control and where the value came from, never the value', async () => {
  const placed = ownerValues({texts: ['- Location: Port Vale, Atlantis'], accountEmail: ''});
  const run = (field, extra = {}) => tripwire({typed: async () => [field]}, {values: placed, ...extra});
  const asked = await run({label: 'Where are you based?', control: 'input', value: 'Port Vale'}, {answers: ['port vale']});
  assert.match(asked.reason, /location typed into "Where are you based\?" \(input, from answer\)/);
  assert.match((await run({label: 'City', control: 'input', value: 'Port Vale'}, {kit: ['Port Vale']})).reason, /\(input, from kit\)/);
  assert.match((await run({label: 'Address', control: 'autocomplete', value: 'Port Vale, Atlantis'})).reason, /\(autocomplete, from page suggestion\)/);
  assert.match((await run({label: 'City', control: 'input', value: 'Port Vale'})).reason, /\(input, from unknown\)/);
  for (const result of [asked, await run({label: 'Address', control: 'autocomplete', value: 'Port Vale'})]) assert.doesNotMatch(result.reason, /Port Vale|Atlantis/);
});

test('in a real page: a location-autocomplete that offers an IP-based suggestion is a "page suggestion"; a plain input is "unknown"', {skip: !chromium && 'no Chromium'}, async () => {
  const placed = ownerValues({texts: ['- Location: Port Vale, Atlantis'], accountEmail: ''});
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.route('https://jobs.example.org/**', route => route.fulfill({contentType: 'text/html', body: `
      <label for="a">Address (Optional)</label><input id="a" role="combobox" aria-autocomplete="list" aria-expanded="true">
      <ul id="offer"><li id="pick">Port Vale, Atlantis</li></ul>
      <label for="c">Home city</label><input id="c" value="Port Vale">
      <script>document.getElementById('pick').onclick = () => { document.getElementById('a').value = document.getElementById('pick').textContent; };</script>`}));
    await page.goto('https://jobs.example.org/apply');
    await page.click('#a'); await page.click('#pick');   // the page's own suggestion lands in the field; the extension typed nothing
    const result = await tripwire(pageFields(page), {values: placed, kit: ['Zurich, Switzerland']});
    assert.equal(result.ok, false);
    assert.match(result.reason, /location typed into "Address \(Optional\)" \(autocomplete, from page suggestion\)/);
    assert.match(result.reason, /location typed into "Home city" \(input, from unknown\)/);
    assert.doesNotMatch(result.reason, /Port Vale|Atlantis/);
  } finally { await browser.close(); }
});
