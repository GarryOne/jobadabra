#!/usr/bin/env python3
"""AI stage 2: score how well each job fits the owner's Profile.

Runs after stage 1 and the hard filters, so only jobs the owner could apply to
are scored. The Profile page in Notion is the rubric's input; editing it
re-scores every open job on the next run. Scores are advisory: they order the
digest and never apply to anything.
"""
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
import copy
import hashlib
import json
import time
import re
from pathlib import Path
import os
import threading
from types import SimpleNamespace

from .. import paths as _paths  # noqa: F401 (import side effect: loads .env before getenv below)
from .. import run_counts, store
from . import cost, engine, hints, locations, schema_notes, score_not_a_job, score_search
from .models import MAIN_MODEL
from .providers.contract import detail, reason

# Bump when the prompt or schema changes so every job is re-scored once.
SCORER_VERSION = 2
DEFAULT_MODEL = os.getenv('JOB_PILOTTO_SCORE_MODEL', MAIN_MODEL)
# How hard the scorer thinks (medium by default; Haiku has no such setting and ignores it).
EFFORT = os.getenv('JOB_PILOTTO_SCORE_EFFORT', 'medium')
# A cheaper first pass (e.g. claude-haiku-5-5): every pending job gets it, and only jobs whose first-pass score reaches
# ESCALATE_MIN are scored again by the main model. Off when empty. MEASURED 2 Oct 2026 (tools/score_eval.py, 60 jobs): Haiku agrees
# poorly with Sonnet (rank correlation 0.70, scores 14 points high) and the cascade costs 123-152% of Sonnet alone, so leave it OFF.
# Sonnet at effort "low" agreed as well as Sonnet agrees with its own re-run (0.92 vs 0.89) and was 19% cheaper per job.
FIRST_PASS_MODEL = os.getenv('JOB_PILOTTO_SCORE_FIRST_PASS_MODEL', '')
ESCALATE_MIN = int(os.getenv('JOB_PILOTTO_SCORE_ESCALATE_MIN', '40') or 40)
# After a Profile edit only jobs that scored at least this (the digest's own bar) are re-scored on their own; the rest keep their score,
# marked "Previous scoring method", until the user asks (Strategy → Re-score them now). Spending on jobs that were never going to show
# is what a Profile tweak used to cost (28 Sep: 60 re-scores, no new job, about $0.6).
RESCORE_MIN = int(os.getenv('JOB_PILOTTO_RESCORE_MIN', '50') or 50)

SCORES_TABLE = """
CREATE TABLE IF NOT EXISTS scores (
    job_id INTEGER PRIMARY KEY REFERENCES jobs(id),
    scorer_version INTEGER NOT NULL,
    input_hash TEXT NOT NULL,
    model TEXT NOT NULL,
    created_at TEXT NOT NULL,
    data_json TEXT NOT NULL
);
"""

