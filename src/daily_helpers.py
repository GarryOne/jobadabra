"""The jobs check's helpers (src/daily.py runs them): find a job by code, the apply/prepare messages, the switches, the run's saved counts
and Notion log, the starter feeds and the downloaded employer index. No command-line parsing and no mode of its own.
Tests: tests/test_daily.py, tests/test_applications.py, tests/test_added.py, tests/test_cron_runs.py, tests/test_place_triage.py.
"""
import json
import os
import re
from collections import Counter
from datetime import datetime, timezone
from html import escape
from . import digest, employer_index, features, role_kinds, run_log, scout, store, telegram, tgcard
from .ai import cost, enrich, kit, provenance, score
from .notion import client as notion, cron_runs, matches
from .paths import JOBS_DB, REPORTS, load_search_config
from .sources import ats, feeds
from .stores import open_stores, rules
from .store_access import profile_source, run_stores, url_stages  # noqa: F401 -- daily_search and tests use them from here


new_cron_run = run_log.new_run  # kept for callers and tests


def left_out(stats, what):
    """A warning when an AI step left jobs out (each failed, or the run stopped at the Anthropic spending limit), so the
    run shows "Warnings" in ⏱️ Search runs and the app, not a green "Completed" (29 Sep 2026: 23 jobs unscored)."""
    left = (stats.get('pending') or 0) - (stats.get('done') or 0)
    # Without a limit, only a failed call is a loss: a job the time budget left ("late") is said by its own ⏱ line and read by the
    # next refresh (8 Oct 2026: "1 job(s) not read by AI: the AI call failed" when enrichment had only run out of time).
    if not stats.get('limit') and 'failed' in stats:
        left = min(left, stats.get('failed') or 0)
    if left <= 0:
        return []
    from .ai import providers
    # The engine's own limit (an engine that can't go on: its plan, its sign-in, its key); a bare True is the Anthropic API's spend limit.
    why = (providers.spec().limit if stats.get('limit') == 'cli' else
           providers.ENGINES['api'].limit if stats.get('limit') else 'the AI call failed')
    return [f'{left} job(s) not {what}: {why}']


NO_PROFILE = 'scoring skipped: no Profile (connect Notion, or finish the setup)'


def time_budget_on():
    from . import time_budget
    return time_budget.DEADLINE is not None


NEW_LISTED = 10   # new jobs named in the log, for the result card


def new_job_lines(jobs, statuses):
    """"New job: <title> | <company> | <url>" for the first new jobs of a crawl: the Find jobs card lists them when the run sends no digest (the new
    jobs wait for a score; 17 Oct 2026: the owner's run showed only its header line)."""
    new = [job for job, status in zip(jobs, statuses) if status == 'new']
    return [f"New job: {job['title']} | {job['company']} | {job['url']}" for job in new[:NEW_LISTED]]


def none_scored(waiting, stats):
    """A warning when jobs wait for a score and this run scored none: never silent again (17 Oct 2026: every run since 10 Oct scored 0 while
    2,868 waited, and each said only "Completed"; the clock had run out in the crawl, src/time_budget.restart)."""
    if (waiting or 0) > 0 and not (stats or {}).get('done'):
        return [f'{waiting} job(s) waiting, none scored this run']
    return []


def no_profile(score_max, tracker, profile):
    """A warning when scoring is on but there is no Profile to score against (no Notion, no local profile.md): the run
    said "Completed" while every new job stayed unscored (6 Oct 2026, after an import that brought no Profile)."""
    return [NO_PROFILE] if score_max and not tracker and not profile else []


def crawl_counts(report, statuses):
    """Feed and import numbers for the run report."""
    counted = Counter(statuses)
    failing = [s['company'] for s in report.get('sources', []) if not s.get('ok')]
    return {'feeds': len(report.get('sources', [])), 'feed_errors': len(failing), 'failing_feeds': failing,
            'new': counted.get('new', 0), 'changed': counted.get('changed', 0)}


