"""A fake `gh` for tests/test_ship_pr.py (12 Oct 2026): just the pull-request calls tools/ship-pr.sh makes, kept in the JSON file named by FAKE_GH_STATE.
With auto-merge on and no failing check pending, `gh pr view` merges the PR's branch into origin's main (rebased, like GitHub's rebase merge). Not a test module."""
import json
import os
import pathlib
import re
import subprocess
import sys
import tempfile
from pathlib import Path

path = Path(os.environ['FAKE_GH_STATE'])
state = json.loads(path.read_text())
argv = sys.argv[1:]
state.setdefault('calls', []).append(' '.join(argv))


def save():
    path.write_text(json.dumps(state))


def flag(name):
    return argv[argv.index(name) + 1] if name in argv else None


def git(*args, cwd=None):
    return subprocess.run(['git', *args], cwd=cwd, check=True, capture_output=True, text=True).stdout.strip()


def merge():
    work = tempfile.mkdtemp()
    git('clone', '-q', pathlib.Path(state['origin']).as_uri(), work)   # file:// (the pack protocol): a plain-path clone copies origin's pack folder while a push's background gc writes in it (CI, 12 Oct 2026)
    git('config', 'user.email', 't@example.com', cwd=work); git('config', 'user.name', 'Test', cwd=work)
    git('checkout', '-q', state['head'], cwd=work)
    git('rebase', '-q', 'origin/main', cwd=work)
    git('push', '-q', 'origin', 'HEAD:main', cwd=work)
    git('push', '-q', 'origin', ':' + state['head'], cwd=work)   # delete branch on merge
    state['state'] = 'MERGED'
    state['merge_sha'] = git('rev-parse', 'HEAD', cwd=work)


pending = state.get('fail_check') or state.get('fail_check_once')
if argv[:1] == ['api'] and '-i' in argv:   # tools/pr-rest-lib.sh's REST reads (27 Oct 2026): the PR, the head's check-runs and statuses
    p = argv[-1]
    if p.endswith('/check-runs?per_page=100'):
        if pending:
            state['step_red'] = bool(pending.get('step_red'))
            status, conclusion = {'cancel': ('completed', 'cancelled'), 'pending': ('in_progress', None)}.get(pending.get('bucket', 'fail'), ('completed', 'failure'))
            body = {'check_runs': [{'name': pending['name'], 'status': status, 'conclusion': conclusion, 'html_url': pending['link']}]}
            state.pop('fail_check_once', None)
        else:
            body = {'check_runs': [{'name': 'python', 'status': 'completed', 'conclusion': 'success', 'html_url': ''}]}
    elif p.endswith('/status'):
        body = {'statuses': []}
    elif re.search(r'/pulls/\d+$', p):
        if state.get('auto') and not pending and state.get('state') == 'OPEN':
            merge()
        st = state.get('state', 'OPEN')
        body = {'number': 1, 'html_url': 'https://example.test/pull/1', 'head': {'sha': 'h1', 'ref': state.get('head')}, 'state': 'open' if st == 'OPEN' else 'closed',
                'merged_at': 't' if st == 'MERGED' else None, 'merge_commit_sha': state.get('merge_sha'), 'mergeable': True}
    else:
        print('HTTP/2.0 404 Not Found\n\n{}'); save(); sys.exit(1)
    print('HTTP/2.0 200 OK\n\n' + json.dumps(body)); save(); sys.exit(0)
if argv[:1] == ['api']:
    # --jq .full_name: the repository answers (ship_mode); --jq .allow_auto_merge: the switch for review by hand (ship_review)
    if any('.steps' in a for a in argv): print('Core flow files up to date with main' if state.get('step_red') else ''); save(); sys.exit(0)
    print('example/repo' if '.full_name' in argv else ('true' if state.get('auto_merge_allowed') else 'false'))
elif argv[:2] == ['pr', 'list']:
    # without --head: every open PR with its commits (state 'others', for the no-stacking check)
    print(json.dumps(([{'number': 1}] if state.get('state') == 'OPEN' else []) if '--head' in argv else state.get('others', [])))
elif argv[:2] == ['pr', 'create']:
    state.update(state='OPEN', head=flag('--head'), auto=False, draft='--draft' in argv, title=flag('--title'))
    print('https://example.test/pull/1')
elif argv[:2] == ['pr', 'edit']:
    state['body'] = flag('--body') or state.get('body')
    state['title'] = flag('--title') or state.get('title')
elif argv[:2] == ['pr', 'ready']:
    state['draft'] = '--undo' in argv
elif argv[:2] == ['pr', 'merge']:
    state['auto'] = '--auto' in argv
elif argv[:2] == ['pr', 'view'] and flag('--jq') == '.title':
    print(state.get('title') or 'My change')
elif argv[:2] == ['pr', 'view']:
    if state.get('auto') and not pending and state.get('state') == 'OPEN':
        merge()
    print(json.dumps({'state': state.get('state', 'OPEN'), 'mergeable': 'MERGEABLE', 'url': 'https://example.test/pull/1',
                      'mergeCommit': {'oid': state['merge_sha']} if state.get('merge_sha') else None}))
elif argv[:2] == ['pr', 'checks']:
    if pending:
        state['step_red'] = bool(pending.get('step_red'))
        print(json.dumps([{'name': pending['name'], 'bucket': pending.get('bucket', 'fail'), 'link': pending['link']}]))
        state.pop('fail_check_once', None)
    else:
        print(json.dumps([{'name': 'python', 'bucket': 'pass', 'link': ''}]))
else:
    print(f'fake gh: unknown call {argv}', file=sys.stderr)
    save()
    sys.exit(1)
save()