_component = {'type': 'integer', 'description': '0-100'}
# Pay fit and Growth are null when the posting gives no basis (no salary stated, no scope or level to judge): an unknown is shown as
# N/A and counts for nothing in the overall score.
UNKNOWN_OK = ('compensation', 'growth')
_open_component = {'type': ['integer', 'null'], 'description': '0-100, or null when the posting gives no basis (no salary stated; scope and level unreadable)'}
SCHEMA = {
    'type': 'object',
    'additionalProperties': False,
    'required': ['score', 'tier', 'components', 'basis', 'reason', 'strengths', 'gaps', 'confidence'],
    'properties': {
        'score': {'type': 'integer', 'description': 'Overall fit 0-100'},
        'tier': {'type': 'string', 'enum': ['A', 'B', 'C'],
                 'description': 'A = pursue (tailored application, look for a referral); B = apply; C = skip'},
        'components': {
            'type': 'object', 'additionalProperties': False,
            'required': ['role_fit', 'location', 'compensation', 'growth', 'risk'],
            'properties': {
                'role_fit': _component, 'location': _component, 'compensation': _open_component,
                'growth': _open_component,
                'risk': {'type': 'integer', 'description': '0-100, higher = more risk or uncertainty'},
            },
        },
        # What the posting itself states, answered with the score: a refresh scores before the facts are read (src/daily_search.py).
        'basis': {
            'type': 'object', 'additionalProperties': False, 'required': ['salary_stated', 'level_stated', 'one_job'],
            'properties': {
                'salary_stated': {'type': 'boolean', 'description': 'The posting states a salary or pay range, in any currency'},
                'level_stated': {'type': 'boolean', 'description': "The title or text says what kind of role this is: its seniority (junior, senior, lead, manager ...) or what it owns or leads (a team, a system, a budget). A role that leads people is a stated scope."},
                'one_job': {'type': 'boolean', 'description': 'The text is one job a person can apply to; false for a list of jobs, a job category, search results or a company page (src/ai/score_not_a_job.py)'},
            },
        },
        'reason': {'type': 'string', 'description': 'One line, at most 90 characters, why it fits or not'},
        'strengths': {'type': 'array', 'items': {'type': 'string'}, 'description': 'Up to 3 short, specific matches'},
        'gaps': {'type': 'array', 'items': {'type': 'string'}, 'description': 'Up to 3 short gaps or unknowns'},
        'confidence': {'type': 'string', 'enum': ['high', 'medium', 'low']},
    },
}
SCHEMA = score_search.extend(SCHEMA)   # + the fit to the person's search, apart from the CV (src/ai/score_search.py)

SYSTEM = """You rank job postings for one candidate. The candidate's profile follows. \
Score each posting for fit, using only the profile and the posting.

Rules:
- Role fit compares the posting's responsibilities and required skills with the candidate's real \
experience. Name concrete matches (e.g. "Datadog + Terraform monitoring"), not generic praise.
- Location covers commute from the home base, remote policy and workload. Needing visa sponsorship is not \
a location penalty by itself (the candidate may be open to sponsored roles); the digest already flags it \
separately, from the candidate's citizenship and work rights in the profile. Do not state commute times or \
distances. A role that needs the office several days a week in another city than the home base is a location \
gap, never "close" or "no relocation".
- Every figure, place and requirement you write must appear in the posting, the extracted facts or the profile. \
Credit the candidate only with skills, tools and experience the profile names: a related tool is not the same tool, \
and never say a posting's level matches a level the profile does not state. What the posting leaves out is an unknown, said as such \
("growth scope not stated"), never a judgment of it ("growth opportunities limited").
- Compensation: compare only an advertised salary with the target. If no salary is stated, give null (shown as N/A) \
and list it as a gap; the overall score then ignores pay entirely, as if it were not a factor. Never invent a figure or a net amount. The profile's minimum and the target are different \
figures: say which one you compare with. Do not compute percentages or convert currencies; in the same currency as the profile, \
say "below your minimum" or "above your target" and quote the posting's own numbers. Call a salary "in the target range" only \
when it lies between the profile's own figures. A salary in another currency than the profile's is still a stated salary: give a \
number from the posting's own figures, quote them in the text with their currency, and never say it is below or above your figures.
- Growth covers scope, technical depth and seniority relative to the candidate's level. If the posting gives no basis \
(no scope or level you can read), give null (shown as N/A), never a middling number; the overall score then ignores it.
- Risk rises for recruiter listings, vague employers, junior or unrelated roles, heavy on-call, \
missing information.
- Missing information lowers confidence; it is not evidence against the job.
- Do not reward a famous brand by itself.
- Tier A: strong fit worth a tailored application. Tier B: reasonable fit. Tier C: poor fit.
- The overall score means the same for every candidate and every model (9 Oct 2026: two AI families ranked the same jobs alike \
but 16 points apart). Use these bands, from the evidence alone:
  85-100: the role's core work and level match the profile, almost every required skill is named in it, the location works; \
nothing important is missing. Tier A.
  70-84: the core matches, with one or two real gaps the candidate could close or argue (a missing tool, a level step). A or B.
  50-69: a partial fit: some core requirements are missing from the profile, or the place, level or contract is a real compromise. B.
  30-49: mostly another kind of role; only some skills carry over. C.
  0-29: unrelated work, level or place. C.
  An unknown (no salary, no stated level) neither adds nor subtracts. The overall score is not the average of the components.
- reason: one line under 90 characters, plain words, no hype.""" + score_search.RULE + """

What each field means:
""" + schema_notes.text(SCHEMA) + """

Candidate profile:
"""


