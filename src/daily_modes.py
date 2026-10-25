"""The jobs check's single-purpose modes, one function each (src/daily.py main() picks one): import, apply, prepare, kits, add (a pasted
message, or a job link), interview, insight/weekly. Each takes the parsed `args` and the run's store and returns the exit code; every
step reads and writes through the store (a Notion store only when the engine can read it: store_access.notion_ready).
Tests: tests/test_inbox.py, tests/test_inbox_confirm.py, tests/test_added.py, tests/test_interviews.py, tests/test_interview_insights.py,
tests/test_follow_up.py, tests/test_insights.py, tests/test_daily.py.
"""
import json
import os
from html import escape
from pathlib import Path
from . import import_url, store, telegram
from .app_source import APP_SOURCE
from .ai import added, cost, inbox, insights, interview_insights, interviews, kit
from .notion import client as notion, cron_runs, ledger
from .daily_helpers import KITS_DEFAULT, _job_arg, apply_message, for_job_matches, kits_message, log_ai_run, log_text, new_cron_run, prepare_kit, queue_mail_check
from .store_access import notion_ready, open_run, profile_source, url_stages
from . import ledger_store
from .stores import open_stores
from .daily_helpers import log_store_job



def _run_store(stores, message):
    """The run's store (opened here when the caller passed none), or SystemExit(message) when the data is in Notion but Notion can't be
    used: Notion chosen without a token (the store can't open), or a Notion store the engine got no client for (Tracker.from_env:
    JOB_PILOTTO_DISABLE=notion). Exactly the old `not tracker and chosen() == 'notion'`; this Mac's store runs without Notion."""
    if stores is None:
        try:
            stores = open_run()
        except LookupError:
            raise SystemExit(message) from None
    if stores.name == 'notion' and not notion_ready(stores):
        raise SystemExit(message)
    return stores


def _gate(stores, message, on_store):
    """Who may run a mode: a Notion store the engine can read (store_access.notion_ready), or another store when the mode works on it
    (on_store). A Notion store it can't read keeps today's message; another store gets "only with Notion for now" for a mode not moved yet."""
    if stores is not None and stores.name == 'notion' and notion_ready(stores):
        return
    if stores is None or stores.name == 'notion' or not on_store:
        raise SystemExit(message if stores is None or stores.name == 'notion' else
                         message.split(' requires')[0] + ' works only with Notion for now (your data is on this Mac)')

def import_mode(args, stores=None):
    # A link the search has not found: read it, score it, and add it to Job Matches as Open. Not an application.
    if not args.job:
        raise SystemExit('--mode import requires --job <URL> and NOTION_TOKEN')
    _gate(stores, '--mode import requires --job <URL> and NOTION_TOKEN', on_store=True)
    run = new_cron_run('import')
    try:
        with store.connect(args.db) as db:
            outcome = import_url.run(db, _job_arg(args.job), stores=stores, read_profile=profile_source(stores), stats=run)
        reply = outcome['line']
        if outcome.get('row') and outcome.get('created'):
            log_store_job(stores, run, outcome['row'], True)
        run['subject'] = outcome.get('subject') or ''
    except ValueError as error:
        reply = f'⚠️ {error}'
        outcome = {}
    failed = reply.startswith('⚠️')
    run['headline'] = log_text(reply).split('\n')[0][:300]
    if not (failed and not cron_runs.total_usd(run)):
        log_ai_run(stores, run, args, failed=failed)
    print(log_text(reply))
    return 1 if failed else 0


def apply_mode(args, stores=None):
    if not args.job:
        raise SystemExit('--mode apply requires --job and NOTION_TOKEN')
    _gate(stores, '--mode apply requires --job and NOTION_TOKEN', on_store=True)
    with store.connect(args.db) as db:
        reply = apply_message(db, _job_arg(args.job), stores, args.action)
    print(reply)
    # Save/Dismiss are already confirmed on the button itself; only Applied gets a message (Notion link).
    if args.send and args.action == 'applied':
        telegram.send(reply, *telegram.credentials())
    return 0


def prepare_mode(args, stores=None):
    if not args.job:
        raise SystemExit('--mode prepare requires --job and NOTION_TOKEN')
    _gate(stores, '--mode prepare requires --job and NOTION_TOKEN', on_store=True)
    run = new_cron_run('prepare')
    run['kits'] = {}
    drafted = []
    with store.connect(args.db) as db:
        messages, log = prepare_kit(db, _job_arg(args.job), stores, stats=run['kits'], run=run, drafted_out=drafted)
    print(log)
    log_ai_run(stores, run, args)
    print('\n\n'.join(messages))  # the kit is saved in Notion; no Telegram message (owner, 5 Oct 2026: not relevant)
    if drafted:  # the run's card in the app: the job and "nothing sent", on the kits card's shape
        telegram.to_app(kits_message(drafted, 'Drafted for this job · nothing sent'))
    return 0


