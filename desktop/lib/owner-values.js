// The person's own values, read from the app's files on this Mac (profile.md, answers.md, draft.json, the imported CV): e-mails, phone digits, name words, places.
// Shared by the e2e tripwire (e2e/lib/privacy-tripwire.mjs), the page capture scrub (e2e/lib/capture-page.mjs) and the product's "Report this form" scrub (lib/report-scrub.js).
// Values stay on this Mac: compared and replaced, never printed or stored. Guards: e2e/test/capture-page.test.mjs, privacy-tripwire.test.mjs, test/report-scrub.test.js.
import fs from 'node:fs';
import path from 'node:path';
import {EMAIL, PHONE} from './live-capture.js';
import {realDataFolders} from './app-identity.js';
import {splitMark} from '../renderer/question-kind.js';

export const plain = text => String(text || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
// The person's own values from the app's files, as {value: kind}; never printed. Emails, phone digits, the words of any "name:" line.
export function personalValues(texts) {
  const own = texts.join('\n').split('\n').map(line => splitMark(line).text).join('\n'), values = new Map();   // a question's kind mark ("[pick one: …]") is the form's words, never the person's
  for (const email of own.match(EMAIL) || []) values.set(email.toLowerCase(), 'email');
  for (const phone of own.match(PHONE) || []) { const digits = phone.replace(/\D/g, ''); if (digits.length >= 9) values.set(digits, 'phone'); }
  for (const [, value] of own.matchAll(/^\W*(?:full\s*)?(?:first\s*|last\s*|family\s*)?name\W*:\s*(.+)$/gim)) for (const word of value.split(/\s+/)) if (word.replace(/[^\p{L}\p{N}]/gu, '').length >= 3) values.set(word.replace(/[^\p{L}\p{N}'-]/gu, '').toLowerCase(), 'name');
  return values;
}
// The app's files that hold the person's own details: profile.md / answers.md (the store on this Mac) and draft.json (the contact details and draft Profile
// the setup read from the CV, kept also when the Profile lives in Notion: 12 Oct 2026, a Notion user's Mac had no profile.md, so nothing of theirs was known).
// The contact comes back as "label: value" lines ("full name: …", "location: …"), the shape personalValues and the tripwire read. The imported CV (cv/cv.json)
// adds its name, its location and each job's place written as "city, country" (a one-part place such as a work mode is not a place of the person's).
export const appProfileTexts = (folders = realDataFolders()) =>
  folders.flatMap(folder => [...['profile.md', 'answers.md'].map(name => { try { return fs.readFileSync(path.join(folder, name), 'utf8'); } catch { return ''; } }), draftTexts(folder), cvTexts(folder)]);
function cvTexts(folder) {
  try {
    const cv = JSON.parse(fs.readFileSync(path.join(folder, 'cv', 'cv.json'), 'utf8'));
    const places = (cv.jobs || []).flatMap(job => (job.roles || []).map(role => String(role.place || ''))).filter(place => place.includes(','));
    return [cv.name && `full name: ${cv.name}`, cv.location && `location: ${cv.location}`, ...places.map(place => `location: ${place}`)].filter(Boolean).join('\n');
  } catch { return ''; }
}
function draftTexts(folder) {
  try {
    const draft = JSON.parse(fs.readFileSync(path.join(folder, 'draft.json'), 'utf8')).draft || {};
    const contact = Object.entries(draft.contact || {}).filter(([, value]) => typeof value === 'string' && value.trim()).map(([key, value]) => `${key.replace(/_/g, ' ')}: ${value}`);
    return [...contact, String(draft.profile_markdown || '')].join('\n');
  } catch { return ''; }
}

// The person's place from their files: each part of a location, city, country or street line ("Port Vale, Atlantis" -> both), accents and case aside. A part
// with no letters (a postal code alone) is left out, and so is a place the fake applicant shares (a typed one is the fake's). -> [part]
// A line of the person's files: "Location: …", "- City: …", or the Profile template's table row "| Home base | Zurich; open to relocating |" (its place is
// what comes before the first ";" or dash). "Countries" there is where they look for work, not where they live: not read.
const PLACE_LINE = /^\W*(?:home\s*)?(?:location|city|country|street(?:\s*address)?|address|place\s*of\s*residence|based\s*in)\W*:\s*(.+)$/gim;
const HOME_ROW = /^\|\s*home\s*base\s*\|\s*([^|;—–]+)/gim;
const partsOf = text => String(text).replace(/\([^)]*\)/g, ',').split(/[,;/|·]/).map(plain).filter(part => (part.match(/\p{L}/gu) || []).length >= 3);
export const placesOf = (texts, ignore = new Set()) => [...new Set([PLACE_LINE, HOME_ROW].flatMap(line => [...texts.join('\n').matchAll(line)]).flatMap(([, value]) => partsOf(value)))].filter(part => !ignore.has(part));

// Everything the product knows of the person from their files, as Map(value -> kind: email, phone, name, location). -> Map
export function ownerValuesOf(texts = appProfileTexts()) {
  const values = personalValues(texts);
  for (const place of placesOf(texts)) if (!values.has(place)) values.set(place, 'location');
  return values;
}
