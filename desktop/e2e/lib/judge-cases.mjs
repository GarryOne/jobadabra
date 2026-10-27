// The answer key of judge-eval.mjs: closed auto-ui issues a person settled -> findings with their truth (resolution:fixed = real; resolution:by-design or
// resolution:fp:* = false; not-seen, stale-sighting and duplicate settle nothing and are left out), and the table that compares each setup with that truth,
// per detector. Also scores the old Claude Code agent from its own verdict comments, as the baseline. Pure. Guarded by test/judge-eval.test.mjs.
import {MARK} from './verdict-comment.mjs';

const section = (body, name) => (new RegExp(`### ${name}\\n+([\\s\\S]*?)(?:\\n### |\\n<details>|\\n<!--|$)`).exec(body)?.[1] || '').trim();
const logBlocks = body => [...body.matchAll(/<summary>((?:engine|app)\.log)[^<]*<\/summary>\s*```\n?([\s\S]*?)```/g)].map(m => `${m[1]}:\n${m[2].trim().slice(-2000)}`).join('\n\n');

export function truthOf(labels) {
  const names = labels.map(label => label.name || label);
  if (names.includes('resolution:fixed')) return 'real';
  if (names.some(name => name === 'resolution:by-design' || name.startsWith('resolution:fp:'))) return 'false';
  return '';
}

// The old verdict pass's own word on the issue (its first decorated comment written "read-only"), for the baseline column.
export const agentWord = issue => {
  const comment = (issue.comments || []).find(item => MARK.test(item.body || '') && /verdict pass · read-only/.test(item.body || ''));
  return comment ? MARK.exec(comment.body)[1] : '';
};

// One filed issue -> the finding as the judge reads it (also the verdict pass's input: judge.mjs --issue).
export function findingOf(issue) {
  const body = String(issue.body || ''), names = (issue.labels || []).map(label => label.name || label);
  const source = (names.find(name => name.startsWith('source:')) || '').slice(7);
  const png = /!\[[^\]]*\]\((https:\/\/raw\.githubusercontent\.com\/[^)]+\.png)\)/.exec(body)?.[1] || '';
  const step = /-failed-([A-Za-z0-9-]+)\.png$/.exec(png)?.[1]?.replace(/-[^-]*$/, '').replace(/-/g, ' ') || '';   // the slug is cut mid-word: drop its last piece
  const finding = {source, kind: (names.find(name => name.startsWith('kind:')) || '').slice(5) || (/· ([\w-]+) · found by/.exec(body)?.[1] || ''),
    severity: (/\*\*(HIGH|MEDIUM|LOW)\*\*/.exec(body)?.[1] || 'medium').toLowerCase(), view: /Page `([^`]+)`/.exec(body)?.[1] || '',
    title: String(issue.title).replace(/^\[auto-ui\]\s*[^:]*:\s*/, ''), detail: section(body, 'What was found').slice(0, 1500), impact: section(body, 'Why it matters').slice(0, 600),
    ...(step ? {step} : {})};
  return {finding, png, logs: logBlocks(body), sha: /main @ ([0-9a-f]{7,40})/.exec(body)?.[1] || /\| Build \| `([0-9a-f]{7,40})`/.exec(body)?.[1] || ''};
}

export function casesFrom(issues) {
  return issues.map(issue => ({number: issue.number, truth: truthOf(issue.labels), createdAt: issue.createdAt, agent: agentWord(issue), ...findingOf(issue)}))
    .filter(item => item.truth && item.finding.source);
}

// The owner's corrections, without any that name the case itself: a lesson never grades its own issue.
export const lessonsWithout = (text, number) => String(text || '').split('\n').filter(line => !new RegExp(`#${number}\\b`).test(line)).join('\n');

const agrees = (truth, word) => (truth === 'real' ? word === 'real' : ['false-positive', 'harness'].includes(word));
const wrong = (truth, word) => (truth === 'real' ? ['false-positive', 'harness'].includes(word) : word === 'real');

