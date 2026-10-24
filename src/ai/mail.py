#!/usr/bin/env python3
"""Gmail + Calendar -> the application ledger, read-only.

Each run (3 times a day by default, and 5 minutes after an application is marked Applied):

1. **Gmail**: searches recent mail from applicant-tracking systems, recruiter platforms and booking
   tools, plus mail naming a tracked company or role. Claude Haiku 5.5 classifies each new email
   (confirmation, reply, interview scheduled, rejection, offer, or not about an application) and
   matches it to an application. A recruiter pitching a new role ("Recruiter outreach") becomes a tracked
   recruiter lead (src/ai/opportunity.py: Applications row at Stage Recruiter lead, the message in its page,
   a Telegram line); their follow-ups then match it like any application. Matches become 📈 Application Events at the email's own time
   (Source Gmail, Source ID = message id, so an email is never logged twice), move Stage forward
   (never back), and fill Next interview when a time is stated. An event logged by hand for the same
   application, kind and day is linked to the email instead of duplicated.
2. **Calendar**: upcoming events that belong to an application (company, platform, or a contact's
   email among the attendees) set Next interview and an Interview scheduled event. The evening
   before (and the morning of) an interview, Telegram gets a prep message; a few hours after it,
   a nudge to send the transcript for an interview review.

A Telegram summary lists what changed. Nothing in Gmail or Calendar is modified.

Usage:
  python -m src.ai.mail [--days 2] [--send] [--dry-run] [--no-calendar]
"""
import argparse
from datetime import datetime, timezone
from html import escape
import sys

from .. import run_log, telegram, tgcard
from ..sources.google import Google
from ..sources.google_scopes import CALENDAR, GMAIL, PART_NAMES, WHAT_IT_LOSES, MissingScope
from ..stores import open_stores
from . import cost
from .. import feedback as employer_feedback

from .mail_config import (  # noqa: F401 — re-exported: callers and tests use `mail.<name>`
    BATCH, DEFAULT_MODEL, INVITES, INVITE_MAILS, KINDS, LINKEDIN_SENDERS, OUTREACH, RANK, RECRUITER_DOMAINS, SCHEMA,
    SENDER_DOMAINS, STATE_FILE, SYSTEM, TERMINAL, TZ, YOU_REPLIED,
)
from .mail_read import (  # noqa: F401 — re-exported: callers and tests use `mail.<name>`
    _field, _role, _unread_invitation, _when, applications, classify, extra_query, ledger_key, listing, load_state, query,
    save_state, verified_feedback,
)
from .mail_record import (  # noqa: F401 — re-exported: callers and tests use `mail.<name>`
    MOVED, MOVED_FIELDS, _events_index, _moment, _near, _plain, _stage_for, _value, advance,
    changes_of, changes_readable, gmail_link, record,
)
from .mail_lines import (  # noqa: F401 — re-exported: callers and tests use `mail.<name>`
    EMOJI, EVENT_KIND, SHORT_KIND, _head, _label, _short, _who, ask,
)
from .mail_match import (  # noqa: F401 — re-exported: callers and tests use `mail.<name>`
    ENDED, PLATFORMS, STOP, _about_tracked, _ambiguous, _by_mention, _contact_names, _event_text, _matches, _names_it,
    _names_person, _same_person, _sender_org, person_name,
)
from .mail_leads import (  # noqa: F401 — re-exported: callers and tests use `mail.<name>`
    TRACKABLE, _from_email, interview_lead, new_lead,
)
from .mail_inbox import (  # noqa: F401 — re-exported: callers and tests use `mail.<name>`
    mail_pass, without_ai,
)
from .mail_sent import (  # noqa: F401 — re-exported: callers and tests use `mail.<name>`
    EMAIL, SENT_MAX, contacts, review_rejections, sent_pass, sent_query,
)
from .mail_calendar import (  # noqa: F401 — re-exported: callers and tests use `mail.<name>`
    calendar_pass, prep_message, reminders, reviewed_since,
)
from .mail_failure import (  # noqa: F401 — re-exported: callers and tests use `mail.<name>`
    NOT_CHECKED, NOT_CHECKED_OPENAI, failure_cause, failure_warning, not_checked,
)


def _allowed(google, part):
    """False when the user left this part of the Google sign-in unticked (unknown = allowed until Google refuses)."""
    granted = getattr(google, 'scopes', None)
    return granted is None or part in granted


