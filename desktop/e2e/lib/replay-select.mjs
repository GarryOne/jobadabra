// Which recorded cases a change can affect (JP_GATE_REPLAY=1, the opt-in local replay; CI always replays all of them). Reads e2e/recorded-case-map.json, measured by `npm run recorded-map`
// (lib/replay-coverage.mjs: the extension files each case really runs code from). ALL cases run when a shared file changes (one every case runs), a flow-core file, a replay-tool file, a file the
// map has never seen (new, or never run), or the map is missing or stale. A case the map does not know always runs. Guard: e2e/test/replay/replay-select.test.mjs.
// Job: pick the suites
import fs from 'node:fs';
import path from 'node:path';

export const MAP_FILE = 'recorded-case-map.json';   // next to e2e/recorded/, not inside it: that folder holds only case folders
// The replay tool: a change here can change what any case sees.
export const TOOL_FILES = /^desktop\/e2e\/(lib\/(page-replay|replay-browser|replay-coverage|replay-select|replay-shard|real-extension|extension|app)\.mjs|test\/record\/recorded-pages\.test\.mjs|replay-map\.mjs)$/;

export function extensionFiles(root) {   // every file under extension/, relative to it (the map's list: a new or removed file makes the map stale)
  const out = [], walk = dir => { for (const entry of fs.readdirSync(dir, {withFileTypes: true})) { const full = path.join(dir, entry.name); entry.isDirectory() ? walk(full) : out.push(path.relative(path.join(root, 'extension'), full).split(path.sep).join('/')); } };
  walk(path.join(root, 'extension'));
  return out.sort();
}

// -> {all: true, why} or {all: false, names: [case names], why}. changed: repo-relative paths; cases: the recorded cases' names; map: parsed case-map.json or null; flowCore: FLOW_CORE paths; files: extensionFiles() now.
export function selectCases({changed, cases, map, flowCore = [], files = []}) {
  const all = why => ({all: true, why});
  const relevant = changed.filter(file => file.startsWith('extension/') || file.startsWith('desktop/e2e/recorded/') || TOOL_FILES.test(file));
  if (!relevant.length) return {all: false, names: [], why: 'no extension, case or replay-tool file changed'};
  if (!map || !map.cases) return all('no case map (npm run recorded-map)');
  if (JSON.stringify(map.extensionFiles || []) !== JSON.stringify(files)) return all('the case map is stale: extension/ has new or removed files (npm run recorded-map)');
  const core = relevant.find(file => flowCore.includes(file)); if (core) return all(`flow core changed: ${core}`);
  const tool = relevant.find(file => TOOL_FILES.test(file)); if (tool) return all(`replay tool changed: ${tool}`);
  const mapped = Object.keys(map.cases);
  const shared = new Set(map.extensionFiles.filter(file => mapped.length && mapped.every(name => map.cases[name].includes(file))));   // run by every case
  const names = new Set(cases.filter(name => !mapped.includes(name)));   // a case the map does not know always runs
  for (const file of relevant) {
    if (file.startsWith('desktop/e2e/recorded/')) { const name = file.split('/')[3]; if (cases.includes(name)) names.add(name); continue; }
    const inside = file.slice('extension/'.length);
    if (shared.has(inside)) return all(`shared file changed: ${file} (every case runs it)`);
    const users = mapped.filter(name => map.cases[name].includes(inside));
    if (!users.length) return all(`no case runs ${file} (unmapped: it runs everything)`);
    for (const name of users) if (cases.includes(name)) names.add(name);
  }
  return {all: false, names: [...names].sort(), why: `${names.size} of ${cases.length} cases can be affected`};
}

export function readMap(recordedDir) {
  try { return JSON.parse(fs.readFileSync(path.join(recordedDir, '..', MAP_FILE), 'utf8')); } catch { return null; }
}
