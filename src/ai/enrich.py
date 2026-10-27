#!/usr/bin/env python3
"""AI stage 1: read each new or changed job description and extract structured facts.

Code decides what happened; the model only interprets text. Every extracted
field carries a short evidence quote, and "unknown" is always allowed, so the
model never has to invent a salary, language rule or employer.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
import hashlib
import json
import time
import os
from pathlib import Path

from .. import store
from ..paths import JOBS_DB
from . import cost, engine, schema_notes, slots
from .seniority import settle
from ..role_kinds import KINDS, WORK
from .models import SMALL_MODEL
from .providers.contract import detail, reason

# Bump when the prompt or schema changes so every job is re-extracted once.
EXTRACTOR_VERSION = 4   # 4: responsibilities; 3: contract, deadline, posted (a bump re-reads every job on the next search, newest and best first: the backfill)
DEFAULT_MODEL = os.getenv('JOB_PILOTTO_ENRICH_MODEL') or SMALL_MODEL

ENRICHMENT_TABLE = """
CREATE TABLE IF NOT EXISTS enrichments (
    job_id INTEGER PRIMARY KEY REFERENCES jobs(id),
    extractor_version INTEGER NOT NULL,
    description_hash TEXT NOT NULL,
    model TEXT NOT NULL,
    created_at TEXT NOT NULL,
    data_json TEXT NOT NULL
);
"""

LANGUAGES = ['English', 'German', 'French', 'Italian', 'Spanish', 'Portuguese', 'Dutch', 'Other']
_evidence = {'type': 'string', 'description': 'Short verbatim quote from the posting, or "" if none'}
IT_FAMILIES = ('sre', 'platform', 'devops', 'cloud_infrastructure', 'software', 'data', 'security', 'support_it')   # the IT role families before the trades
# Each IT family's work, said like the trades' (src/role_kinds.py WORK): 26 Oct 2026, on Free AI's open model 5 SRE and platform jobs came back
# 'engineering' while these were bare names (e2e quality, PR #1992). Guarded by: tests/test_role_kinds_split.py.
IT_WORK = {'sre': 'site reliability: keeping production services up, incidents, on-call, monitoring',
           'platform': 'internal platforms and developer infrastructure, e.g. Kubernetes and CI/CD for other teams',
           'devops': 'build, release and deployment automation, infrastructure as code',
           'cloud_infrastructure': 'cloud, servers, networks and data-centre infrastructure',
           'software': 'building software and applications', 'data': 'data engineering, analytics, data science, machine learning',
           'security': 'IT and cyber security', 'support_it': 'IT support and help desk'}
# The role families in words, in the system prompt AND the schema: 26 Oct 2026 (PR #1992), with them only in the schema's description Free AI's
# open model still answered 'engineering' for SRE and platform jobs (a schema there fixes the answer's shape; its descriptions may go unread).
ROLE_FAMILIES = ("The job's own kind of work, not the team, product or customers it serves; when the title names a kind of work below "
                 "(site reliability, platform, DevOps, cloud ...), that is its family, and software is only for building the product's own software. IT work (an engineer in software or IT is one of these, "
                 "not engineering): " + '; '.join(f'{family} = {IT_WORK[family]}' for family in IT_FAMILIES) + '. Other work: '
                 + '; '.join(f'{kind} = {WORK[kind]}' for kind in KINDS if kind not in IT_FAMILIES) + '.')
SCHEMA = {
    'type': 'object',
    'additionalProperties': False,
    'required': ['languages', 'english_is_enough', 'seniority', 'work_mode', 'workload', 'salary',
                 'employer_type', 'role_family', 'technologies', 'on_call', 'visa_sponsorship', 'contract', 'deadline', 'posted', 'responsibilities', 'confidence'],
    'properties': {
        'languages': {
            'type': 'array',
            'description': 'Every human language the posting mentions as a requirement or a plus',
            'items': {
                'type': 'object', 'additionalProperties': False,
                'required': ['language', 'level', 'evidence'],
                'properties': {
                    'language': {'type': 'string', 'enum': LANGUAGES},
                    'level': {'type': 'string', 'enum': ['required', 'nice_to_have']},
                    'evidence': _evidence,
                },
            },
        },
        'english_is_enough': {
            'type': 'object', 'additionalProperties': False, 'required': ['value', 'evidence'],
            'description': 'yes when English alone is enough to get and do the job: the working language is English and every other language '
                           'is at most a plus; no when the posting requires another language; unknown when it says nothing about languages',
            'properties': {'value': {'type': 'string', 'enum': ['yes', 'no', 'unknown']}, 'evidence': _evidence},
        },
        'seniority': {
            'type': 'object', 'additionalProperties': False, 'required': ['value', 'evidence'],
            'description': 'The level the title or text gives, by a level word or by the years of experience it asks: junior (entry level, up to '
                           'about 2 years), mid (about 3 to 5 years), senior (more, or senior in the title), staff_principal, lead_manager (leads '
                           'people); unknown only when it gives neither',
            'properties': {
                'value': {'type': 'string', 'enum': ['junior', 'mid', 'senior', 'staff_principal', 'lead_manager', 'unknown']},
                'evidence': _evidence,
            },
        },
        'work_mode': {
            'type': 'object', 'additionalProperties': False, 'required': ['value', 'remote_scope', 'evidence'],
            'description': 'onsite = at the workplace every working day; hybrid = some days at home, some at the workplace; remote = from home '
                           '(remote_scope says where from); unknown when the posting does not say',
            'properties': {
                'value': {'type': 'string', 'enum': ['onsite', 'hybrid', 'remote', 'unknown']},
                'remote_scope': {'type': 'string', 'description': 'Where remote work is allowed, e.g. "one country", "EMEA", "worldwide", or ""'},
                'evidence': _evidence,
            },
        },
        'workload': {'type': 'string', 'description': 'e.g. "100%", "80-100%", or "unknown"'},
        'salary': {
            'type': 'object', 'additionalProperties': False, 'required': ['stated', 'text'],
            'properties': {'stated': {'type': 'boolean'}, 'text': {'type': 'string', 'description': 'Salary exactly as written, or ""'}},
        },
        'employer_type': {
            'type': 'object', 'additionalProperties': False, 'required': ['value', 'evidence'],
            'properties': {
                'value': {'type': 'string', 'enum': ['direct_employer', 'recruiter', 'unknown']},
                'evidence': _evidence,
            },
        },
        # IT families, then the kinds of role of every other trade (src/role_kinds.py KINDS, read from there): 6 Oct 2026, a photographer's shop
        # and warehouse jobs could only be 'other'. 26 Oct 2026, 8 kinds split out of 'other': the description says each family's work, and that
        # the job's own work decides, not its title's team (e2e golden 3006: an "SRE, Customer Care" title on a phone helpdesk job).
        'role_family': {'type': 'string', 'enum': [*IT_FAMILIES, *(kind for kind in KINDS if kind not in IT_FAMILIES)],
                        'description': ROLE_FAMILIES},
        'technologies': {'type': 'array', 'items': {'type': 'string'}, 'description': 'Up to 8 key skills, tools, licences, certifications or topics the role names (any trade), short, in the posting\'s own language: every tool, platform or licence the text names counts; [] only when it names none'},
        'responsibilities': {'type': 'array', 'items': {'type': 'string'},
                             'description': 'What the role involves day to day: up to 4 short plain sentences (under 110 characters each), in the posting\'s own terms; [] when it says nothing'},
        'on_call': {'type': 'string', 'enum': ['yes', 'no', 'unknown']},
        'visa_sponsorship': {
            'type': 'object', 'additionalProperties': False, 'required': ['value', 'evidence'],
            'properties': {
                'value': {'type': 'string', 'enum': ['offered', 'not_offered', 'unknown']},
                'evidence': _evidence,
            },
        },
        'contract': {'type': 'string', 'enum': ['permanent', 'fixed_term', 'freelance', 'internship', 'unknown']},
        'deadline': {'type': 'string', 'description': 'Application deadline as YYYY-MM-DD when the posting states one, else ""'},
        'posted': {'type': 'string', 'description': 'Date the posting says it was published, YYYY-MM-DD, else ""'},
        'confidence': {'type': 'string', 'enum': ['high', 'medium', 'low']},
    },
}

SYSTEM = """You extract facts from job postings for a job-search tool. Report only what the \
posting says. When a fact is not stated, answer "unknown" (or an empty list/string) rather than \
guessing from the company name or job title. Evidence must be a short verbatim quote from the posting.

