"""The daily insight and weekly report, what they read: the owner's applications with their outcomes, the funnel, the
interviews, the recent insights and the week's events, from the active store (src/stores: SQLite on this Mac, or
Notion), never from Notion directly. Plain records in, plain numbers out; no AI.
Used by src/ai/insights.py (and learning.py's evidence). Tests: tests/test_insights.py, tests/test_insights_store.py.
"""
from collections import Counter, defaultdict
from datetime import date, timedelta

from ..notion import funnel
from ..notion.ledger import OUTCOME_STAGES, REPLY
from ..notion.origin import INBOUND, origin

INTERVIEW_STAGES = {'Screening', 'Interview scheduled', 'Interviewing', 'Offer'}
# Any of these means a human answered: the basis for reply rate and time to first reply.
RESPONSE_KINDS = INTERVIEW_STAGES | {REPLY, 'Rejected'}
INTERVIEW_PATTERNS = 'Interview patterns'  # interview_insights.CATEGORY: one row updated in place, not a daily insight
WEEKLY = 'Weekly report'
# The daily insight's categories (its schema's enum, src/ai/insights.py). With WEEKLY, the only 💡 Insights rows that are findings.
CATEGORIES = ['Skills', 'CV', 'Location', 'Salary', 'Seniority', 'Role focus', 'Timing', 'Activity', 'Process']


def is_finding(record):
    """A daily insight or weekly report. Why (28 Oct 2026, #insights PR 1a): other rows share the store (Interview patterns, a
    person's answer to a suggestion); a reader that excluded only Interview patterns took an answer for today's insight."""
    return (record or {}).get('category') in (*CATEGORIES, WEEKLY)


# A person's answer to a computed suggestion (Not now / Not true on Tune, Analyze now; src/suggestions.py): a row of its own, never shown as an insight.
ANSWER_CATEGORY = 'Suggestion'


def is_answer(record):
    """A person's Not now / Not true on a computed suggestion, kept as a row of its own."""
    return (record or {}).get('category') == ANSWER_CATEGORY


MIN_GROUP = 10


def key(record_id):
    """An id as every store's records compare it (Notion ids come with and without dashes)."""
    return (record_id or '').replace('-', '')


def events_by_app(stores):
    """{app key: [event, …]} oldest first."""
    found = defaultdict(list)
    for event in sorted(stores.events.list(), key=lambda e: e.get('at') or ''):
        found[key(event['app_id'])].append(event)
    return found


def _share(n, total):
    return f'{n}/{total} ({round(100 * n / total)}%)' if total else '0/0'


def _outcome(stage, kinds):
    if stage in INTERVIEW_STAGES or kinds & INTERVIEW_STAGES:
        return 'interview'
    if stage == 'Rejected':
        return 'rejected'
    if stage == 'Withdrawn':
        return 'withdrawn'
    if REPLY in kinds:
        return 'replied'
    if stage == 'No response':
        return 'no_response'
    return 'waiting'


def _number(value):
    return None if value in ('', None) else value


def region(location):
    from .insights import region as by_place
    return by_place({'location': location or ''})


