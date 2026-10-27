"""A fake `gh api -i [-H 'If-None-Match: <etag>'] <path>` for the REST PR readers (tools/pr-rest-lib.sh): answers from files in $FAKE_GH_DIR, no network.
rest/<path, every non-alphanumeric as _>: the JSON body for that path, with an ETag of its hash (304 when the request sends that ETag). A missing file: [] for a list, else 404.
The watcher's looks (tests/test_ship_watch.py): when states exists, repos/<r>/pulls/<n> and the head's check-runs/status follow one line per look of
states (OPEN | MERGED <sha> | CLOSED | REFUSED), mergeables, checks (pending | <failing name> | empty = pass), runs (none | running | gate | ok), verdicts (pending | none | ok).
Every call is appended to calls; any other gh command fails like an unknown call."""
import hashlib
import json
import os
import re
import sys
from pathlib import Path

d = Path(os.environ['FAKE_GH_DIR'])
argv = sys.argv[1:]
with open(d / 'calls', 'a') as f:
    f.write(' '.join(argv) + '\n')
if argv[:1] != ['api'] or '-i' not in argv:
    print(f'fake gh: unknown call {argv}', file=sys.stderr)
    sys.exit(1)
path = argv[-1]
sent = next((a.split(': ', 1)[1] for a in argv if a.startswith('If-None-Match: ')), '')


def line(name, n, default=''):
    rows = (d / name).read_text().splitlines() if (d / name).exists() else []
    return rows[n - 1] if n <= len(rows) else (rows[-1] if rows and name == 'states' else default)


def answer(body, status='200 OK'):
    text = json.dumps(body)
    etag = 'W/"' + hashlib.sha1(text.encode()).hexdigest()[:12] + '"'
    if sent == etag:
        print('HTTP/2.0 304 Not Modified\netag: ' + etag + '\n')
        sys.exit(1)   # like gh: a 304 exits 1
    print(f'HTTP/2.0 {status}\netag: {etag}\ncontent-type: application/json\n\n{text}')
    sys.exit(0)


def look():
    return int((d / 'looks').read_text() or 0) if (d / 'looks').exists() else 0


m = re.fullmatch(r'repos/([^/]+/[^/]+)/pulls/(\d+)', path)
if (d / 'states').exists() and m:
    n = look() + 1
    (d / 'looks').write_text(str(n))
    state = line('states', n).split()
    if state[0] == 'REFUSED':
        print('HTTP/2.0 403 Forbidden\n\n{"message":"API rate limit exceeded"}')
        sys.exit(1)
    mergeable = {'CONFLICTING': False, 'UNKNOWN': None}.get(line('mergeables', n) or 'MERGEABLE', True)
    answer({'number': int(m[2]), 'html_url': f'https://github.com/{m[1]}/pull/{m[2]}', 'head': {'sha': 'new1', 'ref': 'feature'},
            'state': 'open' if state[0] == 'OPEN' else 'closed', 'merged_at': '2026-10-27T10:00:00Z' if state[0] == 'MERGED' else None,
            'merge_commit_sha': state[1] if state[0] == 'MERGED' else None, 'mergeable': mergeable})
if (d / 'states').exists() and path.endswith('/commits/new1/check-runs?per_page=100'):
    n, runs, check = look(), line('runs', look()) or 'ok', line('checks', look())
    if runs == 'none': answer({'check_runs': []})
    if runs == 'running' or check == 'pending': answer({'check_runs': [{'name': 'x', 'status': 'in_progress', 'conclusion': None}]})
    one = {'name': check, 'status': 'completed', 'conclusion': 'failure'} if check else {'name': 'x', 'status': 'completed', 'conclusion': 'success'}
    gate = [{'name': 'All checks passed', 'status': 'completed', 'conclusion': 'success'}] if runs == 'gate' else []
    answer({'check_runs': [one] + gate})
if (d / 'states').exists() and path.endswith('/commits/new1/status'):
    runs = line('runs', look())   # like pr-verdict.yml: no status before the head's runs exist, pending while they run, none for runs older than the status
    verdict = line('verdicts', look()) or {'gate': 'none', 'none': 'none', 'running': 'pending'}.get(runs, 'ok')
    answer({'statuses': [] if verdict == 'none' else [{'context': 'All checks passed', 'state': 'pending' if verdict == 'pending' else 'success', 'target_url': 'u'}]})
f = d / 'rest' / re.sub(r'[^A-Za-z0-9]', '_', path)
if f.exists():
    answer(json.loads(f.read_text()))
if re.search(r'/(comments|reviews|commits)\?|/pulls\?', path):
    answer([])
print('HTTP/2.0 404 Not Found\n\n{"message":"Not Found"}')
sys.exit(1)
