#!/usr/bin/env node
// Replays the fixed case set of lib/option-pick.js's prompt (desktop/test/option-pick-cases.json) on the plan path (`claude -p`, no API key), N asks each.
// Usage: node tools/option-pick-cases.mjs [asks=3]     exit 1 when any ask differs from its expected choice.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {modelClient} from '../desktop/e2e/lib/model.mjs';
import {pickOption} from '../desktop/lib/option-pick.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const {cases} = JSON.parse(fs.readFileSync(path.join(root, 'desktop/test/option-pick-cases.json'), 'utf8'));
const asks = Number(process.argv[2]) || 3, client = modelClient(), storage = {readText: () => null, writeText: () => {}};
let right = 0, total = 0;
for (const c of cases) {
  let hits = 0;
  for (let i = 0; i < asks; i++) hits += (await pickOption(storage, {label: c.label, value: c.value, options: c.choices, searchable: true, tried: []}, {client})).choice === c.expect ? 1 : 0;
  right += hits; total += asks;
  console.log(`${hits === asks ? 'ok  ' : 'MISS'} ${c.id.padEnd(30)} ${hits}/${asks}`);
}
console.log(`${right}/${total} asks right`);
process.exit(right === total ? 0 : 1);
