"""The store interface: one Protocol per entity of the user's data, plain dicts in and out (never Notion JSON).

Every adapter (memory, sqlite, notion, later others) implements these and passes tests/store_contract.py.
Spec: docs/superpowers/specs/2026-10-09-store-adapters.md. Ids are adapter-opaque strings; a job is found by
its URL (normalised by `url_key`). Records carry the keys listed in the *_FIELDS tuples; a missing value is ''
or None, never an absent key.
"""
from dataclasses import dataclass, field
from datetime import date
from typing import Optional, Protocol

from ..notion.dedupe import normalize_url


def local_today() -> str:
    """The person's calendar day (ISO), for a date they live by such as Applied on: this computer's date, as the Notion tracker's
    mark has always used (src/notion/client.py). A UTC clock gave yesterday's date to an application made after midnight in Zurich."""
    return date.today().isoformat()

# Kinds of text the user writes and the app reads whole (each Markdown): the Profile, the standard answers and
# form knowledge. ⚙️ Search settings are not a text: their home stays config/search.json + preferences.json on
# the Mac, rendered to a Notion page by src/notion/search_settings.py when the store is Notion (one copy each).
TEXTS = ('profile', 'answers', 'knowledge')

# set_stage outcomes.
CREATED, CHANGED, UNCHANGED = 'created', 'changed', 'unchanged'

# What an adapter can do beyond the contract. The UI asks a capability, never an adapter's name.
LINKS = 'links'      # records have a page the user can open elsewhere (link() returns a URL)
CLOUD = 'cloud'      # reachable from GitHub runners and the Telegram worker (Always on)
FILES = 'files'      # attach() keeps the bytes in the store itself (else a path on this Mac)

APPLICATION_FIELDS = ('id', 'url', 'title', 'company', 'location', 'work_mode', 'stage', 'fit', 'next_step',
                      'next_interview', 'applied_on', 'via', 'contact', 'origin', 'source', 'notes', 'kit_inputs',
                      'rejection', 'rejection_lesson', 'feedback_status', 'employer_feedback', 'salary', 'contract',
                      'call_facts', 'created_at',
                      # When the row last changed, by anyone (Notion: the page's last edit, a hand edit too). Read-only:
                      # every adapter stamps it on create/update/set_stage and ignores a value the caller passes.
                      'updated_at',
                      # The frozen record and what the engine stamps on a job (Job Tracker columns in Notion).
                      'ats', 'posted', 'recorded', 'tier', 'seniority', 'days_to_apply', 'cover_letter', 'questions',
                      'answers_captured', 'cv_version', 'kit_variant', 'agent', 'channel', 'date_approximate', 'reached_via',
                      'recruiter', 'kit_cost', 'fill_minutes', 'interview_prep', 'confirmation_email')
EVENT_FIELDS = ('id', 'app_id', 'kind', 'at', 'source', 'note', 'source_id', 'interview_at', 'changes', 'needs_you',
                'suggested_job', 'created_at')
# An event's `changes` (a dict) says what the item moved and where it came from: {'fields': {name: [before, after]},
# 'from', 'subject', 'feedback'} (src/ai/mail_record.py writes it). `needs_you` + `suggested_job` (a job URL) mark a
# question on no job (app_id ''): "Which job is this email about?", answered in Focus (src/ai/reassign.py).
MATCH_FIELDS = ('id',   # the store's own: Notion's 🎯 Job Matches page id, a stable row id elsewhere (a link to the job)
                'url', 'title', 'company', 'location', 'work_mode', 'fit', 'reason', 'fit_detail', 'status',
                'first_seen',
                # Every other 🎯 Job Matches column, with the column's own value (src/notion/matches.py properties writes them): what a
                # Notion user reads there, and what the application record freezes (src/notion/ledger_record.match_for).
                'tier', 'confidence', 'code', 'scored', 'scoring_method', 'seniority', 'languages', 'salary', 'recruiter',
                'technologies', 'role_family',
                'workload', 'on_call', 'visa', 'remote_scope', 'contract', 'deadline', 'posted', 'responsibilities',   # the posting's own facts (matches_sync.posting_facts)
                'places',   # a fingerprint of the places the score used (src/ai/locations.py): '' for a score made before they were recorded
                'last_update')   # read-only: when the row last changed (Notion's Last update; the other stores stamp each write)
