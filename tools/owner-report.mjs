#!/usr/bin/env node
// Check for a branch/PR (owner, 16 Oct 2026: fixes that passed their tests failed on his real page, #941 and #972): a commit that says it fixes a bug the owner saw must carry "Owner-report: <report id>"
// and the push must bring a recorded case built from that ⚑ capture (case.json origin "captured", "report": "<id>", made by row-to-case from desktop/e2e/reports-fetch.mjs's reported-<id>-<site> record).
// A hand-cut case (written from vendor code or a sketch) never counts as proof of an owner-seen bug. "Owner-report: none <why>" when the owner's bug has no ⚑ capture (a rule that cannot be shown on a page).
// That the case FAILS on the old code is "New test pages fail on the old build" (tools/recorded-fails-on-old.mjs); an Owner-report also counts there as naming a failure (no "Recorded-pins").
// Every owner-seen fix also records the missed journey: "Escaped-e2e: <suite>[, <suite>] — <journey>" or "Escaped-e2e: no suite — <journey>".
//   node tools/owner-report.mjs [--base origin/main]      exit 1 with the reason. Guard: desktop/test/owner-report.test.js.
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {casesOf, commitFiles} from './recorded-cases.mjs';

export const TRAILER = /^Owner-report:[ \t]*(\S.*)$/im;
// Words that say a commit answers to something the owner saw on his own page.
export const CLAIMS_OWNER_SEEN = /\bowner[- ](?:saw|seen|reported|report|'s (?:page|capture|report))|\bowner's (?:own )?(?:page|capture|report)|reported by (?:the )?owner|⚑|\breport this form\b/i;
const ESCAPE = /^Escaped-e2e:[ \t]*([^\r\n]*)$/im;

/** Read the report id and owner claim; trailer wording itself never implies an owner-seen bug. */
export function reportOf(message) {
  const value = TRAILER.exec(String(message))?.[1].trim() || '';
  const none = /^none\s+\S/i.test(value);
  const id = value && !/^none\b/i.test(value) ? value.split(/\s+/)[0] : '';
  const prose = String(message).split('\n').filter((line, index) => index === 0 || !/^[a-z][a-z0-9-]*:/i.test(line)).join('\n');
  return {claims: CLAIMS_OWNER_SEEN.test(prose) || Boolean(id), id, none, bare: /^none\s*$/i.test(value)};
}

/** Parse an escape trailer without I/O; absent or malformed records return null. */
export function escapeOf(message) {
  const value = ESCAPE.exec(String(message))?.[1].trim() || '';
  const parts = /^(.+?)[ \t]+—[ \t]+(\S.*)$/.exec(value);
  if (!parts) return null;
  const [, list, journey] = parts;
  if (list === 'no suite') return {suites: [], none: true, journey};
  const suites = list.split(',').map(suite => suite.trim());
  if (suites.some(suite => !/^[a-z0-9][a-z0-9-]*$/i.test(suite))) return null;
  return {suites, none: false, journey};
}

function suiteNames() {
  const folder = new URL('../desktop/e2e/suites/', import.meta.url);
  return fs.readdirSync(folder).filter(file => file.endsWith('.mjs')).flatMap(file => {
    const name = /^export\s+const\s+name\s*=\s*['"]([^'"]+)['"]/m.exec(fs.readFileSync(new URL(file, folder), 'utf8'))?.[1];
    return name ? [name] : [];
  }).sort();
}

function escapeProblem(message, required, suites) {
  if (!required && !ESCAPE.test(String(message))) return '';
  const escape = escapeOf(message);
  const unknown = escape?.suites.filter(suite => !suites.includes(suite)) || [];
  if (escape && !unknown.length) return '';
  const why = unknown.length ? `Unknown Escaped-e2e suite: ${unknown.join(', ')}.` : 'An owner-seen fix needs a valid Escaped-e2e trailer on that commit.';
  return `${why}\nAdd one of:\n  Escaped-e2e: <suite>[, <suite>] — <the journey in a few words>\n  Escaped-e2e: no suite — <the journey>\nSuite names (exported by desktop/e2e/suites/*.mjs): ${suites.join(', ')}.\nChoose the suites that play this journey but missed it, or "no suite" when none plays it.`;
}

/** Check pushed commits and captured cases; return an empty string when every required record is valid. */
export function ownerReportProblem(commits, caseJson) {
  const lines = [];
  const suites = suiteNames();
  for (const commit of commits) {
    const said = reportOf(commit.message);
    const escape = escapeProblem(commit.message, said.claims, suites);
    if (escape) lines.push(escape);
    if (said.bare) lines.push('"Owner-report: none" needs a reason after it ("Owner-report: none <why no ⚑ capture shows this>").');
    if (!said.claims || said.none || said.bare) continue;
    if (!said.id) { lines.push(`a commit says it fixes a bug the owner saw but has no "Owner-report: <report id>" (the id in reported-<id>-<site> after reports-fetch.mjs). Build the case: cd desktop/e2e && npm run row-to-case -- "reported-<id>-<site>" <case> --old-commit <sha>.\nOr, when no ⚑ capture shows this bug: "Owner-report: none <why>".`); continue; }
    const mine = commits.flatMap(c => casesOf(c.files)).filter(name => caseJson(name)?.report === said.id);
    if (!mine.length) { lines.push(`"Owner-report: ${said.id}" but no recorded case in this push has "report": "${said.id}" in its case.json: the fix is not proven on the owner's own page.`); continue; }
    const hand = mine.filter(name => caseJson(name)?.origin !== 'captured');
    if (hand.length === mine.length) lines.push(`${hand.join(', ')} (report ${said.id}) is hand-cut: a case written by hand from vendor code or a sketch never proves an owner-seen bug. Make it from the capture with row-to-case.`);
  }
  return [...new Set(lines)].join('\n');
}

function main() {
  const args = process.argv.slice(2), base = args.includes('--base') ? args[args.indexOf('--base') + 1] : 'origin/main';
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const git = (...rest) => execFileSync('git', ['-C', root, ...rest], {encoding: 'utf8', maxBuffer: 64 << 20});
  let commits;
  try { commits = git('rev-list', '--reverse', `${base}..HEAD`).split('\n').filter(Boolean).map(sha => ({message: git('log', '-1', '--format=%B', sha), files: commitFiles(git, sha)})); } catch { return 0; }
  const caseJson = name => { try { return JSON.parse(fs.readFileSync(path.join(root, 'desktop/e2e/recorded', name, 'case.json'), 'utf8')); } catch { return null; } };
  const why = ownerReportProblem(commits, caseJson);
  if (why) { console.error(why); return 1; }
  return 0;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) process.exit(main());
