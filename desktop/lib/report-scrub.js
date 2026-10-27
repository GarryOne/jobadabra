// The scrub of a "Report this form" record (spec docs/superpowers/specs/2026-10-15-report-this-form.md §2): the record keeps its shape (hosts, paths, timings, statuses) and loses
// whatever could be the person's: URL query values, typed-value attributes and text, the person's own values (lib/owner-values.js), any e-mail or phone. Then lastGate() scans the
// result again with the same values: one hit and nothing is sent. Kinds and counts only ever leave here, never a value. Pure: no files, no network.
// Guard: test/report-scrub.test.js.
import {EMAIL, EXAMPLE, FAKE_EMAIL, PHONE, fakeContacts, sameLengthFake} from './live-capture.js';
import {KEEP_HEADER, keepRecord, sha} from './net-keep.js';

const CODE = /javascript|ecmascript|text\/css/i, TEXT = /^(text\/|application\/([\w.+-]*\+)?(json|xml)\b|application\/(x-)?(javascript|ecmascript|x-www-form-urlencoded)\b)/i;   // a text kind by its whole type ("vnd.openxmlformats..." is a Word file, not XML)
// A body is kept only when its type is one the scrub understands (text kinds, fonts, wasm, SVG: an image already blanked is SVG); anything else, or no type at all, is dropped
// (a CV echoed back after an upload, a PDF, base64 blobs). Review of #798: the scrub fails closed.
const KEPT = /^(font\/|application\/(font|x-font|vnd\.ms-fontobject|wasm)|image\/svg\+xml)/i;
const understood = type => TEXT.test(type) || KEPT.test(type);

