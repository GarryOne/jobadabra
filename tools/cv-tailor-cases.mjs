#!/usr/bin/env node
// Replays CV tailoring's fixed case set (desktop/test/fixtures/cv-tailor-cases.json) through the app's own cv.tailor on the person's Claude plan ($0, never an API key).
// Usage: node tools/cv-tailor-cases.mjs [--before] [--runs 3]
//   --before: origin/main's cv.js (the whole Profile text, no learnings) so the same cases show what About you D1c changes; default: this checkout.
// One line per case and run (pass, or what failed) and the input characters per call, then the totals. Exit 1 when any case failed.
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.env.ANTHROPIC_API_KEY = '';   // the person's own Claude Code: the replay never reaches an API account
const args = process.argv.slice(2), before = args.includes('--before'), runs = Number(args[args.indexOf('--runs') + 1]) || 3;
const set = JSON.parse(fs.readFileSync(path.join(root, 'desktop/test/fixtures/cv-tailor-cases.json'), 'utf8'));

let cvPath = path.join(root, 'desktop/lib/cv.js'), temp = '';
if (before) {   // origin/main's file beside the real one, so its relative imports resolve; removed at the end
  temp = path.join(root, 'desktop/lib/cv-main-replay.mjs');
  fs.writeFileSync(temp, execFileSync('git', ['show', 'origin/main:desktop/lib/cv.js'], {cwd: root, encoding: 'utf8'}));
  cvPath = temp;
}
const cvlib = await import(pathToFileURL(cvPath).href);
const {bundleOf} = await import(pathToFileURL(path.join(root, 'desktop/lib/about-you.js')).href);
const {cliClient} = await import(pathToFileURL(path.join(root, 'desktop/lib/ai/claude-code-cli.js')).href);
const {claudeBinary} = await import(pathToFileURL(path.join(root, 'desktop/lib/apply.js')).href);
const client = cliClient(await claudeBinary(), {});

const profileText = () => ['## Details', ...set.details.map(line => `- ${line.label}: ${line.value}`), '## Strategy', ...set.strategy.map(line => `- ${line.label}: ${line.value}`)].join('\n');
const textOf = role => [role.title, role.intro, ...(role.bullets || []).map(bullet => (typeof bullet === 'string' ? bullet : bullet.text)), role.skills].join(' ');

async function run(each) {
  const about = bundleOf({details: set.details, learned: each.learned, strategy: set.strategy, cv: set.base}, 'cv_tailor');
  const options = before ? {client, base: set.base, profile: profileText()} : {client, base: set.base, about};
  const {result} = await cvlib.tailor(null, each.posting, '', options);
  const applied = cvlib.applyTailoring(set.base, result, profileText());
  const roles = applied.cv.jobs.flatMap(job => job.roles).map(textOf).join('\n'), summary = applied.cv.summary || '', {expect} = each;
  const fails = [];
  if (expect.summaryMatches && !new RegExp(expect.summaryMatches, 'i').test(summary)) fails.push(`summary lacks /${expect.summaryMatches}/`);
  if (expect.summaryNeverMatches && new RegExp(expect.summaryNeverMatches, 'i').test(summary)) fails.push(`summary has /${expect.summaryNeverMatches}/`);
  if (expect.rolesNeverMatch && new RegExp(expect.rolesNeverMatch, 'i').test(roles)) fails.push(`a role has /${expect.rolesNeverMatch}/`);
  if (expect.warnings !== undefined && applied.warnings.length > expect.warnings) fails.push(`${applied.warnings.length} warnings: ${applied.warnings.join(' | ').slice(0, 160)}`);
  return fails;
}

let failed = 0, total = 0;
try {
  const jobs = set.cases.flatMap(each => Array.from({length: runs}, (_, n) => ({each, n})));
  for (const {each, n} of jobs) {
    total++;
    const fails = await run(each).catch(error => [`error: ${error.message.slice(0, 120)}`]);
    if (fails.length) failed++;
    console.log(`${each.id} #${n + 1}: ${fails.length ? `FAIL ${fails.join('; ')}` : 'pass'}`);
  }
} finally { if (temp) fs.rmSync(temp, {force: true}); }
console.log(`${before ? 'before (origin/main)' : 'after (this checkout)'}: ${total - failed}/${total} passed`);
process.exit(failed ? 1 : 0);