def top_new(report, scored, limit=3):
    """[(title, company, score)] for jobs first seen this run, best score first."""
    new_urls = {j['url'] for j in report.get('jobs', []) if j.get('status') == 'new'}
    hits = [(j['title'], j['company'], j['fit']['score']) for j in scored if j.get('url') in new_urls]
    return sorted(hits, key=lambda h: h[2], reverse=True)[:limit]


KITS_DEFAULT = 3  # Prepare top matches: kits per run unless --auto-kit-max says otherwise
STALE_DAYS = 7  # A job not seen by a full crawl for this long is closed (reopened if seen again).
MODES = ('scheduled', 'run', 'today', 'apply', 'more', 'prepare', 'insight', 'weekly', 'interview', 'add', 'import', 'kits')


def find_job(db, code):
    """Job by its 8-hex code, or by URL (the browser extension sends the page it is on)."""
    wanted = _url_key(code) if '/' in code else None
    for job in store.digest_jobs(db, limit=10_000, only_new=False):
        url = job.get('url')
        if url and (notion.job_code(url) == code or (wanted and _url_key(url) == wanted)):
            return job
    return None


def tracked_job(code, stores):
    """A job known to the store but absent from the crawl's SQLite (evicted cache, reset DB, or a
    filter that no longer admits it): rebuilt from its application record, or else its match, with
    the posting text fetched live from its job board. Matches by URL or by 8-hex code (of the URL as
    stored). None if the store has neither. Notion: the Job Tracker row, else the Job Matches row."""
    wanted = _url_key(code) if '/' in code else None
    matches = lambda u: (wanted and _url_key(u) == wanted) or notion.job_code(u) == code
    row = next((r for r in stores.applications.list() if matches(r['url'] or '')), None) or \
        next((m for m in stores.matches.list() if matches(m['url'] or '')), None)
    if not row:
        return None
    live = ats.posting(row['url']) or {}
    return {'id': None, 'url': row['url'], 'title': live.get('title') or row['title'], 'company': row['company'],
            'location': live.get('location') or row['location'], 'description': live.get('description', ''),
            'work_mode': '', 'city': ''}


def to_score(db, hidden):
    """The jobs scoring may take: eligible ones, but not a job whose location names no place of its own until its posting has been read for
    where it is (src/ai/place_triage.py read): a fit for a job that may be outside your places is a Sonnet call spent for nothing."""
    from .sources import feeds
    return [job for job in digest.eligible_jobs(db, hidden)[0] if feeds.place_of(job) != 'vague']


def for_job_matches(db, hidden):
    """The scored open jobs mirrored into Notion Job Matches: what the search found. Jobs you added yourself
    (src/ai/added.py) are left out: they live on Applications only, with their fit columns there."""
    fits, yours = score.load(db), store.added_source_ids(db)
    candidates, _ = digest.eligible_jobs(db, hidden)
    return [dict(j, fit=fits[j['id']]) for j in candidates if j['id'] in fits and j.get('source_id') not in yours]


def _job_arg(value):
    value = value.strip()
    return value if '/' in value else value.lower()


def _url_key(url):
    """Greenhouse links to one job come in several forms; compare them by board-independent job id."""
    match = re.search(r'greenhouse\.io/[\w-]+/jobs/(\d+)', url) or re.search(r'[?&]gh_jid=(\d+)', url)
    if not match and 'greenhouse.io' in (url or ''):
        match = re.search(r'[?&]token=(\d+)', url)
    return f'greenhouse:{match.group(1)}' if match else url.split('?')[0].split('#')[0].rstrip('/').lower()


ACTIONS = {'applied': 'Applied', 'saved': 'Saved', 'dismissed': 'Dismissed'}


