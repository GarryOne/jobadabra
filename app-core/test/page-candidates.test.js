// Numbered candidates (extension/ladder/rung3-candidates.js, rung 3): the sentences, links, buttons and addresses of a posting, found by structure only, at most 12, so the AI can answer by number.
// Shapes: Aldi (30 navigation links crowd a sketch's 20 buttons; the Apply control is in the main text), a closed notice above a working form, a press address beside an Apply button.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadJsdom, openPage } from './helpers/page.js';

const JSDOM = await loadJsdom();
const SOURCE = fs.readFileSync(new URL('../../extension/ladder/rung3-candidates.js', import.meta.url), 'utf8');   // not in PAGE_FILES yet: loaded by hand
const open = (html, url = 'https://jobs.example.ch/job/1') => { const window = openPage(JSDOM, html, { url }); window.eval(SOURCE); return window; };
const of = (html, url) => Array.from(open(html, url).__jobadabraCandidates.candidatesOf());

const NAV = Array.from({ length: 30 }, (_, i) => `<a href="/cat/${i}">Kategorie ${i}</a>`).join('');
const ALDI = `<header><nav>${NAV}</nav></header><main><h1>Filialmitarbeiter</h1><p>Wir suchen Verstärkung für unsere Filiale.</p>
  <a href="https://apply.example.net/start?token=abc123&x=1">Jetzt bewerben</a><p>Start nach Vereinbarung. Unbefristet.</p></main><footer><a href="/impressum">Impressum</a></footer>`;

test('a candidate is numbered from 1, with a kind, a short text and a position; at most 12', { skip: !JSDOM }, () => {
  const many = `<main>${Array.from({ length: 40 }, (_, i) => `<p>Sentence number ${i} of the posting.</p>`).join('')}</main>`;
  const found = of(many);
  assert.equal(found.length, 12);
  assert.deepEqual(found.map((item) => item.n), Array.from({ length: 12 }, (_, i) => i + 1));
  assert.ok(found.every((item) => ['sentence', 'link', 'button', 'email', 'phone'].includes(item.kind) && item.text.length <= 160 && ['main', 'header', 'footer', 'other'].includes(item.position)));
  assert.equal(found[0].text, 'Sentence number 0 of the posting.');
});

test('Aldi shape: the Apply link of the main text is a candidate even when 30 navigation links precede it', { skip: !JSDOM }, () => {
  const found = of(ALDI);
  const apply = found.find((item) => item.text === 'Jetzt bewerben');
  assert.ok(apply, 'the Apply link is inside the 12');
  assert.deepEqual([apply.kind, apply.host, apply.position], ['link', 'apply.example.net', 'main']);
  assert.ok(apply.n <= 4);
  assert.ok(found.filter((item) => item.position === 'header').length <= 2, 'navigation never crowds the posting out');
});

test('a link keeps its host only: no address, query string or token reaches the list', { skip: !JSDOM }, () => {
  const text = JSON.stringify(of(ALDI));
  assert.ok(!/token|abc123|\?|https?:/.test(text));
});

test('addresses and phone-shaped strings come first, with the sentence that carries them', { skip: !JSDOM }, () => {
  const found = of('<main><h1>Job</h1><p>Some text first.</p><p>Bitte senden Sie Ihre Unterlagen an jobs@example.ch oder rufen Sie +41 44 555 66 77 an.</p><p>Mehr Text.</p><a href="mailto:hr@example.ch?subject=x">Mail</a></main>');
  assert.deepEqual(found.slice(0, 2).map((item) => item.kind), ['email', 'email']);
  assert.ok(found[0].text.includes('jobs@example.ch'));
  assert.equal(found[1].text, 'hr@example.ch');   // a mailto link gives its address only, never its ?subject
  const phone = of('<main><p>Rufen Sie uns an: 044 555 66 77.</p></main>');
  assert.equal(phone[0].kind, 'phone');
});

