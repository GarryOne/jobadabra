#!/usr/bin/env node
// The prompt case gate (docs/rules/files.md "Comments" → "Prompts"; owner, 27 Oct 2026: a session reworded a prompt to pass one benchmark case, "another session can
// come tomorrow and redo that prompt for a different use-case and basically introducing a regression"). A push that changes an AI prompt's text also adds the case it
// fixed to that prompt's fixed case set (tools/prompt-cases.json), or a commit says "Prompt-case: none <why>" (a typo, a pure move, a prompt with no set yet).
// A prompt: a top-level string constant named *SYSTEM, *PROMPT, *RULE(S), *INSTRUCTIONS or *EXAMPLES in worker/src/*.js, desktop/lib/*.js or src/**/*.py.
// Usage: node tools/prompt-cases.mjs [--base origin/main]            exit 1 with the prompts and what to add.
//        node tools/prompt-cases.mjs --live [--base origin/main]     prints the live sets the push reaches, one per line (prompt-cases.yml re-asks them).
// Guard: desktop/test/prompt-cases.test.js.
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const PROMPT_FILE = /^(worker\/src\/[^/]+\.js|desktop\/lib\/[^/]+\.js|src\/.+\.py)$/;
const NAME = /^(?:export\s+)?(?:const\s+|let\s+)?([A-Z0-9_]*(?:SYSTEM|PROMPT|RULES?|INSTRUCTIONS|EXAMPLES))\s*=\s*(.*)$/;
const STRING_START = /^(?:[rRbBuUfF]{0,2}("""|'''|"|')|`|\()/;
const TRAILER = /^Prompt-case:[ \t]*none\s+\S.{6,}$/m;

// From the opening quote at `at` of `text`, the index just past the literal's end (JS template, Python triple or single quotes, or a parenthesised Python string run).
function literalEnd(text, at) {
  const rest = text.slice(at);
  const triple = /^[rRbBuUfF]{0,2}("""|''')/.exec(rest);
  if (triple) { const close = text.indexOf(triple[1], at + triple[0].length); return close < 0 ? text.length : close + 3; }
  const quote = /^[rRbBuUfF]{0,2}([`"'])/.exec(rest);
  if (quote) {
    for (let i = at + quote[0].length; i < text.length; i++) {
      if (text[i] === '\\') { i++; continue; }
      if (text[i] === quote[1]) return i + 1;
      if (quote[1] !== '`' && text[i] === '\n') return i;
    }
    return text.length;
  }
  let depth = 0;   // "(": to the matching ")", skipping what sits in strings
  for (let i = at; i < text.length; i++) {
    if (`"'`.includes(text[i])) { i = literalEnd(text, i) - 1; continue; }
    if (text[i] === '(') depth++;
    if (text[i] === ')' && --depth === 0) return i + 1;
  }
  return text.length;
}

// A file's text -> Map(name -> the prompt's source text, every top-level assignment of it joined). Only names first set to a string count; later assignments of
// the same name (SYSTEM = WRITING_RULES + SYSTEM) are part of it.
export function promptTexts(text) {
  const prompts = new Map();
  const lines = String(text).split('\n');
  let offset = 0;
  for (const line of lines) {
    const found = NAME.exec(line);
    if (found && (STRING_START.test(found[2]) || prompts.has(found[1]))) {
      const at = offset + line.length - found[2].length;
      const end = STRING_START.test(found[2]) ? literalEnd(text, at) : offset + line.length;
      prompts.set(found[1], `${prompts.get(found[1]) ?? ''}${line.slice(0, line.length - found[2].length)}${text.slice(at, Math.max(end, offset + line.length))}\n`);
    }
    offset += line.length + 1;
  }
  return prompts;
}

// before/after: a file's text -> the names of its prompts whose text changed (added, removed or edited).
export function changedPrompts(before, after) {
  const old = promptTexts(before), now = promptTexts(after);
  return [...new Set([...old.keys(), ...now.keys()])].filter(name => old.get(name) !== now.get(name));
}

// registry -> [{file, name, set}] lookups.
const setOf = (registry, file, name) => Object.entries(registry.sets).find(([, set]) => (set.prompts[file] || []).includes(name))?.[0] || '';

// changes: [{file, name}]; addedTo(file): lines the push adds to a file; messages: the push's commit messages. -> '' or the message.
export function missingCase(changes, addedTo, messages, registry) {
  if (!changes.length || messages.some(message => TRAILER.test(String(message)))) return '';
  const problems = [];
  for (const {file, name} of changes) {
    const set = setOf(registry, file, name);
    if (!set) { problems.push(`${file} ${name}: no case set protects it yet: add one in tools/prompt-cases.json with its first case, or say "Prompt-case: none <why>"`); continue; }
    if (!registry.sets[set].cases.some(caseFile => addedTo(caseFile) > 0)) problems.push(`${file} ${name}: add the case this change fixes to the "${set}" set (${registry.sets[set].cases.join(' or ')})`);
  }
  if (!problems.length) return '';
  return `this push changes ${problems.length > 1 ? 'AI prompts' : 'an AI prompt'} without a case that shows why:\n  ${problems.join('\n  ')}\nA prompt reworded for one case can undo an earlier one; its set replays on every prompt change (docs/rules/files.md "Prompts"). A typo or a pure move: "Prompt-case: none <why>".`;
}

// The tools that build and ask the live sets: a change to one re-asks every live set, since it can change every answer (27 Oct 2026: #2259 moved the asker to an API key and no set was asked).
export const ASKERS = ['tools/prompt-cases-live.mjs', 'tools/free-ai-eval-claude.mjs', 'tools/free-ai-eval.mjs', 'tools/free-ai-form-cases.mjs',
  'tools/prompt-cases.mjs', '.github/workflows/prompt-cases.yml'];   // gitar on #2259: the workflow pins Claude Code and sets the key and caps; prompt-cases.mjs picks the sets

// The live sets a push reaches: a changed prompt of the set, a changed case file of it, or a changed asker.
export function liveSets(changes, changedFiles, registry) {
  const asker = ASKERS.some(file => changedFiles.includes(file));
  return Object.entries(registry.sets).filter(([name, set]) => set.live &&
    (asker || changes.some(change => setOf(registry, change.file, change.name) === name) || set.cases.some(file => changedFiles.includes(file)))).map(([name]) => name);
}

// -> {changes, addedTo, changedFiles, messages} for base..HEAD of the repo at root.
export function pushFacts({root, base = 'origin/main'}) {
  const git = (...rest) => execFileSync('git', ['-C', root, ...rest], {encoding: 'utf8', maxBuffer: 256 << 20, stdio: ['ignore', 'pipe', 'ignore']});
  const show = (rev, file) => { try { return git('show', `${rev}:${file}`); } catch { return ''; } };
  const from = git('merge-base', base, 'HEAD').trim();
  const stat = git('diff', '--numstat', '--no-renames', from, 'HEAD').trim().split('\n').filter(Boolean).map(line => line.split('\t'));
  const added = new Map(stat.map(([plus, , file]) => [file, Number(plus) || 0]));
  const changes = stat.map(([, , file]) => file).filter(file => PROMPT_FILE.test(file)).flatMap(file => changedPrompts(show(from, file), show('HEAD', file)).map(name => ({file, name})));
  return {changes, addedTo: file => added.get(file) || 0, changedFiles: [...added.keys()], messages: git('log', '--format=%B%x00', `${base}..HEAD`).split('\0')};
}

function main() {
  const base = process.argv.includes('--base') ? process.argv[process.argv.indexOf('--base') + 1] : 'origin/main';
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const registry = JSON.parse(fs.readFileSync(path.join(root, 'tools/prompt-cases.json'), 'utf8'));
  let facts;
  try { facts = pushFacts({root, base}); } catch { return 0; }   // no base to compare with: nothing to say
  if (process.argv.includes('--live')) { for (const name of liveSets(facts.changes, facts.changedFiles, registry)) console.log(name); return 0; }
  const why = missingCase(facts.changes, facts.addedTo, facts.messages, registry);
  if (why) { console.error(why); return 1; }
  return 0;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) process.exit(main());
