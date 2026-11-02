// No price is shown before an action (owner, 9 Oct 2026): not a fixed "~12¢" (read as $12), not "about $0.25", not "≈ $0.45". The cost is not known (it
// depends on the CV, the model, and the engine: a person on their own Claude Code pays a subscription, not credits). What a run actually spent, shown after it
// ran (run cards, "Actual cost"), is a fact and stays; so do the AI-cost pages.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {existsSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';

const repo = fileURLToPath(new URL('../..', import.meta.url));   // not .pathname: on Windows that is /D:/… (CI red, 9 Oct 2026)
const PRICE = /\d¢|a few cents|(?:about|≈|~) ?\$\d|\(\$?\d+(?:\.\d+)? ?(?:cents|¢)\)/i;
// Not before an action: a competitor's list price, and how much credit to put on an Anthropic account (said once, in the guide for friends).
const INFORMATION = [['compare.html', /Teal\+ about \$29\/month/], ['friends.html', /add about \$5 of credit/]];
// Every tracked page, script and style a person can see, found by git (no hand list of folders: a new UI folder is covered the day it is added; 15 Oct 2026, after the extension's panel slipped through a list).
const NOT_UI = /^(docs|tests|tools|brand|\.github|\.claude)\/|node_modules|[\\/](test|e2e|fixtures|recorded|scripts|migrations)[\\/]/;
const files = () => execFileSync('git', ['ls-files', '-z'], {cwd: repo, maxBuffer: 1 << 26}).toString().split('\0').filter(file => /\.(js|mjs|cjs|html|css|jsx|tsx|astro)$/.test(file) && !NOT_UI.test(file));

test('no price in a button, hint, tooltip or dialog before the action: the words say what it does, not what it costs', () => {
  const all = files();
  // The website's folders are in the private repo jobadabra-web: its CI runs this test over the joined tree, where they must be scanned too (the preview folder only while it exists: the next website was deleted, 2 Nov 2026, owner).
  const folders = [/^desktop\/renderer\//, /^desktop\/lib\//, /^extension\//, ...(existsSync(join(repo, 'admin')) ? [/^web\/public\//, ...(existsSync(join(repo, 'preview')) ? [/^preview\/public\//] : [])] : [])];
  for (const folder of folders) assert.ok(all.some(file => folder.test(file)), `${folder} is scanned`);
  const found = all.flatMap(file => readFileSync(join(repo, file), 'utf8').split('\n').map((line, i) => [file, i + 1, line.trim()])
    .filter(([name, , line]) => !line.startsWith('//') && !line.startsWith('*') && !line.startsWith('<!--') && PRICE.test(line)
      && !INFORMATION.some(([page, said]) => name.endsWith(page) && said.test(line))).map(([f, n]) => `${f}:${n}`));
  assert.deepEqual(found, []);
});
