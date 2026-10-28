// Fixture application forms for the apply suite, served over HTTPS from this machine. Chromium maps the real job-site host names the extension is allowed on
// (boards.greenhouse.io, jobs.lever.co, e2e.recruitee.com) to this server, and every other host name is unresolvable, so no employer site is ever contacted.
// The forms are written like the real boards' (labels, required stars, a late-rendered field, a multi-step flow) and each records what happened to it:
// a Submit that is clicked or submitted is logged, so a test can prove it was never touched.
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import {CONTACT} from './apply-fixtures.mjs';

export const HOSTS = ['boards.greenhouse.io', 'jobs.lever.co', 'e2e.recruitee.com', 'e2e.wd3.myworkdayjobs.com'];
const LEVER_ID = '5e2e5e2e-0000-4000-8000-00000000a001';

// One entry per form. `kit` is what the job's drafted kit holds for it (field ids of the form); `legal` the ids the extension must leave to the person even
// though the kit says "checked"; `consent` the consent / data-notice boxes it ticks by default, `consentWords` what the panel's "Left for you" would say about them (it must not, once ticked) (Settings -> Advanced -> Consent boxes, owner 17 Oct 2026); `late` the ids that only appear after the page has loaded.
export const FORMS = {
  greenhouse: {
    title: 'Senior Site Reliability Engineer', company: 'E2E Greenhouse Labs', host: 'boards.greenhouse.io', path: '/e2e/jobs/4001001',
    kit: [
      {field: 'question_1001', question: 'Years of experience with Kubernetes', answer: '8', needs_review: false},
      {field: 'question_1002', question: 'Are you legally authorized to work in Switzerland?', answer: 'Yes', needs_review: false},
      {field: 'question_1003', question: 'Notice period', answer: '3 months', needs_review: false},
      {field: 'question_1004', question: 'Describe a production incident you led and what you changed afterwards.',
        answer: 'I led the response to a cascading failure in our payments cluster, wrote the post-mortem and added load-shedding and SLO alerts afterwards.', needs_review: false},
      {field: 'consent_privacy', question: 'I agree to the privacy policy and the processing of my data', answer: 'checked', needs_review: false},
    ],
    legal: [], consent: ['consent_privacy'], consentWords: ['privacy'],
  },
  lever: {
    title: 'Platform Engineer', company: 'E2E Lever Systems', host: 'jobs.lever.co', path: `/e2e/${LEVER_ID}`, formPath: `/e2e/${LEVER_ID}/apply`,
    kit: [
      {field: 'org', question: 'Current company', answer: 'Acme Infrastructure AG', needs_review: false},
      {field: 'urls[LinkedIn]', question: 'LinkedIn URL', answer: 'https://www.linkedin.com/in/ada-tester', needs_review: false},
      {field: 'heard', question: 'How did you hear about us?', answer: 'Job board', needs_review: false},
    ],
    // Not in the kit, so the app asks its AI (canned in the test): the open question below.
    open: {field: 'why', question: 'Why do you want to work at E2E Lever Systems?'},
    late: ['org'], legal: [],
  },
  multistep: {
    title: 'DevOps Engineer', company: 'E2E Recruitee GmbH', host: 'e2e.recruitee.com', path: '/o/devops-engineer',
    kit: [
      {field: 'salary', question: 'Salary expectation (CHF per year)', answer: '140000', needs_review: false},
      {field: 'start_date', question: 'Earliest start date', answer: '1 December 2026', needs_review: false},
      {field: 'consent_data', question: 'I agree to the processing of my personal data (privacy policy)', answer: 'checked', needs_review: false},
    ],
    legal: [], consent: ['consent_data'], consentWords: ['personal data'],
  },
  // Workday's own shape (5 Oct 2026): opaque ids (input-7), labels tied only by aria-labelledby with the star in an <abbr>, aria-required instead of `required`,
  // a "How Did You Hear About Us?" that is a button opening a list (not a <select>), and data-automation-id everywhere. The kit's answers fill by id; the
  // dropdown cannot be filled and must be left to the person, by name.
  workday: {
    title: 'Site Reliability Engineer', company: 'E2E Workday Corp', host: 'e2e.wd3.myworkdayjobs.com', path: '/en-US/E2E/job/Zurich/Site-Reliability-Engineer_R1001/apply',
    kit: [
      {field: 'input-7', question: 'How many years of experience do you have with AWS?', answer: '6', needs_review: false},
      {field: 'input-9', question: 'What is your notice period?', answer: '3 months', needs_review: false},
    ],
    dropdown: 'How Did You Hear About Us?', legal: [],
  },
  unknown: {
    title: 'Infrastructure Engineer', company: 'E2E Unknown Widget Inc', host: 'boards.greenhouse.io', path: '/e2e/jobs/4001004',
    kit: [{field: 'question_2001', question: 'Years of experience with Terraform', answer: '6', needs_review: false}],
    widget: 'How would you rate your Terraform skill?', legal: [],
  },
};
// A journey over three pages and two tabs, like a job board posting that leads to an agency's own site (jobs.ch -> consultandpepper.com): the posting has
// only an Apply link that opens a NEW tab, that page has only a "To apply" button whose form POSTs into a new tab, and the form is behind it. `kit` is for the posting's job.
export const CHAIN = {
  title: 'Fullstack Engineer with DevOps Mindset', company: 'E2E Chain Recruiting', host: 'boards.greenhouse.io', path: '/e2e/jobs/4001005',
  stepHost: 'e2e.recruitee.com', stepPath: '/o/chain-step', formPath: '/o/chain-form',
  kit: [{field: 'question_3001', question: 'Years of experience with Kubernetes', answer: '7', needs_review: false}],
};
CHAIN.url = `https://${CHAIN.host}${CHAIN.path}`;
CHAIN.stepUrl = `https://${CHAIN.stepHost}${CHAIN.stepPath}`;
CHAIN.formUrl = `https://${CHAIN.stepHost}${CHAIN.formPath}`;
// A posting whose Apply opens the form from its OWN SCRIPT (window.open), so nothing can be pointed at the same tab: the extension follows
// the new tab as the same application and closes the posting (extension/same-tab.js). Its kit answers 9 where CHAIN's answers 7, so a
// form filled from the other job's kit (two applications side by side, 8 Oct 2026: Migros's form on Manor's card) shows at once.
export const SCRIPTED = {
  title: 'Platform Engineer, Scripted Apply', company: 'E2E Scripted Careers', host: 'jobs.lever.co', path: '/e2e-scripted/4001006',
  formHost: 'e2e.wd3.myworkdayjobs.com', formPath: '/e2e/scripted-form',
  kit: [{field: 'question_3001', question: 'Years of experience with Kubernetes', answer: '9', needs_review: false}],
};
SCRIPTED.url = `https://${SCRIPTED.host}${SCRIPTED.path}`;
SCRIPTED.formUrl = `https://${SCRIPTED.formHost}${SCRIPTED.formPath}`;
// A form drawn late (9 Oct 2026, SuccessFactors after a sign-in): the page first shows a spinner and the form's own submit control (a span the site's
// code names "_submitBtn", text "Postuler", not a type=submit), and draws its fields 3 s later. Judged while empty it reads as a posting: its
// "Postuler" must never be pressed as Apply, and once the fields come the page is looked at again and filled.
export const LATE = {
  title: 'Store Assistant, Late Form', company: 'E2E Late Form Careers', host: 'jobs.lever.co', path: '/e2e-late/4001007',
  formHost: 'e2e.wd3.myworkdayjobs.com', formPath: '/e2e/late-form',
  kit: [{field: 'question_3001', question: 'Years of experience with Kubernetes', answer: '5', needs_review: false}],
};
LATE.url = `https://${LATE.host}${LATE.path}`;
LATE.formUrl = `https://${LATE.formHost}${LATE.formPath}`;
// A sign-up page in front of the form (8 Oct 2026, Manor/Migros on SuccessFactors): the posting's Apply leads to "Create an account" (email,
// password, "not a robot"), which really posts; the account then leads to the application form. The extension must leave the sign-up
// alone (an account page), the session must show the account step with no form progress, and nothing typed there may be learned.
export const SIGNUP = {
  title: 'Store Associate, Sign-up First', company: 'E2E Sign-up Retail', host: 'jobs.lever.co', path: '/e2e-signup/4001007',
  accountHost: 'e2e.wd3.myworkdayjobs.com', accountPath: '/e2e/signup', formPath: '/e2e/signup-application',
  kit: [{field: 'question_3001', question: 'Years of experience with Kubernetes', answer: '5', needs_review: false}],
};
SIGNUP.url = `https://${SIGNUP.host}${SIGNUP.path}`;
SIGNUP.accountUrl = `https://${SIGNUP.accountHost}${SIGNUP.accountPath}`;
SIGNUP.formUrl = `https://${SIGNUP.accountHost}${SIGNUP.formPath}`;
// A sign-in page in front of the form where we HAVE an account (8 Oct 2026, SuccessFactors sites with a saved password): the run's own password store holds this
// host's password with the applicant's email, so the app says "sign-in". The extension fills the email (the normal fill) and the password (account-step.js), presses
// "Sign in" once on the AI's "ready", and the form behind it is filled from the kit. SIGNIN_REFUSED is the same page where the site says the password is wrong: pressed once,
// never again, and the person is told (Claude offered). The password is a test value made for this run; `signinPosts` counts the presses the site received.
export const SIGNIN_PASSWORD = `Fictional-Signin-${Math.random().toString(36).slice(2, 10)}`;
const signinFixture = (title, company, path, accountPath) => {
  const fixture = {title, company, host: 'jobs.lever.co', path, accountHost: 'e2e.recruitee.com', accountPath, formPath: `${accountPath}-application`,
    kit: [{field: 'question_3001', question: 'Years of experience with Kubernetes', answer: '4', needs_review: false}]};
  return Object.assign(fixture, {url: `https://${fixture.host}${path}`, accountUrl: `https://${fixture.accountHost}${accountPath}`, formUrl: `https://${fixture.accountHost}${fixture.formPath}`});
};
export const SIGNIN = signinFixture('Site Reliability Engineer, Sign-in First', 'E2E Sign-in Bank', '/e2e-signin/4001008', '/e2e/signin');
export const SIGNIN_REFUSED = signinFixture('Platform Engineer, Sign-in Refused', 'E2E Sign-in Insurer', '/e2e-signin/4001009', '/e2e/signin-refused');
// The account and the application on ONE page (8 Oct 2026, Coop on SuccessFactors): an "Upload a CV" button with its file input hidden,
// email twice, a password twice, names and more. It is the application (filled, counted, the form step); its passwords stay account fields.
export const ONEPAGE = {
  title: 'Retail Assistant, One-page Sign-up', company: 'E2E One-page Retail', host: 'e2e.wd3.myworkdayjobs.com', path: '/e2e/one-page-apply',
  kit: [{field: 'question_3001', question: 'Years of experience with Kubernetes', answer: '3', needs_review: false}],
};
ONEPAGE.url = `https://${ONEPAGE.host}${ONEPAGE.path}`;
// An application form the stand-in AI calls a "posting" (a wrong kind, kept): the extension finds no Apply to press while the page has a
// form's fields, so it drops that kind, fills the form, and the next visit asks again (self-correction, 8 Oct 2026).
// Its path has no digit, so its page shape (desktop/lib/page-kind.js pageShape: a part with a digit is blanked, and "e2e" has one) is its own:
// on /e2e-…/<id> it shared jobs.lever.co/*/* with the + upload form, whose right "form" was remembered first and the wrong kind never asked
// (beta 9 Oct 2026). test/apply-parts.test.mjs keeps it unique.
export const MISLABELLED = {
  title: 'Support Engineer, Mislabelled', company: 'E2E Mislabelled Co', host: 'jobs.lever.co', path: '/mislabelled-co/support-engineer',
  kit: [{field: 'question_3001', question: 'Years of experience with Kubernetes', answer: '4', needs_review: false}],
};
MISLABELLED.url = `https://${MISLABELLED.host}${MISLABELLED.path}`;
MISLABELLED.shape = `${MISLABELLED.host}${MISLABELLED.path}`;   // its page-kind cache shape, asserted in the test
// A form the TEST (playing the person) really submits: its Submit POSTs and the same address answers with the site's own "submitted" banner (like OK Job,
// api.easytemp.ch), so the extension must see the Submit press, the page change, and send that page to the AI. Never reported to `fired`: it is the one
// form allowed to be submitted, and only by the person (the test), never by the extension.
FORMS.submitter = {
  title: 'Platform Engineer (Submit test)', company: 'E2E Submit Co', host: 'e2e.recruitee.com', path: '/o/submit-form',
  kit: [{field: 'question_4001', question: 'Years of experience with Linux', answer: '9', needs_review: false}],
  legal: [], submits: true,
  // Why (2026-10-28, Full automation e2e): the same form at a second path with only the person's details and CV, so every field is a saved fact (a kit answer is never one, extension/flow.js `source: 'kit'`).
  autoPath: '/o/auto-submit-form',
};
// REAL forms (5 Oct 2026): the shapes of forms the extension failed on for a real person, rebuilt from the fill log by tools/fixture-from-fills.py (field
// labels and kinds only, never a value: public form wording). Each is a job with no kit answers: the extension fills the person's details and must list every
// required field it cannot fill as left for them, by its label. A real form the extension once skipped silently stays a test for good.
const REAL_HOSTS = {greenhouse: 'boards.greenhouse.io', lever: 'jobs.lever.co', workday: 'e2e.wd3.myworkdayjobs.com'};
export const REAL_FORMS = (() => {
  const dir = new URL('../fixtures/real-forms/', import.meta.url);
  try { return fs.readdirSync(dir).filter(name => name.endsWith('.json')).map(name => JSON.parse(fs.readFileSync(new URL(name, dir), 'utf8'))); } catch { return []; }
})();
for (const spec of REAL_FORMS) {
  FORMS[`real-${spec.id}`] = {title: spec.title || 'Engineer (real form)', company: `E2E Real ${spec.id}`, host: REAL_HOSTS[spec.ats] || 'e2e.recruitee.com', path: `/real/${spec.id}`, kit: [], legal: [], real: spec};
}
for (const form of Object.values(FORMS)) form.url = `https://${form.host}${form.path}`;