def kits_mode(args, stores=None):
    # Prepare top matches (the app's Actions page): kits for the best-scored open jobs that have none yet, from the
    # scores already stored. No crawl, no scoring: the same step a search runs after scoring (auto-kit), on demand.
    _gate(stores, '--mode kits requires NOTION_TOKEN', on_store=True)
    run = new_cron_run('kits')
    run['kits'] = {}
    stages = url_stages(stores)
    hidden = frozenset(u for u, st in stages.items() if st not in notion.VISIBLE_STAGES)
    kitted = frozenset(u for u, st in stages.items() if st == 'Kit ready')
    with store.connect(args.db) as db:
        candidates = [j for j in for_job_matches(db, hidden) if (j.get('url') or '').strip() not in kitted]
        summary, drafted = kit.auto_run(db, candidates, stores, kit.DEFAULT_MODEL, args.auto_kit_max or KITS_DEFAULT,
                                        args.auto_kit_min_score, stats=run['kits'])
    print(summary)
    if drafted:
        message = kits_message(drafted)
    else:
        message = (f"No kit to prepare: every open match scoring {args.auto_kit_min_score}+ already has one. "
                   "Run a search for new jobs first.")
    run['headline'] = f'Kits ready: {len(drafted)}' if drafted else 'Kits ready: 0, no new top match'
    run['kit_titles'] = [f"{job['title']} ({job['company']})" for job, _ in drafted]
    print(run['headline'])
    log_ai_run(stores, run, args)
    telegram.to_app(message)  # shown in the app only; kits get no Telegram message (owner, 5 Oct 2026)
    return 0


def add_message_mode(args, stores=None):
    # A pasted message or screenshot (/add <message>, a forward or photo sent to the bot, the app's Log box):
    # the job it's about is updated, or created (src/ai/inbox.py).
    _gate(stores, '--mode add requires NOTION_TOKEN', on_store=True)
    # The inbox, its AI stages (added.hook) and the job it logs take the caller's store alone (src/ai/inbox.py).
    run = new_cron_run('add')
    run['mail'] = {}  # Haiku reading one message: counted with the mail check's cost
    found = {}  # the job it created or updated (inbox.log fills it)
    try:
        image = None
        files = [f for f in (args.file or '').split(',') if f]  # the app sends up to 5 screenshots, comma-separated
        if files and all(Path(f).is_file() for f in files):
            image = [inbox.load_image(f) for f in files[:inbox.MAX_IMAGES]]
        elif args.file:  # a photo or image file sent to the bot
            name, data = interviews.download(telegram.credentials()[0], args.file)
            image = (name, data, inbox.MEDIA.get(Path(name).suffix.lower(), 'image/jpeg'))
        # Where it was added: the app's Log box is the app even when its reply also goes to Telegram (--send).
        source = APP_SOURCE if args.from_app else 'Telegram' if args.send else 'Manual'
        if args.propose:  # the app's step 1: nothing written; the proposal comes back to be confirmed
            # With --reading: the job you picked in the confirmation step (--target), for the same reading (no AI).
            earlier = json.loads(Path(args.reading).read_text(encoding='utf-8')) if args.reading else None
            proposal = inbox.propose(stores, text=args.note or '', image=image, stats=run['mail'], target=args.target,
                                     item=earlier['item'] if earlier else None)
            print(json.dumps({'ok': True, **proposal, 'stats': (earlier.get('stats') or {}) if earlier else run['mail']}, default=str))
            return 0
        proposal = None
        if args.reading:  # step 2: what you confirmed replaces Claude's guesses; no second reading
            saved = json.loads(Path(args.reading).read_text(encoding='utf-8'))
            for key, value in (saved.pop('stats', None) or {}).items():  # the reading's cost counts in this run
                run['mail'][key] = run['mail'].get(key, 0) + value if isinstance(value, (int, float)) else value
            proposal = inbox.confirm(saved, kind=args.kind, channel=args.channel, started=args.started,
                                     other=args.channel_other, interview_at=args.interview_at, company=args.company,
                                     agency=args.agency, last_at=args.last_at,
                                     first_contact=None if args.first_contact is None else args.first_contact == 'yes',
                                     agreed=None if args.agreed is None else args.agreed == 'yes', origin=args.origin)
        reply = escape(inbox.log(stores, text=args.note or '', image=image, source=source,
                                 event_source=APP_SOURCE if args.from_app else 'Telegram' if args.send else 'CLI',
                                 talking=args.action == 'talking', stats=run['mail'], target=args.target,
                                 on_new=added.hook(stores, args.db, run), proposal=proposal, found=found))
        run['mail'].update(pending=1, done=1)
        queue_mail_check()
    except ValueError as error:
        reply = f'⚠️ {escape(str(error))}'
    failed = reply.startswith('⚠️')  # nothing was logged: the run says so ("had problems", not "done")
    if found.get('row') and not reply.startswith(('⚠️', 'ℹ️')):  # a job created or updated: the run links to it
        # found['row'] is the job's record (src/ai/inbox.py): the run's "Job logged:" line names it as its page shows it ("Principal SRE ·
        # via Huxley" for an Inbound row) and links it, on every store (tests/test_daily_store_notion.py JobLoggedOnNotionTests).
        log_store_job(stores, run, found['row'], found['created'])
    run['headline'] = log_text(reply).split('\n')[0][:300]  # the run's result line (⏱️ Search runs, Recent activity)
    # Turned away before any AI call (too short, no key): the dialog says why; that's no run, so no row.
    if not (failed and not cron_runs.total_usd(run)):
        log_ai_run(stores, run, args, failed=failed)
    print(log_text(reply))  # the log (and the app) get plain text; Telegram gets the HTML
    if args.send:
        telegram.send(reply, *telegram.credentials())
    return 1 if failed else 0


