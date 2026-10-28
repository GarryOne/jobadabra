"""Focus's Suggestions: the pool of calls to action that can wait, from the engine's producers, with the person's answers applied.

Spec: docs/superpowers/specs/2026-10-28-insights-with-actions-design.md (PR 1a). Up next keeps only what can't wait (UP_NEXT);
every other call to action is an entry here. Counts and saved rows only: no AI call (the weekly report's own call picks its door).

One entry, the producer interface every screen draws (Focus Suggestions, the Jobs bar, its home):
  {kind, home, topic, strength, source, title, detail, evidence: [str], actions: [{label, do}], key, row_id, answers}
- key: the evidence it rests on. An answer is kept against it in 💡 Insights (State, Hidden until): on its own row for a finding
  (today's insight, the weekly report), else in a row of ANSWER_CATEGORY whose Input hash is the key.
- actions[].do: what the app does in one press (renderer/suggestions.js maps each to its handler).
Guarded by tests/test_suggestions.py; the screens by desktop/test/suggestions.test.js.
"""
from datetime import date, datetime, timedelta
import json
import re

from .ai.insights_data import ANSWER_CATEGORY, WEEKLY, is_finding
from .focus_items import _field, _role, _short, _when
from .notion.ledger import EVENT_KINDS, REPLY

PRODUCERS = ('insight', 'rejection', 'week', 'analyze', 'tune', 'places', 'ideas', 'coverage', 'filters', 'visits', 'pay')   # the last six: suggestions_search.py, suggestions_pay.py
HOMES = ('focus', 'jobs', 'strategy', 'profile', 'interviews')
TOPICS = ('search', 'applying', 'profile', 'interviews')
STRENGTH = {'insight': 100, 'rejection': 95, 'week': 90, 'analyze': 80, 'tune': 70,   # PR 6 ranks by evidence; until then by kind
            'places': 60, 'ideas': 58, 'coverage': 56, 'filters': 54, 'pay': 52, 'visits': 50}   # Strategy's order: Tune, then these
NOT_NOW_DAYS = 14   # owner, 28 Oct 2026 (sketch Jpf5gETGzQsee5WoaTKZXy)
FRESH_DAYS = 7      # today's insight and Your week stay this long, as Focus's Insight card did
# Up next holds only what can't wait (owner, 28 Oct 2026: "very important, that cannot wait"); "waiting" has no button and leaves Focus.
UP_NEXT = {'offer', 'book', 'reply', 'prepare', 'follow_up'}
DROPPED = {'waiting'}
ITEM_TOPICS = {'happened': 'interviews', 'review': 'interviews', 'feedback': 'interviews', 'feedback_wait': 'interviews',
               'feedback_review': 'interviews', 'learn': 'interviews', 'which_job': 'applying', 'details': 'applying',
               'nudge': 'applying', 'apply': 'applying'}
CATEGORY_TOPICS = {'Skills': 'profile', 'CV': 'profile', 'Location': 'search', 'Salary': 'search', 'Seniority': 'search',
                   'Role focus': 'search', 'Timing': 'applying', 'Activity': 'applying', 'Process': 'applying'}
# Analyze now, between Mondays (spec: "only when enough happened since the last analysis"; owner, 28 Oct 2026).
ANALYZE_AFTER = 10   # new applications and outcomes since the last analysis
MIN_GAP_DAYS = 2     # an analysis this fresh is not offered again
QUIET_APPLIED, QUIET_WINDOW_DAYS, QUIET_DAYS = 8, 14, 10   # replies stopped: 8+ applications in 14 days, no human reply for 10
HUMAN = {REPLY, 'Screening', 'Interview scheduled', 'Interviewing', 'Offer'}
# The weekly report's door (src/ai/insights_text.py WEEKLY_SCHEMA): only what the app carries out in one press. Why (owner, 28 Oct 2026):
# a button that opens a screen for the person to finish by hand "is noise"; none fits → "Read the week".
DOORS = ('find_jobs', 'tune', 'tailor', 'prep')
DOOR_LABEL_MAX = 40


def place(kind):
    """Where a Focus item is drawn: 'up_next', 'suggestions', or None (left out)."""
    return None if kind in DROPPED else 'up_next' if kind in UP_NEXT else 'suggestions'


def item_topic(kind):
    """A Focus item's topic (which Jobs bar shows it: search and applying)."""
    return ITEM_TOPICS.get(kind, 'applying')


def hidden_until(now):
    """The day a Not now ends (an ISO date)."""
    return (now + timedelta(days=NOT_NOW_DAYS)).date().isoformat()


def _entry(kind, *, home, topic, title, actions, key, source='', detail='', evidence=(), row_id='', answers=('Not now', 'Not true')):
    return {'kind': kind, 'home': home, 'topic': topic, 'strength': STRENGTH[kind], 'source': source, 'title': title,
            'detail': detail, 'evidence': [line for line in evidence if line], 'actions': actions, 'key': key,
            'row_id': row_id, 'answers': list(answers)}