// A setup's answer for one case from the kept answers: {word, usd, asked} or null (not asked yet). free+haiku = Free AI, then Haiku when Free AI was unsure or failed.
export function answerOf(setup, number, kept, {unsure}) {
  const free = kept.get(`${number}|free`), haiku = kept.get(`${number}|haiku`);
  const word = row => (row?.ok ? row.judged.word : 'needs-human');
  if (setup === 'free') return free ? {word: word(free), usd: free.usd, asked: 1} : null;
  if (setup === 'haiku') return haiku ? {word: word(haiku), usd: haiku.usd, asked: 1} : null;
  if (!free) return null;
  if (free.ok && !unsure(free.judged)) return {word: free.judged.word, usd: free.usd, asked: 1};
  return haiku ? {word: word(haiku), usd: free.usd + haiku.usd, asked: 2} : null;
}

// -> markdown: per detector, per setup: agrees / wrong / unsure (needs-human) and the cost of one judgement. The agent's column reads its own verdict comments.
export function scoreTable(cases, kept, {unsure, setups = ['agent', 'free', 'haiku', 'free+haiku']} = {}) {
  const detectors = [...new Set(cases.map(item => item.finding.source))].sort();
  const cell = (list, setup) => {
    const answers = list.map(item => ({item, answer: setup === 'agent' ? (item.agent ? {word: item.agent, usd: 0} : null) : answerOf(setup, item.number, kept, {unsure})})).filter(row => row.answer);
    if (!answers.length) return {text: '-', n: 0};
    const ok = answers.filter(({item, answer}) => agrees(item.truth, answer.word)).length, bad = answers.filter(({item, answer}) => wrong(item.truth, answer.word)).length;
    const lostReal = answers.filter(({item, answer}) => item.truth === 'real' && wrong(item.truth, answer.word)).length;
    const usd = answers.reduce((sum, row) => sum + (row.answer.usd || 0), 0) / answers.length;
    return {text: `${Math.round((100 * ok) / answers.length)}% (${ok}/${answers.length}; ${bad} wrong${lostReal ? `, ${lostReal} real lost` : ''})`, n: answers.length, usd};
  };
  const rows = [...detectors.map(source => [source, cases.filter(item => item.finding.source === source)]), ['**all**', cases]].map(([name, list]) => {
    const real = list.filter(item => item.truth === 'real').length;
    return `| ${name} | ${real}/${list.length - real} | ${setups.map(setup => cell(list, setup).text).join(' | ')} |`;
  });
  const costs = setups.filter(setup => setup !== 'agent').map(setup => `${setup}: $${(cell(cases, setup).usd || 0).toFixed(4)}`).join(' · ');
  return [`| Detector | Real/false | ${setups.map(setup => (setup === 'agent' ? 'Sonnet agent (until 26 Oct)' : setup)).join(' | ')} |`, `|---|---|${setups.map(() => '---').join('|')}|`, ...rows, '',
    `Agree = the same verdict as the person (real, or false-positive/harness for a false one); wrong = the opposite; the rest said needs-human. One judgement costs: ${costs}.`].join('\n');
}

// The judge exam (lib/judge-exam.mjs: findings from the loop's history with their code as of their build and a known answer) as cases with their own excerpts.
// A code file is named <path with __ for />.<ref>.<from>-<to>.txt.
export function examCases(items, read) {
  return items.map(item => ({number: item.id, truth: item.expect === 'real' ? 'real' : 'false', agent: '', png: '', logs: '', sha: '',
    finding: {...item.finding, detail: String(item.finding.detail || '')},
    excerpts: item.code.map(file => {
      const m = /([^/]+)\.[^.]+\.(\d+)-(\d+)\.txt$/.exec(file);
      if (!m) return null;
      const lines = read(file).replace(/\n$/, '').split('\n');
      return {file: m[1].replace(/__/g, '/'), from: Number(m[2]), to: Number(m[2]) + lines.length - 1, lines, why: 'the code at the tested build'};
    }).filter(Boolean)}));
}