def application_stats(stores, now):
    """The owner's applications with outcomes, and reply rates per group (flagged when small)."""
    rows = stores.applications.list(stages=list(OUTCOME_STAGES))
    kinds, first_reply = defaultdict(set), {}
    for app_key, events in events_by_app(stores).items():
        for event in events:
            kind, at = event.get('kind') or '', (event.get('at') or '')[:10]
            kinds[app_key].add(kind)
            if kind in RESPONSE_KINDS and at and (app_key not in first_reply or at < first_reply[app_key]):
                first_reply[app_key] = at
    apps = []
    for row in rows:
        applied = (row.get('applied_on') or '')[:10]
        app_key = key(row['id'])
        replied_after = ((date.fromisoformat(first_reply[app_key]) - date.fromisoformat(applied)).days
                         if app_key in first_reply and applied else None)
        score, days = _number(row.get('fit')), _number(row.get('days_to_apply'))
        apps.append({'outcome': _outcome(row.get('stage'), kinds[app_key]), 'applied': applied, 'days_to_reply': replied_after,
                     'Channel': row.get('channel') or 'unknown', 'Seniority': row.get('seniority') or 'unknown',
                     'Work mode': row.get('work_mode') or 'unknown', 'ATS': row.get('ats') or 'unknown',
                     'Tier': row.get('tier') or 'unknown', 'Region': region(row.get('location')),
                     'Fit score': ('>=70' if score >= 70 else '<70') if score else 'unknown',
                     'Days to apply': ('<=3' if days <= 3 else '>3') if days is not None else 'unknown',
                     'Cover letter': 'yes' if row.get('cover_letter') else 'no',
                     'Recruiter': 'yes' if row.get('recruiter') else 'no'})
    decided = [a for a in apps if a['outcome'] != 'waiting']
    groups = {}
    for group in ('Channel', 'Region', 'Seniority', 'Work mode', 'ATS', 'Tier', 'Fit score', 'Days to apply',
                  'Cover letter', 'Recruiter'):
        table = defaultdict(Counter)
        for app in apps:
            table[app[group]][app['outcome']] += 1
        groups[group] = {value: dict(c, n=sum(c.values()), too_small=sum(c.values()) < MIN_GROUP)
                         for value, c in table.items()}
    dates = sorted(a['applied'] for a in apps if a['applied'])
    week, month = (now - timedelta(days=7)).date().isoformat(), (now - timedelta(days=30)).date().isoformat()
    return {
        'applications': len(apps), 'outcomes': dict(Counter(a['outcome'] for a in apps)),
        'interview_rate_of_decided': _share(sum(a['outcome'] == 'interview' for a in decided), len(decided)),
        'reply_rate_of_all': _share(sum(a['outcome'] in ('interview', 'rejected', 'replied') for a in apps), len(apps)),
        'days_to_first_reply': sorted(a['days_to_reply'] for a in apps if a['days_to_reply'] is not None),
        'applied_last_7_days': sum(d >= week for d in dates), 'applied_last_30_days': sum(d >= month for d in dates),
        'days_since_last_application': (now.date() - date.fromisoformat(dates[-1])).days if dates else None,
        'by_group': groups, 'min_group_for_conclusions': MIN_GROUP,
        'funnel': funnel_stats(stores),
    }


def reached(stores):
    """funnel.reached() on the store: per outbound application, the stages and event kinds it has reached."""
    return funnel.reached(stores)


def funnel_stats(stores):
    """Conversion between funnel steps, for the model (the same numbers as the 🎯 Pipeline page)."""
    steps = funnel.funnel(reached(stores))
    return {'steps': [{k: s.get(k) for k in ('step', 'reached', 'waiting', 'conversion', 'decided', 'decided_conversion',
                                              'benchmark')} for s in steps],
            'summary': funnel.summary(steps)}


def recent_insights(stores, today, days=45):
    since = (today - timedelta(days=days)).isoformat()
    items = [i for i in stores.insights.list(since=since) if not is_answer(i)]   # the prompt's history as before, without answers
    return [{'date': i['day'], 'category': i['category'], 'headline': i['title'], 'feedback': (i['fields'] or {}).get('feedback')}
            for i in sorted(items, key=lambda i: i['day'] or '')]


def sent_today(stores, today):
    """A daily insight or weekly report saved today (the Interview patterns row, updated after every review, is not one)."""
    return any(i['day'] == today.isoformat() and is_finding(i)
               for i in stores.insights.list(since=today.isoformat()))


def week_stats(stores, now):
    """The last 7 days: outcome events and the daily insights with their feedback."""
    since = (now - timedelta(days=7)).date().isoformat()
    events = [{'kind': e.get('kind'), 'at': (e.get('at') or '')[:10], 'event': e.get('note'), 'source': e.get('source')}
              for e in stores.events.list() if (e.get('at') or '')[:10] >= since and e.get('source') != 'Backfill']
    return {'events_last_7_days': sorted(events, key=lambda e: e['at']),
            'event_counts': dict(Counter(e['kind'] for e in events)),
            'insights_last_7_days': [i for i in recent_insights(stores, now.date(), days=7) if i['category'] != WEEKLY]}


def interview_stats(stores):
    """Interview topics across all reviewed interviews, for the daily insight and weekly report."""
    rows = sorted((r for r in stores.interviews.list() if r.get('overall')), key=lambda r: r.get('at') or '')
    split = lambda value: [t.strip() for t in (value or '').split(';') if t.strip()]
    topics, weak = Counter(), Counter()
    for row in rows:
        topics.update(split(row.get('topics')))
        weak.update(split(row.get('weak_topics')))
    top = lambda counts: dict(sorted(counts.items(), key=lambda kv: -kv[1])[:15])
    return {'interviews': len(rows), 'overall': {k: sum(r.get('overall') == k for r in rows) for k in ('positive', 'neutral', 'negative')},
            'topics_asked': top(topics), 'topics_answered_weakly': top(weak),
            'rounds': [f"{r.get('at')} · {r.get('title')} · {r.get('overall')}" for r in rows][-10:]}
