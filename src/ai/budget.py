"""Monthly AI budget: how much of this month's Anthropic spend limit is used, and what to do about it.

Spend comes from Anthropic's Usage & Cost Admin API when an Admin API key is available
(ANTHROPIC_ADMIN_KEY, or the Keychain entry job-pilotto.anthropic.admin-key) — the exact figure the
console shows. Without one (Admin keys need an organization account), it is the sum of this month's runs' AI cost
(stores.cron_runs: ⏱️ Search runs "AI cost (USD)" in Notion), which every AI run logs (crawls, kits, insights, interviews, mail).

Levels, against JOB_PILOTTO_MONTHLY_BUDGET_USD (your console limit, default 15):
  ok     below 70%
  warn   70% or more: one Telegram alert
  pause  90% or more: one Telegram alert, and the scheduled crawl skips optional AI (auto-kits, scoring
         beyond the top jobs) so mail, insights and interview reviews keep working until the reset.
"""
from datetime import datetime, timezone
import json
import os
import subprocess
import sys
import urllib.parse
import urllib.request

from .. import secret_store

WARN_AT, PAUSE_AT = 0.70, 0.90
COST_REPORT = 'https://api.anthropic.com/v1/organizations/cost_report'
# Kept when paused: enough to score and enrich the few best new jobs.
PAUSED_SCORE_MAX, PAUSED_ENRICH_MAX = 10, 30


def monthly_budget():
    try:
        return float(os.getenv('JOB_PILOTTO_MONTHLY_BUDGET_USD') or 15)
    except ValueError:
        return 15.0


def admin_key():
    key = os.getenv('ANTHROPIC_ADMIN_KEY')
    if key or sys.platform != 'darwin' or secret_store.isolated():  # the end-to-end journey never reaches the owner's Anthropic organisation
        return key
    found = subprocess.run(['security', 'find-generic-password', '-a', os.getenv('USER', ''),
                            '-s', 'job-pilotto.anthropic.admin-key', '-w'], capture_output=True, text=True)
    return found.stdout.strip() or None


def month_start(now):
    return now.astimezone(timezone.utc).replace(day=1, hour=0, minute=0, second=0, microsecond=0)


def admin_spend(key, now, opener=urllib.request.urlopen):
    """USD spent this month per Anthropic's cost report (amounts are decimal strings in cents)."""
    params = {'starting_at': month_start(now).strftime('%Y-%m-%dT%H:%M:%SZ'),
              'ending_at': now.astimezone(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'), 'limit': 31}
    total, page = 0.0, None
    while True:
        query = dict(params, **({'page': page} if page else {}))
        request = urllib.request.Request(f'{COST_REPORT}?{urllib.parse.urlencode(query)}', headers={
            'x-api-key': key, 'anthropic-version': '2023-06-01', 'User-Agent': 'JobPilotto/1.0'})
        with opener(request, timeout=20) as response:
            data = json.load(response)
        for bucket in data.get('data', []):
            for result in bucket.get('results', []):
                total += float(result.get('amount') or 0) / 100
        page = data.get('next_page')
        if not data.get('has_more') or not page:
            return total


def ledger_spend(stores, now):
    """USD this month from the run history (every AI run logs its cost in its stats)."""
    runs = stores.cron_runs.list(since=month_start(now).date().isoformat())
    return sum((run.get('stats') or {}).get('ai_cost_usd') or 0 for run in runs)


def status(stores, now=None, opener=urllib.request.urlopen):
    """{'spent', 'budget', 'pct', 'level', 'source'} for this month. stores: the active store (src/stores open_stores)."""
    now = now or datetime.now(timezone.utc)
    budget, key, spent, source = monthly_budget(), admin_key(), None, 'Jobadabra log'
    from . import providers
    if key and providers.spec().family == 'claude':   # Anthropic's own report; an OpenAI engine's spend is in the run log
        try:
            spent, source = admin_spend(key, now, opener), 'Anthropic cost report'
        except Exception as error:  # noqa: BLE001 — fall back to the log rather than fail the run
            print(f'Warning: Anthropic cost report unavailable ({type(error).__name__}); using the run log')
    if spent is None:
        spent = ledger_spend(stores, now)
    pct = spent / budget if budget else 0.0
    level = 'pause' if pct >= PAUSE_AT else 'warn' if pct >= WARN_AT else 'ok'
    return {'spent': round(spent, 2), 'budget': budget, 'pct': pct, 'level': level, 'source': source}


def describe(info):
    return f"${info['spent']:.2f} of ${info['budget']:.0f} this month ({info['pct']:.0%}, {info['source']})"


ALERT_TABLE = 'CREATE TABLE IF NOT EXISTS budget_alerts (month TEXT, level TEXT, PRIMARY KEY (month, level))'


def alert_once(db, info, send, now=None):
    """Send the Telegram alert for this level once per month (state in the crawl's SQLite)."""
    if info['level'] == 'ok' or not send:
        return False
    db.execute(ALERT_TABLE)
    month = (now or datetime.now(timezone.utc)).strftime('%Y-%m')
    if db.execute('SELECT 1 FROM budget_alerts WHERE month=? AND level=?', (month, info['level'])).fetchone():
        return False
    if info['level'] == 'pause':
        text = (f"⚠️ <b>AI budget</b>\n{info['pct']:.0%} used · {describe(info)}\n\n<b>What is paused</b>\n"
                "Auto-kits and extra scoring, until the limit resets on the 1st. Mail, insights and interview reviews keep running.\n\n"
                "<b>Next step</b>\nTo resume now, raise the limit in the Anthropic console and JOB_PILOTTO_MONTHLY_BUDGET_USD.")
    else:
        text = (f"💸 <b>AI budget</b>\n{info['pct']:.0%} used · {describe(info)}\n\n<b>What happens next</b>\n"
                "At 90% the optional AI steps pause so the essentials keep running.")
    send(text)
    db.execute('INSERT OR IGNORE INTO budget_alerts VALUES (?, ?)', (month, info['level']))
    db.commit()
    return True


def apply_caps(args, info, warnings):
    """At 'pause', turn the scheduled crawl's optional AI down; returns True if anything changed."""
    if info['level'] != 'pause':
        return False
    args.auto_kit_max = 0
    if args.score_max:
        args.score_max = min(args.score_max, PAUSED_SCORE_MAX)
    if args.enrich_max:
        args.enrich_max = min(args.enrich_max, PAUSED_ENRICH_MAX)
    # The AI that helps find sources (careers pages, alert emails, scout ideas) is optional too: off until the month resets.
    off = [name for name in (os.getenv('JOB_PILOTTO_DISABLE') or '').split(',') if name.strip()]
    os.environ['JOB_PILOTTO_DISABLE'] = ','.join(dict.fromkeys(off + ['page_reader', 'job_alerts', 'scout_ai']))
    warnings.append(f"budget {info['pct']:.0%}: auto-kits off, scoring capped at {PAUSED_SCORE_MAX}, AI source reading off")
    return True
