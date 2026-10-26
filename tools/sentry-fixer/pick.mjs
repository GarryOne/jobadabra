// The Sentry fixer's first step (sentry-fix.yml): the most critical issue of the app's Sentry project that is real, fresh and not already being fixed.
//   node tools/sentry-fixer/pick.mjs --out .heal     (needs SENTRY_AUTH_TOKEN, `gh` and GH_TOKEN)
// Writes <out>/candidate.json + <out>/prompt.md and sets the step output `candidate` (the Sentry short id, or "none"). The public run log gets only short ids and reasons, never event content.
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {VERDICT_LABEL, choose, eventFacts, exceptionType} from './lib.mjs';

const ORG = 'job-pilotto', PROJECT = 'job-pilotto-app', HOST = 'https://de.sentry.io';
const api = async route => {
  const response = await fetch(`${HOST}/api/0/${route}`, {headers: {Authorization: `Bearer ${process.env.SENTRY_AUTH_TOKEN}`}});
  if (!response.ok) throw new Error(`Sentry ${route.split('?')[0]}: HTTP ${response.status}`);
  return response.json();
};

const outDir = (process.argv.includes('--out') && process.argv[process.argv.indexOf('--out') + 1]) || '.heal';
fs.mkdirSync(outDir, {recursive: true});
const issues = await api(`projects/${ORG}/${PROJECT}/issues/?statsPeriod=14d&query=is:unresolved&limit=100`);
const candidates = [];
for (const issue of issues) {
  const event = await api(`organizations/${ORG}/issues/${issue.id}/events/latest/`).catch(() => null);
  const tags = Object.fromEntries((event?.tags || []).map(tag => [tag.key, tag.value]));
  candidates.push({issue, event, environment: tags.environment || '', tags, type: exceptionType(event)});
}
const prs = JSON.parse(execFileSync('gh', ['pr', 'list', '--state', 'all', '--search', 'head:sentry-fix/', '--json', 'headRefName,state,closedAt,mergedAt', '--limit', '100'], {encoding: 'utf8'}) || '[]');
const verdicts = JSON.parse(execFileSync('gh', ['issue', 'list', '--state', 'all', '--label', VERDICT_LABEL, '--json', 'title,createdAt', '--limit', '100'], {encoding: 'utf8'}) || '[]');
const {pick, left} = choose(candidates, prs, Date.now(), verdicts);

const lines = [`## Sentry fixer`, pick ? `Most critical fixable issue: ${pick.issue.shortId}` : 'Nothing is ready to fix.', ...left.map(item => `- ${item.shortId}: ${item.why}`)];
console.log(lines.join('\n'));
if (pick) {
  const facts = eventFacts(pick.event || {});
  const candidate = {shortId: pick.issue.shortId, title: pick.issue.title, culprit: pick.issue.culprit, count: Number(pick.issue.count), users: pick.issue.userCount, firstSeen: pick.issue.firstSeen, lastSeen: pick.issue.lastSeen, link: pick.issue.permalink, ...facts};
  fs.writeFileSync(path.join(outDir, 'candidate.json'), JSON.stringify(candidate, null, 2));
  const template = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'prompt.md'), 'utf8');
  fs.writeFileSync(path.join(outDir, 'prompt.md'), `${template}\n\n## The Sentry issue\n\`\`\`json\n${JSON.stringify(candidate, null, 2)}\n\`\`\`\n`);
}
if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `candidate=${pick ? pick.issue.shortId : 'none'}\n`);