def job_hash(job, facts):
    """The job's own part of the input (its text and the facts read from it), apart from the Profile."""
    blob = json.dumps({'title': job['title'], 'description': job.get('description') or '', 'facts': facts}, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(blob.encode()).hexdigest()


def input_hash(job, facts, profile):
    blob = json.dumps({'title': job['title'], 'description': job.get('description') or '',
                       'facts': facts, 'profile': profile}, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(blob.encode()).hexdigest()


# Profile sections that are about filling forms, not about which jobs fit: editing them must not re-score anything.
FORM_ONLY = re.compile(r'contact|\blinks?\b|application form answers|📎', re.I)
# Your details' fact sections (desktop/lib/profile-sections.js SECTIONS, src/desktop_strategy.py DETAILS_SECTIONS): work rights, notice and pay, languages
# say which jobs fit, so they are read even under a skipped heading (owner's Profile, 18 Oct 2026: they sat under "# Links" and the scorer never saw them).
FACT_SECTION = re.compile(r'^\W*(work eligibility|availability & compensation|languages)\s*$', re.I)


CURRENT_METHOD, PREVIOUS_METHOD = 'Current', 'Previous'  # Job Matches "Scoring method"


def scoring_profile(profile):
    """The Profile as the fit score reads it: without its contact, links and form-answer sections, so a new phone
    number or LinkedIn link doesn't re-score every job (experience, goals, salary, locations still do)."""
    kept, skipping, level = [], False, 0
    for line in (profile or '').splitlines():
        heading = re.match(r'\s*(#+)\s+(.*)', line)
        if heading:
            depth = len(heading[1])
            if skipping and depth > level and not FACT_SECTION.search(heading[2]):
                continue  # a sub-heading of a skipped section
            skipping, level = bool(FORM_ONLY.search(heading[2])), depth
        if not skipping:
            kept.append(line)
    return '\n'.join(kept).strip()


# The Profile template's own words (docs/notion-profile-template.md): a page made of only these and ❓ fields says nothing about the person.
TEMPLATE = Path(__file__).resolve().parents[2] / 'docs' / 'notion-profile-template.md'
MIN_OWN_CHARS = 60   # less than about a line of the person's own words: no basis for a fit score


def _plain(line):
    return re.sub(r'[\s|#*_`>-]+', ' ', line).strip().lower()


def own_words(profile):
    """The Profile's lines that are the person's own: not a ❓ field, a heading, a table header or the template's wording."""
    try:
        template = {_plain(line) for line in TEMPLATE.read_text().splitlines()}
    except OSError:
        template = set()
    kept = []
    for line in scoring_profile(profile).splitlines():
        plain = _plain(line)
        if not plain or '❓' in line or re.match(r'\s*#', line) or re.fullmatch(r'[\s|:-]*', line) or plain in template:
            continue
        kept.append(line.strip())
    return kept


def unfilled(profile):
    """True when the Profile is empty or still the template (7 Oct 2026: a Notion workspace connected after an import got the blank
    template; 31 jobs were then scored 2-5 against ❓ fields, and those low scores are not redone when the Profile is filled later)."""
    own = sum(len(line) for line in own_words(profile))
    return own == 0 or ('❓' in (profile or '') and own < MIN_OWN_CHARS)   # a short Profile of one's own is still scored


PAUSED = 'Fit scores paused: your Profile is still empty (the Notion template). Fill it in, or Strategy → Rebuild from CV'


def pending_jobs(db, candidates, profile, limit, full_profile=None):
    """Candidates whose score is missing or out of date (job, facts or the scoring part of the profile changed), most worth scoring first:
    new jobs, then changed jobs, then jobs whose only reason is a Profile edit, best previous score first. A job whose previous score is
    under RESCORE_MIN and whose only reason is a Profile edit is not scored: it keeps its score, marked as the previous method (the
    user can re-score those on request). full_profile: the whole Profile text, for scores made before scoring_profile existed: if one
    matches it, the score is still current (only form sections were in it) and its hash is updated instead of scoring again."""
    db.executescript(SCORES_TABLE)
    done = {row['job_id']: row for row in db.execute('SELECT job_id, scorer_version, input_hash, data_json FROM scores')}
    score_search.recheck_lifts(db, [job for job in candidates if job.get('description')], done)   # a title-only lift falls on the role check's no, scored now or not
    pending, again = [], score_search.again_ids([job for job in candidates if job.get('description')], done, RESCORE_MIN)
    for job in candidates:
        if not job.get('description'):
            continue
        row = done.get(job['id'])
        current = input_hash(job, job.get('ai'), profile)
        if job['id'] in again:   # scored before the search part, low, a title the search wants now
            pending.append(((1, 0), job))
            continue
        if row and row['scorer_version'] == SCORER_VERSION and row['input_hash'] == current:
            continue
        if row and full_profile and row['scorer_version'] == SCORER_VERSION and row['input_hash'] == input_hash(job, job.get('ai'), full_profile):
            # Kept without an AI call, and labelled: scored from the whole Profile (the previous method), not this one.
            data = json.loads(row['data_json'])
            data['method'] = PREVIOUS_METHOD
            db.execute('UPDATE scores SET input_hash=?, data_json=? WHERE job_id=?', (current, json.dumps(data, ensure_ascii=False), job['id']))
            continue
        if not row:
            pending.append(((0, 0), job))   # a new job: always worth reading
            continue
        try:
            data = json.loads(row['data_json'])
        except ValueError:
            data = {}
        asked = row['input_hash'] == ''   # the user asked for it (Strategy → Re-score them now): no shortcut
        profile_only = row['scorer_version'] == SCORER_VERSION and not asked and data.get('job_hash', job_hash(job, job.get('ai'))) == job_hash(job, job.get('ai'))
        previous = int(data.get('score') or 0)
        if profile_only and previous < RESCORE_MIN:
            # Only the Profile changed and this job was never going to show: keep its score, say so, spend nothing.
            data.update(method=PREVIOUS_METHOD, job_hash=job_hash(job, job.get('ai')))
            db.execute('UPDATE scores SET input_hash=?, data_json=? WHERE job_id=?', (current, json.dumps(data, ensure_ascii=False), job['id']))
            continue
        pending.append(((2, -previous) if profile_only else (1, 0), job))
    db.commit()
    from ..time_budget import best_first
    ordered = [job for _, job in sorted(pending, key=lambda item: item[1].get('first_seen_at') or '', reverse=True)]
    ordered = best_first(ordered)                                                                   # your best places first
    group = {id(job): key for key, job in pending}
    ordered.sort(key=lambda job: group[id(job)])                                                    # then by group (stable)
    return ordered[:limit]


# Where each unknown-able part has a basis in the facts read from the posting: the AI may not answer "unknown" there.
HAS_BASIS = {
    'compensation': lambda facts: bool((facts.get('salary') or {}).get('stated')),
    'growth': lambda facts: (facts.get('seniority') or {}).get('value') not in (None, 'unknown'),
}
# The same basis in the scorer's own answer (SCHEMA 'basis'), for a job scored before its facts are read.
BASIS = {'compensation': 'salary_stated', 'growth': 'level_stated'}


def unread_parts(components, facts, basis=None):
    """The parts left null although the posting's facts, or the answer's own basis, give a basis for them (fixed answer, validated here)."""
    return [part for part in UNKNOWN_OK if components.get(part) is None
            and (HAS_BASIS[part](facts or {}) or (basis or {}).get(BASIS[part]) is True)]


def score_one(client, model, job, profile, effort=None):
    data, usage = _ask(client, model, job, profile, effort, '', SCHEMA)
    missing = unread_parts(data['components'], job.get('ai'), data.get('basis'))
    if missing and score_not_a_job.is_one_job(data):   # never kept as sure: ask again once, naming the parts, and the answer's shape no longer allows null for them
        data, again = _ask(client, model, job, profile, effort,
                           f"\n\nYour last answer left {', '.join(missing)} unknown, but the posting gives a basis for "
                           f"{'it' if len(missing) == 1 else 'them'} (a stated salary in another currency is still a stated salary: judge it from the "
                           f"posting's own figures, without converting). Give a whole number 0-100 for {'it' if len(missing) == 1 else 'each'}.",
                           _whole(missing))
        usage = _sum_usage(usage, again)
    if not score_not_a_job.is_one_job(data):   # a verdict that zeroes a job is never kept as sure: ask again once, with the question narrowed (two real Greenhouse postings were zeroed, 22 Oct 2026)
        again_data, again = _ask(client, model, job, profile, effort, score_not_a_job.RECHECK, SCHEMA)
        usage = _sum_usage(usage, again)
        if score_not_a_job.is_one_job(again_data):
            data = again_data
    return score_not_a_job.mark(data), usage


def _sum_usage(first, second):
    fields = ('input_tokens', 'output_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens')
    return SimpleNamespace(**{f: (getattr(first, f, 0) or 0) + (getattr(second, f, 0) or 0) for f in fields})


def _whole(parts):
    """SCHEMA with the given parts as whole numbers only (null no longer allowed)."""
    schema = copy.deepcopy(SCHEMA)
    for part in parts:
        schema['properties']['components']['properties'][part] = dict(_component)
    return schema


def _ask(client, model, job, profile, effort, note, schema):
    facts = json.dumps(job.get('ai') or {}, ensure_ascii=False)
    params = dict(
        model=model,
        max_tokens=4000,
        # The profile is identical for every job, so it is cached across requests.
        system=[{'type': 'text', 'text': SYSTEM + profile + score_search.block() + locations.block_now() + hints.text(hints.load()), 'cache_control': {'type': 'ephemeral'}}],
        messages=[{'role': 'user', 'content': (
            f"Title: {job['title']}\nCompany: {job['company']}\nLocation: {job.get('location') or ''}\n"
            f"Extracted facts (stage 1): {facts}\n\nPosting:\n{job['description']}{note}")}],
        output_config=engine.structured(schema, model, effort or EFFORT),
    )
    response = client.messages.create(**params)
    if response.stop_reason != 'end_turn':
        raise RuntimeError(f'stopped with {response.stop_reason}')
    data = json.loads(next(block.text for block in response.content if block.type == 'text'))
    clamp = lambda n: max(0, min(100, int(n)))
    data['score'] = clamp(data['score'])
    data['components'] = {k: None if v is None else clamp(v) for k, v in data['components'].items()}
    data['strengths'], data['gaps'] = data['strengths'][:3], data['gaps'][:3]
    return score_search.apply(data, job), response.usage


def save(db, job, model, data, profile):
    db.executescript(SCORES_TABLE)
    db.execute("""INSERT INTO scores (job_id, scorer_version, input_hash, model, created_at, data_json)
        VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(job_id) DO UPDATE SET scorer_version=excluded.scorer_version,
        input_hash=excluded.input_hash, model=excluded.model, created_at=excluded.created_at,
        data_json=excluded.data_json""",
               (job['id'], SCORER_VERSION, input_hash(job, job.get('ai'), profile), model,
                datetime.now(timezone.utc).isoformat(timespec='seconds'),
                json.dumps({**data, 'method': CURRENT_METHOD, 'scorer_version': SCORER_VERSION,
                            'inputs': input_hash(job, job.get('ai'), profile)[:12], 'job_hash': job_hash(job, job.get('ai')),
                            'locations': locations.fingerprint_now()}, ensure_ascii=False)))
    db.commit()


def load(db):
    """Map job_id -> score data, for the digest."""
    db.executescript(SCORES_TABLE)
    return {row['job_id']: json.loads(row['data_json']) for row in db.execute('SELECT job_id, data_json FROM scores')}


def previous_method(db):
    """Job ids whose score is from the previous scoring method (kept, not re-scored yet)."""
    return [job_id for job_id, data in load(db).items() if data.get('method') == PREVIOUS_METHOD]


def rescore_previous(db):
    """Queue the previous-method scores for a new score (the next searches re-score them, 60 per search)."""
    ids = previous_method(db)
    db.executemany("UPDATE scores SET input_hash='' WHERE job_id=?", [(job_id,) for job_id in ids])
    db.commit()
    return len(ids)


def queue(db, candidates, profile):
    """The jobs waiting for a (re-)score with this profile (the whole Profile text), checked the way run() checks them: against the
    scoring part of the Profile (7 Oct 2026: a refresh asked with the whole text, so every job it had just scored looked out of date,
    its next batch held only those, run() found "0 job(s) to score" and the refresh stopped after one batch)."""
    return pending_jobs(db, candidates, scoring_profile(profile), 10**9, full_profile=profile)


def stale_count(db, candidates, profile):
    """How many scored-or-scorable jobs still wait for a (re-)score with this profile ("Scores updating")."""
    return len(queue(db, candidates, profile))


def run(db, candidates, profile, model, max_jobs, client=None, workers=5, stats=None, first_pass=None, escalate_min=None, on_scored=None, every=10, only_ids=None):
    """Score up to max_jobs pending candidates; returns a one-line summary. profile: the whole Profile text (the
    scoring part is taken here). With a first_pass model (default: JOB_PILOTTO_SCORE_FIRST_PASS_MODEL) every job gets the
    cheap model first and only those scoring at least escalate_min are scored again by `model`; the rest keep the quick score."""
    first_pass = FIRST_PASS_MODEL if first_pass is None else first_pass
    escalate_min = ESCALATE_MIN if escalate_min is None else escalate_min
    cascade = bool(first_pass) and first_pass != model
    if unfilled(profile):   # scores against an empty Profile are noise, and they stick: none are made
        if stats is not None:
            stats['paused'] = 'profile'
        return PAUSED
    full, profile = profile, scoring_profile(profile)
    from .. import time_budget as planner
    if only_ids is not None:   # the refresh's batch: the jobs it found and read, scored end to end (src/daily.py)
        jobs = [job for job in pending_jobs(db, candidates, profile, 10_000, full_profile=full) if job['id'] in only_ids]
    else:
        jobs = pending_jobs(db, candidates, profile, max_jobs, full_profile=full)
        jobs = jobs[:planner.batch('score', len(jobs))]   # a batch this refresh can finish (src/time_budget.py), best places first
    if not jobs:
        return f'0 job(s) to score with {model}'
    began = time.monotonic()
    from . import engine
    # Whatever the engine: down or busy (the next run continues), or a refusal of this one call (the job is skipped).
    transient, permanent = engine.transient_errors(), engine.permanent_errors()
    from . import engine
    client = client or engine.client(action='score')
    scored = failures = 0
    usage_totals = {'input': 0, 'output': 0, 'cache_read': 0}
    stop = threading.Event()  # the spend limit was hit: jobs still queued don't call the API
    from .. import time_budget as budget
    late = [0]   # not started: the search's time was up (src/time_budget.py); the next search scores them
    said = {}    # requested model -> the model that answered it (cost.answered), for the summary line

    def batch(todo, used_model, keep=None):
        """Score `todo` with `used_model`; a result is saved unless keep(data) says it needs the main model. -> (escalate, halted)."""
        nonlocal scored, failures
        escalate, halted = [], False

        def one(job):
            if stop.is_set():
                return None
            if not budget.may_score():   # the deadline, past the search's first 3 scores (time_budget.FLOOR)
                late[0] += 1
                return None
            try:
                return score_one(client, used_model, job, profile)
            except Exception as error:
                if cost.limit_reached(error):
                    stop.set()
                raise

        from ..progress import Ticker
        ticker, done = Ticker('Scoring jobs against your Profile', len(todo)), 0
        with ThreadPoolExecutor(max_workers=workers) as pool:
            futures = {pool.submit(one, job): job for job in todo}
            for future in as_completed(futures):
                job = futures[future]
                done += 1
                ticker.tick(done)
                try:
                    result = future.result()
                    if result is None:  # skipped: the spend limit was reached
                        continue
                    data, usage = result
                except transient as error:
                    print(f'Warning: AI unavailable ({reason(error)}), {len(todo) - scored - failures} job(s) left for the next check')
                    detail('score', error)
                    for pending in futures:
                        pending.cancel()
                    halted = True
                    break
                except (*permanent, RuntimeError, json.JSONDecodeError, StopIteration, KeyError, ValueError) as error:
                    if cost.limit_reached(error):
                        # The account's spend limit: every other call would fail the same way. Stop; the next run continues.
                        if stats is not None:
                            stats['limit'] = 'cli' if cost.cli_limit(error) else True
                        print(f'AI limit reached: {cost.limit_reason(error)}, {len(jobs) - scored - failures} job(s) left for the next check')
                        for pending in futures:
                            pending.cancel()
                        halted = True
                        break
                    failures += 1
                    print(f'Skipped job {job["id"]}: {type(error).__name__}: {error}')
                    continue
                usage_totals['input'] += usage.input_tokens
                usage_totals['output'] += usage.output_tokens
                usage_totals['cache_read'] += getattr(usage, 'cache_read_input_tokens', 0) or 0
                cost.add(stats, used_model, usage)
                said[used_model] = cost.answered(used_model, usage)
                if keep is not None and keep(data):
                    escalate.append(job)   # worth the main model: scored again below, this quick score is not kept
                    continue
                if keep is not None:
                    data['first_pass'] = True   # a quick score by the cheap model, below the bar for a second look
                save(db, job, said[used_model], data, profile)
                scored += 1
                run_counts.scored(job, data.get('score'))
                print(f'Scored {scored} of {len(jobs)} job(s)')   # a heartbeat for the live log: one Claude Code call takes tens of seconds
                if on_scored and scored % every == 0:
                    on_scored()   # every `every` scores: the jobs so far go to Notion (a stopped search leaves them there)
        return escalate, halted

    if cascade:
        escalate, halted = batch(jobs, first_pass, keep=lambda data: data['score'] >= escalate_min)
        if not halted and escalate:
            batch(escalate, model)
        if stats is not None:
            stats['cascade'] = {'first_pass': len(jobs), 'escalated': len(escalate)}
    else:
        batch(jobs, model)
    if late[0]:
        print(budget.left_line('score', late[0]), flush=True)
    budget.record('score', time.monotonic() - began, scored)
    if stats is not None:
        stats.update(pending=len(jobs), done=scored, failed=failures, late=late[0])
    return (f'Scored {scored} of {len(jobs)} job(s) with {said.get(model, model)}{f" (first pass {said.get(first_pass, first_pass)})" if cascade else ""}; {failures} failed; tokens in '
            f"{usage_totals['input']} (+{usage_totals['cache_read']} cached), out {usage_totals['output']}")