def _fresh(rows, now):
    since = (now - timedelta(days=FRESH_DAYS)).date().isoformat()
    return [r for r in rows if (r.get('day') or '')[:10] >= since]


def _extra(record, name):
    return (record.get('fields') or {}).get(name) or ''


def insight_entry(insights, now):
    """Today's insight: the newest daily finding of the last week, an issue first (as Focus's Insight card chose)."""
    fresh = [r for r in _fresh(insights, now) if is_finding(r) and r['category'] != WEEKLY]
    if not fresh:
        return None
    row = max(fresh, key=lambda r: (bool(_extra(r, 'issue_detected')), r['day'], r.get('created_at') or ''))
    issue = bool(_extra(row, 'issue_detected'))
    return _entry('insight', home='focus', topic=CATEGORY_TOPICS.get(row['category'], 'applying'),
                  source='Issue detected' if issue else row['category'], title=row['title'], detail=_extra(row, 'action'),
                  evidence=_extra(row, 'evidence').split('\n'), row_id=row['id'], key=f"row:{row['id']}",
                  actions=[{'label': 'Review evidence' if issue else 'Open insight', 'do': 'open_insight', 'link': row.get('link') or ''}])


def rejection_entry(rows, now):
    """The latest rejection lesson of the last 3 days (src/ai/rejection review), opened on its job's Review tab."""
    recent = [r for r in rows if _field(r, 'stage') == 'Rejected' and _field(r, 'rejection_lesson')
              and (_when(r.get('updated_at') or '') or now) > now - timedelta(days=3)]
    if not recent:
        return None
    row = max(recent, key=lambda r: r.get('updated_at') or '')
    lesson = _field(row, 'rejection_lesson')
    first = re.split(r'(?<=[.;])\s', lesson, maxsplit=1)[0].rstrip('.;')
    return _entry('rejection', home='jobs', topic='applying', source=_field(row, 'rejection') or 'Rejection',
                  title=_short(first, 220), detail=f"{_field(row, 'company')} — {_role(row)}", evidence=[lesson], key=f"rejection:{row['id']}",
                  actions=[{'label': 'Review rejection', 'do': 'open_rejection', 'link': row.get('link') or '', 'url': _field(row, 'url'),
                            'title': _field(row, 'title'), 'company': _field(row, 'company')}])


def _valid_door(picked):
    picked = picked if isinstance(picked, dict) else {}
    name, label = picked.get('door'), str(picked.get('label') or '').strip()
    return {'door': name, 'label': label} if name in DOORS and label and len(label) <= DOOR_LABEL_MAX else None


def door_field(picked):
    """The weekly report's next_action as its row's fields: {'data': JSON} when the AI picked a door it may, else {} (Read the week)."""
    found = _valid_door(picked)
    return {'data': json.dumps(found, ensure_ascii=False)} if found else {}


def door(record, doors):
    """The weekly report's one-press action, if the AI picked one this app can carry out now: {label, do} or None."""
    try:
        found = _valid_door(json.loads(_extra(record, 'data') or '{}'))
    except ValueError:
        return None
    return {'label': found['label'], 'do': found['door']} if found and found['door'] in doors else None


def week_entry(insights, now, doors):
    """Your week: this week's analysis (the weekly report), its door first when it has one, then Read the week."""
    weeks = [r for r in _fresh(insights, now) if r['category'] == WEEKLY]
    if not weeks:
        return None
    row = max(weeks, key=lambda r: (r['day'], r.get('created_at') or ''))
    actions = [found for found in (door(row, doors),) if found] + [{'label': 'Read the week', 'do': 'read_week', 'link': row.get('link') or ''}]
    return _entry('week', home='focus', topic='search', source='Your week', title=row['title'], detail=_extra(row, 'action'),
                  evidence=[_extra(row, 'evidence')], row_id=row['id'], key=f"row:{row['id']}", actions=actions)


def _stamp(record):
    return record.get('created_at') or record.get('day') or ''


def _day_words(iso):
    try:
        day = date.fromisoformat(iso[:10])
    except ValueError:
        return ''
    return f'{day:%a} {day.day} {day:%b}'   # not %-d: Windows' strftime has no "-" flag