def apply_message(db, code, stores, action='applied'):
    """Record a Telegram button action for the job with this code in the active store; return the reply text. Every store: its
    stage rules and ledger (src/stores/rules.py, src/ledger_store.py); on Notion the same pages as before the store
    (tests/test_daily_store_notion.py)."""
    job = find_job(db, code) or tracked_job(code, stores)
    if not job:
        where = 'Notion' if stores.name == 'notion' else 'the app'
        return f"⚠️ <b>Job not found</b>\nNo job with code <code>{escape(code)}</code>. It may have closed; add it in {where} manually."
    stage = ACTIONS[action]
    found, outcome = rules.mark(stores, job, stage)
    page = {'id': found['id'], 'url': stores.link(found['id']) or ''}
    if stage == 'Applied' and outcome != 'unchanged':
        # The application ledger: an Applied event and the frozen record (no form capture from CI,
        # so answers are the kit drafts). Never blocks the reply.
        try:
            from . import ledger_store
            ledger_store.add_event(stores, found, 'Applied', 'Telegram')
            ledger_store.record(stores, job['url'])
        except Exception as error:
            print(f'Warning: application record skipped: {type(error).__name__}: {error}')
        queue_mail_check()
    link = f'<a href="{escape(page.get("url", ""), quote=True)}">Notion</a>' if page.get('url') else 'the app'
    title = f"{escape(job['title'])}\n{escape(job['company'])}"
    if outcome == 'unchanged':
        return f"ℹ️ <b>Already tracked</b>\n{title}\n\n<b>Next step</b>\nSee {link}."
    return {
        'Applied': f"✅ <b>Marked applied</b>\n{title}\n\n<b>Next step</b>\nIt won't appear in digests again. Track the stage in {link}.",
        'Saved': f"⭐ <b>Saved</b>\n{title}\n\n<b>Next step</b>\nIt stays in digests with a star; /saved lists your saved jobs.",
        'Dismissed': f"❌ <b>Dismissed</b>\n{title}\n\n<b>Next step</b>\nIt won't appear again, and helps tune the scores.",
    }[stage]


def queue_mail_check(delay=5):
    """Start the Gmail + Calendar workflow in `delay` minutes, so an application's confirmation email is
    picked up soon after it's marked Applied. Needs GITHUB_TOKEN/GITHUB_REPOSITORY (set in Actions);
    a no-op elsewhere, and a failure never blocks the reply."""
    token, repo = os.getenv('GITHUB_TOKEN'), os.getenv('GITHUB_REPOSITORY')
    if not token or not repo:
        return False
    import urllib.request
    request = urllib.request.Request(
        f'https://api.github.com/repos/{repo}/actions/workflows/mail.yml/dispatches', method='POST',
        data=json.dumps({'ref': 'main', 'inputs': {'delay': str(delay)}}).encode(),
        headers={'Authorization': f'Bearer {token}', 'Accept': 'application/vnd.github+json'})
    try:
        with urllib.request.urlopen(request, timeout=20):
            return True
    except Exception as error:
        print(f'Warning: mail check not queued: {type(error).__name__}: {error}')
        return False


def log_text(html):
    """A Telegram HTML reply as plain text for the terminal and the app's activity log (no tags, no &#x27;)."""
    return telegram.plain(html)


def kits_message(drafted, subtitle=None):
    """The "Prepare top matches" message: the count, then each drafted job's linked title and company (the window's
    kits card reads it: desktop/renderer/kits-ready.js, checked against this writer in desktop/test/engine-message-contract.test.js)."""
    return tgcard.card('Application kits ready', subtitle or f"{len(drafted)} drafted for your top matches · nothing sent", [
        f"<a href=\"{escape(job['url'], quote=True)}\">{escape(job['title'])}</a>\n{escape(job['company'])}"
        for job, _ in drafted], emoji='📝')


