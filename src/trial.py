"""The free trial in a GitHub (Always on) run: the same answer as the app, asked of the website (GET /api/trial/status, site/src/trial.js).

The run identifies as the app's install (JOBADABRA_TRIAL_KEY = JPF1.<install>.<token>, set by the app as a repo secret) and sends how many applications it
holds (Applied or later) and the app's first-run day (JOBADABRA_FIRST_RUN). Over the trial and not Pro, a run starts no new work (searches, scoring, kits);
tracking (mail, status, apply marks) goes on. An unreachable site never pauses anything. Guarded by tests/test_trial.py.
"""
import json
import os
import urllib.parse
import urllib.request

from .stores.rules import EMPLOYER_STAGES

APPLIED_OR_LATER = {'Applied', *EMPLOYER_STAGES}
NEW_WORK_MODES = ('scheduled', 'run', 'today', 'kits', 'prepare')
OVER_LINE = 'Your free trial is over: Always on paused new searches. Get Pro to continue.'
SITE = 'https://www.jobadabra.top'


def applied_count(stages):
    """How many applications a {url: stage} map holds, as the app counts them (Applied or later)."""
    return sum(1 for stage in stages.values() if stage in APPLIED_OR_LATER)


def status(applied, urlopen=urllib.request.urlopen, env=None, claim=False):
    """The website's answer {ended, pro, ...}, or None when this run has no install key or the site did not answer (never pauses on a failure)."""
    env = os.environ if env is None else env
    key = env.get('JOBADABRA_TRIAL_KEY', '').strip()
    if not key:
        return None
    query = {'applied': applied, 'first': env.get('JOBADABRA_FIRST_RUN', '')}
    if claim:
        query['claim'] = 1   # asks to send the pause line: the website says yes once a day per install
    headers = {'x-api-key': key}
    if env.get('JOBADABRA_LICENSE_KEY'):
        headers['x-jp-license'] = env['JOBADABRA_LICENSE_KEY']
    base = env.get('JOBADABRA_SITE_URL', SITE).rstrip('/')
    try:
        request = urllib.request.Request(f'{base}/api/trial/status?{urllib.parse.urlencode(query)}', headers=headers)
        with urlopen(request, timeout=15) as response:
            body = json.load(response)
    except Exception:  # noqa: BLE001 - a site outage must not stop a person's search
        return None
    return body if isinstance(body, dict) and body.get('ok') else None


def paused(mode, stages, claim=False, **kwargs):
    """The answer when this run must start no new work (mode starts new work, the trial is over, not Pro), else None."""
    if mode not in NEW_WORK_MODES:
        return None
    answer = status(applied_count(stages), claim=claim, **kwargs)
    return answer if answer and answer.get('ended') else None


def pause_run(args, stores, mode=None):
    """True when this run must stop here: the trial is over and the person is not Pro. Says so on the run's log and, with --send, on Telegram."""
    mode = mode or args.mode
    if mode not in NEW_WORK_MODES or not os.environ.get('JOBADABRA_TRIAL_KEY'):
        return False
    from . import telegram
    from .daily_helpers import url_stages
    answer = paused(mode, url_stages(stores), claim=bool(args.send))
    if not answer:
        return False
    print(OVER_LINE, flush=True)
    if args.send and answer.get('notify'):   # once a day per install, decided by the website
        telegram.deliver(OVER_LINE, *telegram.credentials())
    return True
