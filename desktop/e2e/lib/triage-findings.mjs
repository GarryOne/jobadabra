// Self-healing triage, part 1: the label names and thresholds, what a fix may touch, finding severities and normalize() (ui + ai + suite findings -> one list).
// Re-exported by triage.mjs; guarded by desktop/e2e/test/triage.test.mjs (and the other triage-*.test.mjs, severity, a11y, prejudge, regress-flaky tests).
// Job: report health
import {fingerprint, cappedSeverity} from './vision.mjs';


export const LABEL = 'auto-ui';
export const NEEDS_HUMAN = 'needs-human';
export const FALSE_POSITIVE = 'wontfix-auto';
export const CONFIRMED = 'confirmed';   // a person looked at the finding and says it is real: ready without a second sighting
export const NOT_SEEN = 'not-seen-latest';   // the page was photographed and reviewed again and the finding did not come back
export const SEEN_AGAIN = 'seen-again';   // seen on two or more commits (sightings()): reproduced, not a one-off
export const SIGHTINGS_NEEDED = 2;   // a finding must show in two runs before anyone (or anything) acts on it: one-off flakes and model noise drop out
export const LOGIC_KINDS = ['functionality', 'crash'];   // fixable since 4 Oct 2026, only when confirmed (notReadyReason)
export const FIX_KINDS = ['a11y', 'layout', 'text', 'empty-state', 'consistency', 'error-shown', 'tall-row', 'tall-cell', 'page-overflow', 'clipped-text', 'broken-image', 'spill', 'dead-control', 'silent-control', 'expand-broken', 'no-loading-state', 'distorted-spinner'];

// Allowed edits of an automatic fix: the window's pages, styles and their tests. Nothing that touches data, Notion, secrets, the engine, the site or workflows.
// Since 4 Oct 2026 also the engine (src/*.py) and the app's own logic (desktop/lib/*.js), with their tests: confirmed logic bugs from the AI code review (#109, #110)
// had to be fixed by hand. Never: workflows, tools, the extension, packaging, the e2e harness, main.js, or anything about secrets, licences, sign-in or tokens.
export const ALLOWED = [/^desktop\/renderer\/[^\n]+$/, /^desktop\/test\/[^\n]+\.test\.js$/, /^src\/[^\n]+\.py$/, /^tests\/test_[^\n/]+\.py$/, /^desktop\/lib\/[^\n]+\.js$/];
const SENSITIVE = /secret|keychain|licen[cs]e|oauth|token|credential|crash_reporting/i;
export const allowedPath = file => ALLOWED.some(pattern => pattern.test(file)) && !file.includes('..') && !SENSITIVE.test(file);

