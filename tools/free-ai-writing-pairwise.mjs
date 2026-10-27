// Head-to-head on written text: two models' answers to the same case, shown in both orders to a Claude judge on the plan (`claude -p`), which picks the better one for the job seeker. Ranks writers the pass/fail rubric (free-ai-writing-judge.mjs) cannot tell apart.
//   node tools/free-ai-writing-pairwise.mjs --a <raw.json>:<slot>:<label> --b <raw.json>:<slot>:<label> --judges claude:sonnet,claude:opus [--features letter,prep] --out <dir>
// Why (27 Oct 2026, owner): the rubric said "no gain over Haiku" on 5 cases per feature; a yes/no floor check cannot reward richer text, and a judge from a writer's own family favours it, so each pair is judged in both orders by two judges.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {claudeRun} from './free-ai-eval-claude.mjs';
import {withFloors} from './free-ai-writing-eval.mjs';
import {proseOf} from './free-ai-writing-judge.mjs';
import {allCases} from './free-ai-writing-cases.mjs';

const SCHEMA = {type: 'object', additionalProperties: false, required: ['winner', 'reason'], properties: {winner: {type: 'string', enum: ['A', 'B', 'tie']}, reason: {type: 'string', description: 'One sentence: what decided it'}}};
const SYSTEM = 'You compare two texts an AI wrote for the same job seeker from the same facts. Pick the one the job seeker would rather send or use: more useful, specific to THIS posting, honest about gaps, in a direct personal voice, well formed. A fact not in the given facts counts heavily against a text. Length and polish alone never win. Answer "tie" only when you truly cannot choose.';

/**
 * One judge's pick between two texts for the same case.
 * Invariant: the caller shows each pair in both orders (see main), so a judge's position bias cancels; a judge of the writer's own family favours it, so the report splits every result per judge.
 * @param {object} item a case from free-ai-writing-cases.mjs (params, trap)
 * @returns {Promise<{winner: 'A'|'B'|'tie', reason: string}|null>} null when the judge failed twice
 * TODO(AI): 5 cases per feature is a direction, not proof; --more-letters gives 15 letters (27 Oct 2026)
 */
export async function compare(item, textA, textB, run, model) {
  const facts = item.params.system.map(part => part.text).join('\n').slice(-9000) + '\n' + item.params.messages.map(message => message.content).join('\n').slice(0, 9000);
  const input = {messages: [{role: 'system', content: SYSTEM}, {role: 'user', content: `# Facts the writer had\n${facts}\n\n# What a careless writer gets wrong here\n${item.trap}\n\n# Text A\n${textA}\n\n# Text B\n${textB}`}], response_format: {json_schema: {schema: SCHEMA}}};
  for (let attempt = 0; attempt < 2; attempt++) {
    try { const reply = JSON.parse((await run(model, input)).choices[0].message.content); if (['A', 'B', 'tie'].includes(reply.winner)) return reply; } catch (error) { console.error(`judge: ${error.message.slice(0, 160)}`); }
  }
  return null;
}

/** Per feature: wins for a, wins for b, ties, over every (case, order, judge) verdict. */
export function tally(rows) {
  const out = {};
  for (const row of rows) { const t = (out[row.feature] ||= {a: 0, b: 0, tie: 0, n: 0}); t.n++; t[row.winner]++; }
  return out;
}

async function main(argv) {
  const option = name => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };
  const load = spec => { const [file, slot, label] = spec.split(':'); return {raw: JSON.parse(fs.readFileSync(file, 'utf8')), slot, label}; };
  const a = load(option('a')), b = load(option('b'));
  const judges = (option('judges') || 'claude:sonnet,claude:opus').split(',');
  const wanted = (option('features') || 'letter,review,prep,weekly,rejection').split(',');
  const out = option('out'); fs.mkdirSync(out, {recursive: true});
  const run = claudeRun();
  const rows = [];
  for (const item of allCases({more: process.argv.includes('--more-letters')}).filter(c => wanted.includes(c.feature) && a.raw[c.id]?.[a.slot]?.data && b.raw[c.id]?.[b.slot]?.data)) {
    const text = side => proseOf(item.feature, withFloors(item, side.raw[item.id][side.slot].data));
    const [ta, tb] = [text(a), text(b)];
    for (const model of judges) for (const flip of [false, true]) {
      const verdict = await compare(item, flip ? tb : ta, flip ? ta : tb, run, model);
      if (!verdict) continue;
      const winner = verdict.winner === 'tie' ? 'tie' : (verdict.winner === 'A') !== flip ? 'a' : 'b';   // back to a/b whatever the order
      rows.push({id: item.id, feature: item.feature, judge: model, flip, winner, reason: verdict.reason});
      console.error(`${item.id} ${model} ${flip ? 'B|A' : 'A|B'}: ${winner}`);
    }
  }
  fs.writeFileSync(path.join(out, 'pairwise.json'), JSON.stringify(rows, null, 1));
  const lines = [`A = ${a.label}, B = ${b.label}; each case in both orders by ${judges.join(' and ')}`, '', '| Feature | n | A wins | B wins | tie |', '|---|---|---|---|---|'];
  const sum = {a: 0, b: 0, tie: 0, n: 0};
  for (const [feature, t] of Object.entries(tally(rows))) { lines.push(`| ${feature} | ${t.n} | ${t.a} | ${t.b} | ${t.tie} |`); for (const k of Object.keys(sum)) sum[k] += t[k]; }
  lines.push(`| all | ${sum.n} | ${sum.a} | ${sum.b} | ${sum.tie} |`);
  for (const model of judges) { const mine = rows.filter(r => r.judge === model); lines.push('', `${model}: A ${mine.filter(r => r.winner === 'a').length}, B ${mine.filter(r => r.winner === 'b').length}, tie ${mine.filter(r => r.winner === 'tie').length}; picked the first-shown text ${mine.filter(r => (r.winner === 'a') !== r.flip && r.winner !== 'tie').length} of ${mine.filter(r => r.winner !== 'tie').length} times (position bias check)`); }
  fs.writeFileSync(path.join(out, 'table.md'), lines.join('\n') + '\n');
  process.stdout.write(lines.join('\n') + '\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exit(1); });