// The forms a value can hide in: URL-encoded (+ for a space), JSON-escaped, HTML entities, one decoding on top of another (up to 3 deep). -> [text, ...its decoded forms]
const NAMED = {amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' '};
const htmlDecode = text => text.replace(/&(?:#(\d+)|#x([0-9a-f]+)|(amp|lt|gt|quot|apos|nbsp));/gi, (_, dec, hex, name) => (name ? NAMED[name.toLowerCase()] : String.fromCodePoint(Math.min(0x10ffff, dec ? Number(dec) : parseInt(hex, 16)))));
const jsonDecode = text => text.replace(/\\u([0-9a-f]{4})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16))).replace(/\\x([0-9a-f]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16))).replace(/\\([/"'\\])/g, '$1');
const urlDecode = text => { const spaced = text.replace(/\+/g, ' '); try { return decodeURIComponent(spaced); } catch { return spaced.replace(/%([0-9a-f]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16))); } };
export function decodedForms(text) {
  const forms = new Set([text]);
  let layer = [text];
  for (let depth = 0; depth < 3; depth += 1) {
    layer = layer.flatMap(form => [urlDecode(form), jsonDecode(form), htmlDecode(form)]).filter(form => !forms.has(form));
    for (const form of layer) forms.add(form);
    if (!layer.length) break;
  }
  return [...forms];
}
// A long base64 run decoded, as latin1: a PDF or a name inside JSON.
const BASE64 = /[A-Za-z0-9+/_-]{40,}={0,2}/g;
const b64Forms = text => (text.match(BASE64) || []).map(run => Buffer.from(run.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('latin1'));
// The few encoded spellings of "@" and of a space that stand between an e-mail's or phone's parts: written plain before the scrub, so its shapes match (a page does not break on a raw @).
// Why (27 Oct 2026, owner: scrub missed an e-mail in a recorded Personio page): an "@" can be encoded more than once ("%2540", "&amp;#64;", "\\u0040" inside a JSON string), so each spelling allows its own escape layers in front. Narrowed the same day: an encoded @ is written plain only where an address stands around it (the next Why).
// Why (27 Oct 2026): a "%40" is written plain ONLY where an address stands around it. Site code spells modulo 400 as e%400==0; rewriting every "%40" broke Starling Bank's and a Personio row's bundle
// (e@0==0), so the recorded page never booted and its replay stopped at the posting. The left part is the run of address characters before it, the right part must read as a host with a dot.
const ENCODED_AT = /%(?:25)*40|&(?:amp;)*(?:#0*64|#x0*40|commat);|\\+u0040|\\+x40/gi, AT_RIGHT = /^[\w-]+(?:\.[\w-]+)*\.[A-Za-z]/, AT_LEFT = /[\w.+-]+$/;
const NBSP = /&nbsp;|&#0*160;|&#xa0;/gi;
const plainSeparators = (text, {spaces = true} = {}) => text.replace(ENCODED_AT, (found, at) => (AT_LEFT.test(text.slice(Math.max(0, at - 64), at)) && AT_RIGHT.test(text.slice(at + found.length, at + found.length + 255)) ? '@' : found)).replace(spaces ? NBSP : /(?!)/g, ' ');

const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const ONE_EMAIL = new RegExp(`^${EMAIL.source}$`);
const TOKEN = /^(?=.*\d)[A-Za-z0-9_-]{16,}$/;   // an id-like path segment: long, with a digit

// A URL with its query values and fragment gone, an e-mail or id-like path segment named <id>. -> string
export function scrubUrl(url) {
  let u;
  try { u = new URL(url, 'https://x.invalid'); } catch { return String(url).split('#')[0].split('?')[0]; }
  const path = u.pathname.split('/').map(part => (ONE_EMAIL.test(urlDecode(part)) || TOKEN.test(part) ? '<id>' : part)).join('/');   // urlDecode never throws: a path with a bare "%" is common (16 Oct 2026 recording of a Doctolib form)
  const keys = [...u.searchParams.keys()], query = keys.length ? `?${keys.map(key => `${encodeURIComponent(key)}=<v>`).join('&')}` : '';
  return `${/^https?:/i.test(url) ? `${u.protocol}//${u.host}` : ''}${path}${query}`;
}

// What the person typed in a page's own markup: an input's value, a textarea's text, a chosen option. A button's, radio's or checkbox's value is the page's own wording.
const KEEPS_VALUE = /\btype\s*=\s*["']?(submit|button|reset|image|radio|checkbox)\b/i;   // words-ok: HTML's own input type names, not page wording
function blankTyped(html, counts) {
  let out = html.replace(/<input\b[^>]*>/gi, tag => (KEEPS_VALUE.test(tag) ? tag : tag.replace(/(\svalue\s*=\s*)("[^"]*"|'[^']*'|[^\s>]+)/i, (_, head) => { counts.typed += 1; return `${head}""`; })));
  out = out.replace(/(<textarea\b[^>]*>)([^<]+)(<\/textarea>)/gi, (_, open, body, close) => { counts.typed += 1; return `${open}${close}`; });
  return out.replace(/<option\b[^>]*\sselected\b[^>]*>/gi, tag => { counts.typed += 1; return tag.replace(/\sselected(\s*=\s*("[^"]*"|'[^']*'|[^\s>]+))?/i, ''); });
}

// A session token, CSRF token or credential inside a body (an API answer carrying an auth token, a token in a page's meta tag or boot data), found by the FIELD NAME it sits in and by the shape of a
// JWT / Bearer value, never by the value's words; it is replaced by <token>. A reported journey crosses more pages and answers, so this runs on every kept text body. Kinds only: counts.tokens.
const SECRET_KEY = '(?:token|secret(?!ar)|passw(?:or)?d|passwd|csrf|xsrf|nonce|auth(?!or)|(?<!pos|ob)session|sess?id|(?<![a-z])sid(?![a-z])|jwt|bearer|api[_-]?key|access[_-]?key|credential|signature)';   // words-ok: field names of credentials; sid only as its own word (not residenceCountry, president)
const QUOTED_SECRET = new RegExp(`(["']?[\\w.-]{0,60}${SECRET_KEY}[\\w.-]{0,60}["']?\\s*[:=]\\s*)(["'])((?:(?!\\2)[^\\\\\\n]|\\\\.){6,}?)\\2`, 'gi');
const BARE_SECRET = new RegExp(`(\\b[\\w.-]{0,60}${SECRET_KEY}[\\w.-]{0,60}=)([A-Za-z0-9._~+/%-]{10,})`, 'gi');   // key=value pairs of a form body or text
const META_SECRET = new RegExp(`(<meta\\b[^>]*\\bname\\s*=\\s*["'][^"']*${SECRET_KEY}[^"']*["'][^>]*\\bcontent\\s*=\\s*)("[^"]*"|'[^']*')`, 'gi');
const JWT = /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g, BEARER = /\b(Bearer\s+)[A-Za-z0-9._~+/=-]{12,}/gi;
function tokensOut(text, code, counts) {
  const hit = replacement => (...match) => { counts.tokens += 1; return typeof replacement === 'function' ? replacement(...match) : replacement; };
  let out = text.replace(QUOTED_SECRET, hit((_, head, quote) => `${head}${quote}<token>${quote}`)).replace(JWT, hit('<token>')).replace(BEARER, hit((_, head) => `${head}<token>`));
  if (!code) out = out.replace(META_SECRET, hit((_, head) => `${head}"<token>"`)).replace(BARE_SECRET, hit((_, head) => `${head}<token>`));
  return out;
}

// Owner values that may be replaced or searched in this kind of text: code (a script, a style sheet) takes e-mails, phones and multi-word values only, so a name word that is also
// an identifier never breaks a page's code.
const usable = (values, code) => [...values].filter(([value, kind]) => !code || kind === 'email' || kind === 'phone' || /\s/.test(value));
// In code, two or more of the person's name words in a row ("Rosalind Quill") are a name, not an identifier. -> RegExp or null
const nameRun = values => {
  const words = [...values].filter(([, kind]) => kind === 'name').map(([value]) => escape(value));
  return words.length > 1 ? new RegExp(`(?<![\\p{L}\\p{N}])(?:${words.join('|')})(?:\\s+(?:${words.join('|')}))+(?![\\p{L}\\p{N}])`, 'giu') : null;
};
const SPACE = '(?:\\s|%20|\\+|&nbsp;|&#0*32;|&#0*160;)+';   // the gaps of a multi-word value, as a page or an address may write them
const NAME = 'Candidate', PLACE = 'Elsewhere';

// One matcher for the person's words, used by the scrub AND the last gate (so the gate can never find what the scrub did not look for): accents and case aside ("Chișinău" is "chisinau"),
// the gaps of a multi-word value as a page writes them, and bounded by letters/digits. In a script a lone word is the person's only when it stands as text (between quotes, commas, spaces, tags):
// `x.moldova`, `zoe()` and `a_bronte` are identifiers, left alone and not searched for (the report reads the code; it does not run it).
const fold = text => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const AS_TEXT_BEFORE = '(?<=["\'`>|,;:\\s\\[{])', AS_TEXT_AFTER = '(?=["\'`<|,;:\\s\\]}])';
export function valueMatcher(value, code = false) {
  const words = fold(value).split(/\s+/).filter(Boolean).map(word => [...word].map(ch => `${escape(ch)}\\p{M}*`).join(''));
  const body = words.join(SPACE), lone = words.length === 1;
  return code && lone ? new RegExp(`${AS_TEXT_BEFORE}${body}${AS_TEXT_AFTER}`, 'giu') : new RegExp(`(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`, 'giu');
}
// A value's replacement across accents: matched on the decomposed text, written back composed. Unchanged text comes back as it was. -> text
function replaceValue(text, re, replacement, counts) {
  const nfd = text.normalize('NFD');
  let hit = false;
  const out = nfd.replace(re, () => { hit = true; counts.own += 1; return replacement; });
  return hit ? out.normalize('NFC') : text;
}

function ownOut(text, values, code, counts, report = false) {
  let out = code && nameRun(values) ? text.replace(nameRun(values), () => { counts.own += 1; return NAME; }) : text;
  for (const [value, kind] of (report ? [...values] : usable(values, code))) {
    if (kind === 'phone') continue;   // a phone is scrubbed by shape below (any 9+ digits), whatever its separators
    if (kind === 'email' || kind === 'account') {
      out = out.replace(new RegExp(escape(value), 'giu'), () => { counts.own += 1; return FAKE_EMAIL; });
      continue;
    }
    out = replaceValue(out, valueMatcher(value, code), kind === 'location' ? PLACE : NAME, counts);   // every case: a name in capitals is still the name
  }
  return out;
}
function contactsOut(text, counts) {
  EMAIL.lastIndex = 0; PHONE.lastIndex = 0;
  const out = fakeContacts(text);
  if (out !== text) counts.contacts += (text.match(EMAIL) || []).filter(e => !EXAMPLE.test(e)).length + (text.match(PHONE) || []).filter(p => p.replace(/\D/g, '').length >= 9).length;
  return out;
}

// Why (27 Oct 2026): after a backslash the first letters of the match are an escape (\u003e, \x3c, \n), not part of the address: Personio's page data holds \u003eprivacy@host, and rewriting u003eprivacy
// removed the > so the markup after it broke (React error 412, a blank posting). -> the escape's text ('' when no backslash precedes the match).
const escapeLead = (email, at, whole) => (whole[at - 1] === '\\' ? (/^(?:u[0-9a-f]{4}|x[0-9a-f]{2}|[nrtbfv])/i.exec(email) || [''])[0] : '');

// The personal part of ONE recorded response, for a record a REPLAY reads (e2e/lib/record-scrub.mjs, run by records-publish.mjs): the person's own values (names, places, e-mails, phones by value) and any
// e-mail address, by the definitions above (ownOut, EMAIL, EXAMPLE), and nothing else: a replay needs the page, its URLs, its typed values, its numbers and its tokens as the site sent them (a phone SHAPE
// would rewrite a timestamp in a JSON answer). Unchanged text comes back as it was (no re-encoding, so its hash stays). null when the body is not a text kind. -> {text, counts: {own, contacts, phones}} | null
export function scrubPersonal(text, {type = '', url = '', values = new Map()} = {}) {
  if (!TEXT.test(type)) return null;
  let path = ''; try { path = new URL(url, 'https://x.invalid').pathname; } catch { /* no address */ }
  const code = CODE.test(type) || /\.(m?js|css)(\?|$)/i.test(path), counts = {own: 0, contacts: 0, phones: 0}, original = String(text);
  // Why (27 Oct 2026): a non-breaking space is written plain only when that finds more of the person's own values (a name split by one); otherwise the page keeps its "&nbsp;", because the AI's
  // kept answers are keyed by the page text and Personio's posting stopped matching them (0 of 6) after every one became a space.
  const pass = spaces => {
    const found = {own: 0, contacts: 0, phones: 0};
    let out = ownOut(plainSeparators(original, {spaces}), values, code, found);
    EMAIL.lastIndex = 0;
    out = out.replace(EMAIL, (email, at, whole) => { if (EXAMPLE.test(email)) return email; const lead = escapeLead(email, at, whole), rest = email.slice(lead.length); if (rest.startsWith('@')) return email; found.contacts += 1; return lead + sameLengthFake(rest); });
    out = b64EmailsOut(out, found);
    for (const [value, kind] of values) {
      if (kind !== 'phone') continue;
      const digits = String(value).replace(/\D/g, '');
      if (digits.length < 9) continue;
      out = out.replace(new RegExp(escape(String(value)), 'g'), () => { found.phones += 1; return '(phone)'; });
    }
    return {out, found};
  };
  let {out, found} = pass(false);
  NBSP.lastIndex = 0;
  if (NBSP.test(original)) { const spaced = pass(true); if (spaced.found.own + spaced.found.phones > found.own + found.phones) ({out, found} = spaced); }
  Object.assign(counts, found);
  return counts.own || counts.contacts || counts.phones ? {text: out, counts} : {text: original, counts};
}

// An address inside a base64 run (a JSON answer or a token carrying one): the run is decoded, the address (when the text around it is text, as the gate counts it) becomes the fake one, and the run is written back in
// its own alphabet. A run with no address stays as it was. Why (27 Oct 2026, owner): personalHits searches base64 runs, so the replay scrub has to clean them or the publish gate refuses the row.
const b64EmailsOut = (text, counts) => text.replace(BASE64, run => {
  // The alphabet and padding are read from the run itself (a base64url run of 40+ characters often has no "-" or "_"); the separators inside are written plain first, as the gate decodes them.
  const urlSafe = !/[+/=]/.test(run), padded = /=$/.test(run), inner = plainSeparators(Buffer.from(run.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('latin1'));
  let replaced = 0;
  EMAIL.lastIndex = 0;
  const clean = inner.replace(EMAIL, (email, ...rest) => {
    const at = rest[rest.length - 2];
    if (EXAMPLE.test(email) || !inText(inner, at, email.length)) return email;
    replaced += 1; return FAKE_EMAIL;
  });
  if (!replaced) return run;
  counts.contacts += replaced;
  const b64 = Buffer.from(clean, 'latin1').toString('base64'), out = urlSafe ? b64.replace(/\+/g, '-').replace(/\//g, '_') : b64;
  return padded ? out : out.replace(/=+$/, '');
});

// What a scrubbed replay record must no longer hold, in every decoded form (URL, JSON, HTML entities, base64): an e-mail address that is not an example one, and any of the person's own values.
// Narrower than lastGate (no phone SHAPE, no token shapes: those would fire on a replay's own numbers). -> [kind, ...] (kinds only, never a value)
// An address found in the bytes of a decoded base64 run counts only when the text around it is text (90% of the 32 characters each side printable): random bytes of an embedded binary spell "x@hZ.B" by chance (17 Oct 2026).
const printable = ch => ch >= 0x20 && ch < 0x7f || ch === 0x09 || ch === 0x0a || ch === 0x0d;
// Why (27 Oct 2026): 6 characters either side are not enough. Cloudflare's challenge answer (a 600 KB base64 run, 38% printable) spells "x@y.z" with 6 text-like characters around it often enough that the scrub
// rewrote it and the challenge broke: a Personio posting then rendered another page and its replay stopped there. Text means 90% printable over 32 characters either side (random bytes: ~0%; a name inside JSON: 100%).
const inText = (form, at, length) => { const around = [...form.slice(Math.max(0, at - 32), at) + form.slice(at + length, at + length + 32)]; return around.filter(char => printable(char.charCodeAt(0))).length >= 0.9 * around.length; };
export function personalHits(text, {code = false, values = new Map()} = {}) {
  const hits = new Set(), run = (form, bytes = false) => {
    EMAIL.lastIndex = 0;
    if ([...form.matchAll(EMAIL)].some(found => !EXAMPLE.test(found[0]) && (!bytes || inText(form, found.index, found[0].length)))) hits.add('email');
    const folded = form.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
    for (const [value, kind] of values) {
      if (kind === 'email' || (kind === 'phone' && String(value).replace(/\D/g, '').length < 9)) continue;
      const plain = value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
      if (kind === 'phone' ? folded.includes(plain) : new RegExp(`(?<![\\p{L}\\p{N}])${escape(plain)}(?![\\p{L}\\p{N}])`, 'u').test(folded) && !(code && !/\s/.test(value))) hits.add(kind);
    }
  };
  for (const form of decodedForms(String(text))) run(form);
  for (const form of b64Forms(String(text))) for (const inner of decodedForms(form)) run(inner, true);
  return [...hits];
}

// The person's words, contacts and tokens out of one piece of text, by the same steps for a body, a decoded run inside it and a note. -> text
const cleanText = (text, values, code, counts) => tokensOut(contactsOut(ownOut(plainSeparators(text), values, code, counts, true), counts), code, counts);

// What the last gate scans besides the plain text: a base64 run and a percent-encoded run, each decoded. The scrub rewrites them in their decoded form and writes them back encoded, so the gate has nothing left
// in a form the scrub never looked at (19 Oct 2026). A run that comes out unchanged stays as it was. -> text
const PERCENT_RUN = /[^\s"'<>&=,;]*%[0-9a-f]{2}[^\s"'<>&=,;]*/gi;
function repairForms(text, values, code, counts) {
  const out = text.replace(BASE64, run => {
    const inner = Buffer.from(run.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('latin1'), clean = cleanText(inner, values, code, counts);
    return clean === inner || [...clean].some(ch => ch.charCodeAt(0) > 255) ? run : Buffer.from(clean, 'latin1').toString('base64');
  });
  return out.replace(PERCENT_RUN, run => { const plain = urlDecode(run), clean = cleanText(plain, values, code, counts); return clean === plain ? run : encodeURIComponent(clean); });
}

// A URL the gate still finds something in (a long number, the person's name, a token in a path segment or a query key): that part becomes <id>, else only the host stays. -> string
function cleanUrl(url, values) {
  const u = new URL(url, 'https://x.invalid'), bad = text => scanKinds(text, false, values).size > 0, origin = /^https?:/i.test(url) ? `${u.protocol}//${u.host}` : '';
  if (!bad(url)) return url;
  const path = u.pathname.split('/').map(part => (bad(part) ? '<id>' : part)).join('/'), query = [...u.searchParams.keys()].map(key => `${bad(key) ? '<k>' : encodeURIComponent(key)}=<v>`).join('&');
  const next = `${origin}${path}${query ? `?${query}` : ''}`;
  return bad(next) ? `${origin}/<id>` : next;
}

// -> {entries, bodies, stats}: the record after the keep rules (net-keep.js) and the scrub. stats.removed counts what was taken out, by kind (unclean = a body left out because the gate still found
// something in it after every repair).
export function scrubRecord(record, values = new Map()) {
  const kept = keepRecord(record), counts = {typed: 0, own: 0, contacts: 0, urls: 0, binary: 0, tokens: 0, unclean: 0}, bodies = new Map(), entries = [];
  for (const entry of kept.entries) {
    let url = scrubUrl(entry.url); url = cleanUrl(url, values); if (url !== entry.url) counts.urls += 1;
    const own = Object.fromEntries(Object.entries(entry.headers || {}).filter(([name]) => KEEP_HEADER.test(name))), type = own['content-type'] || '', headers = own.location ? {...own, location: scrubUrl(own.location)} : own;
    let hash = entry.hash;
    const body = entry.hash ? kept.bodies.get(entry.hash) : null, code = CODE.test(type) || /\.(m?js|css)(\?|$)/i.test(entry.url.split(/[?#]/)[0]);
    let out = null;   // the body that stays
    if (body && !understood(type)) { counts.binary += 1; hash = ''; }
    else if (body && TEXT.test(type)) {
      let text = plainSeparators(body.toString('utf8'));
      if (!code) text = blankTyped(text, counts);
      out = Buffer.from(cleanText(text, values, code, counts));
      if (bodyKinds(out, code, values).size) out = Buffer.from(repairForms(out.toString('utf8'), values, code, counts));
    } else if (body) out = body;
    if (out && bodyKinds(out, code, values).size) { counts.unclean += 1; out = null; hash = ''; }   // still found after every repair: left out, counted, said in the preview
    if (out) { hash = out === body ? hash : sha(out); bodies.set(hash, out); }
    entries.push({...entry, url, headers, bodyKey: '', hash, size: hash ? bodies.get(hash).length : 0});
  }
  return {entries, bodies, stats: {...kept.stats, removed: counts}};
}

// What the gate finds in ONE text and its decoded forms (URL, JSON, entities, base64 runs). -> Set of kinds
function scanKinds(text, code, values) {
  const kinds = new Set(), run = form => {
    EMAIL.lastIndex = 0; PHONE.lastIndex = 0;
    if ((form.match(EMAIL) || []).some(e => !EXAMPLE.test(e))) kinds.add('email');
    if ((form.match(PHONE) || []).some(p => p.replace(/\D/g, '').length >= 9)) kinds.add('phone');
    if (code && nameRun(values)?.test(form)) kinds.add('name');
    for (const shape of [JWT, BEARER, QUOTED_SECRET, ...(code ? [] : [BARE_SECRET])]) { shape.lastIndex = 0; if ([...form.matchAll(shape)].some(found => !/<token>/.test(found[0]))) kinds.add('token'); }
    for (const [value, kind] of values) {
      if (kind === 'phone' || kind === 'email') continue;
      if (valueMatcher(value, code).test(form.normalize('NFD'))) kinds.add(code && !/\s/.test(value) ? 'name-in-code' : kind);   // the same matcher the scrub used
    }
  };
  for (const form of decodedForms(text)) run(form);
  for (const form of b64Forms(text)) for (const inner of decodedForms(form)) run(inner);
  return kinds;
}
// A body as UTF-8 and as latin1. -> Set of kinds
const bodyKinds = (body, code, values) => new Set([...scanKinds(body.toString('utf8'), code, values), ...scanKinds(body.toString('latin1'), code, values)]);
const contentKind = type => String(type || '').split(';')[0].trim().toLowerCase().replace(/[^\w./+-]/g, '?').slice(0, 60) || 'none';   // the MIME type: a kind of content, never a value

// The last gate before anything leaves: every kept body (whatever its type), as UTF-8 and as latin1, in every decoded form, searched again with the person's values. A lone name
// word inside code is a hit too ('name-in-code'): losing one report is cheaper than leaking a name. -> [{kind, in: 'url' | 'body', type}] (kinds and the content kind only; empty = clear)
export function lastGate({entries, bodies}, values = new Map()) {
  const hits = [], seen = new Set();
  for (const entry of entries) {
    const body = entry.hash ? bodies.get(entry.hash) : null, type = entry.headers?.['content-type'] || '', add = (kinds, where) => { for (const kind of kinds) if (!seen.has(`${kind}/${where}/${contentKind(type)}`)) { seen.add(`${kind}/${where}/${contentKind(type)}`); hits.push({kind, in: where, type: contentKind(type)}); } };
    add(scanKinds(entry.url, false, values), 'url');
    if (!body) continue;
    add(bodyKinds(body, CODE.test(type) || /\.(m?js|css)(\?|$)/i.test(entry.url.split('?')[0]), values), 'body');
  }
  return hits;
}

// The person's optional note to the owner of the report ("what went wrong"): their own words, so their values, e-mails, phones and tokens are replaced like a body's, then searched again. 300 characters.
// -> {ok: true, text} | {ok: false, blocked: [kind]}
export function scrubNote(note, values = new Map()) {
  const counts = {typed: 0, own: 0, contacts: 0, urls: 0, binary: 0, tokens: 0}, original = String(note || '').replace(/\s+/g, ' ').trim().slice(0, 300);
  if (!original) return {ok: true, text: ''};
  const text = tokensOut(contactsOut(ownOut(plainSeparators(original), values, false, counts, true), counts), false, counts);
  const hits = lastGate({entries: [{url: 'https://note.invalid/', headers: {'content-type': 'text/plain'}, hash: 'n'}], bodies: new Map([['n', Buffer.from(text)]])}, values);
  return hits.length ? {ok: false, blocked: hits.map(hit => hit.kind)} : {ok: true, text};
}