// ---- Varied starting data (lib/variation.mjs): what a real person's data and a real site's timing throw at the fill, not only the tidy values above. ----
// A seeded run takes another pick from each list below; no seed leaves the forms exactly as written (the release gate). The kit is changed IN PLACE before anything reads it, so the
// suite's expectations (they come from the kit) stay right. Short answers stay short and the long one stays long: the panel flags a long drafted answer for a read-through.
const LONG_ANSWERS = [
  'I led the response to a cascading failure in our payments cluster, wrote the post-mortem and added load-shedding and SLO alerts afterwards.',
  "I'm proud of one night: a bad deploy took our \"checkout\" service down & I rolled it back in 9 minutes, then wrote the post-mortem (what we'd change: canaries, <5 min alerts).",
  'Während eines Ausfalls im Zürcher Rechenzentrum habe ich den Failover geleitet; danach schrieb ich das Post-Mortem und führte Lastabwurf ein. Résumé: très instructif, café inclus. 🚀',
  'Line one: the page went red at 02:10.\nLine two: I paged the database owner.\nLine three: we fixed the replica lag and wrote the review the next day, with three follow-ups.',
  'A '.repeat(450).trim(),   // about 900 characters: a long answer that must not be cut
];
const HAZARDS = {
  question_1001: ['8', '12', '0.5', '8 years'],
  question_1003: ['3 months', '30 days', 'six Wochen (Kündigungsfrist)', 'immédiat'],
  question_1004: LONG_ANSWERS,
  org: ['Acme Infrastructure AG', "O'Reilly & Sons <Cloud> GmbH", 'Zürich Cloud Systèmes Ltd', 'Äpfel-AG 日本'],
  salary: ['140000', "140'000", 'CHF 140,000', '140 000'],
  start_date: ['1 December 2026', '01.12.2026', 'ASAP', 'Dec 1st, 2026'],
};
const LATE_CHOICES = [0, 300, 600, 900, 1200];   // under the extension's wait; a value past it is a negative test of its own (E2E_LATE_MS)
const ORIGINAL = JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(FORMS).map(([name, form]) => [name, form.kit]))));
let lateMs = 600, questionOrder = [0, 1, 2, 3];