INTERVIEW_FIELDS = ('id', 'app_id', 'title', 'at', 'input', 'round', 'overall', 'questions', 'weak_answers', 'topics',
                    'weak_topics', 'next_step', 'cost', 'model', 'transcript', 'review', 'created_at')
INSIGHT_FIELDS = ('id', 'day', 'category', 'title', 'body', 'fields', 'created_at')
# The keys an insight's `fields` may hold (each a column in Notion); any other key is refused, as an unknown field is.
INSIGHT_EXTRAS = ('basis', 'confidence', 'sample_size', 'evidence', 'action', 'feedback', 'issue_detected', 'cost', 'model',
                  'input_hash', 'data', 'state', 'hidden_until')
# The person's answer to a suggestion (src/suggestions.py; spec 2026-10-28-insights-with-actions): none = open while its producer still makes it.
# Why (28 Oct 2026, owner): Not now / Not true must survive a restart and read the same on Focus, Jobs and the suggestion's home.
INSIGHT_STATES = ('Done', 'Not now', 'Not true', 'Stale')
EMPLOYER_FIELDS = ('id', 'name', 'website', 'careers_url', 'feed', 'active', 'created_at',
                   # What Find employers learns about one (🏢 Employers & Sources columns): its kind and tier, the job feed it found
                   # (ats + slug), how good it is, where it hires, research links and when it was checked.
                   'kind', 'tier', 'ats', 'slug', 'feed_status', 'integration', 'quality', 'origin', 'cities', 'relevant_roles',
                   'in_preferred_places', 'notes', 'size', 'verification', 'glassdoor', 'levels_fyi', 'checked', 'added')
AGENT_RUN_FIELDS = ('id', 'url', 'ats', 'outcome', 'fields', 'learnings', 'transcript', 'created_at')
# An agent run's `fields` (a dict) holds only these keys: each is an 🤖 Agent Runs column, so a move to Notion loses nothing (one
# copy). `data` is the catch-all (JSON). Every adapter raises KeyError on any other key (check_extras).
AGENT_RUN_EXTRAS = ('job', 'company', 'job_stage', 'agent', 'status', 'reason', 'started', 'ended', 'minutes', 'age_days', 'fresh',
                    'field_count', 'fill_time', 'unfilled_required', 'waiting_for_you', 'billed_to', 'session_id', 'tokens_total',
                    'output_tokens', 'working_min', 'waiting_min', 'times_asked', 'reply_median_s', 'ready_to_decided_min', 'turns',
                    'tool_calls', 'tools_used', 'tokens_in', 'tokens_out', 'cache_read', 'model', 'timeline', 'data')
CRON_RUN_FIELDS = ('id', 'kind', 'where', 'status', 'started_at', 'finished_at', 'summary', 'report', 'result',
                   'log', 'progress', 'trigger', 'mode', 'run_url', 'application', 'stats',
                   # title: the row's name, the engine's ("2026-09-29 16:02 · Interview prep · Huxley — Principal SRE"); log_id: the
                   # id that joins the row to logs/app.log, logs/engine.log and the Actions log (Notion's "Run id").
                   'title', 'log_id',
                   # details: how the run ran (src/run_details.py), a dict of fixed keys and numbers; '' on a run from before it.
                   'details')
# A run's numbers (`stats`, a dict): what Recent activity and Telegram /status show. Keys are these; the Notion adapter maps each to its
# ⏱️ Search runs column (New jobs, Scored, AI cost (USD)…). A key not set is absent from the dict.
RUN_STATS = ('new_jobs', 'changed_jobs', 'scored', 'kits', 'emails', 'updates', 'closed_stale', 'feeds', 'feed_errors',
             'top_new_score', 'duration_s', 'ai_cost_usd', 'tokens_total', 'billed_to', 'telegram')