def analyze_entry(events, insights, now):
    """Analyze now, between Mondays: enough happened since the last analysis, or replies stopped after a run of applications."""
    weeks = [r for r in insights if r.get('category') == WEEKLY]
    last = max(weeks, key=_stamp, default=None)
    if last and (now.date() - date.fromisoformat(last['day'][:10])).days < MIN_GAP_DAYS:
        return None
    since = _stamp(last) if last else ''
    real = [e for e in events if e.get('kind') in EVENT_KINDS and e.get('source') != 'Backfill']
    new = [e for e in real if (e.get('at') or '') > since]
    key = f"analyze:{last['id'] if last else 'none'}"
    actions = [{'label': 'Analyze now', 'do': 'analyze'}]
    if len(new) >= ANALYZE_AFTER:
        when = f'since your last analysis ({_day_words(last["day"])})' if last else 'since you started'
        return _entry('analyze', home='focus', topic='search', source='Analyze my job search', title='A lot happened since your last analysis',
                      detail=f'{len(new)} new applications and outcomes {when}', key=key, actions=actions, answers=('Not now',))
    window = (now - timedelta(days=QUIET_WINDOW_DAYS)).isoformat()
    applied = [e for e in real if e['kind'] == 'Applied' and (e.get('at') or '') >= window]
    replies = sorted(e.get('at') or '' for e in real if e['kind'] in HUMAN)
    silence_from = replies[-1] if replies else min((e['at'] for e in applied), default='')
    quiet_since = _when(silence_from)
    if len(applied) < QUIET_APPLIED or not quiet_since or now - quiet_since < timedelta(days=QUIET_DAYS):
        return None
    if since and since[:10] >= (quiet_since + timedelta(days=QUIET_DAYS)).date().isoformat():
        return None   # the last analysis already saw this silence
    return _entry('analyze', home='focus', topic='search', source='Analyze my job search', title='Replies stopped',
                  detail=f'{len(applied)} applications in 2 weeks, no replies in {QUIET_DAYS} days', key=f'{key}:quiet',
                  actions=actions, answers=('Not now',))


TUNE_WORDS = {'exclude_title': 'leave out "{label}" titles', 'drop_place': 'drop {label}', 'drop_role': 'stop searching "{label}"'}


def tune_entry(answer):
    """Tune my strategy (src/tune.py, counts only): shown only when your results support at least one change."""
    found = (answer or {}).get('proposals') or [] if (answer or {}).get('ok') else []
    if not found:
        return None
    count = len(found)
    words = [TUNE_WORDS.get(p['kind'], '{label}').format(label=p['label']) for p in found[:2]]
    detail = ', '.join(words) + (f' and {count - 2} more' if count > 2 else '')
    detail = detail[:1].upper() + detail[1:]
    return _entry('tune', home='strategy', topic='search', source='Search strategy · Tune',
                  title=f'{count} change{"s" if count != 1 else ""} your results support', detail=detail,
                  evidence=[p.get('why') or '' for p in found], key='tune:' + '|'.join(sorted(p['id'] for p in found)),
                  actions=[{'label': 'Review', 'do': 'tune'}])


def _answers(insights):
    """{key: the newest answer's fields} for every entry the person answered."""
    answers = {}
    for record in sorted(insights, key=_stamp):
        fields = record.get('fields') or {}
        if fields.get('state'):
            key = fields.get('input_hash') if record.get('category') == ANSWER_CATEGORY else f"row:{record['id']}"
            answers[key] = fields
    return answers


def hidden(insights, now):
    """The keys the person's answers hide now: Not now until its day, Not true / Done / Stale for good. Strategy's rows read it too (Focus's
    `suggestions_hidden`), so a row answered on Focus is gone there as well."""
    today = now.date().isoformat() if isinstance(now, datetime) else str(now)
    return {key for key, found in _answers(insights).items() if not (found['state'] == 'Not now' and (found.get('hidden_until') or '')[:10] <= today)}


def _aside(found):
    """The words an answer set aside: its `data` JSON's `aside` list (desktop/lib/suggestion-answers.js), [] for any other data."""
    try:
        data = json.loads(found.get('data') or '{}')
    except (TypeError, ValueError):
        return []
    return [str(word) for word in data.get('aside') or []] if isinstance(data, dict) else []


def set_aside(insights):
    """The role-idea words a Not true set aside: its answer row keeps them in `data` (a column in every store), so they hold after the role
    words change the row's key, on every Mac of the store. Why (#2350, Gitar): a copy on one Mac let Focus offer them again."""
    return sorted({word.lower() for found in _answers(insights).values() if found['state'] == 'Not true' for word in _aside(found)})


def answered(entries, insights, now):
    """The entries the person has not set aside (hidden)."""
    gone = hidden(insights, now)
    return [entry for entry in entries if entry['key'] not in gone]


def pool(*, insights, tune, events, now, doors, rows=(), search=()):
    """Every engine producer's entry that holds now, answers applied, strongest first. search: Strategy's search entries (suggestions_search.now)."""
    entries = [insight_entry(insights, now), rejection_entry(rows, now), week_entry(insights, now, doors),
               analyze_entry(events, insights, now), tune_entry(tune), *search]
    return sorted(answered([e for e in entries if e], insights, now), key=lambda e: -e['strength'])