test('closed notice above a working form: the notice sentence is a candidate, the form fields never are (no typed value read)', { skip: !JSDOM }, () => {
  const found = of('<main><h1>Advisor</h1><p>The deadline for this posting has passed, but applications are still accepted below.</p><form><label>First name <input value="Igor"></label><textarea>secret text</textarea><button type="submit">Send application</button></form></main>');
  assert.ok(found.some((item) => /deadline for this posting/.test(item.text)));
  assert.ok(found.some((item) => item.kind === 'button' && item.text === 'Send application'));
  assert.ok(!JSON.stringify(found).includes('Igor') && !JSON.stringify(found).includes('secret text'));
});

test('a press address beside an Apply button: both are candidates, and the AI chooses', { skip: !JSDOM }, () => {
  const found = of('<main><h1>Logistik</h1><p>Presseanfragen bitte an presse@example.ch.</p><button type="button">Jetzt bewerben</button></main>');
  assert.ok(found.some((item) => item.kind === 'email' && item.text.includes('presse@example.ch')));
  assert.ok(found.some((item) => item.kind === 'button' && item.text === 'Jetzt bewerben'));
});

test('hidden text, scripts and a page without <main> (the body is the main) are handled', { skip: !JSDOM }, () => {
  const found = of('<p>Visible sentence about the job.</p><p hidden>Hidden sentence nobody sees.</p><script>var x = "a@b.example.org";</script><div style="display:none"><p>Also hidden.</p></div>');
  assert.deepEqual(found.map((item) => item.text), ['Visible sentence about the job.']);
  assert.equal(found[0].position, 'main');
});

test('the same sentence is listed once; a long sentence is cut to 160 characters', { skip: !JSDOM }, () => {
  const found = of(`<main><p>Same line.</p><p>Same line.</p><p>${'word '.repeat(80)}</p></main>`);
  assert.equal(found.filter((item) => item.text === 'Same line.').length, 1);
  assert.ok(found.every((item) => item.text.length <= 160));
});

test('arbeitnow shape: breadcrumb and menu links of the same site do not crowd out an external Apply link or a button', { skip: !JSDOM }, () => {
  const menu = `<ul>${Array.from({ length: 8 }, (_, i) => `<li><a href="/c/${i}">Category ${i}</a></li>`).join('')}</ul>`;
  const crumbs = '<p><a href="/">Home</a> | <a href="/co">Company</a> | <a href="/job">Job</a></p>';
  const found = of(`<main>${menu}${crumbs}<h1>Accountant</h1><p>We are hiring.</p><a href="https://employer.example.org/apply/1?t=1">Apply Now</a><button type="button">Save</button></main>`);
  const actions = found.filter((item) => item.kind === 'link' || item.kind === 'button');
  assert.ok(actions.slice(0, 4).some((item) => item.text === 'Apply Now' && item.host === 'employer.example.org'), 'the external link is among the first 4 actions');
  assert.ok(actions.slice(0, 4).some((item) => item.text === 'Save'), 'a button is too');
  assert.ok(!/Category [4-7]/.test(JSON.stringify(found.slice(0, 6))), 'menu links come last, if at all');
});

test('a banner (a dialog or a fixed overlay) does not crowd out the Apply control, whatever language the banner is in', { skip: !JSDOM }, () => {
  const found = of(`<main><div style="position: fixed; bottom: 0"><p>Cookies.</p><button type="button">Deny</button><button type="button">Allow</button></div>
    <div role="dialog"><button type="button">Accept all</button><button type="button">Settings</button><a href="https://consent.example.net/policy">Policy</a></div>
    <h1>Operative</h1><p>Days in Derby.</p><button type="button">Apply Now</button></main>`);
  const actions = found.filter((item) => item.kind === 'link' || item.kind === 'button').map((item) => item.text);
  assert.equal(actions[0], 'Apply Now');
  assert.ok(actions.indexOf('Deny') > actions.indexOf('Apply Now'));
});

