// The live page-kind calls, kept for the pool's replay candidates (owner, 11 Oct 2026: a rung-2/3 fixture is built from what the app really received, not from a
// load-time capture or a hand-written stub). Writes ONLY when the e2e harness sets LIVE_CAPTURE_DIR: with no variable there is no code path. Local only, no network.
// What is kept: the page sketch the extension sent and the app's answer, scrubbed BEFORE writing (no query string, no email, no phone, no typed value, no secret key).
// The file: <LIVE_CAPTURE_DIR>/ai-calls.json = [{route, at, request, answer}]; desktop/e2e/record-sites.mjs copies it into the replay candidate's folder.
// Guard: desktop/test/live-capture.test.js (also: the shipped app source calls it in one place).
import fs from 'node:fs';
import path from 'node:path';
import {everyRealDataFolder} from './app-identity.js';

const SECRET_KEYS = /^(value|values|typed|cookie|cookies|password|passwd|token|authorization|secret|session)$/i;   // words-ok: object KEY names to drop from what is written, never page text or a judgment about a page
const QUERY = /\?[\w%.~-]+=[^\s"'<>&]*(?:&[\w%.~-]+=[^\s"'<>&]*)*/g;
// One fake contact for every scrub: the page capture (e2e/lib/capture-page.mjs) uses the same rule, so a replay of a captured page sends the sketch the live run
// sent (speed-5x, 11 Oct 2026: two fake emails made 3 of 18 replayed pages differ). An example.* email is kept; a number of 9+ digits is a phone.
export const FAKE_EMAIL = 'test.candidate@example.com', FAKE_PHONE = '(phone)';
// A phone: 9+ digits standalone; a digit run glued to a word character is an identifier (Greenhouse's question_4553828006: scrubbing it broke every label's for=, 11 Oct 2026).
export const EMAIL = /(?<![\w.+-])[\w.+-]+@[\w-]+(?:\.[\w-]+)*\.[A-Za-z][\w-]*/g, PHONE = /(?<![\w])\+?\d[\d\s().-]{8,}\d(?![\w])/g;
// The reserved example domains (RFC 2606: example.com, .org, .net and example.test) are never a person's: the offline runs' fake applicant is ada.tester@example.test. Other .test names stay personal (a test person's).
// Why (27 Oct 2026): a retina image name (flags@2x.9790563a0e331d13.webp) has the shape of an address but names a file; rewriting it changed Starling Bank's recorded stylesheets. Only "@<n>x" + an image extension, or "@tag" + a script/style file (sdk@beta.umd.js, an npm tag in Vimeo's player).
export const EXAMPLE = /@example\.(?:com|org|net|test)$|@\dx(?:\.[\w-]+)*\.(?:png|jpe?g|gif|webp|svg|avif|ico)$|@[a-z]+(?:\.[\w-]+)*\.(?:m?js|css|map)$/i;   // words-ok: the reserved domains, never page text
// Why (27 Oct 2026): a scrubbed address keeps the LENGTH of the one it replaces (as far as "@example.com" allows: 13+ characters). Personio's posting is a Next.js page whose text chunks carry their byte length
// ("e20:T48e,"); a 25-character fake for a 21-character address broke every chunk after it, React failed to hydrate and the replay stopped at a blank posting. The local part is "test.candidate" padded (25+ characters) or only underscores (13-24: a marker no real page holds, so test@example.com stays itself)
// with underscores (a digit run would be read as a number by the memo key); the AI's memo key (normalise -> fakeContacts) folds every such fake back to FAKE_EMAIL, so the page text still keys to the live run's kept answers.
const FAKE_LOCAL = FAKE_EMAIL.slice(0, FAKE_EMAIL.indexOf('@')), EXAMPLE_COM = '@example.com';
// email (a string that EMAIL matched) -> an example.com address of the same length when it is 13+ characters long, else FAKE_EMAIL; never throws, reads no data. Used by the publish scrub (lib/report-scrub.js).
export const sameLengthFake = email => (email.length >= FAKE_EMAIL.length ? `${FAKE_LOCAL}${'_'.repeat(email.length - FAKE_EMAIL.length)}${EXAMPLE_COM}` : email.length > EXAMPLE_COM.length ? `${'_'.repeat(email.length - EXAMPLE_COM.length)}${EXAMPLE_COM}` : FAKE_EMAIL);
const isScrubFake = email => email.endsWith(EXAMPLE_COM) && /^(?:_+|test\.candidate_*)$/.test(email.slice(0, -EXAMPLE_COM.length));
// value (any string) -> the same text with every non-example address as FAKE_EMAIL (a same-length scrub fake folds back to it) and every 9+ digit phone as FAKE_PHONE; never throws. Used by the page capture and the memo key.
export const fakeContacts = value => value.replace(EMAIL, email => (isScrubFake(email) ? FAKE_EMAIL : EXAMPLE.test(email) ? email : FAKE_EMAIL))
  .replace(PHONE, number => (number.replace(/\D/g, '').length >= 9 ? FAKE_PHONE : number));
const text = value => fakeContacts(value.replace(QUERY, ''));

// -> the same shape without what a public repo and a log must not hold.
export function scrub(value) {
  if (typeof value === 'string') return text(value);
  if (Array.isArray(value)) return value.map(scrub);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key]) => !SECRET_KEYS.test(key)).map(([key, one]) => [key, scrub(one)]));
  return value;
}

