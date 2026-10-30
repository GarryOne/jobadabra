// Approve current fixed-system instruction hashes offline without changing any stored answer bytes or keys.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {capturePrompts, familyHashes} from '../desktop/e2e/lib/ai-answer-prompts.mjs';
const FILE = fileURLToPath(new URL('../desktop/e2e/fixtures/golden/ai-answers.json', import.meta.url));

/** Explicitly approve selected captured contracts; preserve every byte outside the promptHashes property. */
export function stampAnswers({file = FILE, family, all = false, root} = {}) {
  const hashes = familyHashes(capturePrompts(root)), before = fs.readFileSync(file, 'utf8'), table = JSON.parse(before);
  if (!all && !Object.hasOwn(hashes, family)) throw new Error(`Unknown or uncaptured family: ${family}`);
  const selected = all ? hashes : {[family]: hashes[family]}, approved = {...table.promptHashes, ...selected};
  const property = `"promptHashes": ${JSON.stringify(Object.fromEntries(Object.entries(approved).sort()), null, 2).replace(/\n/g, '\n  ')}`;
  // Invariant: only the stamp property changes, including on compact temporary tables; two runs produce identical bytes.
  const after = table.promptHashes ? before.replace(/"promptHashes"\s*:\s*\{[^}]*\}/, property) : before.replace(/\{/, `{\n  ${property},`);
  fs.writeFileSync(file, after);
  return selected;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (!(args.length === 1 && args[0] === '--all') && !(args.length === 2 && args[0] === '--family')) throw new Error('Usage: --family <family> | --all');
  console.log(JSON.stringify(stampAnswers({all: args[0] === '--all', family: args[1]}), null, 2));
}
