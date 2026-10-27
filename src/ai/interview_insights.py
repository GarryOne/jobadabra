#!/usr/bin/env python3
"""Interview insights: what your reviewed interviews say together, for the Interviews page and 💡 Insights.

Event-driven, not scheduled: it runs right after an interview review is saved (src/daily.py --mode interview, on
this Mac or on GitHub) and from the Interviews page's Refresh (`python -m src.ai.interview_insights refresh`).
Input is the reviews already in Notion 🎤 Interviews (Round, Overall, Topics, Weak topics, Next step, and the
review's summary, strengths, weak spots and practice lines from the page), never the transcripts. One Claude call
(the interview review's model) writes a headline, 2-4 patterns and 1-3 things to do before the next interview.

Honesty is checked in code, not only asked for: every piece of evidence must quote its interview's review word for
word, or it is dropped; a pattern backed by fewer than MIN_SUPPORT interviews is marked tentative (always, with one
interview); a to-do must cite an interview. Nothing useful in the reviews: it says so.

It never spends twice on the same input: the reviewed rows' fingerprint (Input hash) is kept on the one 💡 Insights
row (Category "Interview patterns", upserted), and an unchanged set skips the call. At 90% of the monthly AI budget
(budget.py 'pause') it waits, like the other optional AI steps.
"""
from datetime import datetime, timezone
import hashlib
import json
import os
import re
import sys
import urllib.error

from ..stores import open_stores
from ..stores.notion_blocks import plain_text, to_blocks
from . import engine
from . import budget, cost, interviews, meanings
from .interviews_apps import app_by_id, role, who
from .interview_insights_text import (  # noqa: F401 — moved; kept importable from here
    CATEGORY, BASIS, MIN_SUPPORT, ROUND_TYPES, REVIEW_SECTIONS, MAX_REVIEW_CHARS, TRANSCRIPT_CHARS, TRANSCRIPT_BUDGET,
    KINDS, DATA_VERSION, SCHEMA, SYSTEM,
)


def insights_db():
    return os.getenv('NOTION_INSIGHTS_DB', '')


def model():
    return interviews.DEFAULT_MODEL


def round_type(round_):
    """Recruiter screen, Technical, Hiring manager or Other, from the review's Round in any language (interviews.round_kind)."""
    return {'recruiter_screen': 'Recruiter screen', 'technical': 'Technical', 'hiring_manager': 'Hiring manager'}.get(meanings.round_kind(round_), 'Other')


# ---------- input: the reviewed rows, and a fingerprint of them ----------

FINGERPRINT_COLUMNS = ('Interview', 'Round', 'Overall', 'Topics', 'Weak topics', 'Next step', 'Questions', 'Weak answers', 'Date')


def reviewed_rows(stores):
    """The reviewed interviews (records), oldest first."""
    rows = [r for r in stores.interviews.list() if r.get('overall')]
    return sorted(rows, key=lambda r: (r.get('at') or '', r['id']))


# The record field behind each FINGERPRINT_COLUMNS column, and whether Notion's plain() gave None for it when empty (a
# select, a date, a number): the digest is the one written before the store, so a Notion user's insight stays current.
FINGERPRINT_FIELDS = (('title', False), ('round', False), ('overall', True), ('topics', False), ('weak_topics', False),
                      ('next_step', False), ('questions', True), ('weak_answers', True), ('at', True))


def fingerprint(rows):
    """The same reviewed interviews with the same review fields -> the same value (order doesn't matter)."""
    items = sorted([r['id'].replace('-', ''), [None if empty_is_none and r.get(field) in ('', None) else r.get(field)
                                               for field, empty_is_none in FINGERPRINT_FIELDS],
                    [r['app_id'].replace('-', '')] if r.get('app_id') else []]
                   for r in rows)
    return hashlib.sha256(json.dumps(items, ensure_ascii=False, default=str).encode()).hexdigest()[:24]


