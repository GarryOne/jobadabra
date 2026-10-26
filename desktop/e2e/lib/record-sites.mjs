// Layer 3 of applying reliability (spec: docs/superpowers/specs/2026-10-10-applying-reliability-layers.md): the hand-started live smoke's logic, no browser here.
// parseLive reads where a live run got to from its own printed log lines (lib/apply-live.mjs), compare finds what reached less than last time, pickPosting
// rotates through the owner's postings of each site shape. Runner: e2e/record-sites.mjs. Guard: e2e/test/record-sites.test.mjs.
import {causeOf} from '../../../extension/fill-card.js';
import {recordVar} from '../../../tools/record-env.mjs';
import {PAGE_LINE} from './live-still.mjs';
import {parseReadings} from './live-readings.mjs';
export const STEPS = ['none', 'posting', 'account', 'code/bot', 'form', 'ready'];
// Sites read only through the person's own visit, never by an automated run (CLAUDE.md: LinkedIn, Glassdoor, Indeed, levels.fyi and Reddit; 10 Oct 2026: discovery
// opened an Indeed posting). Never a smoke or discovery candidate, whatever list it comes from.
export const NEVER_VISIT = /(^|\.)(linkedin\.com|glassdoor\.[a-z.]+|indeed\.[a-z.]+|levels\.fyi|reddit\.com)$/i;
export const mayVisit = url => { try { return !NEVER_VISIT.test(new URL(url).hostname); } catch { return true; } };   // only the named sites are blocked
export const rank = step => STEPS.indexOf(step);

// The AI ladder's rung (0 to 6) of a decision, read from the app's own log lines (docs/flows/ladder.md); the app's exact line `ladder: rung N signal S` overrides what is derived.
const BY_RUNG = {ai: 2, remembered: 1, 'structure rule': 0};
const SIGNALS = ['unsure', 'contradicted', 'stalled', 'failed', 'blind'];

// The rung and signal a site's upload row carries (absent = unknown; the site drops anything else).
export const rungFields = result => ({...(result?.rung != null ? {rung: result.rung} : {}), ...(result?.signal ? {signal: result.signal} : {})});

