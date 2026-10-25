#!/usr/bin/env python3
"""What the Chrome extension failed to fill, across recent runs: the input for improving it.

    python3 tools/fill-failures.py [--days 14] [--json]

Reads the extension's rows in 🎏 Job Apply — Agent Runs (Agent = Extension) from the Notion workspace the
desktop app is connected to (its NOTION_TOKEN and NOTION_AGENT_RUNS_DB, or env vars), parses each run's
field log and debug JSON, and groups every field left by reason, job site and extension version, most
frequent first. Read-only. Used by the record-applying-sites skill (.claude/skills/record-applying-sites/SKILL.md).
"""
import argparse
import collections
import json
import os
import subprocess
import sys
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from app_data_dir import app_data_dir  # noqa: E402

APP = app_data_dir()


def app_settings():
    try:
        return json.loads((APP / 'settings.json').read_text())
    except OSError:
        return {}


def notion(token, method, path, body=None):
    request = urllib.request.Request(f'https://api.notion.com/v1/{path}', method=method,
                                     data=json.dumps(body).encode() if body else None,
                                     headers={'Authorization': f'Bearer {token}', 'Notion-Version': '2022-06-28',
                                              'Content-Type': 'application/json'})
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)


KEYCHAIN_TOKENS = ('job-pilotto.notion.token', 'job-pilotto.notion.token-job-pilotto-2')


def keychain_tokens():
    """Every Notion token in this Mac's Keychain (the real workspace's and the test workspace's), in order."""
    found = []
    for service in KEYCHAIN_TOKENS:
        result = subprocess.run(['security', 'find-generic-password', '-s', service, '-w'], capture_output=True, text=True)
        if result.returncode == 0 and result.stdout.strip():
            found.append(result.stdout.strip())
    return found


def token_from_keychain():
    tokens = keychain_tokens()
    return tokens[0] if tokens else ''


def token_for(database, candidates, opens=None):
    """The first token that can open `database`. The database id comes from the app (the real workspace) while a Keychain token may
    belong to the test workspace: the test token used to be tried first and every run ended in HTTP 404 (5 Oct 2026). '' when none can."""
    def can_open(token):
        try:
            notion(token, 'GET', f'databases/{database}')
            return True
        except urllib.error.HTTPError:
            return False
    opens = opens or can_open
    return next((token for token in dict.fromkeys(item for item in candidates if item) if opens(token)), '')


def runs(token, database, since):
    body = {'filter': {'and': [{'property': 'Agent', 'select': {'equals': 'Extension'}},
                               {'timestamp': 'created_time', 'created_time': {'on_or_after': since.isoformat()}}]},
            'sorts': [{'timestamp': 'created_time', 'direction': 'descending'}], 'page_size': 100}
    for page in notion(token, 'POST', f'databases/{database}/query', body)['results']:
        blocks = notion(token, 'GET', f"blocks/{page['id']}/children?page_size=100")['results']
        raw = ''.join(t['plain_text'] for b in blocks if b['type'] == 'code' for t in b['code']['rich_text'])
        rows = [b for b in blocks if b['type'] == 'table']
        trace = []
        if rows:
            for row in notion(token, 'GET', f"blocks/{rows[0]['id']}/children?page_size=100")['results'][1:]:
                cells = [''.join(t['plain_text'] for t in c) for c in row['table_row']['cells']]
                trace.append(dict(zip(('label', 'required', 'source', 'result', 'why'), cells)))
        props = page['properties']
        yield {'url': props['Job URL'].get('url') or '', 'ats': (props['ATS'].get('select') or {}).get('name', ''),
               'run': page['url'], 'at': page['created_time'], 'trace': trace, 'debug': json.loads(raw) if raw else {}}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--days', type=int, default=14)
    parser.add_argument('--json', action='store_true')
    args = parser.parse_args(argv)
    settings = app_settings()
    database = os.getenv('NOTION_AGENT_RUNS_DB') or settings.get('notionIds', {}).get('NOTION_AGENT_RUNS_DB')
    if not database:
        sys.exit('Need NOTION_AGENT_RUNS_DB (or a connected Jobadabra app).')
    token = token_for(database, [os.getenv('NOTION_TOKEN', '')] + keychain_tokens())
    if not token:
        sys.exit(f'No Notion token on this Mac can open the Agent Runs database {database}: set NOTION_TOKEN to the token of the '
                 f'workspace the app is connected to, or share that database with the connection whose token is in the Keychain.')
    since = datetime.now(timezone.utc) - timedelta(days=args.days)
    all_runs = list(runs(token, database, since))
    left = collections.defaultdict(list)
    for run in all_runs:
        version = run['debug'].get('version', '?')
        for field in run['trace']:
            if field.get('result', '').startswith('✅'):
                continue
            reason = field.get('why') or 'unknown'
            if reason.startswith('legal/consent'):
                continue  # by design (or ticked by the setting)
            left[(reason, run['ats'])].append({'field': field.get('label'), 'version': version, 'run': run['run'], 'job': run['url']})
    report = [{'reason': reason, 'ats': ats, 'count': len(items), 'versions': sorted({i['version'] for i in items}),
               'examples': items[:5]} for (reason, ats), items in sorted(left.items(), key=lambda kv: -len(kv[1]))]
    if args.json:
        print(json.dumps({'runs': len(all_runs), 'since': since.isoformat(), 'failures': report}, indent=1))
        return 0
    print(f'{len(all_runs)} extension fill(s) since {since:%Y-%m-%d}; fields left, most frequent first:\n')
    for item in report:
        print(f"{item['count']:>3}× {item['ats'] or '?'} · {item['reason']}  (versions {', '.join(item['versions'])})")
        for example in item['examples'][:3]:
            print(f"       - {example['field']}  {example['run']}")
    if not report:
        print('Nothing left unfilled (besides legal choices).')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