def review_text(review):
    """An interview's review (Markdown), by section: {'summary', 'strengths', 'weak_spots', 'practice', 'signals',
    'weak_answers', 'mixed_answers', 'against'}: ⚠️/❌ questions are weak answers, ➖ ones mixed (their "Better:" lines matter
    too). The transcript is read separately (transcript_of)."""
    out = {'summary': '', 'strengths': [], 'weak_spots': [], 'practice': [], 'signals': [], 'weak_answers': [], 'mixed_answers': [],
           'against': []}
    section = None
    for block in to_blocks(review or ''):
        kind = block.get('type')
        text = plain_text((block.get(kind) or {}).get('rich_text'))
        if kind == 'heading_3':
            if text == 'Transcript':
                break
            section = 'questions' if text == 'Questions' else REVIEW_SECTIONS.get(text, 'other')
        elif kind == 'paragraph' and section is None and text and not text.startswith('🔗') and text != interviews.PLACEHOLDER:
            out['summary'] = out['summary'] or text
        elif kind == 'bulleted_list_item' and section in out:
            out[section].append(text)
        elif kind == 'bulleted_list_item' and section == 'questions' and text.startswith(('⚠️', '❌')):
            out['weak_answers'].append(text)
        elif kind == 'bulleted_list_item' and section == 'questions' and text.startswith('➖'):
            out['mixed_answers'].append(text)
    return out


def gather(stores, rows):
    """The reviewed interviews as the prompt's items (I1, I2, …): their fields, review sections, job and transcript."""
    apps = stores.applications.list()
    split = lambda value: [t.strip() for t in (value or '').split(';') if t.strip()]
    items, transcripts = [], {}
    for n, row in enumerate(rows, 1):
        full = stores.interviews.get(row['id']) or row
        transcripts[row['id']] = full.get('transcript') or ''
        app = app_by_id(stores, row.get('app_id'), apps) if row.get('app_id') else None
        items.append({
            'label': f'I{n}', 'id': row['id'], 'url': stores.link(row['id']) or '', 'title': row.get('title') or 'Interview',
            'date': row.get('at') or '', 'round': row.get('round') or '', 'round_type': round_type(row.get('round')),
            'company': who(app), 'job': role(app) if app else '', 'outcome': row.get('overall') or '',
            'topics': split(row.get('topics')), 'weak_topics': split(row.get('weak_topics')),
            'next_step': row.get('next_step') or '', **review_text(full.get('review'))})
    left = TRANSCRIPT_BUDGET  # newest first: the latest interviews matter most
    for item in reversed(items):
        item['transcript'] = transcripts[item['id']][:max(min(TRANSCRIPT_CHARS, left), 0)]
        left -= len(item['transcript'])
    return items


def _source(item):
    """Everything a quote from this interview may come from (the review, not the transcript)."""
    parts = [item['summary'], item['next_step'], item['round'], *item['topics'], *item['weak_topics'],
             *item['strengths'], *item['weak_spots'], *item['practice'], *item['signals'], *item['weak_answers'],
             *item.get('mixed_answers', []), *item.get('against', []), item.get('transcript', '')]
    return _norm(' \n '.join(p for p in parts if p))


def _norm(text):
    return re.sub(r'\s+', ' ', (text or '').replace('“', '"').replace('”', '"').replace('’', "'")).strip().casefold()


def prompt_input(items):
    """Grouped by round type, so screens and technical rounds are never read as one."""
    groups = {}
    for item in items:
        view = {k: item[k] for k in ('label', 'date', 'round', 'company', 'job', 'outcome', 'topics', 'weak_topics', 'next_step',
                                     'summary', 'strengths', 'weak_spots', 'practice', 'signals', 'weak_answers')}
        view.update(mixed_answers=item.get('mixed_answers', []), could_count_against=item.get('against', []))
        if len(json.dumps(view, ensure_ascii=False)) > MAX_REVIEW_CHARS:  # a very long review: fewer answers, every signal kept
            view['weak_answers'], view['mixed_answers'] = view['weak_answers'][:6], view['mixed_answers'][:4]
        if item.get('transcript'):
            view['transcript'] = item['transcript']
        groups.setdefault(item['round_type'], []).append(view)
    return {'interviews_reviewed': len(items), 'by_round_type': {t: groups[t] for t in ROUND_TYPES if t in groups}}


# ---------- the one AI call ----------


def generate(client, model_, items):
    """(result dict, usage, the model that answered) from one schema-constrained call (interviews.ask: a declined request is
    answered by the fallback model)."""
    return interviews.ask(client, model_, max_tokens=interviews.MAX_TOKENS,
                          system=[{'type': 'text', 'text': SYSTEM}],
                          messages=[{'role': 'user', 'content': 'Reviewed interviews (JSON):\n' + json.dumps(prompt_input(items), ensure_ascii=False)}],
                          output_config=engine.structured(SCHEMA, model_))