// -> {reached, filled, left, rung (0-6 | null), signal (unsure|contradicted|stalled|failed | null), kinds: [page kinds seen], path: [{kind, host}] in order (consecutive repeats folded), errors: [lines],
//     note? (an eligibility stop and its reason, or ACCOUNT_HELD)}
// Account-first (owner, 11 Oct 2026: a documented hold): a sign-up page is filled like a form, but the run never presses its account button. While the extension's
// own last page kind is 'account' (the AI's decision), fields and marks are the account page's, never the application's; a run that ends there is ACCOUNT_HELD.
export const ACCOUNT_HELD = 'account-first: held';
// A stop the ladder's numbered digest already named (its own fixed outcome, never the page's words; cc/owner, 11 Oct 2026: Louis Vuitton and H&M answered with a block page,
// Cloudera with a sign-in wall, all "No cause recorded"): the site refuses the visitor (it comes and goes: retry later), or the job is behind a sign-in. Documented holds, not fixes;
// neither counts as a clean run on the Fixed tab (only account-first does), and a later run that gets through and fails lists the row again.
export const SITE_REFUSED = 'site refused: retry later';
export const LOGIN_WALL = 'login wall: held';
// The extension's own fixed lines for a posting that says how to apply without a form (the app tells the person: fill-flow.js `decide('fill', ...)`): documented holds too.
export const APPLY_BY_EMAIL = 'applies by email: told';
export const PAGE_TELLS = 'page tells how to apply: told';
// The posting is closed: the digest's own fixed outcome "expired" (desktop/lib/ladder/rung3-digest.js OUTCOMES), never words from its free text. A hold about the posting, not the site (like an eligibility stop).
export const POSTING_CLOSED = 'posting closed: held';
const DIGEST_HOLD = {refused: SITE_REFUSED, login_wall: LOGIN_WALL, expired: POSTING_CLOSED};
// A menu the page opened and that showed no choice at all (extension/flow.js: "a menu showed no choice that matched", choices []): the site offered nothing to pick, so the field is left for the person (an explained field).
const EMPTY_MENU = /fill: a menu showed no choice that matched (\{.*)$/;
// The line's JSON (cut at 230 characters in some logs: then its fields are read one by one); the choices are empty when "" or [] (the real log writes a joined string).
const emptyMenuField = line => { const json = (line.match(EMPTY_MENU) || [])[1]; if (!json) return ''; const choices = (json.match(/"choices":("(?:[^"\\]|\\.)*"|\[[^\]]*\])/) || [])[1], field = (json.match(/"field":"((?:[^"\\]|\\.)*)"/) || [])[1];
  return field && (choices === '""' || choices === '[]') ? field : ''; };
const labelKey = text => String(text || '').replace(/\s+/g, ' ').trim().slice(0, 60);
// The page a fill's report line belongs to (its "url", cut by the app's log): the path, or '' when the line has none.
const reportPage = line => { const url = (line.match(/"url":"([^"]*)"/) || [])[1] || ''; return url.replace(/^https?:\/\/[^/]*/, '').split(/[?#]/)[0]; };
const samePage = (open, page) => !!page && (open === page || (page.length > 1 && open.startsWith(page)));
// The fill's fields line, in both wordings (extension/fill-fields.js logFieldsLine): a record updated after a late retype follows the first and replaces it (the later one is the run's ending).
export const FIELDS_LINE = String.raw`fields(?: \(updated after a late retype\))?: (\d+) filled, (\d+) left`;
export function parseLive(output) {
  const readings = parseReadings(output);   // the false readings at the row's end (lib/live-readings.mjs)
  const lines = String(output || '').split('\n');
  let blocked = '', reached = 'none', filled = null, left = null, marks = null, note = '', verdict;
  const kinds = [], errors = [], path = [];
  let fieldList = [];   // the form's fields, one 'field ...' line each (apply-live.mjs prints them whole: the app's own line is cut at 230 characters)
  const emptyMenus = new Set();   // labels of the menus that showed no choice
  let fillVideo = null, derived = null, told = null, onAccount = false, digestHold = '', dialogLeft = false, usd = null, aiCalls = null, tripped = false, aiRefused = null;
  const openFills = new Map();   // page -> the line its fill started on, while it has not reported (fill: filling {page})
  let countPage = '', lastReport = '', countAt = -1;   // the page the counted "fields:" line belongs to
  const pageKindErrors = [];   // the AI's own words when a page-kind answer had no kind (usage limit, CLI failure...): job-pilotto-54 found a fast null answer with nothing saying why
  const reach = step => { if (rank(step) > rank(reached)) reached = step; };
  for (const [index, line] of lines.entries()) {
    if (/Apply pressed on /.test(line)) reach('posting');
    const kind = line.match(/page kind: ([\w-]+)/);
    if (kind) { const host = (line.match(/"host":"([^"]+)"/) || line.match(/"shape":"([^\/"|]+)/) || [])[1] || ''; const last = path.at(-1);
      if (!last || last.kind !== kind[1] || last.host !== host) path.push({kind: kind[1], host});
      const by = (line.match(/"by":"([^"]*)"/) || [])[1];
      derived = BY_RUNG[by] ?? (/page kind: none/.test(line) ? 0 : derived);
      onAccount = kind[1] === 'account';
      kinds.push(kind[1]); if (kind[1] === 'account') reach('account'); if (/^(form|account-form)$/.test(kind[1])) reach('form'); }
    if (/account (judgment|result)[^:]*: needs_code|"botCheck":true|bot check/.test(line)) reach('code/bot');
    if (/fill: the posting asks for the application by email: reported to the app/.test(line)) digestHold = APPLY_BY_EMAIL;
    if (/fill: the page tells what to do: reported to the app/.test(line)) digestHold = PAGE_TELLS;
    if (/fill: no form on this page .*"applyBy":"email"/.test(line)) digestHold = APPLY_BY_EMAIL;   // the page-kind AI's fixed answer apply_by=email, with no address to name (extension/fill-flow.js decide data): the posting still asks for an e-mail
    const emptyMenu = emptyMenuField(line);
    if (emptyMenu) emptyMenus.add(labelKey(emptyMenu));
    if (/fill: a broken page: reported as site_broken/.test(line)) digestHold = SITE_REFUSED;   // a page that never loads or answers 5xx (extension/ladder/site-broken.js): the site's own state, a hold like a refusal, not an unclear flow
    // The run's summary prints the digest line again after the fill lines, with a bare clock time ("  18:46:46 [extension] digest: ..."): the same line, not a later digest, so it never resets a hold.
    const digestOutcome = /^\s+\d\d:\d\d:\d\d \[/.test(line) ? null : line.match(/\bdigest: outcome=(\w+)/);
    if (digestOutcome) digestHold = DIGEST_HOLD[digestOutcome[1]] || '';
    const noKind = line.match(/page kind: none \(([^)]*)\)/);
    if (noKind && noKind[1] && !pageKindErrors.includes(noKind[1].slice(0, 120)) && pageKindErrors.length < 5) pageKindErrors.push(noKind[1].slice(0, 120));
    if (/pressed the control the digest named|the page tells what to do/.test(line)) derived = 3;   // the ladder's rung 3 (the numbered digest) decided
    if (/\bcloser look: /.test(line)) derived = 4;
    if (/the ladder ended at the person/.test(line)) derived = 6;
    if (/take over with Claude asked from the page/.test(line)) derived = 5;
    const ladder = line.match(/\bladder: rung (\d) signal (\w+)\s*$/);
    if (ladder && Number(ladder[1]) <= 6) told = {rung: Number(ladder[1]), signal: SIGNALS.includes(ladder[2]) ? ladder[2] : null};
    const markLine = line.match(/fill: marks: (\d+) starred, (\d+) required/);
    if (markLine && !onAccount && !/account page/.test(line)) marks = {starred: Number(markLine[1]), required: Number(markLine[2])};
    const fields = line.match(new RegExp(FIELDS_LINE));
    const field = line.match(/^\s+field (filled|left) (\S+) "(.*)" required=(true|false|\?) reason=(.*)$/);
    if (field && !onAccount) fieldList.push({outcome: field[1], type: field[2], label: field[3], required: field[4] === 'true' ? true : field[4] === 'false' ? false : null, reason: field[5], ...(emptyMenus.has(labelKey(field[3])) ? {noOptions: true} : {})});
    if (fields && !onAccount && !/account page/.test(line)) { fieldList = []; filled = Number(fields[1]); left = Number(fields[2]); countPage = reportPage(line) || lastReport; countAt = index; reach('form'); digestHold = ''; if (left === 0 && filled > 0) reach('ready'); }
    // Each fill opens on its page ("fill: filling {page}") and closes with its own report (filled the form / did not fill / fields: the line's url) or a hold.
    const opened = !onAccount && line.match(/fill: filling \{.*?"page":"([^"]*)"/);
    if (opened) openFills.set(opened[1], index);
    if (new RegExp(`fill: (filled the form|did not fill|${FIELDS_LINE})`).test(line)) { const page = reportPage(line); if (page) lastReport = page;   // the fields line is cut before its url: it follows its page's "filled the form"
      for (const open of [...openFills.keys()]) if (samePage(open, page)) openFills.delete(open); }
    if (/fill: held: a dialog covers the form/.test(line)) openFills.clear();
    // The form came after the Apply press (the same page drew it): reached, whatever the fill did next (Teamtailor, 11 Oct 2026: scored "posting").
    if (/fill: after the press: a form came/.test(line)) { reach('form'); digestHold = ''; }
    // The fill's AI judged the applicant ineligible (extension/background.js: the only "did not fill:" line): the form was reached and the run stopped there on
    // purpose. Kept as the note, so the pool shows an eligibility stop, not a fill failure (the line is cut at 230 characters: the reason is read up to its own end).
    // The AI's own verdict and what passed a "not eligible" (extension/eligibility-verdict.js); an older extension's line carries neither.
    const judged = /fill: filled the form/.test(line) && line.match(/"aiEligible":(true|false|null),"forced":"([^"]*)"/);
    if (judged) verdict = {aiEligible: JSON.parse(judged[1]), forced: judged[2]};
    const stop = line.match(/fill: did not fill: (.*?)(?:\s+\{"|$)/);
    if (stop) { reach('form'); note = `eligibility stop: ${stop[1].trim().slice(0, 160)}`; }
    if (/(^|\s)(✗|not ok)\b|Error:|crash/.test(line)) errors.push(line.trim().slice(0, 200));
    if (/fill: held: a dialog covers the form/.test(line)) { dialogLeft = true; errors.push('held: a dialog covers the form (nothing was typed)'); }   // the gate before the fill (extension/dialog-after-fill.js): nothing closed it
    if (/fill: a dialog was left open over the form/.test(line)) { dialogLeft = true; errors.push('a dialog was left open over the form'); }   // extension/dialog-after-fill.js: never a silent "ready"
    const noShot = line.match(/live: no end screenshot: (.*)$/);   // lib/end-shot.mjs: the last picture is a must, a run without one says why
    if (noShot) errors.push(`no end screenshot: ${noShot[1].trim().slice(0, 100)}`);
    const layerLeft = line.match(/live: cookie layer still open at the end: (.*)$/);   // lib/end-shot.mjs: a miss, never a clean end
    if (layerLeft) errors.push(`cookie layer still open at the end: ${layerLeft[1].trim().slice(0, 100)}`);
    const video = line.match(/^live: fill video: (.+)\|(\d+)\|(\d+)$/);   // the row's fill video, kept in CI for the Lab's ▶ Watch (lib/live-video.mjs, uploaded by pool-ci-rows.mjs)
    if (video) fillVideo = {path: video[1], bytes: Number(video[2]), secs: Number(video[3])};
    const spend = line.match(/^live: AI spend \$([\d.]+)(?: on the CI key \((\d+) calls)?/);   // a row on the CI key (lib/live-row.mjs): what its asks cost; the pool's dollar cap sums it (lib/pool-ci.mjs)
    if (spend) { usd = Number(spend[1]); if (spend[2] != null) aiCalls = Number(spend[2]); }   // the calls: /admin/intelligence/ai-cost counts them (pool-ai-cost.mjs)
    if (/^live: privacy tripwire: .* typed into "/.test(line)) tripped = true;   // a hit names the field (lib/privacy-tripwire.mjs); a line about the tripwire is not one
    const refused = line.match(/^live: AI refused (\d+) call\(s\): (.*)$/);   // the key was refused (no credit, a limit, a bad key): the row ran without AI
    if (refused) aiRefused = {calls: Number(refused[1]), why: refused[2].trim().slice(0, 200)};
    const judgedForm = line.match(/panel: application form ready\?: (\w+)/);   // the form judge's last word on the page (extension/form-ready.js)
    if (judgedForm) blocked = judgedForm[1] === 'blocked' ? (line.match(/"blocked":"(\w+)"/) || [])[1] || 'overlay' : '';
  }
  // A fill opened after the counted report and still open when the watch ended, on another page than the one counted (HelloFresh's Electron leg, 12 Oct 2026: the posting page's "1 filled" was scored
  // for a form showing 4 of 5): no count is the form's; the run says so.
  const fillUnreported = rank(reached) >= rank('form') ? [...openFills].filter(([open, at]) => at > countAt && (!countPage || !samePage(open, countPage))).map(([open]) => open).at(-1) : undefined;
  if (fillUnreported) { filled = null; left = null; fieldList = []; errors.push(`form fill did not report: ${fillUnreported}`); if (reached === 'ready') reached = 'form'; }
  if (blocked) errors.push(`form judge: the page is blocked after the fill (${blocked})`);
  if ((dialogLeft || blocked) && reached === 'ready') reached = 'form';
  // "a form came" after the Apply press can be the route to the sign-up page (adnovum, 11 Oct 2026): with no application field counted, the run still ended at the account step.
  if (!note && ['account', 'form'].includes(reached) && filled == null && path.at(-1)?.kind === 'account') { reached = 'account'; note = ACCOUNT_HELD; }
  if (!note && digestHold && rank(reached) < rank('form')) note = digestHold;
  return {...(readings ? {readings} : {}), reached, filled, left, rung: told ? told.rung : derived, signal: told ? told.signal : null, fieldList, marks, pageKindErrors, kinds: [...new Set(kinds)], path, errors, ...(blocked ? {blocked} : {}), ...(note ? {note} : {}), ...(verdict ? {verdict} : {}), ...(usd != null ? {usd} : {}), ...(aiCalls != null ? {aiCalls} : {}), ...(tripped ? {tripped} : {}), ...(fillVideo ? {video: fillVideo} : {}), ...(fillUnreported ? {fillUnreported} : {}), ...(aiRefused ? {aiRefused} : {})};
}

// The same shape reaching an earlier step than its last run, or filling fewer fields on the same posting, is a regression.
export function compare(previous = {}, current = {}) {
  const out = [];
  for (const [shape, now] of Object.entries(current)) {
    const before = previous[shape];
    if (!before || now.note || before.note || now.pathDifference) continue;   // a posting gone, or no posting: not a regression of ours; nor a fall Electron did not show (lib/record-sites-paths.mjs)
    if (rank(now.reached) < rank(before.reached)) out.push({shape, why: `reached ${now.reached}, last time ${before.reached}`, url: now.url});
    else if (now.url === before.url && before.filled != null && now.filled != null && now.filled < before.filled) out.push({shape, why: `filled ${now.filled}, last time ${before.filled}`, url: now.url});
  }
  return out;
}

// One of a shape's postings, rotating by day (the list is the owner's own jobs matching the shape's patterns).
export const pickPosting = (postings, day = new Date()) => { const allowed = postings.filter(item => mayVisit(item?.url || item)); return allowed.length ? allowed[Math.floor(day.getTime() / 86400000) % allowed.length] : null; };

// --only: the words of one row, or several rows' words joined by | (the CI workflow's list of rows; a fixer's single row as before).
export const matchesOnly = (shape, only = '') => !only || String(only).split('|').map(words => words.trim()).filter(Boolean).some(words => shape.includes(words));
// The pool is one list (owner, 12 Oct 2026: postings are public pages; only the owner's details, CV and answers are private, and no run ever holds them): the repo's
// desktop/e2e/smoke-sites.json, plus a Mac's optional extra rows not yet moved in (a name or a posting already in the repo keeps the repo's row).
export const poolShapes = (repo = [], extra = []) => {
  const names = new Set(repo.map(item => item.shape)), urls = new Set(repo.flatMap(item => item.urls || []));
  return [...repo, ...extra.filter(item => !names.has(item.shape) && !(item.urls || []).some(url => urls.has(url)))];   // a name or a posting already in the repo: the repo's row
};
// The privacy floor on a posting address in the repo: query keys that could carry a person or a tracking id (a job id is fine). -> the offending keys.
const PERSONAL_KEY = /^(utm_.*|ref|referrer|source|src|token|.*email.*|.*mail|session|sid|.*user.*|uid|.*applicant.*|.*candidate.*|trk|.*track.*|campaign|gclid|fbclid)$/i;
export const personalQueryKeys = url => [...new URL(url).searchParams.keys()].filter(key => PERSONAL_KEY.test(key));

// The rows --only selects: a row's exact name selects that row alone (a one-row recording names one), else every row matchesOnly holds.
export function selectRows(shapes, only = '') {
  const exact = only ? shapes.filter(item => item.shape === String(only).trim()) : [];
  return exact.length ? exact : shapes.filter(item => matchesOnly(item.shape, only));
}

// A run's share of the ordered pool (lib/record-sites-order.mjs orderPool: the least tested first): the first `size` rows; a share bigger than the pool is the pool.
export const runShare = (ordered, size = 10) => ordered.slice(0, size);
// How many shapes a run takes: RECORD_SHARE (SMOKE_PER_NIGHT, its old name, still read), default 10.
export const shareSize = (env = process.env) => Number(recordVar('SHARE', env, {old: 'PER_NIGHT'}) || 10);

// Each shape's most recent result across all earlier reports (a shape runs every few pool runs, so its "last time" may be days ago).
export function lastSeen(reports) {
  const seen = {};
  for (const report of [...reports].sort((a, b) => String(a.day).localeCompare(String(b.day)))) for (const [shape, result] of Object.entries(report.results || {})) seen[shape] = {...result, day: report.day};
  return seen;
}

// A site's flow signature (owner, 10 Oct 2026: tell distinct flows apart by what the extension met, not by the address): the page kinds in order, with the
// host where the journey ended, and how far it got. Two sites with one signature test the same thing; a new signature is a new shape for the pool.
export function signature(result) {
  const path = (result?.path || []).filter(step => step.kind);
  if (!path.length) return 'unclear';   // no page kind was decided: nothing learned about the site's flow (10 Oct 2026: Richemont's first run)
  return `${path.map(step => step.kind).join('>')}@${path.at(-1).host || '?'}#${result.reached}`;
}
// Discovery candidates from a job list: a few postings per host (more from job boards, whose postings lead to different employers), none already in the pool.
export function candidates(postings, known = new Set(), {perHost = 2, perBoard = 12, boards = /(^|\.)(jobs\.ch|jobup\.ch|indeed\.|arbeitnow\.ch|linkedin\.)/} = {}) {
  const byHost = {};
  for (const posting of postings) {
    if (known.has(posting.url) || !mayVisit(posting.url)) continue;
    let host = ''; try { host = new URL(posting.url).hostname; } catch { continue; }
    (byHost[host] ||= []).push(posting);
  }
  return Object.entries(byHost).flatMap(([host, list]) => list.slice(0, boards.test(host) ? perBoard : perHost));
}

// Where a discovered flow goes in the pool list (desktop/e2e/smoke-sites.json): a never-run shape on the posting's own host gets the signature (no duplicate row), else a new shape named
// by the employer ("Breitling (found 2026-10-10)"; the host's name when the list has no company). Returns the shape touched.
export function placeFound(shapes, posting, flow, day) {
  const host = url => { try { return new URL(url).hostname; } catch { return ''; } };
  const own = shapes.find(item => !item.signature && (item.urls || []).some(url => host(url) === host(posting.url)));
  if (own) { own.signature = flow; return own; }
  const added = {shape: `${posting.company || host(posting.url)} (found ${day})`, urls: [posting.url], signature: flow};
  shapes.push(added);
  return added;
}

// The "*" cross-check for one run (the same rule as site/src/formlearning.js marksCheck): the page marked at least 3 labels and the extension counted
// fewer than half as many required questions, so its required rule missed a layout. {starred, required} or null.
export function marksBlind(result) {
  const marks = result?.marks;
  return marks && marks.starred >= 3 && marks.starred > 2 * marks.required ? marks : null;
}

// The owner's test for a left field (10 Oct 2026, after "4 of 12" for a form whose left fields were all questions only the person can answer): (1) did we really not know the answer
// (the kit, the Profile, the person's details were checked), and (2) did we suggest one? Both yes: expected, however little is filled. Else a failure. The reasons are the extension's own fixed
// texts and its own cause words (extension/fill-card.js causeOf), never a word list of ours.
//   filled       the extension filled it
//   expected     a suggestion was shown for the person to confirm, or it is a legal / consent choice (always the person's)
//   miss         the extension had it or failed to apply it: the field did not take it, the question text was not read, a menu did not open or select
//   no_suggestion  nothing known and nothing proposed (the AI declined, was unsure or was not asked)
//   unknown      the same, but the AI was off in this run (an AuthenticationError in the log): no suggestion could exist, so it is not judged
// A required two-state control the answer said "no" to and the page holds unchecked: an answer kept (extension/page/fill.js, 0ae22fd), never a miss.
const answeredNoOf = row => /^answered no/.test(String(row?.reason || ''));   // words-ok: our own trace reason
export function verdictOf(field, {aiOff = false} = {}) {
  if (field.outcome === 'filled' || answeredNoOf(field)) return 'filled';   // a "no" kept on an unchecked two-state control is the answer
  const reason = String(field.reason || '');
  if (/^(legal|written|demographic)/.test(reason)) return 'expected';   // written: the AI read an open question of the person's own words (category written)
  if (field.noOptions) return 'expected';   // a menu that showed no choice at all: the site offered nothing to pick, left for the person (parseLive emptyMenus)
  if (field.type === 'password' || /^password:/.test(reason)) return 'expected';   // a password is never typed (a safety rule), whatever an older record's reason says
  const cause = causeOf({reason, field: field.label});
  if (cause === 'proposed') return 'expected';
  if (['no_data', 'ai_declined', 'ai_unsure', 'ai_off', 'ai_error'].includes(cause)) return aiOff ? 'unknown' : 'no_suggestion';
  return 'miss';
}

// A shortfall: the form was reached and at least one asked field (a required one, not a file slot) is a miss or has no suggestion. With no field list (an old run) the counts decide:
// under half filled. Returns {done, total, miss, noSuggestion} or null.
export function shortfall(result, {aiOff = result?.aiOff} = {}) {
  if (result?.reached !== 'form' || result.filled == null || result.note) return null;   // a noted stop (eligibility) is deliberate: what it left waits for a person
  const list = (result.fieldList || []).filter(item => item.required !== false && item.type !== 'file');
  if (!list.length) {
    const total = result.filled + (result.left || 0);
    return total > 0 && result.filled / total < 0.5 ? {done: result.filled, total, miss: 0, noSuggestion: 0} : null;
  }
  const verdicts = list.map(item => verdictOf(item, {aiOff}));
  const miss = verdicts.filter(item => item === 'miss').length, noSuggestion = verdicts.filter(item => item === 'no_suggestion').length;
  return miss + noSuggestion > 0 ? {done: verdicts.filter(item => item === 'filled' || item === 'expected').length, total: list.length, miss, noSuggestion} : null;
}

// The one-per-field lines for the app's "fill: fields: N filled, M left {...}" log line (the app's line is cut at 230 characters in the run's timeline, so a run lost which fields were left and why);
// parseLive reads them back. An account page's fields are not the form's, and a line that is not whole JSON gives none.
// An app log as a live run prints it (live.mjs): the Apply press, the app's own page lines, each field. What parseLive reads, for a live row and for a replayed one (lib/measure.mjs).
export function outputOfLog(appLog = '', url = '') {
  const lines = String(appLog).split('\n').filter(one => PAGE_LINE.test(one)).flatMap(line => [`      log ${line.slice(11, 230)}`, ...fieldLines(line)]);
  return [...(url ? [`  live +  0s: Apply pressed on ${url}`] : []), ...lines].join('\n');
}

export function fieldLines(line) {
  const at = String(line).indexOf('{"fields":');
  if (at < 0 || !new RegExp(`fill: ${FIELDS_LINE}`).test(line) || /account page/.test(line)) return [];
  try {
    return JSON.parse(line.slice(at, line.lastIndexOf('}') + 1)).fields.slice(0, 40).map(item => `      field ${item.outcome} ${item.type} "${String(item.label || '').replace(/\s+/g, ' ').slice(0, 60)}" required=${item.required === undefined ? '?' : item.required} reason=${String(item.reason || item.source || '').replace(/\s+/g, ' ').slice(0, 160)}`);
  } catch { return []; }
}

// What the page needs of the verdict (site/src/applying.js shortOf): the asked fields and how many are unexplained, only for a form reached with a field list; an older run sends nothing and the page counts.
export function verdictFields(result) {
  if (result?.reached !== 'form' || !(result.fieldList || []).length) return {};
  const asked = result.fieldList.filter(item => item.required !== false && item.type !== 'file').length, short = shortfall(result);
  return {asked, unexplained: short ? short.miss + short.noSuggestion : 0};
}

// Which path a smoke row runs on (owner, 11 Oct 2026: "make RECORD_NO_ELECTRON the default"): the app's own server under plain node (live.mjs, speed-5x landing 3:
// ~35-65 s a row instead of 69-97 s, no 27 s app start, the same reached and filled on the paired rows) unless RECORD_ELECTRON=1 or RECORD_NO_ELECTRON=0 asks for the
// Electron app (a row that needs the real app). The privacy tripwire runs on both. -> 'node' | 'electron'
export const smokeEngine = (env = process.env) => (recordVar('ELECTRON', env) === '1' || recordVar('NO_ELECTRON', env) === '0' ? 'electron' : 'node');
export const engineLine = engine => (engine === 'node' ? 'record-sites: rows run on the app\'s own path without Electron (RECORD_ELECTRON=1 runs the Electron app)' : 'record-sites: rows run in the Electron app (RECORD_ELECTRON=1)');
