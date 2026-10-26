"""Readiness check: is everything set up, and what is the one thing to do next?

    python -m src doctor            checklist grouped by area, then "Next step"
    python -m src doctor --next     only the next step (the launchers print this when nothing is ready)
    python -m src doctor --json     machine-readable, for a menu bar or Telegram /status
    python -m src doctor --alert    health checks only; one Telegram line if something is wrong

The data checks read the active store (src/stores: Notion, or this Mac's), so they work without Notion too; "Your data"
says whether it can be read. The health checks (Google sign-in, mail workflow, AI budget, failing feeds) also run once a day with the
04:30 UTC scheduled crawl, which sends one Telegram line only when one of them warns or fails.

Checks run in order of dependency: setup → the scheduled pipeline on GitHub → data it produced →
kits → this Mac's form-filling tools. The next step is the first failing check, else the first
warning, else "apply to the next job". Nothing here spends money or changes anything.

Only the core (crawl + digest) is required. An optional feature that isn't set up is shown as off
(ℹ️), never as a failure; the Features line lists what's on, off and switched off (src/features.py).
"""
import argparse
import html
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

from . import features, secret_store
from .ai import apply_batch
from .notion import client as notion
from .paths import CONFIG
from .stores import chosen, open_stores

OK, WARN, FAIL, INFO = 'ok', 'warn', 'fail', 'info'
ICONS = {OK: '✅', WARN: '⚠️ ', FAIL: '❌', INFO: 'ℹ️ '}
STALE_CRAWL_HOURS = 9  # the schedule is every 4 h; two missed runs is worth a warning
STALE_MAIL_HOURS = 14  # mail runs 3 times a day
GOOGLE_TESTING_DAYS = 7  # Google expires sign-ins of apps in "Testing" after 7 days
HEALTH_HOUR_UTC = 4  # the scheduled crawl in this hour sends the daily health alert
FEED_FAIL_SHARE = 0.3  # this share of feeds failing in the last crawl is a failure, any is a warning
CHROME = Path('/Applications/Google Chrome.app')


@dataclass
class Check:
    area: str
    name: str
    state: str
    detail: str
    fix: str = ''


def notion_token():
    token = os.getenv('NOTION_TOKEN')
    if token:
        return token
    try:
        return secret_store.get('job-pilotto.notion.token')   # a test run or a twin: never the owner's (src/secret_store.py)
    except (OSError, subprocess.TimeoutExpired):
        return None


def gh(*args):
    """JSON output of a gh command, or None when gh is missing, logged out or offline."""
    if not shutil.which('gh'):
        return None
    try:
        done = subprocess.run(['gh', *args], capture_output=True, text=True, timeout=20)
    except subprocess.TimeoutExpired:
        return None
    if done.returncode:
        return None
    try:
        return json.loads(done.stdout or 'null')
    except json.JSONDecodeError:
        return None


def _hours_ago(iso, now):
    return (now - datetime.fromisoformat(iso.replace('Z', '+00:00'))).total_seconds() / 3600


# ---------- Setup ----------

def check_notion(tracker, store=None):
    """The Notion line. store: the active store's name; on another one Notion holds none of the data, so it is not asked."""
    if store not in (None, 'notion'):
        return Check('Setup', 'Notion', INFO, 'not used — your data is on this Mac; Always on needs it')
    if tracker is None:
        # Optional: the core crawl and digest work without it; tracking, scoring and kits need it.
        state = 'switched off (JOB_PILOTTO_DISABLE)' if features.disabled('notion') else 'not set up'
        return Check('Setup', 'Notion', INFO, f'{state} — optional; your data stays on this Mac without it, Always on needs it',
                     'Store it: security add-generic-password -a "$USER" -s job-pilotto.notion.token -w')
    try:
        tracker._request('GET', 'users/me')
    except Exception as error:
        return Check('Setup', 'Notion', FAIL, f'token rejected or Notion unreachable ({type(error).__name__})',
                     'Check the token and that the integration is connected to the Project Hub page')
    return Check('Setup', 'Notion', OK, 'connected')