def validate(result, items):
    """Only what the reviews support: evidence quoted word for word from the interview it names, patterns with fewer
    than MIN_SUPPORT interviews marked tentative, to-dos citing a real interview. Returns the stored shape."""
    by_label = {item['label']: item for item in items}
    sources = {label: _source(item) for label, item in by_label.items()}
    patterns, used = [], set()
    for pattern in result.get('patterns') or []:
        evidence = []
        for ref in pattern.get('evidence') or []:
            label, quote = (ref.get('interview') or '').strip(), (ref.get('quote') or '').strip().strip('"“”')
            # a quote backs one pattern only (the first that uses it): the same moment never counts twice
            if label in by_label and len(quote) >= 8 and _norm(quote) in sources[label] and (label, _norm(quote)) not in used:
                used.add((label, _norm(quote)))
                evidence.append({'interview': by_label[label]['id'], 'quote': quote[:300]})
        cited = list(dict.fromkeys(e['interview'] for e in evidence))
        if not evidence or not (pattern.get('pattern') or '').strip():
            continue
        patterns.append({'text': pattern['pattern'].strip()[:200], 'title': (pattern.get('title') or '').strip()[:80],
                         'kind': pattern.get('kind') if pattern.get('kind') in KINDS else 'note',
                         'round_type': pattern.get('round_type') or 'Other',
                         'interviews': cited, 'evidence': evidence[:4], 'tentative': len(cited) < MIN_SUPPORT})
    steps = []
    for step in result.get('next_steps') or []:
        cited = list(dict.fromkeys(by_label[l]['id'] for l in step.get('interviews') or [] if l in by_label))
        if cited and (step.get('action') or '').strip():
            steps.append({'text': step['action'].strip()[:200], 'title': (step.get('title') or '').strip()[:80],
                          'focus': (step.get('focus') or '').strip()[:100], 'interviews': cited})
    n = len(items)
    confidence = result.get('confidence') if result.get('confidence') in ('high', 'medium', 'low') else 'low'
    if n < 3 or not any(not p['tentative'] for p in patterns):
        confidence = 'low'
    nothing = bool(result.get('nothing_useful')) or not (patterns or steps)
    headline = (result.get('headline') or '').strip()[:200]
    if nothing:
        headline = headline if result.get('nothing_useful') and headline else \
            'Nothing to conclude yet: the reviews name no clear strength, gap or next step.'
        patterns, steps = [], []
    return {'headline': headline, 'headline_detail': '' if nothing else (result.get('headline_detail') or '').strip()[:200],
            'patterns': patterns[:4], 'next_steps': steps[:3], 'confidence': confidence,
            'nothing_useful': nothing, 'interviews': n}


# ---------- storage: one upserted 💡 Insights row ----------

def existing(stores):
    """The Interview patterns insight (a record), or None (the newest if several)."""
    rows = stores.insights.list(category=CATEGORY)
    return rows[0] if rows else None


def evidence_lines(stored, items):
    names = {item['id']: item['title'] for item in items}
    lines = []
    for p in stored['patterns']:
        tag = 'Tentative, 1 interview' if p['tentative'] else f"{len(p['interviews'])} interviews"
        lines.append(f"• {p['text']} ({tag}; {p['round_type']})")
        lines += [f"    {names.get(e['interview'], 'Interview')}: “{e['quote']}”" for e in p['evidence']]
    return '\n'.join(lines) or stored['headline']


def step_key(text):
    """A to-do's identity: its words without case, spacing or punctuation. A tick on "Practice next" lives on this key, so it
    survives a Refresh only while the step's words do."""
    return re.sub(r'[^a-z0-9]+', ' ', (text or '').lower()).strip()[:80]


def _row_data(row):
    try:
        return json.loads(((row or {}).get('fields') or {}).get('data') or '{}')
    except ValueError:
        return {}


def record_of(stored, items, digest, model_, usd, now, done=()):
    """The Interview patterns insight as a store record: its numbers in fields, the whole result in fields['data'] (JSON)."""
    keys = {step_key(step['text']) for step in stored['next_steps']}
    data = {'v': DATA_VERSION, 'headline_detail': stored.get('headline_detail') or '', 'patterns': stored['patterns'], 'next_steps': stored['next_steps'], 'nothing_useful': stored['nothing_useful'],
            'done_steps': [key for key in done if key in keys],
            'interviews': [{'id': i['id'], 'title': i['title'], 'url': i['url'], 'round_type': i['round_type'], 'date': i['date']}
                           for i in items],
            'updated': now.isoformat(timespec='seconds')}
    return {'title': stored['headline'][:200], 'day': now.date().isoformat(), 'category': CATEGORY, 'fields': {
        'basis': BASIS, 'confidence': stored['confidence'], 'sample_size': len(items),
        'evidence': evidence_lines(stored, items)[:2000], 'action': '\n'.join(f"• {s['text']}" for s in stored['next_steps'])[:2000],
        'cost': round(usd, 4), 'model': model_, 'input_hash': digest, 'data': json.dumps(data, ensure_ascii=False)}}