// -> a one-line description of what this run's data looks like (empty for the fixed path).
export function varyForms(vary) {
  for (const [name, form] of Object.entries(FORMS)) form.kit = JSON.parse(JSON.stringify(ORIGINAL[name]));   // always from the written forms, never on top of an earlier pick
  lateMs = 600; questionOrder = [0, 1, 2, 3];
  if (!vary || vary.fixed) return '';
  const picked = [];
  for (const form of Object.values(FORMS)) for (const item of form.kit) if (HAZARDS[item.field]) { item.answer = vary.pick(HAZARDS[item.field]); picked.push(`${item.field}=${JSON.stringify(item.answer).slice(0, 24)}`); }
  lateMs = Number(process.env.E2E_LATE_MS) || vary.pick(LATE_CHOICES);
  questionOrder = vary.shuffle([0, 1, 2, 3]);
  return `late field after ${lateMs} ms, greenhouse questions in order ${questionOrder.map(i => i + 1).join('')}, answers ${picked.join(' ')}`;
}

const esc = text => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const field = (id, label, {type = 'text', required = false, name = id, extra = ''} = {}) =>
  `<div class="field"><label for="${id}">${esc(label)}${required ? ' *' : ''}</label><input id="${id}" name="${esc(name)}" type="${type}"${required ? ' required' : ''} ${extra}></div>`;
const select = (id, label, options, {required = false} = {}) =>
  `<div class="field"><label for="${id}">${esc(label)}${required ? ' *' : ''}</label><select id="${id}" name="${id}"${required ? ' required' : ''}><option value="">Select…</option>${options.map(o => `<option>${esc(o)}</option>`).join('')}</select></div>`;
const area = (id, label, {required = false} = {}) =>
  `<div class="field"><label for="${id}">${esc(label)}${required ? ' *' : ''}</label><textarea id="${id}" name="${id}" rows="4"${required ? ' required' : ''}></textarea></div>`;
const resume = `<div class="field"><label for="resume">Resume/CV *</label><input id="resume" name="resume" type="file" required></div>`;
const consent = (id, text) => `<div class="field"><label><input id="${id}" name="${id}" type="checkbox" required> ${esc(text)} *</label></div>`;