def add_link_mode(args, stores=None):
    # /add <job URL> [date]: track an application made outside Jobadabra.
    _gate(stores, '--mode add requires --job <URL> and NOTION_TOKEN', on_store=True)
    run = new_cron_run('add')
    found = {}  # the job it created or updated (ledger.add_application fills it)
    try:
        applied, approx = ledger.parse_applied(args.note)
        meta = ledger.page_meta(args.job)
        given = {'title': args.job_title, 'company': args.job_company, 'description': args.job_text}
        meta.update({key: value.strip() for key, value in given.items() if value and value.strip()})
        meta['company'] = ledger_store.company_for(stores, args.job, meta)
        with store.connect(args.db) as db:
            # The same AI stages as a found job (facts, fit score) before the record is frozen: the fit columns
            # go on its Applications row (meta['application_columns'], no Job Matches row), so the application
            # record carries them too. AI trouble never blocks tracking it.
            fit = None
            try:
                fit = added.process(db, args.job, meta, stats=run, stores=stores)
            except Exception as error:  # noqa: BLE001
                print(f'Warning: AI stages skipped: {type(error).__name__}: {error}')
            reply = '📥 ' + escape(ledger_store.add_application(stores, args.job, applied=applied, approx=approx, source='Telegram',
                                                               meta=meta, found=found, origin=args.origin))
            if fit:
                reply += f' · {escape(fit)}'
            if ledger.walled(args.job) and not meta.get('description'):
                reply += ('\nℹ️ That page showed a sign-in page instead of the posting. For the fit score and facts, send me a screenshot of '
                          'the job posting too, or add it in the app with its text.')
            elif not fit and not (meta.get('description') or '').strip():
                reply += ('\nℹ️ The posting text could not be read, so it is not scored yet. Add its text (the app asks for it) '
                          'for the fit score and facts.')
            # The app's Jobs list shows it too, as Applied (the local cache of the Applications row just written).
            store.track_applied(db, args.job, meta)
        queue_mail_check()
    except ValueError as error:
        reply = f'⚠️ {escape(str(error))}'
    failed = reply.startswith('⚠️')  # nothing was logged: the run says so ("had problems", not "done")
    if found.get('row') and not reply.startswith(('⚠️', 'ℹ️')):  # a job created or updated: the run links to it
        log_store_job(stores, run, found['row'], found['created'])
    run['headline'] = log_text(reply).split('\n')[0][:300]  # the run's result line (⏱️ Search runs, Recent activity)
    # Turned away before any AI call (too short, no key): the dialog says why; that's no run, so no row.
    if not (failed and not cron_runs.total_usd(run)):
        log_ai_run(stores, run, args, failed=failed)
    print(log_text(reply))  # the log (and the app) get plain text; Telegram gets the HTML
    if args.send:
        telegram.send(reply, *telegram.credentials())
    return 1 if failed else 0