def check_store(stores):
    """Can the user's data be read where it lives (src/stores)? One narrow read per table the checks below use."""
    where = 'Notion' if stores.name == 'notion' else 'this Mac' if stores.name == 'sqlite' else stores.name
    for entity, read in (('applications', lambda: stores.applications.list(stages=['Applying'])),
                         ('matches', lambda: stores.matches.list(status='Open')),
                         ('runs', lambda: stores.cron_runs.list(since=datetime.now(timezone.utc).date().isoformat()))):
        try:
            read()
        except Exception as error:  # noqa: BLE001 — the check reports it
            return Check('Setup', 'Your data', FAIL, f'{where}: {entity} could not be read ({type(error).__name__})',
                         'Settings → Connections: reconnect Notion' if stores.name == 'notion' else 'Restart the app; if it stays, restore the latest backup')
    return Check('Setup', 'Your data', OK, f'in {where}, readable')


def check_profile(stores):
    from .ai import score
    text = stores.texts.get('profile')
    if score.unfilled(text):   # length alone passed the blank template (about 2,000 characters of ❓ fields)
        return Check('Setup', 'Profile', FAIL, 'Profile page is empty or still the template',
                     'Fill "Profile — CV and Preferences" in Notion (template: docs/notion-profile-template.md)' if stores.name == 'notion'
                     else 'Fill your profile in the app: Profile, or Strategy → Detailed strategy')
    return Check('Setup', 'Profile', OK, f'{len(text):,} characters')


def check_answers(stores):
    text = stores.texts.get('answers')
    if len(text) < 200:
        return Check('Setup', 'Application Answers', WARN, 'page is empty; forms will stop to ask you more often',
                     'Fill "Application Answers — Standard Form Fields" in Notion' if stores.name == 'notion'
                     else 'Fill your reusable answers in the app: Profile → Reusable answers')
    return Check('Setup', 'Application Answers', OK, f'{len(text):,} characters')


def check_cv():
    path = Path(apply_batch.DEFAULT_CV).expanduser()
    if not path.is_file():
        return Check('Setup', 'CV file', INFO, f'not found: {path} (only needed for form filling)',
                     'Set JOB_PILOTTO_CV_PATH in .env to your CV PDF')
    return Check('Setup', 'CV file', OK, path.name)


# ---------- Scheduled pipeline (GitHub Actions) ----------

def repo_args():
    """['-R', 'owner/repo'] for the repository the schedules and the Gmail check run in — the user's private
    workspace repo — else [] (this checkout). The engine repo has no NOTION_* variables, so asking GitHub about
    it reports runs that never happen there, and hides the real ones (1 Oct 2026)."""
    from .paths import workspace_repo
    repo = workspace_repo()
    return ['-R', repo] if repo else []


def where():
    """The repo the GitHub checks looked at, in words for a detail line."""
    args = repo_args()
    return f' in {args[1]}' if args else ''


def check_workflow():
    flows = gh('workflow', 'list', *repo_args(), '--json', 'path,state')
    if flows is None:
        return Check('Pipeline', 'GitHub', INFO, 'gh CLI missing or not logged in; cloud checks skipped '
                     '(the scheduled GitHub pipeline is optional; everything also runs locally)',
                     'brew install gh && gh auth login')
    daily = next((f for f in flows if f['path'].endswith('daily.yml')), None)
    if not daily or daily['state'] != 'active':
        return Check('Pipeline', 'Scheduled crawl', FAIL, f'daily.yml is disabled or missing{where()}',
                     'gh workflow enable daily.yml' + (' -R ' + repo_args()[1] if repo_args() else ''))
    return Check('Pipeline', 'Scheduled crawl', OK, f'daily.yml enabled (every 4 h){where()}')


def pipeline_env():
    """Names of the GitHub secrets and variables set for the scheduled runs, with placeholder values
    (features only test presence), plus the real value of JOB_PILOTTO_DISABLE. None without gh."""
    secrets, variables = gh('secret', 'list', '--json', 'name'), gh('variable', 'list', '--json', 'name,value')
    if secrets is None or variables is None:
        return None
    env = {item['name']: 'set' for item in secrets + variables}
    env['JOB_PILOTTO_DISABLE'] = next((v['value'] for v in variables if v['name'] == 'JOB_PILOTTO_DISABLE'), '')
    return env


