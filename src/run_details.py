"""What one finished search run saves about how it ran, for Reports → Searches (owner, 25 Oct 2026: "all the numbers in the world, how the
search was performed, how many jobs, how many employers"): one small dict of fixed keys and numbers, written once when the run ends beside
its report (the run record's `details`, every store adapter). It is built from what the run already has: its output lines (steps with their
seconds, boards, refused reads, employers checked), the crawl funnel (src/coverage.py), the run's counts and its AI stages. No source module
calls into it; the run log tees every output line to line(). Never a job title, link, CV or typed word beyond the board and company names the
run's own page shows.
Tests: tests/test_run_details.py."""
import re
import time
from collections import Counter

VERSION = 1
STEPS_KEPT = 40
BOARDS_KEPT = 30
STAGES = ('enrich', 'score', 'kits', 'insight', 'interview', 'mail', 'sources')   # src/notion/cron_report.py STAGES

_steps = []       # [label, started (monotonic)], one per distinct ⏳ label, in order
_counts = Counter()
_boards = {}      # board name -> {'jobs', 'relevant'}
_clock = {'start': None, 'now': time.monotonic}

BOARD = re.compile(r'^Job boards found: (?P<name>.+?) (?P<jobs>\d+) job\(s\), (?P<relevant>\d+) relevant')
REFUSED = (('slow down', 'refused_slow_down'), ('captcha', 'refused_captcha'), ('did not load', 'refused_not_loaded'), ('stopped', 'refused_stopped'))
COUNTED = (('Checked: ', 'employers_checked'), ('Visit: ', 'left_to_open'))


def reset():
    _steps.clear()
    _counts.clear()
    _boards.clear()
    _clock['start'] = _clock['now']()


def line(text):
    """One output line of the running job: a ⏳ step starts, a board is read, a refused site is met, an employer is checked."""
    if _clock['start'] is None:
        _clock['start'] = _clock['now']()
    text = str(text or '')
    if text.startswith('⏳ '):
        label = re.split(r'[:(]', text[2:], 1)[0].strip()
        if label and (not _steps or _steps[-1][0] != label) and all(label != step[0] for step in _steps):
            _steps.append([label, _clock['now']()])
        return
    for prefix, key in COUNTED:
        if text.startswith(prefix):
            _counts[key] += 1
            return
    if text.startswith('Refused sites: '):
        _counts['refused_reads'] += 1
        for word, key in REFUSED:
            if word in text:
                _counts[key] += 1
                break
        return
    found = BOARD.match(text)
    if found and len(_boards) < BOARDS_KEPT:
        _boards[found['name']] = {'jobs': int(found['jobs']), 'relevant': int(found['relevant'])}
    if text.startswith('Job boards found: ') and 'after its scripts ran' in text:
        _counts['headless_reads'] += 1


def _steps_out(ended):
    out = []
    start = _clock['start'] if _clock['start'] is not None else (_steps[0][1] if _steps else ended)
    for i, (label, at) in enumerate(_steps[:STEPS_KEPT]):
        until = _steps[i + 1][1] if i + 1 < len(_steps) else ended
        out.append({'label': label, 'at_s': max(0, round(at - start)), 'secs': max(0, round(until - at))})
    return out


def _ai(run):
    out = {}
    for stage in STAGES:
        info = run.get(stage)
        if info:
            out[stage] = {key: info.get(key) for key in ('model', 'provider', 'done', 'failed', 'pending', 'tokens_in', 'tokens_out', 'cache_read',
                                                         'cli_calls', 'api_calls', 'usd') if info.get(key) is not None}
    return out


def build(run, funnel=None, employers=None):
    """The details of a finished run (fixed keys; absent when the run did not measure it). `funnel`: the crawl's summary (coverage.summary()),
    `employers`: coverage.employers_state()."""
    ended = _clock['now']()
    funnel = funnel or {}
    details = {'v': VERSION, 'steps': _steps_out(ended)}
    jobs = {key: funnel[key] for key in ('fetched', 'in_places', 'matched', 'title_hits', 'elsewhere') if key in funnel}
    if funnel.get('excluded'):
        jobs['dropped'] = [{'filter': item.get('fragment'), 'count': item.get('count', 0)} for item in funnel['excluded'][:8]]
    for key, name in (('new', 'added'), ('changed', 'changed'), ('closed_stale', 'expired')):
        if run.get(key) is not None:
            jobs[name] = run[key]
    if jobs:
        details['jobs'] = jobs
    state = {key: value for key, value in (employers or {}).items() if value is not None}
    counts = {key: value for key, value in _counts.items() if key.startswith('employers')}
    if state or counts or run.get('feeds') is not None:
        details['employers'] = {**state, **counts, **({'feeds': run['feeds'], 'feed_errors': run.get('feed_errors') or 0} if run.get('feeds') is not None else {})}
    boards = {key: value for key, value in _counts.items() if key.startswith(('refused', 'headless', 'left_to_open'))}
    if boards or _boards:
        details['boards'] = {**boards, 'read': len(_boards), 'list': [{'name': name, **numbers} for name, numbers in _boards.items()]}
    ai = _ai(run)
    if ai:
        details['ai'] = ai
    scoring = {key: run[key] for key in ('waiting',) if run.get(key) is not None}
    score = run.get('score') or {}
    scoring.update({key: score[key] for key in ('done', 'failed', 'pending') if key in score})
    if scoring:
        details['scoring'] = scoring
    if run.get('warnings'):
        details['problems'] = [str(w)[:300] for w in run['warnings'][:20]]
    return details
