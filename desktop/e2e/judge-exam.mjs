// The verdict pass's exam (lib/judge-exam.mjs), run by judge-exam.yml:
//   node judge-exam.mjs --prepare .heal                                  -> .heal/pending.json, .heal/exam/<id>/code/, .heal/exam-prompt.md
//   node judge-exam.mjs --score --verdicts .heal/verdicts.md --out .heal/judge-exam.json
import fs from 'node:fs';
import path from 'node:path';
import {loadExam, examPending, scoreExam} from './lib/judge-exam.mjs';
import {parseVerdicts, prejudgePrompt} from './lib/prejudge.mjs';

const args = process.argv.slice(2), at = name => (args.includes(name) ? args[args.indexOf(name) + 1] : '');
const items = loadExam();
if (args.includes('--prepare')) {
  const out = at('--prepare');
  const pending = examPending(items);
  fs.mkdirSync(path.join(out, 'exam'), {recursive: true});
  for (const item of items) fs.cpSync(item.codeDir, path.join(out, 'exam', item.id, 'code'), {recursive: true});
  fs.writeFileSync(path.join(out, 'pending.json'), JSON.stringify(pending, null, 2));
  const base = fs.readFileSync(new URL('./ui-verdict-prompt.md', import.meta.url), 'utf8').replace(/\n3\. Write \.heal\/verdict\.md\./, '\n3. Write the verdict (see THIS RUN below for the file).');
  fs.writeFileSync(path.join(out, 'exam-prompt.md'), prejudgePrompt(pending, base));
  console.log(`${pending.length} planted finding(s) to judge: ${path.join(out, 'exam-prompt.md')}`);
} else if (args.includes('--score')) {
  const text = fs.existsSync(at('--verdicts')) ? fs.readFileSync(at('--verdicts'), 'utf8') : '';
  const result = scoreExam(items, parseVerdicts(text, items.map(item => item.id)));
  fs.writeFileSync(at('--out'), JSON.stringify(result, null, 2));
  const line = `Judge exam: ${result.right} of ${result.total} right (${result.dismissed} real bug(s) dismissed, ${result.believed} false alarm(s) believed, ${result.missing} unanswered).`;
  console.log(`${line}\n${result.rows.map(row => `- ${row.right ? '✅' : '❌'} ${row.id}: expected ${row.expect}, got ${row.got}`).join('\n')}\n`);
} else console.log('usage: node judge-exam.mjs --prepare <dir> | --score --verdicts <file> --out <file>');
