// Builds the code → suite map from one e2e run's coverage files (gate G1b): e2e.yml's coverage-map job, after a scheduled main run.
//   node coverage-map.mjs --artifacts <dir with coverage-*.json, any depth> [--previous <coverage-map.json>] --out <coverage-map.json>
// A suite this run recorded replaces its entry; the others keep the previous map's (an exploring run records only the suites that vary). Logic: lib/coverage-pick.mjs.
import fs from 'node:fs';
import path from 'node:path';
import {mergeMap} from './lib/coverage-pick.mjs';

const arg = name => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : ''; };
const walk = dir => (fs.existsSync(dir) ? fs.readdirSync(dir, {withFileTypes: true}).flatMap(e => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)])) : []);
const read = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };

const files = walk(arg('--artifacts')).filter(file => /coverage-.*\.json$/.test(path.basename(file))).map(read).filter(Boolean);
const previous = arg('--previous') ? read(arg('--previous')) : null;
const map = mergeMap(previous, files);
fs.mkdirSync(path.dirname(arg('--out')), {recursive: true});
fs.writeFileSync(arg('--out'), JSON.stringify(map));
const suites = Object.keys(map.suites);
console.log(`coverage map: ${files.length} file(s) from this run; ${suites.length} suite(s): ${suites.join(', ')}`);
