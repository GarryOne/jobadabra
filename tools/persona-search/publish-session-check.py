"""Publish one finished local search check to /admin/lab-job-search "Session checks" so other sessions read it (owner, 24 Oct 2026).
Usage: python3 tools/persona-search/publish-session-check.py <out dir> <case> --session <name> --label "Nurse, Zagreb" --country Croatia --role nurse --mode full|quick
           --build <sha> [--local-jobs N] [--broke "..."] [--conclusion "..."] [--prs "#1825 #1835"] [--dry]
<out dir>/<case>/presses.jsonl and run-1.log are run.mjs's output. The key is the Keychain item job-pilotto.site.session_checks_key (its own key, never the CI one); never print it.
Counts, seconds, board names with listed/relevant counts and two short sentences go up: no job titles, companies or CV text (the site cuts anything else). Guard: tests/test_publish_session_check.py."""
import argparse
import datetime
import json
import re
import subprocess
import sys
import urllib.request
from pathlib import Path

URL = 'https://www.jobpilotto.top/search-lab/session-checks'
USER_AGENT = 'jobadabra-session-check/1'   # Cloudflare refuses Python's default agent with error 1010 before the Worker sees the request (24 Oct 2026)
KEYCHAIN = ('job-pilotto', 'job-pilotto.site.session_checks_key')
BOARD = re.compile(r'Job boards found: (?P<name>.+?) (?P<listed>\d+) job\(s\), (?P<relevant>\d+) relevant(?: \((?P<note>[^)]*)\))?\s*$')
OWN_SECTION = re.compile(r'Job boards found: (?P<name>.+?) read from its own section')


def boards(log):
    """[{name, listed, relevant, note}] from a run's log: the last counts line of each board; 'own section' noted when its section was read."""
    found, sections = {}, set()
    for line in log.splitlines():
        line = re.sub(r'^\[\d+s\]\s*', '', line)
        if match := OWN_SECTION.search(line):
            sections.add(match.group('name'))
        elif match := BOARD.search(line):
            found[match.group('name')] = {'name': match.group('name'), 'listed': int(match.group('listed')), 'relevant': int(match.group('relevant')),
                                          'note': (match.group('note') or '')[:60]}
    for name in sections & set(found):
        found[name]['note'] = found[name]['note'] or 'own section read'
    return list(found.values())[:14]


def row(out, case, args, now=None):
    """The check as the site takes it, from run.mjs's first press and log."""
    folder = Path(out) / case
    press = json.loads(next(line for line in (folder / 'presses.jsonl').read_text(encoding='utf-8').splitlines() if line.strip()))
    log = (folder / 'run-1.log').read_text(encoding='utf-8', errors='ignore') if (folder / 'run-1.log').exists() else ''
    ttfr = press.get('ttfr') or {}
    when = (now or datetime.datetime.fromtimestamp((folder / 'presses.jsonl').stat().st_mtime, datetime.timezone.utc)).strftime('%Y-%m-%dT%H:%M:%SZ')
    return {'session': args.session, 'case_id': case, 'label': args.label or case, 'country': args.country or '', 'role': args.role or '', 'run_at': when, 'build': args.build,
            'mode': args.mode, 'state': 'failed' if press.get('crashes') else 'ok', 'seconds': press.get('seconds'), 'first_s': ttfr.get('first_in_places_s'),
            'local_jobs': args.local_jobs if args.local_jobs is not None else press.get('local_jobs'), 'in_places': press.get('in_places'), 'scored': press.get('scored_in_places'), 'fit70': press.get('fit70_in_places'),
            'boards': boards(log), 'broke': args.broke or '', 'conclusion': args.conclusion or '', 'prs': args.prs or ''}


def key():
    return subprocess.run(['security', 'find-generic-password', '-a', KEYCHAIN[0], '-s', KEYCHAIN[1], '-w'], capture_output=True, text=True, check=True).stdout.strip()


def main(argv):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('out')
    parser.add_argument('case')
    parser.add_argument('--session', required=True)
    for flag in ('label', 'country', 'role', 'build', 'broke', 'conclusion', 'prs'):
        parser.add_argument(f'--{flag}')
    parser.add_argument('--local-jobs', type=int, help='for a run made before presses.jsonl carried local_jobs: the count by place text')
    parser.add_argument('--mode', choices=['full', 'quick'], default='full')
    parser.add_argument('--dry', action='store_true')
    args = parser.parse_args(argv)
    body = {'rows': [row(args.out, args.case, args)]}
    if args.dry:
        print(json.dumps(body, ensure_ascii=False, indent=2))
        return 0
    request = urllib.request.Request(URL, data=json.dumps(body).encode(), method='PUT', headers={'Authorization': f'Bearer {key()}', 'Content-Type': 'application/json', 'User-Agent': USER_AGENT})
    try:
        with urllib.request.urlopen(request, timeout=30) as answer:
            print(answer.status, answer.read().decode())
    except urllib.error.HTTPError as error:
        print(error.code, error.read().decode())
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
