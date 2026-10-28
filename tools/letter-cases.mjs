#!/usr/bin/env node
// Replays the cover letter's fixed case set (desktop/test/fixtures/letter-cases.json) through the app's own job-letter.draft on the person's Claude plan ($0, never an API key).
// Usage: node tools/letter-cases.mjs [--before] [--runs 2]
//   --before: origin/main's job-letter.js (the whole Profile and answers pages in the prompt) so the same cases show what About you D1c-2 changes; default: this checkout.
// One line per case and run (pass, or what failed), then the totals. Exit 1 when any case failed.
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.env.ANTHROPIC_API_KEY = '';   // the person's own Claude Code: the replay never reaches an API account
const args = process.argv.slice(2), before = args.includes('--before'), runs = Number(args[args.indexOf('--runs') + 1]) || 2;
const set = JSON.parse(fs.readFileSync(path.join(root, 'desktop/test/fixtures/letter-cases.json'), 'utf8'));

let writerPath = path.join(root, 'desktop/lib/job-letter.js'), temp = '';
if (before) {   // origin/main's file beside the real one, so its relative imports resolve; removed at the end
  temp = path.join(root, 'desktop/lib/job-letter-main-replay.mjs');
  fs.writeFileSync(temp, execFileSync('git', ['show', 'origin/main:desktop/lib/job-letter.js'], {cwd: root, encoding: 'utf8'}));
  writerPath = temp;
}
const writer = await import(pathToFileURL(writerPath).href);
const {bundleOf} = await import(pathToFileURL(path.join(root, 'desktop/lib/about-you.js')).href);
const {cliClient} = await import(pathToFileURL(path.join(root, 'desktop/lib/ai/claude-code-cli.js')).href);
const {claudeBinary} = await import(pathToFileURL(path.join(root, 'desktop/lib/apply.js')).href);
const client = cliClient(await claudeBinary(), {});

// What the old prompt pasted: the Profile page (details and strategy, pay lines included) and the answers page with the Writing preferences glued on.
const line = item => `- ${item.label}: ${item.value}`;
const profileText = () => ['## Details', ...set.details.map(line), '## Strategy', ...set.strategy.map(line)].join('\n');
const answersText = each => ['## Learned from forms', ...each.learned.map(item => `- ${item.question}: ${item.answer}`), ...(each.preferences.length ? ['## Cover letter style', ...each.preferences.map(rule => `- ${rule}`)] : [])].join('\n');

async function run(each) {
  const about = bundleOf({details: set.details, learned: each.learned, strategy: set.strategy, voice: {preferences: each.preferences, example: set.voice.example}}, 'letter', {skip: ['cv']});
  const common = {job: each.posting, cv: set.cv, client, name: set.cv.name};
  const made = await writer.draft(null, before ? {...common, profile: profileText(), answers: answersText(each)} : {...common, about});
  const fails = [], {expect} = each;
  if (expect.letterMatches && !new RegExp(expect.letterMatches, 'i').test(made.text)) fails.push(`letter lacks /${expect.letterMatches}/`);
  if (expect.letterNeverMatch && new RegExp(expect.letterNeverMatch, 'i').test(made.text)) fails.push(`letter has /${expect.letterNeverMatch}/`);
  return fails;
}

let failed = 0, total = 0;
try {
  for (const each of set.cases) for (let n = 0; n < runs; n++) {
    total++;
    const fails = await run(each).catch(error => [`error: ${error.message.slice(0, 120)}`]);
    if (fails.length) failed++;
    console.log(`${each.id} #${n + 1}: ${fails.length ? `FAIL ${fails.join('; ')}` : 'pass'}`);
  }
} finally { if (temp) fs.rmSync(temp, {force: true}); }
console.log(`${before ? 'before (origin/main)' : 'after (this checkout)'}: ${total - failed}/${total} passed`);
process.exit(failed ? 1 : 0);
