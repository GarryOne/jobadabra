// Job: report health
// Writes the lessons from the owner's corrections (lib/reversals.mjs) to a file the judges append to their prompt: node reversals.mjs --out .heal/lessons.md. Needs gh.
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {lessonsBlock, reversalsFrom} from './lib/reversals.mjs';
import {fetchCorrectionEvents} from './lib/reversal-events.mjs';

const args = process.argv.slice(2), out = args[args.indexOf('--out') + 1] || '.heal/lessons.md';
const gh = list => execFileSync('gh', list, {encoding: 'utf8', maxBuffer: 50 * 1024 * 1024});
const repo = process.env.REPO || process.env.GITHUB_REPOSITORY || process.env.GH_REPO || 'GarryOne/jobadabra';
let text = '';
try {
  const events = fetchCorrectionEvents(gh, repo);   // ~18 pages, not all 170 (lib/reversal-events.mjs)
  const numbers = [...new Set(reversalsFrom(events).map(item => item.number))].slice(0, 10);
  const issues = Object.fromEntries(numbers.map(number => [number, JSON.parse(gh(['issue', 'view', String(number), '-R', repo, '--json', 'number,title,comments']))]));
  const list = reversalsFrom(events, issues);
  text = lessonsBlock(list);
  console.log(`${list.length} correction(s) by a person: written to ${out}`);
} catch (error) { console.log(`corrections not read (${String(error.message).slice(0, 120)}): the judges run without them`); }
fs.mkdirSync(path.dirname(out), {recursive: true});
fs.writeFileSync(out, text);