// Every form reports a click on Submit and a submit event to the server (which keeps them for the test), and never really submits.
const page = (form, body, script = '', {realSubmit = false} = {}) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(form.title)} at ${esc(form.company)}</title>
<style>body{font:15px/1.4 system-ui,sans-serif;max-width:640px;margin:24px auto;padding:0 16px}.field{margin:14px 0}label{display:block;margin-bottom:4px}input[type=text],input[type=email],input[type=tel],input[type=url],select,textarea{width:100%;padding:6px;box-sizing:border-box}</style></head>
<body><h1>${esc(form.title)}</h1><p>${esc(form.company)} · Zurich, Switzerland</p>
${body}
<script>
const fired = kind => fetch('/__fired?kind=' + kind + '&form=' + encodeURIComponent(location.pathname), {method: 'POST', keepalive: true});
${realSubmit ? '' : "document.addEventListener('click', event => { if (event.target.closest('[type=submit]')) fired('click'); }, true);"}
${realSubmit ? '' : "document.addEventListener('submit', event => { event.preventDefault(); fired('submit'); }, true);"}
${script}
</script></body></html>`;

const ONEPAGE_HTML = () => page(ONEPAGE, `<p>Are you already registered? <a href="#login">Log in here.</a></p><form id="application_form"><div class="field"><button type="button" id="upload_cv" onclick="document.getElementById('cv_file').click()">Upload a CV</button><input id="cv_file" name="cv_file" type="file" style="display:none"></div>${field('email', 'Email', {type: 'email', required: true})}${field('email_again', 'Please re-enter your email address', {type: 'email', required: true})}<div class="field"><label for="password">Choose a password *</label><input id="password" name="password" type="password" required></div><div class="field"><label for="password_again">Confirm password *</label><input id="password_again" name="password_again" type="password" required></div>${field('first_name', 'First name', {required: true})}${field('last_name', 'Last name', {required: true})}${field('city', 'City', {required: true})}${field('phone', 'Phone', {type: 'tel', required: true})}${field('question_3001', 'Years of experience with Kubernetes', {required: true})}<div class="field"><button type="submit" id="submit_app">Submit Application</button></div></form>`);
// A menu whose choices are not the answer's words (8 Oct 2026, Coop's "Indicatif de pays": the answer "+41", the menu lists country names). The fill cannot match it;
// the app asks the AI for the choice that means the same ("Suisse"), arms the menu with it and remembers it for this site and field, so the next form there gets it
// at once with no AI call. Two postings on one site with the same form: the first proves the pick, the second the remembered choice.
const menuFixture = (title, path) => ({title, company: 'E2E Menu Telecom', host: 'boards.greenhouse.io', path, url: `https://boards.greenhouse.io${path}`,
  kit: [{field: 'country_code', question: 'Indicatif de pays', answer: '+41', needs_review: false}, {field: 'question_3001', question: 'Years of experience with Kubernetes', answer: '6', needs_review: false}]});
export const MENU_FIRST = menuFixture('Network Engineer, Country Menu', '/e2e-menus/4001010');
export const MENU_AGAIN = menuFixture('Network Engineer II, Country Menu', '/e2e-menus/4001011');
// "Needs your attention" from the extension's fill (owner, 8 Oct 2026: the rows lost their proposed answers when Apply moved to the extension). The kit's answer
// "3 months" is not one of the notice-period menu's choices and none means the same, so the fill leaves it empty and proposes it; the session page shows the
// row with the proposal and the form's choices, the person picks one and presses Use, and the form gets it.
export const PROPOSE = menuFixture('Cloud Engineer, Notice Period', '/e2e-propose/4001012');
PROPOSE.company = 'E2E Notice Systems';
PROPOSE.kit = [{field: 'notice_period', question: 'Notice period', answer: '3 months', needs_review: false}, {field: 'question_3001', question: 'Years of experience with Kubernetes', answer: '7', needs_review: false}];
// A form whose sections are drawn collapsed (Migros on SuccessFactors, 9 Oct 2026): a heading with a closed disclosure button (aria-expanded="false", aria-controls)
// over a hidden region, the questions inside. Only the first section's neighbours are visible until the extension opens them (extension/sections.js, by structure).
export const COLLAPSED = {title: 'Cashier, Collapsed Sections', company: 'E2E Accordion Retail', host: 'jobs.lever.co', path: '/e2e-collapsed/4001014',
  kit: [{field: 'question_4001', question: 'Years of experience with cash registers', answer: '6', needs_review: false}]};
COLLAPSED.url = `https://${COLLAPSED.host}${COLLAPSED.path}`;
const section = (id, title, inner) => `<h3><button type="button" id="b_${id}" aria-expanded="false" aria-controls="${id}" onclick="const r = document.getElementById('${id}'); r.hidden = !r.hidden; this.setAttribute('aria-expanded', String(!r.hidden))">${title}</button></h3><div id="${id}" hidden>${inner}</div>`;
const COLLAPSED_PAGE = fixture => page(fixture, `<form id="application_form">${field('first_name', 'Prénom', {required: true})}${field('last_name', 'Nom', {required: true})}
  ${section('sec_profile', 'Informations sur le profil', field('email', 'E-mail', {type: 'email', required: true}))}
  ${section('sec_job', 'Informations propres au poste', field('question_4001', 'Years of experience with cash registers', {required: true}))}
  <div class="field"><button type="submit" id="submit_app">Envoyer</button></div></form>`);
export const NOTICE_CHOICES = ['Immediately', '1 month', '2 months'];
const PROPOSE_PAGE = fixture => page(fixture, `<form id="application_form">${field('first_name', 'First name', {required: true})}${field('last_name', 'Last name', {required: true})}${field('email', 'E-mail', {type: 'email', required: true})}${select('notice_period', 'Notice period', NOTICE_CHOICES, {required: true})}${field('question_3001', 'Years of experience with Kubernetes', {required: true})}<div class="field"><button type="submit" id="submit_app">Submit Application</button></div></form>`);
// An upload slot with no file input until its + is pressed (8 Oct 2026, Coop on SuccessFactors): the + opens a "Select a source" popup that creates the input.
// The app's CV must reach it through the whole chain (app -> extension -> upload operator), the slot says it got the file, and Submit is never touched.
export const REVEAL = {title: 'Platform Engineer, Plus-Button Upload', company: 'E2E Reveal Retail', host: 'jobs.lever.co', path: '/e2e-reveal/4001013',
  kit: [{field: 'question_3001', question: 'Years of experience with Kubernetes', answer: '8', needs_review: false}]};