def upsert(stores, values, row=None):
    """Update the Interview patterns insight in place (its fields merged), or add it."""
    if row:
        if 'fields' in values:
            values = {**values, 'fields': {**(row.get('fields') or {}), **values['fields']}}
        return stores.insights.update(row['id'], values)
    return stores.insights.add(values)


def saved(stores):
    """The stored insight for the app: {headline, confidence, interviews, updated, patterns, next_steps, url, evidence,
    action}, or None. Evidence/Action (text) are for a row written before its Data column existed."""
    row = existing(stores)
    if not row:
        return None
    fields, data = row.get('fields') or {}, _row_data(row)
    return {'id': row['id'], 'url': stores.link(row['id']) or '', 'headline': row.get('title') or '',
            'confidence': fields.get('confidence') or 'low', 'sample': fields.get('sample_size') or 0,
            'updated': data.get('updated') or row.get('created_at', ''),
            'version': data.get('v') or 1, 'headline_detail': data.get('headline_detail') or '', 'patterns': data.get('patterns') or [],
            'next_steps': [{**step, 'done': step_key(step.get('text')) in (data.get('done_steps') or [])}
                           for step in data.get('next_steps') or []], 'interviews': data.get('interviews') or [],
            'nothing_useful': bool(data.get('nothing_useful')), 'done_steps': data.get('done_steps') or [], 'evidence': fields.get('evidence') or '',
            'action': fields.get('action') or '', 'input_hash': fields.get('input_hash') or '',
            'outdated': _outdated(stores, fields.get('input_hash'))}


def _outdated(stores, stored):
    """A review changed (or one was added) since the insight was written: Review again doesn't refresh it, and a review
    on GitHub writes it after the review. The card says so instead of looking current. False when it can't tell."""
    try:
        return bool(stored) and fingerprint(reviewed_rows(stores)) != stored
    except Exception:  # noqa: BLE001 - the card shows the insight either way
        return False


def set_step_done(stores, text, done):
    """Tick or untick one "Practice next" step, saved in the insight's data (the store holds the one copy). Returns
    {'done_steps': [...]}. ValueError when there are no insights or the step isn't one of them."""
    row = existing(stores)
    if not row:
        raise ValueError('There are no interview insights yet.')
    data = _row_data(row)
    key = step_key(text)
    if key not in {step_key(step.get('text')) for step in data.get('next_steps') or []}:
        raise ValueError('That is not a step of the current insights (Refresh may have replaced it).')
    kept = [k for k in data.get('done_steps') or [] if k != key]
    data['done_steps'] = kept + [key] if done else kept
    upsert(stores, {'fields': {'data': json.dumps(data, ensure_ascii=False)}}, row)
    return {'done_steps': data['done_steps']}


def update(*, client=None, model_=None, stats=None, now=None, force=False, budget_status=None, stores=None):
    """Bring the Interview patterns row up to date with the reviews. Returns {'status', 'text', ...}: status is
    'updated', 'unchanged' (no AI call), 'none' (no reviewed interview), 'paused' (AI budget) or 'off' (no Insights
    database). force: call even when the input is unchanged (never used by the app: it would spend twice). stores: the active
    store (else open_stores())."""
    stores = stores or open_stores()
    # One refresh at a time on this Mac (the app, the terminal, a review's own refresh): the second one waits, then finds
    # the row current and makes no AI call (two paid Opus refreshes at 14:09 on 30 Sep 2026).
    from ..paths import run_lock
    with run_lock(name='insights', on_wait=lambda: print('Another interview-insights refresh is running: waiting for it…', file=sys.stderr)):
        return _update(stores, client=client, model_=model_, stats=stats, now=now, force=force, budget_status=budget_status)