const insideRealData = dir => {   // the app's own folder (never "Job Pilotto QA", which is the pool's)
  return everyRealDataFolder().some(real => (path.resolve(dir) + path.sep).startsWith(path.resolve(real) + path.sep));
};

// -> true when written. Never throws: a capture must not change what the app does.
export function captureCall({route, request, answer}, {env = process.env, now = Date.now} = {}) {
  const dir = env.LIVE_CAPTURE_DIR;
  if (!dir || insideRealData(dir)) return false;
  try {
    const file = path.join(dir, 'ai-calls.json');
    fs.mkdirSync(dir, {recursive: true});
    let calls = [];
    try { calls = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* a first call */ }
    calls.push({route, at: now(), request: scrub(request), answer: scrub(answer)});
    fs.writeFileSync(file, JSON.stringify(calls, null, 1));
    return true;
  } catch { return false; }
}

// A page-kind ask (and the form judge's: a later ask sees the page as the site's own script left it, e.g. the resume widget's "CV.PDF Success!"), noted the moment it arrives, before the AI answers (speed-5x landing 2: the harness snapshots the asked page then, as the extension saw it; the full
// call is written by captureCall once answered, by which time the extension may have pressed on). <LIVE_CAPTURE_DIR>/asks.jsonl, one {url, at, route} a line. -> true when written.
export function noteAsk(url, {env = process.env, now = Date.now, route = '/extension/page-kind'} = {}) {
  const dir = env.LIVE_CAPTURE_DIR;
  if (!dir || insideRealData(dir) || !url) return false;
  try { fs.mkdirSync(dir, {recursive: true}); fs.appendFileSync(path.join(dir, 'asks.jsonl'), `${JSON.stringify({url: text(String(url)), at: now(), route})}\n`); return true; } catch { return false; }
}

// The form-answer call (worker answerForm's env.onAnswerCall, wired in server-env.js), kept the same way: which fields were asked and, per answer, its
// category and use. Never a value, a note or the page text (11 Oct 2026, Datadog: the evidence could not show that a question was never asked).
export function captureAnswer({url = '', fields = [], answers = []} = {}, options = {}) {
  const asked = (Array.isArray(fields) ? fields : []).map(f => ({field: String(f?.field || ''), label: String(f?.label || ''), type: String(f?.type || ''), required: !!f?.required}));
  const kinds = (Array.isArray(answers) ? answers : []).map(a => ({field: String(a?.field || ''), category: String(a?.category || ''), use: String(a?.use || '')}));
  return captureCall({route: '/extension/answer', request: {url: String(url), fields: asked}, answer: {answers: kinds}}, options);
}