REVEAL.url = `https://${REVEAL.host}${REVEAL.path}`;
const REVEAL_PAGE = fixture => page(fixture, `<form id="application_form">${field('first_name', 'Vorname', {required: true})}${field('last_name', 'Nachname', {required: true})}${field('email', 'E-Mail', {type: 'email', required: true})}
  <div class="field"><div class="lab">Lebenslauf *</div><div class="attachWrapper"><div class="box">Datei hinzufügen</div><span role="button" tabindex="0" class="addAttachments" id="cv_plus" onclick="openPopup('cv_plus')">+</span><div class="ok" id="cv_ok" hidden>hochgeladen</div></div></div>
  ${field('question_3001', 'Years of experience with Kubernetes', {required: true})}<div class="field"><button type="submit" id="submit_app">Bewerbung absenden</button></div></form>
  <div id="popup" hidden>Quelle wählen <button type="button">Vom Gerät</button></div><script>
  window.got = {};
  function openPopup(id) {
    const popup = document.getElementById('popup'); popup.hidden = false; popup.querySelector('input')?.remove();
    const input = document.createElement('input'); input.type = 'file'; input.name = 'fileData' + id;
    input.addEventListener('change', () => { const file = input.files[0]; window.got[id] = file ? {name: file.name, size: file.size} : null; document.getElementById('cv_ok').hidden = !file; });
    popup.appendChild(input);
  }</script>`);

export const MENU_CHOICES = ['Allemagne', 'Autriche', 'France', 'Italie', 'Liechtenstein', 'Suisse'];
const MENU_PAGE = fixture => page(fixture, `<form id="application_form">${field('first_name', 'Prénom', {required: true})}${field('last_name', 'Nom', {required: true})}${field('email', 'E-mail', {type: 'email', required: true})}${select('country_code', 'Indicatif de pays', MENU_CHOICES, {required: true})}${field('phone', 'Téléphone', {type: 'tel'})}${field('question_3001', 'Years of experience with Kubernetes', {required: true})}<div class="field"><button type="submit" id="submit_app">Envoyer la candidature</button></div></form>`);

const SIGNIN_PAGES = {
  posting: fixture => page(fixture, `<p>Join our platform team.</p><a id="apply_link" href="${fixture.accountUrl}" style="display:inline-block;padding:12px 28px;background:#222;color:#fff;font-size:18px;text-decoration:none">Apply</a>`),
  account: (fixture, error = '', email = '') => page(fixture, `<h2>Sign in to apply</h2>${error ? `<p id="signin_error" role="alert" style="color:#b00">${esc(error)}</p>` : ''}<form id="signin_form" method="post" action="${fixture.accountPath}">${field('signin_email', 'Email Address', {type: 'email', required: true, extra: email ? `value="${esc(email)}"` : ''})}<div class="field"><label for="signin_password">Password *</label><input id="signin_password" name="signin_password" type="password" required></div><button type="submit" id="signin_button">Sign in</button></form><p><a id="create_account" href="${fixture.accountPath}/new">Create an account</a></p>`, '', {realSubmit: true}),
  // The sign-up page the extension goes to after a refused sign-in (its register link): a box only a person can tick keeps it from being finished, so the session
  // is stuck on a page that HAS a panel, where Take over with Claude is offered with Claude help on (9 Oct 2026). Never submitted: the box stays empty.
  signup: fixture => page(fixture, `<h2>Create an account</h2><form id="signup_form" method="post" action="${fixture.accountPath}/new">${field('signup_email', 'Email Address', {type: 'email', required: true})}<div class="field"><label for="signup_password">Password *</label><input type="password" id="signup_password" name="signup_password" required autocomplete="new-password"></div><div class="field"><label><input type="checkbox" id="robot" name="robot" required> I'm not a robot *</label></div><div class="field"><button type="submit" id="signup_submit">Create account</button></div></form>`),
  form: fixture => page(fixture, `<form id="application_form">${field('first_name', 'First name', {required: true})}${field('last_name', 'Last name', {required: true})}${field('email', 'E-mail', {type: 'email', required: true})}${field('question_3001', 'Years of experience with Kubernetes', {required: true})}<div class="field"><button type="submit" id="submit_app">Submit Application</button></div></form>`),
};
const SIGNUP_PAGES = {
  posting: () => page(SIGNUP, `<p>Join our store team.</p><a id="apply_link" href="${SIGNUP.accountUrl}" style="display:inline-block;padding:12px 28px;background:#222;color:#fff;font-size:18px;text-decoration:none">Apply</a>`),
  account: () => page(SIGNUP, `<h2>Create an account</h2><form id="signup_form" method="post" action="${SIGNUP.accountPath}">${field('signup_email', 'Email Address', {type: 'email', required: true})}${field('signup_username', 'Username', {required: true})}<div class="field"><label for="signup_password">Password *</label><input id="signup_password" name="signup_password" type="password" required></div><div class="field"><label><input id="robot" type="checkbox" required> I'm not a robot</label></div><button type="submit" id="create_account">Create account</button></form>`, '', {realSubmit: true}),
  form: () => page(SIGNUP, `<form id="application_form">${field('first_name', 'First name', {required: true})}${field('last_name', 'Last name', {required: true})}${field('email', 'E-mail', {type: 'email', required: true})}${field('question_3001', 'Years of experience with Kubernetes', {required: true})}<div class="field"><button type="submit" id="submit_app">Submit Application</button></div></form>`),
};
const SCRIPTED_PAGES = {
  posting: () => page(SCRIPTED, `<p>Join the platform team.</p><button id="apply_now" type="button" onclick="window.open('${SCRIPTED.formUrl}', '_blank')" style="padding:12px 28px;background:#222;color:#fff;font-size:18px;border:0">Apply now</button>`, '', {realSubmit: true}),
  form: () => page(SCRIPTED, `<form id="application_form">${field('first_name', 'First name', {required: true})}${field('last_name', 'Last name', {required: true})}${field('email', 'E-mail', {type: 'email', required: true})}${field('question_3001', 'Years of experience with Kubernetes', {required: true})}<div class="field"><button type="submit" id="submit_app">Submit Application</button></div></form>`),
};
const LATE_PAGES = {
  posting: () => page(LATE, `<p>Join the store team.</p><a id="apply_link" href="${LATE.formUrl}" style="display:inline-block;padding:12px 28px;background:#222;color:#fff;font-size:18px;text-decoration:none">Apply</a>`),
  form: () => page(LATE, `<p id="loading">Chargement en cours…</p><div id="late"></div><p><span id="357:_submitBtn" class="rcmSaveButton" role="button" tabindex="0" style="display:inline-block;padding:10px 22px;background:#555;color:#fff">Postuler</span></p>`,
    `document.getElementById('357:_submitBtn').addEventListener('click', () => fired('click'));
setTimeout(() => { document.getElementById('loading').remove(); document.getElementById('late').innerHTML = ${JSON.stringify(`<form id="application_form">${field('first_name', 'First name', {required: true})}${field('last_name', 'Last name', {required: true})}${field('email', 'E-mail', {type: 'email', required: true})}${field('question_3001', 'Years of experience with Kubernetes', {required: true})}</form>`)}; }, 3000);`),
};
const CHAIN_PAGES = {
  posting: () => page(CHAIN, `<p>Join the team. <a id="apply_link" href="${CHAIN.stepUrl}" target="_blank" style="display:inline-block;padding:12px 28px;background:#222;color:#fff;font-size:18px;text-decoration:none">Apply</a></p>`),
  // "To apply" submits a form into a NEW tab (8 Oct 2026): the form page answers only to that POST, so a journey that loads the address again (a GET) lands
  // on "session expired" with no form, and only a press that keeps the posted data reaches the form.
  step: () => page(CHAIN, `<p>Contact: a consultant looks forward to your application.</p><form id="to_apply_form" method="post" action="${CHAIN.formUrl}" target="_blank"><input type="hidden" name="ref" value="chain-step"><button id="to_apply" type="submit" style="display:inline-block;padding:12px 28px;background:#f5d98b;border:0;font-size:18px">To apply</button></form>`, '', {realSubmit: true}),   // this form really posts (it is the way to the form, not an application)
  expired: () => page(CHAIN, '<p id="expired">Your session has expired. Please start again from the job posting.</p>'),
  // The agency's form has FLOATING labels: the label sits inside the field and moves up only when the field is left with a value (a blur, like a person's tab
  // away), so a value written without focus and blur sits on top of its label (3 Oct 2026, consultandpepper.com).
  form: () => page(CHAIN, `<style>.field label.up{font-size:11px;color:#667}</style><form id="application_form">${field('first_name', 'First name', {required: true})}${field('last_name', 'Last name', {required: true})}${field('email', 'E-mail', {type: 'email', required: true})}${resume}${field('question_3001', 'Years of experience with Kubernetes', {required: true})}${submit}</form>`,
  `document.querySelectorAll('input[type=text],input[type=email]').forEach(input => input.addEventListener('blur', () => document.querySelector('label[for=' + input.id + ']').classList.toggle('up', !!input.value)));`),
};

