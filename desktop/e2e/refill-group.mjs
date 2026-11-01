// The refill's publish step works in groups of 3 rows (records-publish.mjs refuses more at once: its guard replays each twice): copies the <index>-th group of the staged row folders into <out dir>.
//   node refill-group.mjs <staged dir> <index> <out dir>      (folders in name order; a group past the end is empty and nothing is written). Guard: e2e/test/refill.test.mjs.
import fs from 'node:fs';
import path from 'node:path';
import {groupsOf} from './lib/refill.mjs';

const [staged, index, out] = process.argv.slice(2);
if (!staged || index === undefined || !out) { console.error('usage: node refill-group.mjs <staged dir> <index> <out dir>'); process.exit(2); }
const folders = fs.existsSync(staged) ? fs.readdirSync(staged, {withFileTypes: true}).filter(entry => entry.isDirectory()).map(entry => entry.name).sort() : [];
const group = groupsOf(folders)[Number(index)] || [];
for (const name of group) fs.cpSync(path.join(staged, name), path.join(out, name), {recursive: true});
console.log(`refill-group: group ${index}: ${group.length} of ${folders.length} row(s)${group.length ? `: ${group.join(', ')}` : ''}`);