def _update(stores, *, client, model_, stats, now, force, budget_status):
    now = now or datetime.now(timezone.utc)
    if stores.name == 'notion' and (not insights_db() or not interviews.INTERVIEWS_DATABASE_ID):
        return {'status': 'off', 'text': 'Interview insights: no 💡 Insights or 🎤 Interviews database'}
    rows = reviewed_rows(stores)
    if not rows:
        return {'status': 'none', 'text': 'Interview insights: no reviewed interview yet'}
    digest, row = fingerprint(rows), existing(stores)
    if row and not force and (row.get('fields') or {}).get('input_hash') == digest and (_row_data(row).get('v') or 1) >= DATA_VERSION:
        return {'status': 'unchanged', 'text': f'Interview insights: up to date ({len(rows)} reviewed, nothing changed)', 'usd': 0.0}
    try:
        info = (budget_status or budget.status)(stores)
    except Exception as error:  # noqa: BLE001 - a budget read that fails never blocks it
        print(f'Warning: budget check skipped: {type(error).__name__}: {error}')
        info = {'level': 'ok'}
    if info.get('level') == 'pause':
        return {'status': 'paused', 'text': f"Interview insights: paused, AI budget at {info.get('pct', 0):.0%}"}
    items = gather(stores, rows)
    model_ = model_ or model()
    if client is None:
        client = engine.client(action='interview_patterns')   # Why (27 Oct 2026, owner): its own step name, so Pro can route it apart from the call review ('interview')
    result, usage, model_ = generate(client, model_, items)
    cost.add(stats, model_, usage)
    usd = cost.usd(model_, usage)
    if stats is not None:
        stats['pending'] = stats.get('pending', 0) + 1
        stats['done'] = stats.get('done', 0) + 1
    stored = validate(result, items)
    done = _row_data(row).get('done_steps') or [] if row else []  # ticks stay for steps whose words are still there
    saved_row = upsert(stores, record_of(stored, items, digest, cost.answered(model_, usage), usd, now, done), row)
    return {'status': 'updated', 'usd': usd, 'url': stores.link(saved_row['id']) or '', 'headline': stored['headline'],
            'text': f"Interview insights updated from {len(items)} interview(s): {stored['headline']} ({usd:.3f} USD)"}


def after_review(stats=None, client=None, stores=None):
    """Called at the end of a saved review: never fails the review. Returns the one-line result, or ''."""
    try:
        return update(stats=stats, client=client, stores=stores)['text']
    except Exception as error:  # noqa: BLE001 - the review is saved; insights catch up on the next review or Refresh
        if cost.limit_reached(error):
            from . import providers
            return (f'Interview insights: paused, {providers.spec().limit}' if cost.cli_limit(error)
                    else 'Interview insights: paused, the Anthropic spend limit is reached')
        return f'Interview insights skipped: {type(error).__name__}: {error}'


RUN_NAME = 'Interview insights'


def main(argv=None):
    """The Interviews page's Refresh: `refresh` prints one JSON line {ok, status, text, insight}. `step --text T --done yes|no`
    ticks or unticks a "Practice next" step and prints {ok, done_steps}."""
    import argparse
    parser = argparse.ArgumentParser(description=main.__doc__)
    parser.add_argument('command', choices=('refresh', 'step'))
    parser.add_argument('--text', default='')
    parser.add_argument('--done', choices=('yes', 'no'), default='yes')
    args = parser.parse_args(argv)
    if interviews.notion_unusable(os.environ):
        print(json.dumps({'ok': False, 'error': 'Connect Notion first'}))
        return 1
    stores = open_stores()
    if args.command == 'step':
        try:
            print(json.dumps({'ok': True, **set_step_done(stores, args.text, args.done == 'yes')}, ensure_ascii=False))
            return 0
        except (ValueError, urllib.error.URLError) as error:
            print(json.dumps({'ok': False, 'error': str(error)}))
            return 1
    from .. import run_log
    run = run_log.new_run('insight')
    run['insight'] = {}
    run['name'] = RUN_NAME  # "Interview insights" in the run's title, not the daily "Insight"
    try:
        out = update(stats=run['insight'], stores=stores)
    except Exception as error:  # noqa: BLE001 - the page says what failed
        # The page gets a friendly sentence; the log keeps which error it was (a spend limit and a rate limit read alike there).
        print(f'interview insights failed: {type(error).__name__} status={getattr(error, "status_code", "")} '
              f'{str(error)[:300]}', file=sys.stderr)
        text = cost.limit_message(error, 'the interview insights') if cost.limit_reached(error) else \
            f'Could not update the interview insights: {type(error).__name__}: {error}'
        print(json.dumps({'ok': False, 'error': text}))
        return 1
    if out['status'] == 'updated':  # a run with an AI call leaves its row, on any store (its cost counts for the budget)
        run['headline'] = out['text']
        run['seconds'] = int((datetime.now(timezone.utc) - datetime.fromisoformat(run['started_at'])).total_seconds())
        run_log.log_run(stores, run)
    print(json.dumps({'ok': True, 'status': out['status'], 'text': out['text'], 'insight': saved(stores)}, ensure_ascii=False))
    return 0


if __name__ == '__main__':
    sys.exit(main())
