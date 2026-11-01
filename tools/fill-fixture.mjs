// Turns a fill-failure issue's snapshot into a replay test fixture (app-core/test/fixtures/fill/<site>--<label>.html + .json).
//   node tools/fill-fixture.mjs <issue> [--answer "Master's"] [--expect-picked "Master's Degree" | --expect-checked Yes | --expect-value …]
//   node tools/fill-fixture.mjs --body-file issue.md --issue 16 …    (offline: the issue's text saved in a file)
//   node tools/fill-fixture.mjs 12 --repo GarryOne/jobadabra-lab   (a private triage issue: one fixture per reported field)
// Then run `cd app-core && node --test test/fill-replay.test.js`: the new fixture should fail until the fix lands.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { snapshotFromReport } from '../app-core/src/snapshot.js';

export const MARK = '<!-- job-pilotto:snapshot v1 -->';
export const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../app-core/test/fixtures/fill');
const slug = (text) => String(text).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60).replace(/-$/, '');

// The fixture from an issue: {name, html, spec}; the latest snapshot in the body or its comments wins. Null without one.
export function fromIssue({ number, body = '', comments = [] }, { answer = null, expect = {} } = {}) {
  const texts = [body, ...comments.map((c) => c.body || '')];
  const withSnapshot = texts.filter((text) => text.includes(MARK)).pop();
  if (!withSnapshot) return null;
  const html = withSnapshot.slice(withSnapshot.lastIndexOf(MARK)).match(/```html\n([\s\S]*?)```/)?.[1];
  if (!html) return null;
  const site = body.match(/- Site: `([a-z0-9.-]+)`/)?.[1] || '';
  const reason = body.match(/- Reason: (.+)/)?.[1]?.trim() || '';
  let label = '';
  try { label = JSON.parse(body.match(/```json\n([\s\S]*?)```/)?.[1] || '{}').label || ''; } catch {}
  if (!site || !label) return null;
  return { name: `${site}--${slug(label)}`, html,
    spec: { source: `issue #${number}`, site, label, reason, note: `From issue #${number}'s snapshot.`, answer, expect } };
}

// Reading failures (a question the reader did not read, or read as one of its own choices): the fixture's test is that the
// fill names the question and knows it is required. It stays red until the reader is fixed.
const READING = /^question (on the page not read|text not found)/;

// Fixtures straight from a report's fields (the private triage's issue carries them as JSON, each with its snapshot): one per
// field that has a snapshot; a field without one is skipped.
export function fromFields(site, fields, { source = 'synthetic', answer = null } = {}) {
  const out = [];
  for (const field of Array.isArray(fields) ? fields : []) {
    // As the Worker keeps it (scrubbed HTML), or as the page sent it (a tree, scrubbed here).
    const html = typeof field?.snapshot === 'string' ? field.snapshot : field?.snapshot ? snapshotFromReport(field.snapshot) : '';
    if (!html || !site || !field.label) continue;
    const reading = READING.test(field.reason || '');
    // A reading failure is checked with a stand-in answer too: given none, the replay traces even a read question as unread (20 Oct 2026).
    const stand = standIn(field, html, answer);
    if (!reading && !stand) continue;   // nothing a replay can check here: whyNoFixture says what to do instead
    const group = radioGroupName(html);
    out.push({ name: `${site}--${slug(field.label)}`, html,
      spec: { source, site, label: field.label, reason: field.reason || '', note: `From a fill-failure report (${source}).`, ...(group ? { field: `radio:${group}` } : {}),
        answer: reading ? (stand?.answer ?? '') : stand.answer, expect: reading ? { read: true, required: true } : stand.expect } });
  }
  return out;
}

// The choices a snapshot itself holds (a dropdown whose list loads from the site holds none) and the radio group a container marks.
const choicesIn = (html) => [...String(html).matchAll(/<(?:option[^>]*|[^>]*role="option"[^>]*)>\s*([^<]+?)\s*</g)].map((m) => m[1]).filter((text) => !/^(select|choose|please|--|—|\.\.\.)/i.test(text));
const radioGroupName = (html) => (/data-jp-field[^>]*role="radiogroup"|role="radiogroup"[^>]*data-jp-field/.test(html) ? /<input[^>]*type="radio"[^>]*name="([^"]+)"|<input[^>]*name="([^"]+)"[^>]*type="radio"/.exec(html)?.slice(1).find(Boolean) : '') || '';

// A radio's own words (not its group's question): its aria-label, its <label for>, or the label right after it.
function radioChoice(html) {
  const radio = /<input[^>]*type="radio"[^>]*>/.exec(html);
  if (!radio) return '';
  const aria = /aria-label="([^"]+)"/.exec(radio[0])?.[1], id = /\sid="([^"]+)"/.exec(radio[0])?.[1];
  const forId = id ? new RegExp(`<label[^>]*for="${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*>\\s*([^<]+?)\\s*<`).exec(html)?.[1] : '';
  const after = /<label[^>]*>\s*([^<]+?)\s*</.exec(html.slice(radio.index))?.[1];
  return [aria, forId, after, /\svalue="([^"]+)"/.exec(radio[0])?.[1]].map((text) => String(text || '').trim()).find(Boolean) || '';
}