// ui-findings.json (deterministic) + ai-findings.json (vision) -> one list: {id, view, severity, kind, title, detail, suggestion, source}.
// AI findings rated "low" are noise by experience (about 1 in 16 was real) and are not filed; deterministic "severe" counts as high, "warning" as medium.
// The probe's own grading: a dead or broken control confuses (medium); a call with no sign of work is barely noticeable (low) until the person waits seconds for it (medium).
const SLOW_NOTICEABLE_MS = 3000;
// A deterministic check's own words, in the owner's levels: an exact severe check is high; of the warnings, tiny text and a tall table cell are polish, the rest confuse a little.
// A page that states a wrong result about itself (`wrong-result`) is high: it misleads the person (the owner's definition). Deterministic, so it is never low.
export const layoutSeverity = item => item.severity === 'severe' || item.kind === 'wrong-result' ? 'high' : ['tiny-text', 'tall-cell'].includes(item.kind) ? 'low' : item.kind === 'a11y' ? a11ySeverity(item) : 'medium';
// axe's own impact, through a job seeker's eyes (owner, 4 Oct 2026, on #146: a link at 4.0:1 instead of 4.5:1 is not a medium): only a critical barrier (a control no keyboard or screen reader can use)
// is worth an issue (medium); serious, moderate and minor are low, so they are not filed. The contrast fixes still happen when someone touches that CSS.
export const a11ySeverity = item => { const impact = /\d+ element\(s\), (critical|serious|moderate|minor)/.exec(item.detail || '')?.[1]; return impact ? (impact === 'critical' ? 'medium' : 'low') : 'medium'; };
export function probeSeverity(item) {
  if (item.kind !== 'no-loading-state') return 'medium';
  const ms = Number(/ran for (\d+) ms/.exec(item.detail || '')?.[1]);
  return Number.isFinite(ms) && ms >= SLOW_NOTICEABLE_MS ? 'medium' : 'low';
}
// The window around every page (sidebar, bottom bar, brand, icon rail) looks the same on every page, so the AI review reported one sidebar defect once per page:
// nine issues for one cut-off icon (4 Oct 2026). Such a finding goes to view "app-chrome" with a key made of its words (synonyms folded), however it is worded.
const CHROME = /\b(?:sidebar|side bar|status bar|bottom bar|icon rail|brand|activity bar)\b/i;
const CHROME_WORDS = {sidebar: 'sidebar', 'side bar': 'sidebar', 'status bar': 'bottom', 'bottom bar': 'bottom', 'activity bar': 'bottom', 'icon rail': 'sidebar', brand: 'brand',
  icon: 'icon', icons: 'icon', badge: 'badge', badges: 'badge', label: 'label', search: 'search', bottom: 'bottom', footer: 'bottom', last: 'bottom', top: 'top',
  clipped: 'clipped', cut: 'clipped', truncated: 'clipped', hidden: 'clipped', overlap: 'overlap', overlaps: 'overlap', covers: 'overlap', covered: 'overlap', misaligned: 'misaligned'};
export function chromeKey(item) {
  const text = `${item.title || ''} ${item.detail || ''}`;
  if (!CHROME.test(item.title || '')) return '';
  const words = new Set(Object.entries(CHROME_WORDS).filter(([word]) => new RegExp(`\\b${word}\\b`, 'i').test(text)).map(([, key]) => key));
  return [...words].sort().join('-').slice(0, 40);
}
// One problem told twice by the AI review in ONE run (same page, same kind, other words: #270 and #271, 7 seconds apart) is one issue: the most severe stays, the
// others become lines of its detail so nothing is lost. The fingerprint cannot do this: it hashes the title, which the AI words differently each time.
const RANK = {high: 0, medium: 1, low: 2};
export function mergeSameRun(findings) {
  const groups = new Map();
  for (const item of findings) { const key = `${item.view}|${item.kind}`; (groups.get(key) || groups.set(key, []).get(key)).push(item); }
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    group.sort((a, b) => (RANK[a.severity] ?? 3) - (RANK[b.severity] ?? 3));
    const [keep, ...rest] = group;
    keep.detail = `${keep.detail}\n\nAlso told on this page in the same run: ${rest.map(item => `"${item.title}"`).join('; ')}.`;
    for (const item of rest) findings.splice(findings.indexOf(item), 1);
  }
  return findings;
}