test('up to six actions are kept, so one more control than before fits beside the sentences', { skip: !JSDOM }, () => {
  const found = of(`<main><h1>Job</h1>${Array.from({ length: 8 }, (_, i) => `<button type="button">Action ${i}</button>`).join('')}<p>One sentence here.</p></main>`);
  assert.equal(found.filter((item) => item.kind === 'button').length, 6);
  assert.ok(found.some((item) => item.kind === 'sentence'));
});

test('a link drawn as a button, or a call to action shown twice, outranks plain same-site links (structure and style, no words)', { skip: !JSDOM }, () => {
  const window = open(`<main><h1>Operative</h1><p>Days in Derby.</p>${Array.from({ length: 5 }, (_, i) => `<a href="/p/${i}">Plain ${i}</a>`).join('')}
    <a id="cta" href="/go" style="background-color: rgb(0, 80, 200)">Go now</a><a href="/again">Again</a><p>More text.</p><a href="/again">Again</a></main>`);
  window.Element.prototype.getBoundingClientRect = function () { return this.id === 'cta' ? { left: 0, top: 0, width: 160, height: 44, right: 160, bottom: 44 } : { left: 0, top: 0, width: 60, height: 18, right: 60, bottom: 18 }; };
  const actions = Array.from(window.__jobadabraCandidates.candidatesOf()).filter((item) => item.kind === 'link').map((item) => item.text);
  assert.deepEqual(actions.slice(0, 2).sort(), ['Again', 'Go now']);
});

// Hornbach shape (11 Oct 2026): the route without an account is an <a> with NO href (a script handles the click), the route with an account is an a[href].
// The digest listed only a[href], so it named the other route. An href-less control that is clickable by structure (an onclick, a tabindex, a pointer
// cursor or drawn as a button) is a candidate of kind button, with no host; a plain <a name> anchor is not.
const TWO_ROUTES = `<main><h1>Verkäufer (m/w/d)</h1><p>Wir freuen uns auf Ihre Bewerbung.</p>
  <a class="apply dialogApplyBtn" style="cursor:pointer">Jetzt bewerben (ohne Anmeldung)</a>
  <a href="https://career.example.net/login?company=x">Jetzt bewerben (mit Anmeldung)</a>
  <a onclick="void 0">Merken</a><a tabindex="0">Teilen</a><a name="top">Seitenanfang</a></main>`;

test('Hornbach shape: an Apply control without href is a candidate (kind button, no host); a plain anchor is not', { skip: !JSDOM }, () => {
  const found = of(TWO_ROUTES);
  const texts = found.map((item) => item.text);
  const noAccount = found.find((item) => item.text === 'Jetzt bewerben (ohne Anmeldung)');
  assert.ok(noAccount, `the href-less route is listed: ${texts.join(' | ')}`);
  assert.deepEqual([noAccount.kind, noAccount.host, noAccount.position], ['button', undefined, 'main']);
  assert.ok(texts.includes('Jetzt bewerben (mit Anmeldung)'), 'the link route stays listed');
  assert.ok(texts.includes('Merken') && texts.includes('Teilen'), 'onclick and tabindex anchors are clickable by structure');
  assert.ok(!texts.includes('Seitenanfang'), 'a plain <a name> anchor is not a control');
});

// 15 Oct 2026: a yes/no step whose "Continue" is disabled until a choice is made: the candidate says so by the element's own state (disabled attribute or aria-disabled), never by a word.
test('a disabled button or one marked aria-disabled carries disabled: true; an enabled one does not', { skip: !JSDOM }, () => {
  const found = of('<main><p>Do you want to go on?</p><button>Yes</button><button>No</button><button disabled>Continue</button><div role="button" aria-disabled="true">Back</div></main>');
  const by = (text) => found.find((item) => item.text === text);
  assert.equal(by('Continue').disabled, true);
  assert.equal(by('Back').disabled, true);
  assert.equal(by('Yes').disabled, undefined);
  assert.equal(by('No').disabled, undefined);
});