// A stand-in answer (never the user's real one) and what the replay must see, for a control failure; null when the snapshot cannot show it.
export function standIn(field, html, answer = null) {
  const type = String(field.type || '').toLowerCase(), dropdown = /^dropdown/.test(field.reason || '') || /combobox|select/.test(type);
  if (dropdown) {
    if (/<select/.test(html)) return null;   // a native menu: the replay sees picks on drawn options only
    const choice = answer ?? choicesIn(html)[0];
    return choice ? { answer: choice, expect: { picked: choice } } : null;
  }
  if (type === 'radio' || (!type && /type="radio"/.test(html))) {
    const label = answer ?? radioChoice(html);
    return label ? { answer: label, expect: { checked: label } } : null;
  }
  if (!type || /text|email|tel|url|number|textarea|search/.test(type)) {
    const text = answer ?? 'Example answer';
    return { answer: text, expect: { value: text } };
  }
  return null;   // a checkbox: the replay reads no box state yet
}

// Why a reported field gets no fixture: said to the person running the tool, with what to do instead.
export function whyNoFixture(field) {
  if (!field?.snapshot) return 'no snapshot in the report';
  const type = String(field.type || '').toLowerCase();
  if (/^dropdown/.test(field.reason || '') || /combobox|select/.test(type)) return 'its choices are not drawn in the snapshot (they load from the site, or it is a native menu): record the site (skill record-applying-sites)';
  if (type === 'checkbox') return 'a checkbox: write the fixture by hand (the replay reads no box state yet)';
  return 'nothing a replay can check from the snapshot';
}
// A private triage issue's report fields: the ```json block of its "Snapshots" section.
export function fieldsOfIssue(body) {
  try { return JSON.parse(String(body).match(/```json\n([\s\S]*?)```/)?.[1] || '[]'); } catch { return []; }
}

export function write(fixture, { dir = DIR, force = false } = {}) {
  const base = path.join(dir, fixture.name);
  if (!force && fs.existsSync(`${base}.json`)) throw new Error(`${base}.json exists (--force replaces it)`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(`${base}.html`, fixture.html);
  fs.writeFileSync(`${base}.json`, `${JSON.stringify(fixture.spec, null, 1)}\n`);
  return base;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const option = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
  const bodyFile = option('--body-file');
  const number = option('--issue') || args.find((a) => /^\d+$/.test(a));
  if (!number) {
    console.error('usage: node tools/fill-fixture.mjs <issue> [--answer …] [--expect-picked|--expect-checked|--expect-value …] [--force]');
    process.exit(2);
  }
  const issue = bodyFile ? { number, body: fs.readFileSync(bodyFile, 'utf8'), comments: [] }
    : JSON.parse(execFileSync('gh', ['issue', 'view', number, '--json', 'number,title,body,comments', ...(option('--repo') ? ['--repo', option('--repo')] : [])], { encoding: 'utf8' }));
  const expect = Object.fromEntries(['picked', 'checked', 'value'].map((key) => [key, option(`--expect-${key}`)]).filter(([, v]) => v !== undefined));
  // A private triage issue (jobadabra-lab, --repo): its fields JSON, one fixture per field with a snapshot.
  const site = issue.title?.match(/^Fill failure: ([a-z0-9.-]+)/)?.[1] || '';
  const fromTriage = site ? fromFields(site, fieldsOfIssue(issue.body), { source: `issue #${number}`, answer: option('--answer') ?? null }) : [];
  if (site) {
    const made = new Set(fromTriage.map((each) => each.spec.label));
    for (const field of fieldsOfIssue(issue.body).filter((f) => f?.label && !made.has(f.label))) console.log(`No fixture for "${field.label}": ${whyNoFixture(field)}.`);
  }
  if (fromTriage.length) {
    for (const each of fromTriage) console.log(`Wrote ${write(each, { force: args.includes('--force') })}.html and .json.`);
    console.log('Then: cd app-core && node --test test/fill-replay.test.js  (it should fail before the fix, pass after)');
    process.exit(0);
  }
  const fixture = fromIssue(issue, { answer: option('--answer') ?? null, expect });
  if (!fixture) {
    console.error(`Issue #${number} has no snapshot (only reports sent since snapshots were added carry one). Build the fixture by hand from the ` +
      'public form (mark it "source": "synthetic"), see .claude/skills/record-applying-sites/SKILL.md.');
    process.exit(1);
  }
  const base = write(fixture, { force: args.includes('--force') });
  console.log(`Wrote ${base}.html and .json.`);
  if (fixture.spec.answer === null || !Object.keys(expect).length) {
    console.log('Fill in "answer" (a representative value, never the user\'s real one) and "expect" ({picked|checked|value}) in the .json.');
  }
  console.log('Then: cd app-core && node --test test/fill-replay.test.js  (it should fail before the fix, pass after)');
}