# Every entity with ids also has `put(record) -> record`: store a record copied from another store as it is (its
# fields and timestamps; a new id of this store). Only the move between stores (src/stores/copy.py) calls it; the
# caller maps ids that point at other records (app_id).


# The section a job's logged messages are kept in (src/ai/inbox.py; the job panel and prep read it).
LOGGED = '📥 Logged messages'


def entry_files(applications, app_id, markdown, files):
    """This Mac's append_entry with screenshots: each kept as the job's file, and a line in the entry saying so."""
    for name, data, kind in files:
        applications.attach(app_id, name, data, kind)
    said = f'Screenshots: {len(files)} kept with this job' if len(files) != 1 else f'Screenshot: {files[0][0]}, kept with this job'
    return '\n\n'.join(part for part in ((markdown or '').strip(), said if files else '') if part)


def entry_appended(section, title, markdown):
    """A section with one more entry at its end: '### {title}' and its Markdown (append_entry on this Mac's stores)."""
    entry = f'### {title}\n\n{markdown}'.rstrip() if (markdown or '').strip() else f'### {title}'
    return f'{section.rstrip()}\n\n{entry}' if (section or '').strip() else entry


def ref(entity, record_id):
    """How a record is named outside the store when the adapter has no LINKS (the engine's `Cronjob run logged: <link>`
    line, the desktop's run list): `store:<entity>/<id>`. `Stores.link_or_ref` gives the link when there is one."""
    return f'store:{entity}/{record_id}'


def parse_ref(text):
    """(entity, id) from a ref, else None."""
    if not str(text or '').startswith('store:') or '/' not in text:
        return None
    entity, record_id = text[len('store:'):].split('/', 1)
    return (entity, record_id) if entity and record_id else None


def check_extras(values, allowed):
    """`values` with its `fields` dict checked against `allowed` (an *_EXTRAS tuple); KeyError names the unknown keys."""
    unknown = set((values or {}).get('fields') or {}) - set(allowed)
    if unknown:
        raise KeyError(f'not a known field: {", ".join(sorted(unknown))}')
    return values


# A job's application kit: the section of its Applications record that holds it (Notion: the toggle heading on the job's
# page, as src/ai/kit.py has always written it). Its Markdown is the readable kit, then '### Machine-readable kit' and the
# kit as a ```json fence; readers take the last ```json fence (kit_from; the extension's reader the same way). The sample
# both sides test against: tests/fixtures/stores/kit-section.md.
KIT_SECTION = '📝 Application kit'

# An answer the person gave for ONE job only (the review drawer's "Reuse for matching questions" off): the section of that job's record that holds it,
# one '- question — answer' line each, on every store. Read by the fill for that job's form only (worker/src/job-answers.js); never a standard answer.
# The sample both sides test against: tests/fixtures/stores/job-answers.md.
JOB_ANSWERS_SECTION = '💬 Answers for this job only'


def kit_from(markdown):
    """The machine-readable kit (a dict) in a kit section's Markdown, or None."""
    import json
    import re
    fences = re.findall(r'^```json[ \t]*\n(.*?)^```[ \t]*$', markdown or '', re.M | re.S)
    if not fences:
        return None
    try:
        found = json.loads(fences[-1])
    except ValueError:
        return None
    return found if isinstance(found, dict) else None


def url_key(url):
    """The one key a job is matched by in every adapter."""
    return normalize_url((url or '').strip())


def insight_values(values):
    """An insight's values with its `fields` checked against INSIGHT_EXTRAS (KeyError on another key) and its state against
    INSIGHT_STATES (ValueError on another)."""
    fields = (values or {}).get('fields') or {}
    unknown = set(fields) - set(INSIGHT_EXTRAS)
    if unknown:
        raise KeyError(f'not an insight field: {", ".join(sorted(unknown))}')
    if fields.get('state') not in (None, '', *INSIGHT_STATES):
        raise ValueError(f'not an insight state: {fields["state"]}')
    return values