def check_features(env=None):
    """Which optional features the scheduled runs have. Off is fine; it's the developer's choice."""
    env = pipeline_env() if env is None else env
    where = 'GitHub secrets and variables'
    if env is None:
        env, where = os.environ, 'this shell and .env (gh unavailable)'
    rows = features.status(env)
    on = [f.name for f, state, _ in rows if state == 'on']
    off = [f.name for f, state, _ in rows if state == 'off']
    switched = [f.name for f, state, _ in rows if state == 'disabled']
    parked = [f.name for f, state, _ in rows if state == 'parked']
    detail = f"on: {', '.join(on) or 'core only'}"
    for words, names in (('not set up', off), ('switched off', switched), ('parked', parked)):
        if names:
            detail += f"; {words}: {', '.join(names)}"
    return Check('Pipeline', 'Features', OK if on else INFO, f'{detail} (from {where})',
                 'Optional — README → Optional features lists what each needs and costs')


def check_last_crawl(stores, now):
    # Filter by event on GitHub's side: manual prepare/apply runs would crowd a plain "last 10".
    runs = gh('run', 'list', *repo_args(), '--workflow', 'daily.yml', '--event', 'schedule', '--limit', '5',
              '--json', 'conclusion,createdAt,status')
    crawls = [r for r in runs or [] if r['status'] == 'completed']
    if runs is None:
        return Check('Data', 'Last crawl', INFO, 'not checked (gh unavailable)')
    if not crawls:
        return Check('Data', 'Last crawl', FAIL, f'no scheduled crawl has finished yet{where()}',
                     'Run one now: gh workflow run daily.yml -f mode=run  (a few cents of AI)')
    last, hours = crawls[0], _hours_ago(crawls[0]['createdAt'], now)
    if last['conclusion'] != 'success':
        return Check('Data', 'Last crawl', FAIL, f"last scheduled crawl {last['conclusion']} ({hours:.0f} h ago)",
                     'Open it: gh run list --workflow daily.yml, then gh run view <id> --log-failed')
    summary = ''
    runs = stores.cron_runs.list() if stores else []   # newest first
    if runs:
        summary = f" — {runs[0]['summary']}" if runs[0]['summary'] else ''
    if hours > STALE_CRAWL_HOURS:
        return Check('Data', 'Last crawl', WARN, f'{hours:.0f} h ago; the schedule may be paused{summary}',
                     'gh workflow run daily.yml -f mode=run')
    return Check('Data', 'Last crawl', OK, f'{hours:.1f} h ago{summary}')


def check_sources(stores):
    from . import scout
    static = scout.starter_list()
    active = stores.employers.list(active=True)
    count = len(static) + len(active)
    if not count:
        return Check('Data', 'Sources', FAIL, 'no employer feeds to crawl',
                     'Run the source scout: gh workflow run scout.yml, or add feeds to config/sources.json')
    return Check('Data', 'Sources', OK, f'{count} feeds ({len(active)} from Employers & Sources)')


def check_matches(stores):
    rows = stores.matches.list(status='Open')
    if not rows:
        return Check('Data', 'Scored jobs', FAIL, 'no open scored jobs in Job Matches',
                     'Run a crawl with scoring: gh workflow run daily.yml -f mode=run')
    good = sum((r['fit'] or 0) >= 70 for r in rows)
    return Check('Data', 'Scored jobs', OK, f'{len(rows)} open, {good} scoring 70+')


# ---------- Health: sign-ins, background jobs, budget, feeds ----------