Languages: a language may be named in its own words ("Deutsch", "français", "português", "espanhol", \
"fliessend", "maîtrise", "fluente"). Mark a language "required" only when the posting demands it; "nice_to_have" for "a plus", \
"von Vorteil", "un atout", "diferencial". A posting written in another language does not by itself make \
that language required, but note it in english_is_enough.

employer_type is "recruiter" when the advertiser hires on behalf of an unnamed or different client \
(staffing agency, "our client"), otherwise "direct_employer".

visa_sponsorship is "offered" only when the posting explicitly says it sponsors work visas or relocation \
permits; "not_offered" only when it explicitly requires existing work authorization or says it does not \
sponsor; "unknown" when the posting says nothing about it (do not infer this from the country).

What each field means:
""" + schema_notes.text(SCHEMA)   # every field's guidance in the prompt too: Free AI's model skips schema descriptions


def description_hash(job):
    return hashlib.sha256((job['title'] + '\n' + (job.get('description') or '')).encode()).hexdigest()


def pending_jobs(db, limit):
    """Open jobs with a description whose extraction is missing, outdated or for older text."""
    db.executescript(ENRICHMENT_TABLE)
    done = {row['job_id']: row for row in db.execute('SELECT * FROM enrichments')}
    pending = []
    for job in store.digest_jobs(db, limit=10_000, only_new=False):
        if not job.get('description'):
            continue
        row = done.get(job['id'])
        if row and row['extractor_version'] == EXTRACTOR_VERSION and row['description_hash'] == description_hash(job):
            continue
        pending.append(job)
    # Newest first, so a capped run spends its budget on what the next digest will show; your best places before the rest (src/time_budget.py).
    from ..time_budget import best_first
    return best_first(sorted(pending, key=lambda j: j['first_seen_at'], reverse=True))[:limit]


# The judged facts a reader needs (columns the app promises) that a posting usually gives: left empty, they are asked once more, alone, and the second
# look decides (owner, 26 Oct 2026: "Ask again when empty"; Free AI left "5 years of sales experience" at seniority unknown). Guard: tests/test_enrich_ask_again.py.
ASK_AGAIN = {'seniority': lambda data: (data.get('seniority') or {}).get('value', 'unknown') == 'unknown',
             'work_mode': lambda data: (data.get('work_mode') or {}).get('value', 'unknown') == 'unknown',
             'technologies': lambda data: not data.get('technologies')}
AGAIN = ("\n\nYour last answer left {fields} empty. Read the posting again and give each when it gives any basis for it: seniority from a level word "
         "or the years of experience it asks; work_mode from where the work happens (the workplace, home, or both); technologies from the tools, "
         "skills, licences or topics it names. Answer unknown (or []) only when it gives none.")


# An IT job's role family is asked once more, as its own small question, and that answer decides (owner, 26 Oct 2026: "Ask role alone"; Free AI put a
# different plain SRE posting in "software" on each quality run, inside the 16-fact answer). A narrow question is where small models answer best.
ROLE_SYSTEM = "You name one job's own kind of work for a job-search tool, from its title and posting.\n\nrole_family: " + ROLE_FAMILIES


def extract(client, model, job):
    """Return (data, usage) for one job via a schema-constrained response; an empty fact a reader needs is asked once more, alone."""
    data, usage = _ask(client, model, job, SCHEMA)
    data['seniority'] = settle(job['title'], data.get('seniority'))   # the title's own level word, where it decides (ai/seniority.py)
    empty = [field for field, is_empty in ASK_AGAIN.items() if is_empty(data)]
    if empty:
        again, more = _ask(client, model, job, _only(empty), AGAIN.format(fields=', '.join(empty)))
        data.update({field: again[field] for field in empty if field in again})
        data['seniority'] = settle(job['title'], data.get('seniority'))
        usage = cost.combined(usage, more)
    if data.get('role_family') in IT_FAMILIES:
        again, more = _ask(client, model, job, _only(['role_family']), system=ROLE_SYSTEM)
        data['role_family'] = again.get('role_family') or data['role_family']
        usage = cost.combined(usage, more)
    return data, usage


def _ask(client, model, job, schema, note='', system=SYSTEM):
    response = client.messages.create(
        model=model,
        max_tokens=2000,
        system=system,
        messages=[{'role': 'user', 'content': (
            f"Title: {job['title']}\nCompany: {job['company']}\nLocation: {job.get('location') or ''}\n\n"
            f"Posting:\n{job['description']}{note}")}],
        output_config=engine.structured(schema, model, 'low'),   # extraction is routine; low effort keeps thinking short
    )
    if response.stop_reason != 'end_turn':
        raise RuntimeError(f'stopped with {response.stop_reason}')
    return json.loads(next(block.text for block in response.content if block.type == 'text')), response.usage


def _only(fields):
    """SCHEMA narrowed to the given facts."""
    return {'type': 'object', 'additionalProperties': False, 'required': list(fields),
            'properties': {field: SCHEMA['properties'][field] for field in fields}}



def save(db, job, model, data):
    db.execute("""INSERT INTO enrichments (job_id, extractor_version, description_hash, model, created_at, data_json)
        VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(job_id) DO UPDATE SET extractor_version=excluded.extractor_version,
        description_hash=excluded.description_hash, model=excluded.model, created_at=excluded.created_at,
        data_json=excluded.data_json""",
               (job['id'], EXTRACTOR_VERSION, description_hash(job), model,
                datetime.now(timezone.utc).isoformat(timespec='seconds'), json.dumps(data, ensure_ascii=False)))
    db.commit()


def load(db):
    """Map job_id -> extracted facts, for the digest."""
    db.executescript(ENRICHMENT_TABLE)
    return {row['job_id']: json.loads(row['data_json']) for row in db.execute('SELECT job_id, data_json FROM enrichments')}


def run(db, model, max_jobs, client=None, workers=5, stats=None, only_ids=None):
    """Enrich up to max_jobs pending jobs; returns a one-line summary.

    API calls run in parallel threads; results are saved from this thread only,
    because the SQLite connection must not be shared across threads.
    """
    from .. import time_budget as budget
    if only_ids is not None:   # the refresh's batch, read and then scored end to end (src/daily.py)
        queue = [job for job in pending_jobs(db, 10_000) if job['id'] in only_ids]
        jobs = list(queue)
    else:
        queue = pending_jobs(db, max_jobs)
        # A batch this refresh can finish (src/time_budget.py), best places first; when it is done with time left, the next batch, sized from the pace just
        # measured (7 Oct 2026: a first refresh guessed 12 s a job, read 6 of 10 in 15 s of its 3 min, and left 4 for "the next refresh").
        jobs = queue[:budget.batch('enrich', len(queue), say=False)]
    if not queue:
        return f'0 job(s) to enrich with {model}'
    said = [model]   # the model that answered (cost.answered), for the rows and the summary line
    from . import engine
    # Whatever the engine: down or busy (the next run continues), or a refusal of this one call (the job is skipped).
    transient, permanent = engine.transient_errors(), engine.permanent_errors()
    from . import engine
    client = client or engine.client(action='enrich')
    tokens_in = tokens_out = failures = enriched = 0
    from ..progress import Ticker
    ticker, done = Ticker('Reading new jobs with AI', len(queue)), 0
    late = 0   # not started: the search's time was up (src/time_budget.py); the next search reads them
    taken, stopped = 0, False   # jobs handed to a batch so far; the API or the AI limit stopped the run

    def one(job):
        return None if budget.over('enrich', key=job.get('url') or job.get('title')) else extract(client, model, job)

    def read(jobs):
        """One batch, in parallel. True when the run must stop (the API is down, or the AI limit): the next run continues."""
        nonlocal done, late, failures, enriched, tokens_in, tokens_out
        with ThreadPoolExecutor(max_workers=workers) as pool:
            futures = {pool.submit(slots.carry(one), job): job for job in jobs}
            for future in as_completed(futures):
                job = futures[future]
                done += 1
                ticker.tick(done)
                try:
                    result = future.result()
                    if result is None:
                        late += 1
                        continue
                    data, usage = result
                except transient as error:
                    # Transient after the SDK's own retries: stop and let the next run continue.
                    # A line starting "Warning:": it is how the app and the run row know the run did not fully work (a plain line left it "Completed").
                    print(f'Warning: AI unavailable ({reason(error)}), {len(queue) - enriched - failures} job(s) left for the next check')
                    detail('enrich', error)
                    for pending in futures:
                        pending.cancel()
                    return True
                except (*permanent, RuntimeError, json.JSONDecodeError, StopIteration) as error:
                    if cost.limit_reached(error):
                        # The account's spend limit: every other call would fail the same way. Stop; the next run continues.
                        if stats is not None:
                            stats['limit'] = 'cli' if cost.cli_limit(error) else True
                        print(f'AI limit reached: {cost.limit_reason(error)}, {len(queue) - enriched - failures} job(s) left for the next check')
                        for pending in futures:
                            pending.cancel()
                        return True
                    failures += 1
                    print(f'Skipped job {job["id"]}: {type(error).__name__}: {error}')
                    continue
                said[0] = cost.answered(model, usage)
                save(db, job, said[0], data)
                enriched += 1
                tokens_in += usage.input_tokens
                tokens_out += usage.output_tokens
                cost.add(stats, model, usage)
        return False

    while jobs:
        began, before = time.monotonic(), enriched
        stopped = read(jobs)
        budget.record('enrich', time.monotonic() - began, enriched - before)   # this computer's pace: the next batch is sized from it
        taken += len(jobs)
        if stopped or late:
            break
        rest = queue[taken:]
        jobs = rest[:budget.batch('enrich', len(rest), say=False)]
    waiting = late + (0 if stopped else len(queue) - taken)   # time up: said once, how many the next refresh reads
    if waiting:
        print(budget.left_line('enrich', waiting), flush=True)
    if stats is not None:
        stats.update(pending=taken, done=enriched, failed=failures, late=waiting)
    return (f'Enriched {enriched} of {taken} job(s) with {said[0]}; {failures} failed; '
            f'tokens in {tokens_in}, out {tokens_out}')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--db', type=Path, default=JOBS_DB)
    parser.add_argument('--max-jobs', type=int, default=40, help='cap per run to bound cost')
    parser.add_argument('--model', default=DEFAULT_MODEL)
    parser.add_argument('--dry-run', action='store_true', help='list pending jobs without calling the API')
    args = parser.parse_args()
    with store.connect(args.db) as db:
        if args.dry_run:
            print(f'{len(pending_jobs(db, args.max_jobs))} job(s) to enrich with {args.model}')
        else:
            print(run(db, args.model, args.max_jobs))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