const submit = `<div class="field"><button type="submit" id="submit_app">Submit Application</button></div>`;

const PAGES = {
  greenhouse: form => page(form, `<form id="application_form">
  ${field('first_name', 'First Name', {required: true})}${field('last_name', 'Last Name', {required: true})}${field('email', 'Email', {type: 'email', required: true})}${field('phone', 'Phone', {type: 'tel'})}
  ${resume}
  ${questionOrder.map(i => [field('question_1001', 'Years of experience with Kubernetes', {required: true}),
    select('question_1002', 'Are you legally authorized to work in Switzerland?', ['Yes', 'No'], {required: true}),
    field('question_1003', 'Notice period', {required: true}),
    area('question_1004', 'Describe a production incident you led and what you changed afterwards.', {required: true})][i]).join('\n  ')}
  ${consent('consent_privacy', 'I agree to the privacy policy and the processing of my data')}
  ${submit}</form>`),
  // Lever: the posting's page has the form under /apply; "Current company" is rendered by script a moment after the page has loaded (E2E_LATE_MS moves it: a
  // value past the extension's 1.5 s wait proves the suite notices a field that is filled too late).
  lever: form => page(form, `<form id="application_form">
  ${field('name', 'Full name', {required: true})}${field('email', 'Email', {type: 'email', required: true})}${field('phone', 'Phone')}
  ${resume}
  <div id="late-slot"></div>
  ${field('urls[LinkedIn]', 'LinkedIn URL', {type: 'url'})}
  ${select('heard', 'How did you hear about us?', ['Job board', 'Referral', 'Company website', 'Other'], {required: true})}
  ${area('why', 'Why do you want to work at E2E Lever Systems?', {required: true})}
  ${submit}</form>`,
  `setTimeout(() => { document.getElementById('late-slot').innerHTML = ${JSON.stringify(field('org', 'Current company', {required: true}))}; }, ${Number(process.env.E2E_LATE_MS) || lateMs});`),
  // Two steps on one page: step 2 (salary, consent, Submit) is hidden until the person presses Next.
  multistep: form => page(form, `<form id="application_form">
  <section id="step1"><h2>Step 1 of 2: about you</h2>
  ${field('first_name', 'First name', {required: true})}${field('last_name', 'Last name', {required: true})}${field('email', 'Email', {type: 'email', required: true})}${resume}
  <div class="field"><button type="button" id="next_step">Next</button></div></section>
  <section id="step2" hidden><h2>Step 2 of 2: your terms</h2>
  ${field('salary', 'Salary expectation (CHF per year)', {required: true})}${field('start_date', 'Earliest start date', {required: true})}
  ${field('sponsorship', 'Will you now or in the future require sponsorship for employment visa status?', {required: true})}
  ${consent('consent_data', 'I agree to the processing of my personal data (privacy policy)')}
  ${submit}</section></form>`,
  `document.getElementById('next_step').addEventListener('click', () => { document.getElementById('step1').hidden = true; document.getElementById('step2').hidden = false; });`),
  workday: form => {
    const wd = (id, auto, label, {type = 'text', required = true, tag = 'input'} = {}) => `<div class="field" data-automation-id="formField-${auto}"><label id="lbl-${id}">${esc(label)}${required ? '<abbr title="required">*</abbr>' : ''}</label>` +
      (tag === 'textarea' ? `<textarea id="${id}" data-automation-id="${auto}" aria-labelledby="lbl-${id}"${required ? ' aria-required="true"' : ''} rows="3"></textarea>` : `<input id="${id}" data-automation-id="${auto}" type="${type}" aria-labelledby="lbl-${id}"${required ? ' aria-required="true"' : ''}>`) + '</div>';
    return page(form, `<div data-automation-id="applyFlowPage"><h2 data-automation-id="pageHeader">My Information</h2><form id="application_form" data-automation-id="applyFlowForm">
  ${wd('input-2', 'legalNameSection_firstName', 'First Name')}${wd('input-3', 'legalNameSection_lastName', 'Last Name')}${wd('input-4', 'email', 'Email Address', {type: 'email'})}
  <div class="field" data-automation-id="formField-resume"><label id="lbl-input-5">Resume/CV<abbr title="required">*</abbr></label><input id="input-5" data-automation-id="file-upload-input-ref" type="file" aria-labelledby="lbl-input-5" aria-required="true"></div>
  <div class="field" data-automation-id="formField-source"><label id="lbl-source">${esc(form.dropdown)}<abbr title="required">*</abbr></label><button type="button" id="source" data-automation-id="sourcePrompt" aria-haspopup="listbox" aria-labelledby="lbl-source" aria-required="true">Select One</button></div>
  ${wd('input-7', 'questionnaire_aws', form.kit[0].question)}${wd('input-9', 'questionnaire_notice', form.kit[1].question, {tag: 'textarea'})}
  <div class="field"><button type="submit" id="submit_app" data-automation-id="bottom-navigation-next-button">Submit</button></div></form></div>`);
  },
  submitter: (form, done = false, bare = false) => page(form, `${done ? '<p id="done" style="padding:8px;background:#e6f4ea">Your application has been successfully submitted. Thank you, we have received your application.</p>' : ''}<form id="application_form" method="post" action="${bare ? form.autoPath : form.path}">
  ${field('first_name', 'First name', {required: true})}${field('last_name', 'Last name', {required: true})}${field('email', 'Email', {type: 'email', required: true})}${resume}
  ${bare ? '' : field('question_4001', 'Years of experience with Linux', {required: true})}${submit}</form>`, '', {realSubmit: true}),
  // A required control the form reader has no operator for: a custom slider (a div with role=slider).
  unknown: form => page(form, `<form id="application_form">
  ${field('first_name', 'First Name', {required: true})}${field('last_name', 'Last Name', {required: true})}${field('email', 'Email', {type: 'email', required: true})}${resume}
  ${field('question_2001', 'Years of experience with Terraform', {required: true})}
  <div class="field"><div id="skill-label">${esc(form.widget)} *</div>
  <div role="slider" id="skill" aria-labelledby="skill-label" aria-required="true" aria-valuemin="1" aria-valuemax="5" aria-valuenow="1" tabindex="0" style="width:240px;height:24px;background:#ddd;border-radius:12px"></div></div>
  ${submit}</form>`),
};