def check_budget(stores, now=None):
    from .ai import budget, engine
    from .ai import providers
    if providers.spec().billing == providers.SUBSCRIPTION:   # the AI runs on the user's own plan: there is no API spend to measure against a budget
        return Check('Health', 'AI budget', OK, f'{providers.spec().plan}: no API budget to watch')
    info = budget.status(stores, now)
    detail = budget.describe(info)
    if info['level'] == 'pause':
        return Check('Health', 'AI budget', FAIL, f'{detail}; auto-kits and extra scoring are paused',
                     'Raise the limit in the Anthropic console (Settings → Limits) and JOB_PILOTTO_MONTHLY_BUDGET_USD, '
                     'or wait for the reset on the 1st')
    if info['level'] == 'warn':
        return Check('Health', 'AI budget', WARN, detail, 'Watch spend; at 90% the optional AI steps pause')
    return Check('Health', 'AI budget', OK, detail)


def _google_auth_age(now):
    """Days since the Google sign-in, from JOB_PILOTTO_GOOGLE_AUTH_AT (CI variable) or the Keychain."""
    value = os.getenv('JOB_PILOTTO_GOOGLE_AUTH_AT')
    if not value and sys.platform == 'darwin':
        value = secret_store.get('job-pilotto.google.auth-at') or ''
    try:
        return (now - datetime.fromisoformat(value.replace('Z', '+00:00'))).total_seconds() / 86400
    except (AttributeError, ValueError):
        return None


def check_google(now=None):
    from .sources import google, google_scopes
    now = now or datetime.now(timezone.utc)
    client = google.Google.from_env()
    if not client:
        return Check('Health', 'Gmail + Calendar', INFO,
                     'switched off (JOB_PILOTTO_DISABLE)' if features.disabled('mail') else 'not connected (optional)',
                     'README → Gmail and Calendar setup')
    fix = 'Sign in again: python3 -m src.sources.google auth --github  (add --client-json <file> if you use your own Google app)'
    try:
        email = (client.profile().get('emailAddress', '?') if client.scopes is None or 'gmail' in client.scopes else client.account_email()) or '?'
        said = google_scopes.say(client.scopes)
        if said:
            return Check('Health', 'Gmail + Calendar', WARN, f'{email}: {said}', 'Reconnect in the app: Settings → Connections → Gmail & Calendar')
    except Exception as error:
        expired = 'invalid_grant' in str(error)
        return Check('Health', 'Gmail + Calendar', FAIL,
                     'sign-in expired or revoked' if expired else f'unreachable ({type(error).__name__})', fix)
    age = _google_auth_age(now)
    if age is not None and age >= GOOGLE_TESTING_DAYS - 2:
        left = max(0, GOOGLE_TESTING_DAYS - age)
        return Check('Health', 'Gmail + Calendar', WARN,
                     f'{email}; signed in {age:.0f} days ago — expires in about {left:.0f} day(s) while the app is in Testing',
                     fix)
    return Check('Health', 'Gmail + Calendar', OK, f'connected as {email}' + (f', signed in {age:.0f} day(s) ago' if age is not None else ''))


def check_mail_workflow(now=None):
    from .sources import google
    now = now or datetime.now(timezone.utc)
    if not google.Google.from_env():
        return Check('Health', 'Mail checks', INFO, 'off (Gmail + Calendar not connected or switched off)')
    runs = gh('run', 'list', *repo_args(), '-w', 'mail.yml', '-L', '5', '--json', 'conclusion,status,createdAt,event')
    if runs is None:
        return Check('Health', 'Mail checks', INFO, 'not checked (gh unavailable)')
    done = [r for r in runs if r.get('status') == 'completed']
    if not done:
        return Check('Health', 'Mail checks', WARN, f'no mail check has run yet{where()}', 'gh workflow run mail.yml')
    last = done[0]
    hours = _hours_ago(last['createdAt'], now)
    if last.get('conclusion') != 'success':
        return Check('Health', 'Mail checks', FAIL, f"last mail check {last.get('conclusion')} ({hours:.0f} h ago){where()}",
                     'Open the failed run: gh run list -w mail.yml' + (' -R ' + repo_args()[1] if repo_args() else ''))
    if hours > STALE_MAIL_HOURS:
        return Check('Health', 'Mail checks', WARN, f'last one {hours:.0f} h ago; the schedule may be paused{where()}',
                     'gh workflow enable mail.yml')
    return Check('Health', 'Mail checks', OK, f'last one {hours:.1f} h ago{where()}')


