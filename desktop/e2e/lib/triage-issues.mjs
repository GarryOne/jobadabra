// Self-healing triage, part 2: the text of an issue (body, evidence, comments, labels), reading a finding back out of an issue body, and similar().
// Re-exported by triage.mjs; guarded by desktop/e2e/test/triage.test.mjs (and the other triage-*.test.mjs, severity, a11y, prejudge, regress-flaky tests).
import {replayBlock, replayCommand, replayComment} from './replay.mjs';
import {CONFIRMED, NOT_SEEN} from './triage-findings.mjs';

// A suite that failed because the AI had no credit says nothing about the product. A suite that tests the spend-limit message on purpose is not read from its logs.
export const NO_CREDIT = /credit balance is too low|spend limit is reached|AI limit reached|usage limits?\b/i;
export const LIMIT_TESTED = ['activityfailures'];

const SOURCE_WORDS = {'layout-check': 'the layout check', 'suite-failure': 'a run of the suite (a step failed)', 'ai-review': 'the AI screenshot review', 'explorer': 'the AI explorer (an AI found it, a script proved it again without AI)', 'interaction-probe': 'the interaction probe (it pressed the control and recorded what happened)'};
const sourceWords = finding => (finding.source === 'suite-failure' ? `a run of the ${finding.view} suite (a step of the ${finding.view} suite failed)` : SOURCE_WORDS[finding.source] || SOURCE_WORDS['ai-review']);

// The app's own words for its state when the picture was taken (ui-<view>.json), as table rows; empty ones are left out.
const FACT_NAMES = [['page', 'Page'], ['settingsSection', 'Settings section'], ['aiEngineChosen', 'AI engine'], ['anthropicKeySaved', 'API key saved'], ['claudeCodeInstalled', 'Claude Code installed'],
  ['notionConnected', 'Notion connected'], ['setupDone', 'Set up'], ['jobsInList', 'Jobs in the list'], ['jobsUnscored', 'Jobs not scored'], ['situation', 'Situation']];
export function factsRows(facts) {
  return FACT_NAMES.filter(([key]) => facts && facts[key] !== undefined && facts[key] !== '' && facts[key] !== null)
    .map(([key, label]) => [label, typeof facts[key] === 'boolean' ? (facts[key] ? 'yes' : 'no') : String(facts[key])]);
}