def record(fields, values):
    """A record with exactly `fields`, missing ones ''. Adapters build every record through this."""
    return {name: values.get(name, '') for name in fields}


class Applications(Protocol):
    """Every job the user pursues (📮 Applications in Notion)."""
    def list(self, stages=None) -> list: ...
    def get(self, url) -> Optional[dict]: ...
    def by_id(self, app_id: str) -> Optional[dict]: ...  # a button that names its job by id (Focus, feedback); None if gone
    def create(self, job: dict, stage: str) -> dict: ...
    def stages(self) -> dict: ...  # {url_key: stage}, the hot path: no full records
    def set_stage(self, job: dict, stage: str, today=None) -> tuple: ...
    # → (record, CREATED | CHANGED | UNCHANGED). Creates the row from `job` (needs 'url') when missing; writes
    # nothing when the stage is already `stage`; stamps applied_on (today, local_today()) on the first 'Applied'.
    def update(self, app_id: str, fields: dict) -> dict: ...
    def delete(self, app_id: str) -> None: ...  # with its sections and files
    # Named Markdown sections of a job's page: the kit, prep, rejection review, the frozen record.
    def section(self, app_id: str, name: str) -> Optional[str]: ...
    def set_section(self, app_id: str, name: str, markdown: str) -> None: ...
    def attach(self, app_id: str, name: str, data: bytes, content_type: str) -> str: ...
    def sections(self, app_id: str) -> dict: ...  # {name: markdown}
    def append_entry(self, app_id: str, section: str, title: str, markdown: str, files=()) -> None: ...
    # One more dated entry in a section that only grows (LOGGED: a pasted message or screenshot, "📥 29 Sep 2026 · …"). This Mac's
    # stores append "### {title}" and its Markdown to the section; Notion appends the page's folded toggle as it always has, and its
    # sections() reads those toggles back as this section, so every store returns the same shape. files: [(name, bytes, type)], the
    # entry's screenshots: inside the fold on Notion (side by side when several), the job's files on this Mac (one line says so).
    def files(self, app_id: str) -> list: ...     # [(name, bytes, content_type)]
    def put(self, record: dict) -> dict: ...


class Events(Protocol):
    """The outcome history of applications (📈 Application Events)."""
    def list(self, app_id=None, kind=None, source_id=None) -> list: ...
    def get(self, event_id: str) -> Optional[dict]: ...  # None when there is no such (live) event
    def add(self, app_id: str, kind: str, at: str, **fields) -> dict: ...
    # Idempotent: with a non-empty source_id (a mail id, a Telegram tap), an event of that app with that
    # source_id is returned as it is instead of a second one.
    # app_id '' is an event on no job yet: a question (needs_you) the person answers by naming the job.
    def update(self, event_id: str, fields: dict) -> dict: ...
    def archive(self, app_id: str, kind: str) -> int: ...  # archived events leave list()
    def put(self, record: dict) -> dict: ...


class Matches(Protocol):
    """What a search found and scored (🎯 Job Matches)."""
    def list(self, status=None) -> list: ...
    def get(self, url: str) -> Optional[dict]: ...   # by base.url_key; None when the search never had it
    def upsert(self, job: dict) -> dict: ...
    def set_status(self, url: str, status: str) -> None: ...
    def remove(self, url: str) -> None: ...
    def clear(self, keep_urls=()) -> int: ...  # remove every row but those whose url_key is in keep_urls → how many went (Notion: its trash)
    def sync(self, db, scored_jobs: list, applied_urls=frozenset(), open_urls=None, dismissed_urls=frozenset(),
             partial: bool = False) -> str: ...
    # A search's scored jobs, all at once (→ its summary line): one row per job, best copy, Applied / Open; after a full
    # search (not partial) the rows it no longer has become Dismissed, Applied or Not seen. db: the search's job cache,
    # where an adapter may keep what it needs (Notion: its page ids and the rows' hashes). src/stores/matches_sync.py.