def check_feeds(stores):
    crawls = [run for run in stores.cron_runs.list() if (run['stats'] or {}).get('feeds')]   # newest first
    if not crawls:
        return Check('Health', 'Feeds', INFO, 'no crawl with feeds logged yet')
    feeds, errors = crawls[0]['stats']['feeds'], crawls[0]['stats'].get('feed_errors') or 0
    if errors and errors / feeds >= FEED_FAIL_SHARE:
        return Check('Health', 'Feeds', FAIL, f'{errors:.0f} of {feeds:.0f} feeds failed in the last crawl',
                     'Open the last crawl in Recent activity for the failing feeds')
    if errors:
        return Check('Health', 'Feeds', WARN, f'{errors:.0f} of {feeds:.0f} feeds failed in the last crawl',
                     'Usually temporary; check again after the next crawl')
    return Check('Health', 'Feeds', OK, f'all {feeds:.0f} feeds answered in the last crawl')


HEALTH_CHECKS = (check_google, check_mail_workflow)


def health_checks(stores, now=None):
    """The checks that matter for the unattended pipeline (no local tools, no CV file). stores: the active store (src/stores)."""
    checks = [_safe(fn, now) for fn in HEALTH_CHECKS]
    if stores:
        checks += [_safe(check_budget, stores, now), _safe(check_feeds, stores)]
    return checks


def alert(stores, send, now=None):
    """One Telegram line when a health check warns or fails; returns what was found."""
    problems = [c for c in health_checks(stores, now) if c.state in (WARN, FAIL)]
    if not problems:
        return 'Health: all good'
    blocks = [f"<b>{html.escape(c.name)} · {'Failed' if c.state == FAIL else 'Warning'}</b>\n{html.escape(c.detail)}"
              + (f"\n<b>Next step:</b> {html.escape(c.fix)}" if c.fix else '') for c in problems]
    count = f"{len(problems)} problem{'s' if len(problems) != 1 else ''}"
    text = f"🩺 <b>Jobadabra health</b>\n{count}\n\n" + '\n\n'.join(blocks)
    if send:
        send(text)
    return text


# ---------- Kits and applications ----------

def check_kits(stores):
    ready = apply_batch.ready_jobs(stores, 10)
    if not ready:
        return Check('Apply', 'Kits ready', WARN, 'no job has a drafted kit, so there is nothing to apply to yet',
                     'Draft kits for your best matches: tools/prepare-top.sh 5  (~$0.04 each)')
    return Check('Apply', 'Kits ready', OK, f"{len(ready)}{'+' if len(ready) >= 10 else ''} job(s) ready to apply")


def check_in_progress(stores):
    rows = stores.applications.list(stages=['Applying'])
    if rows:
        return Check('Apply', 'In progress', INFO, f'{len(rows)} form(s) filled and waiting for your Submit')
    return Check('Apply', 'In progress', OK, 'nothing waiting for you')


# ---------- This Mac ----------

def check_mac_tools():
    missing = [name for name, found in (('Claude Code', shutil.which('claude')),
                                        ('Google Chrome', CHROME.exists()),
                                        ('osascript', shutil.which('osascript'))) if not found]
    if missing:
        return Check('This Mac', 'Form-filling tools', INFO, f"missing: {', '.join(missing)} (optional)",
                     'Install Claude Code (claude.ai/code) and Google Chrome')
    return Check('This Mac', 'Form-filling tools', OK,
                 'Claude Code and Chrome installed (the Claude in Chrome extension is checked when a run starts)')


# ---------- Running and reporting ----------

