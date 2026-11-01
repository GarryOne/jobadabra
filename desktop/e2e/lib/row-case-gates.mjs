// The gates a row's case folder passes before npm run row-to-case writes it into the cases folder (public today, private from the eval-data move): privacy (the rules of the recorded-pages privacy test, one
// function for both) and size (owner-approved limits, 11 Oct 2026, measured on three real captures: 84-168 KB after shrinking). Findings name the kind and the file, never the value.
// Guard: e2e/test/pool/row-case-gates.test.mjs; desktop/test/recorded-privacy.test.js calls privacyFindings.
export const CASE_WARN = 200 * 1024, CASE_FAIL = 300 * 1024, FOLDER_FAIL = 8 * 1024 * 1024;
export const sizeVerdict = bytes => (bytes > CASE_FAIL ? 'fail' : bytes > CASE_WARN ? 'warn' : 'ok');
export const folderVerdict = bytes => (bytes > FOLDER_FAIL ? 'fail' : 'ok');

// Emails by their @ (a global pattern is quadratic over a long unbroken run, a base64 blob: 310 KB of x hung the gate): the address around each @, at most 64 characters before it and 255 after.
function emailsIn(text) {
  const found = [];
  for (let at = text.indexOf('@'); at >= 0; at = text.indexOf('@', at + 1)) {
    const before = /[\w.+-]+$/.exec(text.slice(Math.max(0, at - 64), at))?.[0], after = /^[\w-]+(?:\.[\w-]+)+/.exec(text.slice(at + 1, at + 256))?.[0];
    if (before && after) found.push(`${before}@${after}`);
  }
  return found;
}
// An input or option that carries a value="…" of its own (not a data-…-value attribute of a script, not a button's label, not a radio or checkbox's option name).
const typedValues = text => Array.from(text.matchAll(/<(input|option)\b[^>]*>/gi)).some(([tag]) => /(?<![\w:-])value="[^"]+"/i.test(tag) && !/\btype="(submit|button|hidden|radio|checkbox)"/i.test(tag));
const PHONE = /(\+\d[\d\s().-]{8,}\d)|(\b0\d{2}[\s.]\d{3}[\s.]\d{2}[\s.]\d{2}\b)/;

// files: {<folder/name>: text}; own: the person's own values {value: kind} (capture-page.mjs personalValues). -> ["<file>: <kind>"]
export function privacyFindings(files, own = new Map()) {
  const found = [];
  for (const [name, text] of Object.entries(files)) {
    for (const email of emailsIn(text)) if (!/@example\.(com|org|net)$/i.test(email)) found.push(`${name}: an email`);
    if (PHONE.test(text)) found.push(`${name}: a phone number`);
    if (typedValues(text)) found.push(`${name}: a typed value`);
    if (/https?:\/\/[^"'\s]+\?[^"'\s]+/i.test(text)) found.push(`${name}: a URL query string`);
    const lower = text.toLowerCase(), digits = text.replace(/\D/g, '');
    for (const [value, kind] of own) if (/^\d+$/.test(value) ? value.length >= 9 && digits.includes(value) : new RegExp(`\\b${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(lower)) found.push(`${name}: ${kind}`);
  }
  return [...new Set(found)];
}