def run(tracker, google, *, client=None, model=DEFAULT_MODEL, days=2, send=None, calendar=True, dry_run=False,
        now=None, state_path=STATE_FILE, stats=None, on_new=None, always_report=False, stores=None):
    """always_report: a check answers even when there's nothing new. Off for the mail workflow, which the app
    dispatches for "Check Gmail now": a quiet check says so in the app and on its ⏱️ Search runs row, and a
    Telegram message for every check someone started is noise (1 Oct 2026).
    stores: the active store (src/stores); by default the one open_stores() picks, on `tracker` when one is given."""
    stores = stores or open_stores(tracker=tracker)
    state = load_state(state_path, ledger_key(stores))
    apps = applications(stores)
    index = _events_index(stores)
    if client is None:
        from . import engine
        client = engine.client(action='mail')
    rejected = []
    lines, count, notes, gaps = [], 0, [], []   # gaps: parts the user left unticked; each is said once and the other part still runs
    if _allowed(google, GMAIL):
        print('Gmail: reading new emails…')
        try:
            lines, count = mail_pass(stores, google, client, model, apps, index, state, days, stats, dry_run, now, rejected,
                                     None if dry_run else on_new)
            if stats is not None:
                stats.update(pending=count, done=count)
            sent_pass(stores, google, apps, index, days, stats, dry_run)  # your own replies: for Focus's follow-ups
        except MissingScope as gap:
            gaps.append(gap)
    else:
        gaps.append(MissingScope(GMAIL))
    if calendar and _allowed(google, CALENDAR):
        print('Gmail: checking the calendar…')
        try:
            cal_lines, notes = calendar_pass(stores, google, client, model, apps, index, state, stats, now, dry_run)
            lines += cal_lines
        except MissingScope as gap:
            gaps.append(gap)
    elif calendar:
        gaps.append(MissingScope(CALENDAR))
    for gap in gaps:   # the part's own line in the log, the run row and the app; the part that was allowed keeps its results
        print(f'Gmail: {PART_NAMES[gap.part]} was not allowed in the Google sign-in, so {WHAT_IT_LOSES[gap.part]}. '
              'Settings → Connections → Gmail & Calendar → Reconnect.')
        if stats is not None:
            stats.setdefault('gaps', []).append(failure_warning(gap))
    if not dry_run:
        save_state(state, state_path)
        lines += review_rejections(stores, client, rejected, stats)
    if send and lines:
        send(tgcard.card('Job emails & calendar', f"{len(lines)} update{'s' if len(lines) != 1 else ''}", lines, emoji='📧'))
    elif send and always_report and not notes:
        send(tgcard.card('Gmail checked', f'{count} new email{"s" if count != 1 else ""}' if count else 'No new job emails',
                         ['Nothing that changes your applications.'] if count else [], emoji='📧'))
    for note in notes:
        if send:
            send(note)
    if (stats or {}).get('updates') and not dry_run:  # one short line each, for the desktop app's activity panel
        print('Updates:')
        for line in stats['updates']:
            print(line)
    usd = (stats or {}).get('usd', 0.0)
    return f'Mail: {count} new email(s) classified, {len(lines)} update(s), {len(notes)} reminder(s) (${usd:.3f})'


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--days', type=int, default=2, help='how far back to search Gmail')
    parser.add_argument('--send', action='store_true', help='send the summary and reminders to Telegram')
    parser.add_argument('--dry-run', action='store_true', help='classify and print; write nothing')
    parser.add_argument('--no-calendar', action='store_true')
    parser.add_argument('--always-report', action='store_true',
                        help='with --send: answer even when nothing is new (a check someone started)')
    parser.add_argument('--log-run', action='store_true',
                        help='log this check to Notion ⏰ Search runs even without --send (the desktop app always does)')
    args = parser.parse_args(argv)
    google = Google.from_env()
    if not google:
        print('Gmail + Calendar is off: Google is not connected or JOB_PILOTTO_DISABLE includes mail. '
              'See README → Gmail and Calendar.')
        return 0
    stores = open_stores()  # the active store: this Mac's (sqlite) or Notion; JOB_PILOTTO_STORE picks it
    sender = None
    from ..features import disabled
    if args.send and not disabled('telegram'):
        token, chat_id = telegram.credentials()
        sender = lambda text: telegram.send(text, token, chat_id)
    stats = {}
    logged = (args.send or args.log_run) and not args.dry_run
    if logged:
        run_log.auto_begin(stores)  # the check's run row opens when it starts, on any store
    log = run_log.new_run('mail')

    def log_check(warning=None):  # one ⏰ Search runs row per check: what it read, what it recorded, the cost
        log['mail'] = {key: value for key, value in stats.items() if key not in ('updates', 'emails', 'gaps')}
        log['updates'] = stats.get('updates', [])
        log['emails'] = stats.get('emails', [])  # every email read: its subject, its link, and what the check did with it
        log['seconds'] = int((datetime.now(timezone.utc) - datetime.fromisoformat(log['started_at'])).total_seconds())
        log['warnings'] += stats.get('gaps', [])   # a part left unticked: said on the run row, the rest of the check is kept
        if warning:
            log['warnings'].append(warning)
        url = run_log.log_run(stores, log)
        if url:
            print(f'Cronjob run logged: {url}')

    try:
        from ..paths import JOBS_DB
        from . import added  # jobs tracked from an email get facts and a fit score, like found ones
        print(run(None, google, days=args.days, send=sender, calendar=not args.no_calendar, dry_run=args.dry_run,
                  stats=stats, on_new=added.hook(stores, JOBS_DB, log),
                  always_report=args.always_report, stores=stores))
        if logged:
            log_check()
    except Exception as error:  # noqa: BLE001 — a spend limit is expected, not a crash
        from .. import run_result
        # Noted before the run row is written, so the result file carries the code and not only the sentence.
        if failure_cause(error):
            run_result.note_mail(failure_cause(error))
        if logged:
            log_check(failure_warning(error))
        if 'invalid_grant' in str(error):
            message = ('⚠️ The Google sign-in for Gmail and Calendar has expired (Google limits apps in testing mode '
                       'to 7 days). On the Mac, in the repo, run: python3 -m src.sources.google auth --github '
                       '(add --client-json <file> if you use your own Google app)')
            print(message)
            if sender:
                sender(escape(message))
            return 0
        if cost.cli_limit(error):  # the user's Claude Code: its plan's usage window, or it is signed out
            print(f'Mail check skipped: {error}')
            return 0
        if cost.limit_reached(error):
            print(f'Mail check skipped: the Anthropic API spend limit is reached ({error}). '
                  'Raise it in the Anthropic console, or it resumes when the limit resets.')
            return 0
        raise
    return 0


if __name__ == '__main__':
    sys.exit(main())