// -> {url, host, port, close(), fired: [{kind, form}] (what happened to a Submit), forms: {name: form}}. https, a self-made certificate.
// A real form's page from its spec: the person's details first (as every board asks), then each field the extension failed on, as the kind it was.
// A real form's field id, from its label and place (the suite reads the field back by it).
export const realFieldId = (label, i) => `real_${i}_${String(label).toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 30)}`;
export function realPage(form) {
  const spec = form.real, slug = realFieldId;
  const fields = spec.fields.map((item, i) => {
    const id = slug(item.label, i), required = item.required !== false;
    if (item.kind === 'select') return select(id, item.label, item.options?.length ? item.options : ['Yes', 'No', 'Prefer not to say'], {required});
    if (item.kind === 'textarea') return area(id, item.label, {required});
    if (item.kind === 'widget') return `<div class="field"><label id="lbl-${id}">${esc(item.label)}${required ? ' *' : ''}</label><button type="button" id="${id}" role="combobox" aria-haspopup="listbox" aria-expanded="false" aria-labelledby="lbl-${id}"${required ? ' aria-required="true"' : ''}>Select…</button></div>`;
    if (item.kind === 'checkbox') return `<div class="field"><label><input id="${id}" name="${id}" type="checkbox"${required ? ' required' : ''}> ${esc(item.label)}${required ? ' *' : ''}</label></div>`;
    return field(id, item.label, {required});
  });
  return page(form, `<form id="application_form">${field('first_name', 'First Name', {required: true})}${field('last_name', 'Last Name', {required: true})}${field('email', 'Email', {type: 'email', required: true})}${resume}
  ${fields.join('\n  ')}
  ${submit}</form>`);
}