def log_ai_run(stores, run, args, failed=False):
    """The run's row in the active store (⏱️ Search runs on Notion) for an on-demand AI job (kit, interview, insight, weekly), so the
    month's rows add up to the AI spend the budget guard reads, on every store. Sending runs and the app's runs (--log-run) are logged."""
    if args.send or args.log_run:
        run['seconds'] = int((datetime.now(timezone.utc) - datetime.fromisoformat(run['started_at'])).total_seconds())
        url = run_log.log_run(stores, run, failed=failed)
        if url:
            print(f'Cronjob run logged: {url}')  # the app's Recent activity links "See it full in Notion" to this


def prepare_kit(db, code, stores, client=None, model=kit.DEFAULT_MODEL, opener=None, stats=None, run=None, drafted_out=None):
    """Draft the application kit for one job; save it on its Notion Applications row (run: its ⏱️ Search runs row
    links to that row, shown on the job's page as Runs).

    Returns (Telegram messages, log line). The row is created as Saved if the job isn't tracked yet."""
    job = find_job(db, code) or tracked_job(code, stores)
    if not job:
        return [f"⚠️ <b>Job not found</b>\nNo job with code <code>{escape(code)}</code>. It may have closed."], 'job not found'
    if job['id'] is not None:
        job = dict(job, ai=enrich.load(db).get(job['id']), fit=score.load(db).get(job['id']))
    try:
        questions = kit.form_questions(job['url'], opener)
    except Exception as error:  # An unreadable form still gets a kit, with likely questions.
        print(f'Warning: form questions unavailable: {type(error).__name__}: {error}')
        questions = []
    profile, answers = stores.texts.plain('profile'), kit.standard_answers(stores)   # as the AI reads it (Notion: the page text)
    if client is None:
        from .ai import engine
        client = engine.client(action='kit')
    drafted, usage = kit.draft(client, model, job, profile, answers, questions)
    cost.add(stats, model, usage)
    if stats is not None:
        stats.update(pending=1, done=1)
    record, _ = rules.mark(stores, job, 'Kit ready')
    page = {'id': record['id'], 'url': stores.link(record['id']) or ''}
    if run is not None:
        run['application'] = page['id']  # the run links to the job it was for, and its title names it
        run['subject'] = cron_runs.job_subject(company=record.get('company') or job.get('company', ''),
                                               role=record.get('title') or job.get('title', ''), via=record.get('via') or '')
    stores.applications.set_section(page['id'], kit.KIT_SECTION, kit.kit_markdown(job, drafted, questions, model))
    kit.record_next_step(stores, page, drafted)
    kit.record_cost(stores, page, model, usage)
    provenance.record_kit(stores, page, profile, answers)
    if drafted_out is not None:
        drafted_out.append((job, page))  # the app's card for this run (kits_message)
    return kit.telegram_messages(job, drafted, questions, page.get('url')), kit.cost_line(model, usage)


def apply_switches(args):
    """JOB_PILOTTO_DISABLE (src/features.py) wins over the flags the workflow passes."""
    for name, flag in (('enrich', 'enrich_max'), ('score', 'score_max'), ('auto_kits', 'auto_kit_max')):
        if features.disabled(name):
            setattr(args, flag, 0)
    if features.disabled('insights'):
        args.insight = False
    if features.disabled('telegram'):
        args.send = False


def digest_note(shown, new, terminal):
    """The line after a digest nobody was sent: the app's users are not told to use a terminal."""
    note = f"Digest ready: {plural(shown, 'job')}, {new} new. Telegram isn't connected, so nothing was sent"
    return note + (' (terminal: set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID, then rerun with --send).' if terminal else '.')


def plural(n, word):
    return f"{n} {word}{'' if n == 1 else 's'}"


def save_run(run):
    """Duration and cost, then the summary of the latest crawl the desktop app's activity bar reads."""
    run['seconds'] = int((datetime.now(timezone.utc) - datetime.fromisoformat(run['started_at'])).total_seconds())
    run['usd'] = round(cron_runs.total_usd(run), 4)
    REPORTS.mkdir(parents=True, exist_ok=True)
    (REPORTS / 'last-run.json').write_text(json.dumps(run, default=str, indent=2))