class Interviews(Protocol):
    """🎤 Interviews. `transcript` and `review` are whole Markdown fields: an adapter with pages rewrites
    that section whole; a block-level patch is the adapter's own business."""
    def list(self, app_id=None) -> list: ...
    def get(self, interview_id: str) -> Optional[dict]: ...
    def save(self, interview_id: Optional[str], fields: dict) -> dict: ...
    def archive(self, interview_id: str) -> None: ...
    def put(self, record: dict) -> dict: ...


class Insights(Protocol):
    """💡 Insights. `fields` holds the extras (basis, confidence, sample_size, evidence, action, feedback, cost, …)."""
    def list(self, since=None, category=None, limit=None) -> list: ...
    # The daily insight and weekly report: one per day+category, a second save that day replaces it.
    def save(self, day: str, category: str, title: str, body: str, fields=None) -> dict: ...
    # Rows of their own: several a day (learning's issues), or one kept and updated in place (Interview patterns).
    def add(self, record: dict) -> dict: ...
    def update(self, insight_id: str, fields: dict) -> dict: ...
    def put(self, record: dict) -> dict: ...


class Employers(Protocol):
    def list(self, active=True) -> list: ...
    def add(self, employer: dict) -> dict: ...     # one per name: an existing one is returned unchanged
    def upsert(self, employer: dict) -> dict: ...  # one per name: an existing one gets these fields (Find employers' re-check)
    def put(self, record: dict) -> dict: ...


class AgentRuns(Protocol):
    """Form fills and Apply sessions (🤖 Agent Runs)."""
    def add(self, run: dict) -> dict: ...
    def update(self, run_id: str, fields: dict) -> dict: ...
    def get(self, run_id: str) -> Optional[dict]: ...
    # transcript=False: the list without each run's conversation (the Notion adapter reads it from the page body, a request per run).
    def list(self, ats=None, limit=None, transcript=True) -> list: ...
    def put(self, record: dict) -> dict: ...


class CronRuns(Protocol):
    """Every run's row (⏱️ Search runs): the one run history."""
    def begin(self, kind: str, where: str, fields=None) -> dict: ...  # fields: trigger, mode, run_url, application, title, log_id
    def progress(self, run_id: str, line: str) -> None: ...
    # The heartbeat of a long quiet step: its numbers so far (duration_s…) merged in, nothing else changed.
    def touch(self, run_id: str, stats=None) -> None: ...
    # title: the row's final name, when the run knows what it was about by the end.
    def finish(self, run_id: str, status: str, summary='', report='', result='', log='', stats=None, title='', details=None) -> dict: ...
    def get(self, run_id: str) -> Optional[dict]: ...
    def list(self, since=None, kind=None) -> list: ...
    def put(self, record: dict) -> dict: ...


class Texts(Protocol):
    def get(self, name: str) -> str: ...
    def set(self, name: str, markdown: str) -> None: ...
    def plain(self, name: str) -> str: ...  # what the AI reads: the text as its page shows it (Notion: Tracker.page_text, as the
    # engine always read the Profile for scoring and kits; elsewhere the text itself), so a Notion user's AI input never changes


@dataclass
class Stores:
    """One adapter's entities, as the rest of the code sees them."""
    name: str
    applications: Applications
    events: Events
    matches: Matches
    interviews: Interviews
    insights: Insights
    employers: Employers
    agent_runs: AgentRuns
    cron_runs: CronRuns
    texts: Texts
    caps: frozenset = field(default_factory=frozenset)

    def link(self, record_id) -> Optional[str]:
        """A URL the user can open for a record, when the adapter has LINKS; else None."""
        return None

    def link_or_ref(self, entity, record_id) -> str:
        return self.link(record_id) or ref(entity, record_id)