export async function startForms({vary = null} = {}) {
  const variation = varyForms(vary);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-e2e-cert-'));
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2', '-subj', '/CN=jp-e2e', '-keyout', path.join(dir, 'key.pem'), '-out', path.join(dir, 'cert.pem')], {stdio: 'ignore'});
  const fired = [];
  const posts = [];   // the real Submit of FORMS.submitter (done by the test as the person)
  const hits = [];
  const signinPosts = [];   // each press of a sign-in fixture's button the site received: which page, and whether the email and the password were the right ones
  const server = https.createServer({key: fs.readFileSync(path.join(dir, 'key.pem')), cert: fs.readFileSync(path.join(dir, 'cert.pem'))}, (req, res) => {
    const url = new URL(req.url, 'https://x');
    const host = String(req.headers.host || '').split(':')[0];
    hits.push(`${host}${url.pathname}`);
    if (req.method === 'POST' && url.pathname === '/__fired') { fired.push({kind: url.searchParams.get('kind'), form: url.searchParams.get('form')}); res.writeHead(204).end(); return; }
    const signup = url.pathname.replace(/(.)\/$/, '$1');
    if (host === MISLABELLED.host && signup === MISLABELLED.path) { res.writeHead(200, {'content-type': 'text/html; charset=utf-8'}); res.end(page(MISLABELLED, `<form id="application_form">${field('first_name', 'First name', {required: true})}${field('last_name', 'Last name', {required: true})}${field('email', 'E-mail', {type: 'email', required: true})}${field('question_3001', 'Years of experience with Kubernetes', {required: true})}<div class="field"><button type="submit" id="submit_app">Submit Application</button></div></form>`)); return; }
    if (host === ONEPAGE.host && signup === ONEPAGE.path) { res.writeHead(200, {'content-type': 'text/html; charset=utf-8'}); res.end(ONEPAGE_HTML()); return; }
    if (host === SIGNUP.host && signup === SIGNUP.path) { res.writeHead(200, {'content-type': 'text/html; charset=utf-8'}); res.end(SIGNUP_PAGES.posting()); return; }
    if (host === SIGNUP.accountHost && signup === SIGNUP.accountPath) {
      if (req.method === 'POST') { req.resume(); req.on('end', () => res.writeHead(303, {location: SIGNUP.formPath}).end()); return; }   // the account is made: on to the form
      res.writeHead(200, {'content-type': 'text/html; charset=utf-8'}); res.end(SIGNUP_PAGES.account()); return;
    }
    if (host === COLLAPSED.host && signup === COLLAPSED.path) { res.writeHead(200, {'content-type': 'text/html; charset=utf-8'}); res.end(COLLAPSED_PAGE(COLLAPSED)); return; }
    if (host === REVEAL.host && signup === REVEAL.path) { res.writeHead(200, {'content-type': 'text/html; charset=utf-8'}); res.end(REVEAL_PAGE(REVEAL)); return; }
    if (host === PROPOSE.host && signup === PROPOSE.path) { res.writeHead(200, {'content-type': 'text/html; charset=utf-8'}); res.end(PROPOSE_PAGE(PROPOSE)); return; }
    for (const fixture of [MENU_FIRST, MENU_AGAIN]) if (host === fixture.host && signup === fixture.path) { res.writeHead(200, {'content-type': 'text/html; charset=utf-8'}); res.end(MENU_PAGE(fixture)); return; }
    for (const fixture of [SIGNIN, SIGNIN_REFUSED]) {
      const html = body => { res.writeHead(200, {'content-type': 'text/html; charset=utf-8'}); res.end(body); };
      if (host === fixture.host && signup === fixture.path) { html(SIGNIN_PAGES.posting(fixture)); return; }
      if (host === fixture.accountHost && signup === fixture.formPath) { html(SIGNIN_PAGES.form(fixture)); return; }
      if (host === fixture.accountHost && signup === `${fixture.accountPath}/new` && req.method !== 'POST') { html(SIGNIN_PAGES.signup(fixture)); return; }
      if (host !== fixture.accountHost || signup !== fixture.accountPath) continue;
      if (req.method !== 'POST') { html(SIGNIN_PAGES.account(fixture)); return; }
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        const sent = new URLSearchParams(body);
        const right = fixture === SIGNIN && sent.get('signin_password') === SIGNIN_PASSWORD && sent.get('signin_email') === CONTACT.email;
        signinPosts.push({path: fixture.accountPath, right, email: sent.get('signin_email') === CONTACT.email, password: sent.get('signin_password') === SIGNIN_PASSWORD});   // never the values
        if (right) res.writeHead(303, {location: fixture.formPath}).end();
        else html(SIGNIN_PAGES.account(fixture, 'The email or password is wrong. Please try again.', sent.get('signin_email') || ''));   // like real sites: the email stays, the password box is empty again
      });
      return;
    }
    if (host === SIGNUP.accountHost && signup === SIGNUP.formPath) { res.writeHead(200, {'content-type': 'text/html; charset=utf-8'}); res.end(SIGNUP_PAGES.form()); return; }
    const bare = host === FORMS.submitter.host && url.pathname === FORMS.submitter.autoPath;   // the details-only variant of the submitter
    if (req.method === 'POST' && host === FORMS.submitter.host && (url.pathname === FORMS.submitter.path || bare)) {
      posts.push({host, path: url.pathname});
      req.resume();
      req.on('end', () => { res.writeHead(303, {location: `${url.pathname}?sent=1`}).end(); });   // post, redirect, get: the way most sites answer a form
      return;
    }
    if (host === FORMS.submitter.host && (url.pathname === FORMS.submitter.path || bare) && (url.searchParams.get('sent') || bare)) {
      res.writeHead(200, {'content-type': 'text/html; charset=utf-8'}); res.end(PAGES.submitter(FORMS.submitter, !!url.searchParams.get('sent'), bare));
      return;
    }
    const chain = host === CHAIN.host && url.pathname.replace(/(.)\/$/, '$1') === CHAIN.path ? 'posting' : host === CHAIN.stepHost && url.pathname.replace(/(.)\/$/, '$1') === CHAIN.stepPath ? 'step'
      : host === CHAIN.stepHost && url.pathname.replace(/(.)\/$/, '$1') === CHAIN.formPath ? 'form' : '';
    const scripted = host === SCRIPTED.host && url.pathname.replace(/(.)\/$/, '$1') === SCRIPTED.path ? 'posting'
      : host === SCRIPTED.formHost && url.pathname.replace(/(.)\/$/, '$1') === SCRIPTED.formPath ? 'form' : '';
    if (scripted) { res.writeHead(200, {'content-type': 'text/html; charset=utf-8'}); res.end(SCRIPTED_PAGES[scripted]()); return; }
    const late = host === LATE.host && url.pathname.replace(/(.)\/$/, '$1') === LATE.path ? 'posting' : host === LATE.formHost && url.pathname.replace(/(.)\/$/, '$1') === LATE.formPath ? 'form' : '';
    if (late) { res.writeHead(200, {'content-type': 'text/html; charset=utf-8'}); res.end(LATE_PAGES[late]()); return; }
    if (chain === 'form') {   // only the step's POST opens the form
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => { res.writeHead(200, {'content-type': 'text/html; charset=utf-8'}); res.end(CHAIN_PAGES[req.method === 'POST' && /(^|&)ref=chain-step(&|$)/.test(body) ? 'form' : 'expired']()); });
      return;
    }
    if (chain) { res.writeHead(200, {'content-type': 'text/html; charset=utf-8'}); res.end(CHAIN_PAGES[chain]()); return; }
    const name = Object.keys(FORMS).find(key => FORMS[key].host === host && [FORMS[key].path, FORMS[key].formPath].includes(url.pathname.replace(/(.)\/$/, '$1')));
    if (!name) { res.writeHead(404, {'content-type': 'text/plain'}).end('not a fixture form'); return; }
    res.writeHead(200, {'content-type': 'text/html; charset=utf-8'});
    res.end((PAGES[name] || realPage)(FORMS[name]));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  return {port, fired, posts, hits, signinPosts, variation, forms: FORMS, close: () => new Promise(resolve => { server.close(resolve); server.closeAllConnections?.(); }), html: name => (PAGES[name] || realPage)(FORMS[name])};
}

// Chromium flags that send the job-site host names to the fixture server and make every other name unresolvable (no employer is ever contacted).
export const hostRules = port => [...HOSTS.map(host => `MAP ${host} 127.0.0.1:${port}`), 'MAP * ~NOTFOUND , EXCLUDE 127.0.0.1 , EXCLUDE localhost'].join(', ');
