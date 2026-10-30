// Loads the ladder fixtures (desktop/e2e/ladder-fixtures/*.json): the page sketch as the extension builds it, the expected outcome and the AI's stored answer. Used by ladder-score.mjs and the tests.
// Job: keep the scorecard
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {VERBS as REPAIR_VERBS} from '../../lib/ladder/fill-repair.js';

export const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'ladder-fixtures');
// What a page can turn out to be (docs/superpowers/specs/2026-10-10-ai-ladder.md): the outcomes pageKind can name today plus the ones the ladder adds.
export const OUTCOMES = ['form', 'account', 'posting', 'email', 'phone', 'link', 'login_wall', 'refused', 'expired', 'in_person', 'form_in_frame', 'closed', 'other'];
export const SCHEMA_VERSION = 1;
// The questions of rung 2 a fixture can ask (docs/flows/ladder.md): the page-kind sketch (the default, no `question` field), and the two judges' questions. Additive: a fixture without `question` is page_kind.
export const QUESTIONS = ['page_kind', 'account_ready', 'account_result', 'form_step', 'form_ready', 'form_flags', 'fill_verify', 'fill_repair'];   // fill_repair: the fill ladder's rung 3 per control (expect.control names the control, expect.option its option or layer button)   // fill_verify: the fill ladder's per-control check (expect.control names the control scored)   // form_ready: the form judge's ready/needs_person (form_step: its step)
export const questionOf = fixture => fixture.question || 'page_kind';
// The fixed answers each question can give (an expectation is one of them; `pending` too, for a captured candidate nobody confirmed).
export const OUTCOMES_BY_QUESTION = {page_kind: OUTCOMES, account_ready: ['ready', 'needs_person', 'unsure'], account_result: ['created', 'created_confirm', 'needs_code', 'already_exists', 'refused', 'unsure'], form_step: ['middle', 'final', 'unsure'], form_ready: ['ready', 'needs_person', 'blocked', 'unsure'], form_flags: ['login', 'account', 'neither', 'unsure'], fill_verify: ['ok', 'empty', 'wrong', 'unreachable', 'unsure'], fill_repair: [...REPAIR_VERBS, 'unsure', 'wrong_option']};
// What the judges' sketch holds (the extension's accountSketch, extension/account-fill.js: never a typed value); fromPath and sameForm only after a press (account_result).
export const JUDGE_SKETCH_FIELDS = ['title', 'headings', 'controls', 'buttons', 'texts', 'frames', 'onTop', 'fromPath', 'sameForm'];
// The fields a fixture may carry (adding one is a one-line change here; the test fails on an undeclared one). `rung` (0-6) and `signal` (unsure|contradicted|stalled|failed|blind) are for the
// admin page; `expect` may later carry form_frame (an index into frameCandidates) and a closed verb with candidate numbers (slice B).
export const FIELDS = ['schemaVersion', 'id', 'question', 'source', 'lang', 'why', 'note', 'trap', 'url', 'capture', 'sketch', 'candidates', 'expect', 'answer', 'answer_path', 'rung', 'signal', 'file', 'misses'];   // misses: fill_repair's input, the fill check's verdicts [{n, verdict, reason}]
// `apply_route` (manual | reuse_previous | third_party_account) and `digest` (not_asked: rung 2 names the manual route and its button, so the numbered digest is not needed; asked: it is) are for start dialogs.
export const EXPECT_FIELDS = ['outcome', 'accept', 'accept_reasons', 'apply_route', 'digest', 'form_frame', 'verb', 'candidates', 'control', 'option', 'confirmed'];   // control: fill_verify's scored control number (1-based)
// The expected MOVE (spec 2026-10-12-one-next-move.md, box 7): `verb` (one of MOVE_VERBS) on `candidates` (numbers of the fixture's own candidates; any of them is right), and ONLY with
// `confirmed`: {by, run, version}, the run whose page confirmed it (by: a pool run, a recorded replay, the person, the takeover). Never a label by hand or by a model: e2e/ladder-label-moves.mjs writes it.
export const MOVE_VERBS = ['press', 'open', 'tell_person', 'not_listed'];   // not_listed: the run pressed a control the numbered list lacked (candidates: [])
export const CONFIRMED_BY = ['pool', 'replay', 'person', 'takeover'];
export const LANGS = ['de', 'fr', 'en', 'it'];
export const SOURCES = ['recorded', 'captured', 'reconstructed', 'invented'];

export function loadFixtures(dir = DIR) {
  return fs.readdirSync(dir).filter(name => name.endsWith('.json')).sort().map(name => {
    const fixture = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
    return {...fixture, file: name};
  });
}
