"""Employer feedback loop. The store holds the status, verbatim feedback and timeline (events); no AI or email sending.

act / save_received work on the active store (the app's buttons, `python -m src.feedback <id> <action>`, the Gmail check).
No Notion here: the Notion ledger reads a row's history itself (src/notion/ledger.py). Guarded by tests/test_feedback.py.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json

from .app_source import APP_SOURCE
from .notion.ledger import moment

REACHED = {'Screening', 'Interview scheduled', 'Interviewing', 'Offer'}
REQUESTED, RECEIVED, REVIEWED, SKIPPED = ('Feedback requested', 'Feedback received', 'Feedback reviewed', 'Feedback skipped')
STATUSES = {REQUESTED: 'Asked for feedback', RECEIVED: 'Received feedback',
            REVIEWED: 'Received feedback', SKIPPED: 'Skipped'}


def _moment(value):
    return value.astimezone(timezone.utc) if isinstance(value, datetime) else moment(value)


def eligible_status(status, history=()):
    """A recorded Screening or later, before rejection. Replies/assessments alone are not proof. history: events with
    'kind' and 'at' (store records, or history_for's)."""
    from .features import disabled
    if disabled('feedback'):
        return False
    if status == 'Not asked':
        return True  # the prior stage was captured when the rejection arrived
    rejected = [_moment(e.get('at')) for e in history if e.get('kind') == 'Rejected']
    cutoff = min(rejected) if rejected else datetime.max.replace(tzinfo=timezone.utc)
    return any(e.get('kind') in REACHED and e.get('at') and _moment(e.get('at')) <= cutoff for e in history)


def draft(row):
    return ('Thank you for your time and consideration.\n\n'
            'Could you share what mainly influenced the decision? '
            'Compensation expectations, technical fit, communication, or something else?\n\n'
            'Even a few words would be really helpful.')


def save_received(stores, app, text):
    """The employer's words on the application (store record `app`), kept apart from AI guesses; every reply is
    preserved. Returns the updated record (unchanged when feedback is switched off)."""
    text = (text or '').strip()
    from .features import disabled
    if disabled('feedback'):
        return app
    if not text:
        raise ValueError('Paste the feedback you received first.')
    previous = app.get('employer_feedback') or ''
    combined = previous if text in previous else '\n\n'.join(filter(None, [previous, text]))
    if len(combined) > 100_000:
        raise ValueError('Feedback is too long; save a shorter excerpt.')
    # A previous AI assessment must be reconsidered against the employer's actual words.
    return stores.applications.update(app['id'], {'employer_feedback': combined, 'feedback_status': STATUSES[RECEIVED],
                                                  'rejection': '', 'rejection_lesson': ''})


def act(stores, app, action, text=''):
    """The app's feedback buttons on one application (its store record): request, receive (pasted words), review,
    skip. Each logs its event once; a repeated click writes nothing."""
    from . import ledger_store
    from .features import disabled
    if disabled('feedback'):
        raise ValueError('Employer feedback is disabled in your settings.')
    history = stores.events.list(app_id=app['id'])
    if action in ('request', 'skip') and app.get('stage') != 'Rejected':
        raise ValueError('This feedback follow-up is for a rejected application.')
    if action in ('request', 'skip') and not eligible_status(app.get('feedback_status'), history):
        raise ValueError('Only rejections after Screening or a later stage need a feedback request.')
    kind = {'request': REQUESTED, 'receive': RECEIVED, 'review': REVIEWED, 'skip': SKIPPED}[action]
    existing = [e for e in history if e['kind'] == kind]
    if action in ('request', 'skip') and existing:
        return  # a repeated click must not create another request/review
    if action == 'review' and existing:
        latest_review = max(moment(e['at']) for e in existing)
        latest_received = max((moment(e['at']) for e in history if e['kind'] == RECEIVED), default=latest_review)
        if latest_review >= latest_received:
            return
    if action in ('request', 'skip') and app.get('feedback_status') in ('Received feedback', 'Asked for feedback'):
        raise ValueError('Feedback was already requested or received; refresh the job.')
    if action == 'receive':
        seed = 'feedback:' + hashlib.sha256(text.strip().encode()).hexdigest()[:24]
        if any(e['source_id'] == seed for e in history):  # the same words pasted twice on this job
            return
        app = save_received(stores, app, text)
        event = ledger_store.add_event(stores, app, kind, APP_SOURCE, note=text[:1900])
        stores.events.update(event['id'], {'source_id': seed})
    else:
        if action == 'review' and not app.get('employer_feedback'):
            raise ValueError('There is no employer feedback to review yet.')
        app = stores.applications.update(app['id'], {'feedback_status': STATUSES[kind]})
        ledger_store.add_event(stores, app, kind, APP_SOURCE, note={
            'request': 'You sent a feedback request (confirmed in the desktop app).',
            'review': 'You reviewed the employer feedback.', 'skip': 'You chose not to request feedback.'}[action])


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('page_id')
    parser.add_argument('action', choices=('request', 'receive', 'review', 'skip'))
    parser.add_argument('--text', default='')
    args = parser.parse_args(argv)
    from .stores import open_stores
    stores = open_stores()
    try:
        app = stores.applications.by_id(args.page_id)
        if not app:
            raise ValueError('This job is no longer in your tracker; refresh the list.')
        act(stores, app, args.action, args.text)
        print(json.dumps({'ok': True}))
    except ValueError as error:
        print(json.dumps({'ok': False, 'error': str(error)}))
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