def run_checks(tracker=None, now=None, stores=None):
    """tracker: the Notion client when a token is set (the Notion line). stores: where the user's data lives (src/stores; none: only
    the local checks). The data checks run when that store answers."""
    now = now or datetime.now(timezone.utc)
    local = [check_cv, check_workflow, check_features, check_mac_tools,
             lambda: check_google(now), lambda: check_mail_workflow(now)]
    remote = [check_profile, check_answers, check_sources, lambda s: check_last_crawl(s, now),
              check_matches, check_kits, check_in_progress, lambda s: check_budget(s, now), check_feeds]
    first = [check_notion(tracker, stores.name if stores is not None else None)]
    if stores is not None and (stores.name != 'notion' or first[0].state == OK):
        first.append(_safe(check_store, stores))
    jobs = [(fn, ()) for fn in local]
    ready = stores is not None and first[-1].name == 'Your data' and first[-1].state == OK
    with ThreadPoolExecutor(max_workers=8) as pool:
        futures = [pool.submit(_safe, fn, *args) for fn, args in jobs]
        # The data checks run on this thread, meanwhile: a store on this Mac (SQLite) answers only the thread that opened it, and
        # Notion's requests go one at a time anyway (src/notion/pace.py).
        data = [_safe(fn, stores) for fn in remote] if ready else []
        results = first + [f.result() for f in futures] + data
    order = ['Setup', 'Pipeline', 'Health', 'Data', 'Apply', 'This Mac']
    return sorted(results, key=lambda c: order.index(c.area))


def active_store(tracker):
    """The active store (the one the tracker stands for, else this Mac's), or None when it cannot be opened (the checklist says so)."""
    try:
        return open_stores(tracker=tracker) if tracker else open_stores()
    except Exception as error:  # noqa: BLE001
        print(f'Warning: your data could not be opened: {type(error).__name__}: {error}')
        return None


def _safe(fn, *args):
    try:
        return fn(*args)
    except Exception as error:
        name = getattr(fn, '__name__', 'check').replace('check_', '').replace('_', ' ')
        return Check('Setup', name, WARN, f'could not check: {type(error).__name__}: {error}')


def next_step(checks):
    for state in (FAIL, WARN):
        for check in checks:
            if check.state == state and check.fix:
                return f'{check.name}: {check.fix}'
    if any(c.name == 'Notion' and c.state != OK for c in checks) and not any(c.name == 'Your data' and c.state == OK for c in checks):
        return ('The core works: python3 -m src daily prints your digest. Unlock more only if you want it: '
                'README → Optional features')
    return 'All set. Apply to your next job: tools/apply-batch-claude.sh --max 1'


def render(checks):
    lines, area = [], None
    for check in checks:
        if check.area != area:
            area = check.area
            lines.append(f'\n{area}')
        lines.append(f'  {ICONS[check.state]} {check.name}: {check.detail}')
    lines.append(f'\n👉 Next step — {next_step(checks)}')
    return '\n'.join(lines).lstrip('\n')


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--json', action='store_true', help='print checks and next step as JSON')
    parser.add_argument('--next', action='store_true', help='print only the next step')
    parser.add_argument('--alert', action='store_true',
                        help='health checks only, and send one Telegram line if something is wrong')
    args = parser.parse_args()
    token = notion_token()
    # A Notion client only when Notion holds the data (a token can outlive a move to this Mac's store).
    on_notion = token and chosen({**os.environ, 'NOTION_TOKEN': token}) == 'notion'
    tracker = notion.Tracker(token, os.getenv('NOTION_APPLICATIONS_DB') or notion.DEFAULT_DATABASE_ID) \
        if on_notion else None
    if args.alert:
        from . import telegram
        try:
            token, chat_id = telegram.credentials()
            send = lambda text: telegram.send(text, token, chat_id)
        except SystemExit:
            send = None
        print(alert(active_store(tracker), send))
        return 0
    checks = run_checks(tracker, stores=active_store(tracker))
    if args.json:
        print(json.dumps({'checks': [asdict(c) for c in checks], 'next_step': next_step(checks)}, indent=2,
                         ensure_ascii=False))
    elif args.next:
        print(f'👉 Next step — {next_step(checks)}')
    else:
        print(render(checks))
    return 1 if any(c.state == FAIL for c in checks) else 0


if __name__ == '__main__':
    sys.exit(main())
