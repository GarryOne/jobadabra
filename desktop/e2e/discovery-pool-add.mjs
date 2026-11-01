// node discovery-pool-add.mjs <pool-add.json> [<pool file>]: the batch's rows that reached a flow shape the pool lacks join the repo's pool list (smoke-sites.json), for the PR the workflow opens and
// the owner merges (owner, 17 Oct 2026). A name or posting already in the list is left alone; prints one line per row added and nothing else changes in the file. Guard: e2e/test/pool/discovery-cli.test.mjs.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export function addRows(pool, additions) {
  const names = new Set(pool.shapes.map(item => item.shape)), urls = new Set(pool.shapes.flatMap(item => item.urls || [])), added = [];
  for (const row of additions) {
    if (!row?.shape || !Array.isArray(row.urls) || !row.urls.length || names.has(row.shape) || row.urls.some(url => urls.has(url))) continue;
    pool.shapes.push({shape: row.shape, urls: row.urls, ...(row.signature ? {signature: row.signature} : {})});
    names.add(row.shape); row.urls.forEach(url => urls.add(url)); added.push(row.shape);
  }
  return added;
}
export function main(argv = process.argv.slice(2)) {
  const [from = 'pool-add.json', file = path.join(here, 'smoke-sites.json')] = argv;
  const pool = JSON.parse(fs.readFileSync(file, 'utf8')), added = addRows(pool, JSON.parse(fs.readFileSync(from, 'utf8')));
  if (added.length) fs.writeFileSync(file, `${JSON.stringify(pool, null, 1)}\n`);
  console.log(added.length ? added.map(name => `added ${name}`).join('\n') : 'nothing to add');
  return added.length;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) process.exit(main() ? 0 : 0);