// A console error is the window's, not a page's: one error in shared code (components.js) is thrown on every page that uses it, and was filed once per page (#307 and #308,
// the same "within.contains is not a function"). Its id is its words (numbers folded), whatever the page; copies on other pages in the same run become one line of its detail,
// and a later run that sees it on any page matches the same issue.
export const consoleKey = item => {
  const words = String(item.detail || '').toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ').trim();
  let hash = 5381;
  for (const char of words) hash = ((hash << 5) + hash + char.charCodeAt(0)) >>> 0;
  return `window-console-error-${hash.toString(36)}`;
};
export function mergeConsoleErrors(findings) {
  const first = new Map();
  for (const item of [...findings]) {
    if (item.kind !== 'console-error') continue;
    const keep = first.get(item.id);
    if (!keep) { first.set(item.id, item); continue; }
    if (keep.view !== item.view && !(keep.alsoOn || []).includes(item.view)) keep.alsoOn = [...(keep.alsoOn || []), item.view];
    findings.splice(findings.indexOf(item), 1);
  }
  for (const item of first.values()) if (item.alsoOn?.length) item.detail = `${item.detail}\n\nAlso thrown on: ${item.alsoOn.join(', ')} (one error of the window, not of one page).`;
  return findings;
}
export function normalize({ui = [], ai = [], suite = [], dropped = []}) {
  const fromUi = ui.filter(item => item && item.view && item.kind && item.detail).map(item => {
    const probed = item.source === 'interaction-probe';   // a control pressed by the interaction probe: the control is in the title
    const explored = item.source === 'explorer';   // a bug the AI explorer met AND a script proved again without AI (lib/explore.mjs): its own title and severity
    const finding = {view: item.view, severity: explored ? cappedSeverity(['high', 'medium', 'low'].includes(item.severity) ? item.severity : 'medium', item.kind) : probed ? probeSeverity(item) : layoutSeverity(item), kind: item.kind,
      title: explored ? `${item.kind.replace(/-/g, ' ')} on ${item.view}: ${String(item.title || '').slice(0, 60)}` : `${item.kind.replace(/-/g, ' ')} on ${item.view}: ${probed ? `"${item.control}"` : String(item.detail).split(' ')[0]}`, detail: item.detail, suggestion: '', source: explored ? 'explorer' : probed ? 'interaction-probe' : 'layout-check', dir: item._dir, shot: item.shot};   // the element is in the title: two problems of one page are two issues
    // `shown` is only the issue's title: a layout finding says what is on the page ("spill on settings-narrow: p#cv-message.message: "400 {"type":"error"…""), not just a selector. The fingerprint
    // keeps using `title`, so issues filed before this still match.
    const quoted = !probed && /:\s*"([\s\S]{3,})$/.exec(String(item.detail || ''))?.[1]?.replace(/"$/, '');
    return {...finding, ...(quoted ? {shown: `${finding.title}: "${quoted.replace(/\s+/g, ' ').slice(0, 40)}${quoted.length > 40 ? '…' : ''}"`} : {}), id: finding.kind === 'console-error' ? consoleKey(finding) : fingerprint(finding)};
  });
  mergeConsoleErrors(fromUi);
  const fromAi = ai.filter(item => item && item.view && item.title && item.severity).map(item => {
    const chrome = chromeKey(item);
    return {...item, severity: cappedSeverity(item.severity, item.kind, item.workaround), dir: item._dir, source: 'ai-review', ...(chrome ? {view: 'app-chrome', id: `app-chrome-${item.kind}-${chrome}`} : {id: item.id || fingerprint(item)})};
  });
  // A step of a suite that failed: one finding per step (its message changes from run to run, the step does not). Never a kind a UI fix can address.
  const fromSuite = suite.filter(item => item && item.suite && item.step).map(item => {
    // A red test step says something is off, not that a journey is blocked: that is a judgement (a person's `confirmed`), and the release gate is red anyway while any suite fails.
    // Until 3 Oct 2026 every failed step was filed high: 18 of the 21 "high" issues were test steps, and none blocked anyone.
    const finding = {view: item.suite, severity: 'medium', kind: 'test-failure', title: `step failed: ${item.step}`, detail: String(item.message || 'The step failed.'), suggestion: '', source: 'suite-failure', dir: item._dir, also: item.also || []};
    return {...finding, id: fingerprint(finding)};
  });
  const seen = new Set();
  mergeSameRun(fromAi);
  // Only medium and high are filed (owner, 4 Oct 2026: "if we assess it as low, let's not open it"): a low finding is not worth an issue, a review or a fix.
  const all = [...fromUi, ...fromAi, ...fromSuite];
  for (const item of all) if (item.severity === 'low') dropped.push({view: item.view, severity: 'low', kind: item.kind, title: String(item.title || '').slice(0, 80), source: item.source, why: 'low severity (never filed)'});
  return all.filter(item => item.severity !== 'low').filter(item => !seen.has(item.id) && seen.add(item.id));
}

export const issueTitle = finding => `[auto-ui] ${finding.view}: ${finding.shown || finding.title}`.slice(0, 120);
export const labelFor = id => `fp:${id}`.slice(0, 50);