def interview_mode(args, stores=None):
    stores = _run_store(stores, '--mode interview requires NOTION_TOKEN')
    # Telegram only to send the summary or fetch a file sent to the bot; the app's reviews work without it.
    from_bot = bool(args.file) and not Path(args.file).is_file()
    token, chat_id = telegram.credentials() if args.send or from_bot else (None, None)
    sender = (lambda text: telegram.send(text, token, chat_id, urgent=True)) if args.send else None   # an interview review is answered at once, never held for a batch
    run = new_cron_run('interview')
    run['interview'] = {}
    reviewed = {}  # the job the interview is linked to, once known (interviews.run fills it)
    try:
        result = interviews.run(file_id=args.file, note=args.note, token=token, send=sender,
                                stats=run['interview'], job_url=args.job, page_id=args.interview, found=reviewed, stores=stores)
        if reviewed.get('application'):
            run['application'] = reviewed['application']  # the run links to the job it was for
        run['subject'] = reviewed.get('title', '')  # the run's title names the interview ("Huxley · Recruiter screen")
        run['headline'] = result.split(' https://')[0]
        print(result)
        run['interview'].update(pending=1, done=1)
        # The Interviews page's insights follow each saved review (event-driven; skipped when nothing changed).
        # Its cost is on this run's row ('insight'); a failure there never fails the review.
        run['insight'] = {}
        if result.startswith('Interview analysed again'):  # "Review again" is one AI call; Refresh updates insights
            print('Interview insights: not refreshed after a review again (Refresh on the Interviews page)')
        else:
            print(interview_insights.after_review(stats=run['insight'], stores=stores))
        log_ai_run(stores, run, args)
    except ValueError as error:  # the owner sent something that can't be analysed: say why
        print(error)
        if sender:
            sender(f'⚠️ {escape(str(error))}')
        _close_unreviewed(stores, run, args, f'Not reviewed: {error}', 'Interview not reviewed')
    except Exception as error:
        if not cost.limit_reached(error):
            raise
        run_url = f"{os.getenv('GITHUB_SERVER_URL', 'https://github.com')}/{os.getenv('GITHUB_REPOSITORY', '')}/actions/runs/{os.getenv('GITHUB_RUN_ID', '')}"
        message = cost.limit_message(error, 'the interview review', retry=(
            ' Your transcript is kept: after raising it, send it again, or re-run '
            f'<a href="{escape(run_url, quote=True)}">this run</a>.' if os.getenv('GITHUB_RUN_ID') else ''))
        print(message)
        if sender:
            sender(message)
        _close_unreviewed(stores, run, args, f'AI limit reached: {cost.limit_reason(error)}', 'Interview review paused')
    return 0


def _close_unreviewed(stores, run, args, reason, headline):
    """A review that ends without a result still closes its run row, with the reason as a warning: left open, the end-of-process guard
    (run_log._unfinished) wrote it as Failed, "ended before its report", for a transcript that was too short or an AI limit (Sentry APP-5)."""
    run['warnings'].append(reason[:300])
    run['headline'] = headline
    log_ai_run(stores, run, args)


def insight_mode(args, stores=None):
    stores = _run_store(stores, f'--mode {args.mode} requires NOTION_TOKEN')
    sender = (lambda text, markup: telegram.send(text, *telegram.credentials(), markup)) if args.send else telegram.to_app
    with store.connect(args.db) as db:
        make = insights.run if args.mode == 'insight' else insights.weekly
        run = new_cron_run(args.mode)
        run['insight'] = {}
        try:
            run['headline'] = make(db, stores, send=sender, stats=run['insight'],
                                   **({'force': True} if args.mode == 'insight' else {})) or \
                ('No new insight: nothing worth saying today' if args.mode == 'insight' else 'Weekly report: nothing to report')
            run['subject'] = insights.category_of(run['headline']) if args.mode == 'insight' else ''
            print(run['headline'])
            log_ai_run(stores, run, args)
        except Exception as error:
            if not cost.limit_reached(error):
                raise
            message = cost.limit_message(error, f'the {args.mode} report')
            print(message)
            if args.send:
                telegram.send(message, *telegram.credentials())
            else:
                telegram.to_app(message)
            # Closed here as a warning that names the limit: left open, the end-of-process guard wrote the row as Failed ("Insight failed") while the run exited 0.
            reason = f'AI limit reached: {cost.limit_reason(error)}'
            print(reason)
            run['warnings'].append(reason)
            run['headline'] = f"{'Insight' if args.mode == 'insight' else 'Weekly report'} paused"
            log_ai_run(stores, run, args)
    return 0