// evidence: {suite, screenshot (url), failedScreenshot (url), facts, logs: {name: text}, codeFile, message}
// A fence longer than any run of backticks inside the text, so a log or a command that contains ``` cannot close it early.
export const fence = (text, lang = '') => { const longest = Math.max(2, ...(String(text).match(/`+/g) || []).map(run => run.length)); const mark = '`'.repeat(longest + 1); return `${mark}${lang}\n${String(text).replace(/\n+$/, '')}\n${mark}`; };
// What a test step or a click reported is often a command, a stack or JSON, written over several lines: as plain markdown it collapses into one paragraph and `import` turns bold
// (#93, 3 Oct 2026). A short lead line ("Command failed:") stays prose, the rest goes in a code block. Prose findings (the AI's) are left as they are.
const CODE_SOURCES = ['suite-failure', 'interaction-probe'];
const LOOKS_LIKE_CODE = /\n|[{}]|=>|\bimport\b|\b[A-Za-z]:\\|\/home\/|\bat .+:\d+|Traceback|\bsys\.argv\b/;
export function formatDetail(finding) {
  const text = String(finding.detail || '');
  if (!CODE_SOURCES.includes(finding.source) || (!LOOKS_LIKE_CODE.test(text) && text.length <= 240)) return text;
  const split = /^([^\n:]{3,80}:)\s+([\s\S]+)$/.exec(text);
  return split ? `${split[1]}\n\n${fence(split[2])}` : fence(text);
}
const DOT = {high: '🔴', medium: '🟠', low: '🟡'};
const PLATFORM_NAME = {mac: 'Mac', windows: 'Windows'};
// The first line and the "Build tested:" line are read back by the later steps (severity, kind, the commit, "found by"); the fingerprint comment ends the body.
// Layout (3 Oct 2026, after the owner's review): the verdict line, a three-line "where and on what" block, then what was found, the evidence, how to reproduce it and where to look.
// Wide or secondary facts (the app's state, a seeded run's variation, the logs) sit in collapsed blocks, so the page reads in a few seconds.
export function issueBody(finding, runUrl, evidence = {}) {
  const view = finding.view, suite = evidence.suite || '';
  const picture = evidence.screenshot || evidence.failedScreenshot;
  const rows = factsRows(evidence.facts);
  const logs = Object.entries(evidence.logs || {}).filter(([, text]) => text);
  const platform = PLATFORM_NAME[evidence.platform] || '';
  const out = [`${DOT[finding.severity] || ''} **${finding.severity.toUpperCase()}** · ${finding.kind} · found by ${sourceWords(finding)}`.trim(), ''];
  out.push(`> 📍 Page \`${view}\`${suite ? ` · suite \`${suite}\`` : ''}${platform ? ` · ${platform}` : ''}`);
  if (evidence.build) out.push(`> 🏷️ Build tested: ${evidence.build}`);
  for (const line of [evidence.context, evidence.stepAge]) if (line) out.push(`> ${line}`);
  out.push(`> 🔗 First seen: ${runUrl}`, '', '### What was found', formatDetail(finding));
  if (finding.impact) out.push('', '### Why it matters', finding.impact);
  if (finding.workaround) out.push('', '### What the person has to do to get past it', finding.workaround);
  if (finding.suggestion) out.push('', '### Suggested', finding.suggestion);
  if (picture || rows.length || logs.length) out.push('', '### Evidence');
  if (picture) out.push(`![${view}](${picture})`);
  if (rows.length) out.push('', '<details><summary>App state when this was taken</summary>', '', ...rows.map(([name, value]) => `- **${name}:** ${value}`), '', '</details>');
  if (finding.also?.length) out.push('', '### Failed after it', ...finding.also.slice(0, 8).map(step => `- ${step}`), ...(finding.also.length > 8 ? [`- … and ${finding.also.length - 8} more`] : []), '', '<sub>Probably consequences of the first failure (later steps of the same suite).</sub>');
  for (const [name, text] of logs) out.push('', `<details><summary>${name} (last lines)</summary>`, '', fence(text), '', '</details>');
  if (suite && evidence.replay) {
    // How it was found (lib/replay.mjs): the run's type, path, window, place, theme and steps, the exact command, and the same facts as one hidden JSON line.
    out.push('', '### Reproduce', fence(replayCommand(evidence.replay), 'sh'), `The step that photographs \`${view}\` (\`snap(ctx, '${view}')\`) shows it.`,
      '', replayBlock(evidence.replay, {platform, withCommand: false}));
  } else if (suite) {
    out.push('', '### Reproduce', fence([`cd desktop/e2e`, `node suite.mjs ${suite}${evidence.seed ? `    # the fixed path` : ''}`, ...(evidence.seed ? [`E2E_SEED=${evidence.seed} node suite.mjs ${suite}    # this run's path`] : [])].join('\n'), 'sh'),
      `The step that photographs \`${view}\` (\`snap(ctx, '${view}')\`) shows it.`);
    if (evidence.seed) out.push('', `<details><summary>Variation of this run: seed ${evidence.seed}${evidence.window ? `, window ${evidence.window.join('x')}` : ''}</summary>`, '',
      ...(evidence.detail ? [`${evidence.detail}`, ''] : []), 'The seed shuffles the pages, the controls and the form data; the same seed replays the same path.', '', '</details>');
  }
  const where = [];
  if (evidence.codeFile) where.push(`- Code: \`${evidence.codeFile}\``);
  if (suite) where.push(`- The run's artifacts: \`e2e-artifacts-${suite}\` (\`ui-${view}.png\`, \`ui-${view}.json\`, the findings files)`);
  if (where.length) out.push('', '### Where to look', ...where);
  if (evidence.replay) out.push('', replayComment(evidence.replay));
  out.push('', `<!-- fingerprint: ${finding.id} -->`);
  return out.join('\n');
}

// Labels so the issue list can be filtered by severity, kind, view, suite and where the finding came from.
export const labelsFor = (finding, suite = '') => [`severity:${finding.severity}`, `kind:${finding.kind}`, `view:${finding.view}`.slice(0, 50), ...(suite ? [`suite:${suite}`.slice(0, 50)] : []),
  `source:${finding.source}`];

const buildLine = build => (build ? `\n\nBuild tested: ${build}` : '');
export const seenAgainComment = (runUrl, screenshot = '', build = '') => `Seen again in run ${runUrl}${buildLine(build)}${screenshot ? `\n\n![the page in this run](${screenshot})` : ''}`;
export const notSeenComment = (runUrl, screenshot = '', build = '') => `Not seen in run ${runUrl}: that page was photographed and reviewed again and the finding did not come back (a fix, or a one-off).${buildLine(build)}${screenshot ? `\n\n![the page in this run](${screenshot})` : ''}`;
// Closing: the finding was already "not seen" in an earlier run and a second, later run did not see it either. A person can reopen it; a finding that comes back files a new issue.
export const closedComment = (runUrl, build = '') => `Closed: not seen in two runs in a row (latest ${runUrl}).${buildLine(build)}\n\nIf it comes back, the loop files a new issue.`;

// The app version of the tested code, as a label (`version:0.5.0`) so the issue list can be filtered by it. Until 3 Oct 2026 it was only text in the body, and only when a
// release tag sat on exactly that commit: most tested commits lie between releases, so most issues had no version at all. Now: the newest release that is an ancestor of the
// tested commit (exact when it is that commit). `gh` and the repo are injected; any failure gives null (an issue is never held back for want of a label).
export const versionLabel = version => `version:${version}`.slice(0, 50);
export function appVersionAt(sha, {gh, repo, limit = 12}) {
  if (!sha || !repo) return null;
  try {
    const releases = JSON.parse(gh(['api', `repos/${repo}/releases?per_page=${limit}`, '--jq', '[.[] | select(.draft | not) | {tag: .tag_name}]']));
    for (const {tag} of Array.isArray(releases) ? releases : []) {
      if (!/^desktop-v/.test(tag || '')) continue;
      const status = String(gh(['api', `repos/${repo}/compare/${tag}...${sha}`, '--jq', '.status'])).trim();
      if (status === 'identical' || status === 'ahead') return {version: tag.replace(/^desktop-v/, ''), exact: status === 'identical'};
    }
  } catch { /* no label this time */ }
  return null;
}

// Closed after one clean run because a commit named the issue: says which commit and which run.
export const closedByFixComment = (runUrl, sha, build = '') => `Closed: commit ${sha} says it fixes this, and the latest run did not see it (${runUrl}).${buildLine(build)}\n\nIf it comes back, the loop files a new issue.`;

// The suite a suite-failure issue came from ("found by a run of the apply suite"), else ''.
export const suiteOfIssue = issue => /found by a run of the (\w+) suite/.exec(issue.body || '')?.[1] || '';

// Open issues that earned closing: labelled not-seen-latest, not matched by this run's findings, not already told about this run, and cleared by it.
// `cleared(issue)` says whether this run looked at the issue's page/suite again (the caller knows the artifacts).
export const toClose = (issues, matched, runUrl, cleared) => issues.filter(issue => issue.state === 'OPEN' && !matched.has(issue.number)
  && (issue.labels || []).some(item => (item.name || item) === NOT_SEEN)
  && !(issue.labels || []).some(item => ['intermittent', CONFIRMED].includes(item.name || item))   // intermittent (lib/flaky-proof.mjs): it shows only sometimes, so two clean runs prove nothing (#1897); a person said it is real: "not seen" proves nothing (it may only show under a condition, like the API failing, #94), so only a fix closes it
  && !(issue.comments || []).some(comment => (comment.body || '').includes(runUrl)) && cleared(issue));

// A probe issue ("jobs: dead control on jobs: "0Inbound"") is cleared by a run whose probe pressed that same control again and did not flag it. Until 3 Oct 2026 nothing cleared
// them: the check only knew screenshot reviews, so a fixed probe finding stayed open until a pull request named it.
export const probeTarget = issue => {
  if (!(issue.labels || []).some(item => (item.name || item) === 'source:interaction-probe')) return null;
  const view = /^\[auto-ui\] ([^:]+):/.exec(issue.title || '')?.[1], control = /"([^"]+)"\s*$/.exec(issue.title || '')?.[1];
  return view && control ? {view, control} : null;
};
export const probeCleared = (issue, pressed) => { const target = probeTarget(issue); return !!target && pressed.some(row => row.view === target.view && row.control === target.control); };

// A commit between the build an issue was first seen on and the build now tested that says "Fixes #N" (also "Closes", "Fixed", "Resolves", lists like "#1, #2"): the fix is known, one clean run is enough.
export const namesIssue = (message, number) => {
  const pattern = /\b(?:fix(?:es|ed)?|close[sd]?|resolve[sd]?)\b[:\s]+((?:#\d+[\s,&and]*)+)/gi;
  for (const match of String(message || '').matchAll(pattern)) if ((match[1].match(/#(\d+)/g) || []).some(ref => ref === `#${number}`)) return true;
  return false;
};
export const firstBuildSha = issue => /Build tested: .*? @ ([0-9a-f]{7})/.exec(issue.body || '')?.[1] || '';
export const testedSha = build => /@ ([0-9a-f]{7})/.exec(build || '')?.[1] || '';

// The first picture of an issue (its body, else its newest comment that has one): what a fix pull request shows as "before".
export function screenshotOf(issue) {
  const find = text => /!\[[^\]]*\]\((https:\/\/raw\.githubusercontent\.com\/[^)\s]+\.png)\)/.exec(text || '')?.[1] || '';
  return find(issue.body) || [...(issue.comments || [])].reverse().map(comment => find(comment.body)).find(Boolean) || '';
}

// The finding's own words in an issue body: the "What was found" section (old bodies had it right after the first line, new ones after a metadata block).
export const foundText = body => { const text = String(body || ''); const at = text.indexOf('### What was found'); return (at >= 0 ? text.slice(at + 18).split('\n###')[0] : text.split('\n').slice(1, 4).join(' ')).replace(/\s+/g, ' ').trim().slice(0, 600); };

// How alike two texts are, 0..1: the share of their words (3+ letters) that both have. The AI words the same problem differently every run.
const wordsOf = text => new Set(String(text || '').toLowerCase().match(/[a-z]{3,}/g) || []);
export function similar(a, b) {
  const x = wordsOf(a), y = wordsOf(b);
  if (!x.size || !y.size) return 0;
  const both = [...x].filter(word => y.has(word)).length;
  return both / (x.size + y.size - both);
}

// The open issue this finding already is: the same fingerprint, else the same view and kind with alike words.