def log_store_job(stores, run, app, created):
    """cron_runs.log_job for a store's application record (no Notion page): the run's Application, its subject and the
    "Job logged: {…}" line the app links the run's result to that job by."""
    from .notion import cron_report
    # The job's title as its page shows it, as cron_runs.log_job read it: an Inbound row's carries its employer or agency ("Principal SRE ·
    # via Huxley", the notion adapter's _title), any other row's is its role.
    from .notion import titles
    title = app.get('title') or ''
    if (app.get('origin') or '').lower() == 'inbound':
        title = titles.job_title(title, app.get('company') or '', app.get('via') or '')
    job = {'page_id': app['id'], 'url': stores.link(app['id']) or '', 'title': title,
           'job_url': app.get('url') or '', 'created': bool(created)}
    run['application'] = app['id']
    run['subject'] = cron_report.job_subject(company=app.get('company') or '', role=app.get('title') or '', via=app.get('via') or '')
    from . import run_result
    run_result.note_job(job)
    print(cron_report.JOB_LINE + json.dumps(job, ensure_ascii=False))
    return job


def log_crawl(stores, run):
    url = run_log.log_run(stores, run)
    if url:
        print(f'Cronjob run logged: {url}')  # the desktop app links its activity row to this


def starter_sources():
    """This install's own starter feeds (scout.starter_list): the ones the app used to ship come from the central index now, with their
    places and role mix, so a search outside IT no longer crawls Stripe or Palantir (6 Oct 2026)."""
    return scout.starter_list()


def downloaded_index():
    """The central employer index (cached, checked about hourly); [] when off or unreachable."""
    if features.disabled('index'):
        return []
    index = employer_index.load()
    # Default: only feeds with roles in your places. JOB_PILOTTO_INDEX_ALL=1 crawls the whole worldwide index.
    if os.getenv('JOB_PILOTTO_INDEX_ALL'):
        return index
    kinds = role_kinds.of_search(load_search_config())
    me = employer_index.me_now()
    # The labels this install shares and is ranked by: fixed lists only (7 Oct 2026: a wrong label, like "Suisse" read as ten metros, shows here).
    print('Pool labels: ' + '; '.join(f"{name} {','.join(me.get(name) or []) or '-'}" for name in ('roles', 'families', 'countries', 'metros')))
    said = []
    kept = employer_index.relevant(index, feeds.wanted_location, kinds, me=me, keep=scored_companies(), said=said)
    for company, label, what in said[:30]:   # each decision, named: "why don't I see Manor's jobs?"
        print(f"Employers: {company} {'left out' if what == 'out' else 'would be left out (shadow mode, still read)'}: "
              f"people doing {label} read it and never found a job there")
    if len(said) > 30:
        print(f'Employers: {len(said) - 30} more like that')
    for_kind = employer_index.relevant(index, feeds.wanted_location, kinds, countries=me.get('countries'))
    in_places = employer_index.relevant(index, feeds.wanted_location)
    if len(for_kind) < len(in_places):   # said once a run: which employers were left out, and why
        print(f'Employers: {len(for_kind)} of {len(in_places)} in your places hire for your kind of role; the others are left out.')
    return kept


def scored_companies():
    """Companies where this user already has a scored job (it matched their search): never left out as quiet, whatever the pool says."""
    try:
        with store.connect(JOBS_DB) as db:
            if not db.execute("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'scores'").fetchone():
                return set()   # nothing scored yet: nothing to protect
            return {row[0] for row in db.execute("""SELECT DISTINCT companies.name FROM jobs JOIN companies ON companies.id = jobs.company_id
                JOIN scores ON scores.job_id = jobs.id""")}
    except Exception as error:  # noqa: BLE001 — no cache or no scores yet: nothing to protect
        print(f'Warning: scored employers not read ({type(error).__name__}): none protected from the quiet rule this run')
        return set()
