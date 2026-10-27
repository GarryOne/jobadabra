#!/usr/bin/env node
// Replays the fixed case set of lib/option-pick.js's prompt (desktop/test/option-pick-cases.json) on the plan path (`claude -p`, no API key), N asks each.
// Each case is asked twice a draw: as a plain menu and as a search box (searchable: the prompt gains its search paragraph), because the app sends both (page/fill-menus.js).
// Usage: node tools/option-pick-cases.mjs [asks=3] [path of an option-pick.js to measure, default this tree's]     exit 1 when any ask differs from its expected choice.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {modelClient} from '../desktop/e2e/lib/model.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const {cases} = JSON.parse(fs.readFileSync(path.join(root, 'desktop/test/option-pick-cases.json'), 'utf8'));
const {pickOption} = await import(process.argv[3] ? path.resolve(process.argv[3]) : '../desktop/lib/option-pick.js');
const asks = Number(process.argv[2]) || 3, client = modelClient(), storage = {readText: () => null, writeText: () => {}};
const totals = {plain: [0, 0], search: [0, 0]};
for (const c of cases) {
  const hits = {};
  for (const mode of Object.keys(totals)) {
    hits[mode] = 0;
    for (let i = 0; i < asks; i++) hits[mode] += (await pickOption(storage, {label: c.label, value: c.value, options: c.choices, ...(mode === 'search' ? {searchable: true, tried: []} : {})}, {client})).choice === c.expect ? 1 : 0;
    totals[mode][0] += hits[mode]; totals[mode][1] += asks;
  }
  console.log(`${Object.values(hits).every(n => n === asks) ? 'ok  ' : 'MISS'} ${c.id.padEnd(30)} plain ${hits.plain}/${asks}  search ${hits.search}/${asks}`);
}
for (const [mode, [right, total]] of Object.entries(totals)) console.log(`${mode}: ${right}/${total} asks right`);
process.exit(Object.values(totals).every(([right, total]) => right === total) ? 0 : 1);
