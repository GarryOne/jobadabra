"""Runs the private lab repo's tests on a public runner and posts one `lab-ci` status on the lab commit (the public Action log shows counts only)."""
import base64
import json
import os
import re
import subprocess
import sys
import tempfile
import urllib.request

LAB = 'GarryOne/jobadabra-lab'
CONTEXT = 'lab-ci'
DESCRIPTION = 'pr-description'   # the lab's own Actions cannot run until 1 Nov 2026: the description check runs here and reports on the lab PR
API = 'https://api.github.com'
SAFE_ENV = ('PATH', 'HOME', 'LANG', 'TMPDIR', 'JOB_PILOTTO_PUBLIC')   # the tests see no token, no workflow secret; JOB_PILOTTO_PUBLIC = this checkout (the lab's discovery tests read the engine)


def parse_summary(output):
    """-> (ran, failed_names): unittest's "Ran N tests" and its FAIL/ERROR lines. Names are for the lab PR's status, never the public log."""
    ran = re.search(r'(?m)^Ran (\d+) tests? in', output)
    names = re.findall(r'(?m)^(?:FAIL|ERROR): (\S+)', output)
    return (int(ran.group(1)) if ran else 0), names


def describe(ran, names, code):
    if code == 0 and ran:
        return 'success', f'{ran} tests passed'
    if names:
        head = ', '.join(n.split('.')[-1] for n in names)
        return 'failure', f'{len(names)} of {ran} failed: {head}'[:140]
    return 'failure', 'the tests did not run to the end'


def api(token, method, path, body=None):
    req = urllib.request.Request(API + path, method=method, data=json.dumps(body).encode() if body else None,
                                 headers={'Authorization': f'Bearer {token}', 'Accept': 'application/vnd.github+json', 'User-Agent': CONTEXT})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read() or b'null')


def post_status(token, sha, state, text):
    api(token, 'POST', f'/repos/{LAB}/statuses/{sha}', {'state': state, 'context': CONTEXT, 'description': text})


def description_gap(title, body):
    """The same check the public and site PRs get in CI (tools/pr-body-check.py): -> '' when laid out, else what is missing."""
    import importlib.util
    spec = importlib.util.spec_from_file_location('pr_body_check', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'pr-body-check.py'))
    check = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(check)
    gap = check.title_gap(title.strip()) or '; '.join(check.missing(body))
    return gap


def post_description(token, label, sha):
    """Posts the `pr-description` status on a lab PR's head; never raises into the tests' result. -> True when laid out."""
    m = re.match(r'PR #(\d+)$', label)
    if not m:
        return True
    pr = api(token, 'GET', f'/repos/{LAB}/pulls/{m.group(1)}')
    gap = description_gap(pr.get('title') or '', pr.get('body') or '')
    api(token, 'POST', f'/repos/{LAB}/statuses/{sha}', {'state': 'failure' if gap else 'success', 'context': DESCRIPTION,
                                                         'description': (gap or 'laid out (headings and separators)')[:140]})
    return not gap


def targets(token, event, pr):
    """-> [(label, sha)] to test: the dispatched PR's head, every open PR head with no result yet (the sweep), or lab main (the daily run)."""
    if event == 'workflow_dispatch':
        return [(f'PR #{pr}', api(token, 'GET', f'/repos/{LAB}/pulls/{pr}')['head']['sha'])]
    if event == 'schedule-main':
        return [('main', api(token, 'GET', f'/repos/{LAB}/commits/main')['sha'])]
    out = []
    for p in api(token, 'GET', f'/repos/{LAB}/pulls?state=open&per_page=50'):
        sha = p['head']['sha']
        if not any(s['context'] == CONTEXT for s in api(token, 'GET', f'/repos/{LAB}/commits/{sha}/statuses?per_page=100')):
            out.append((f'PR #{p["number"]}', sha))
    return out


def run_tests(token, sha, work):
    """Clone the lab at sha and run its tests with no secrets in the environment; the output stays in a file."""
    auth = base64.b64encode(f'x-access-token:{token}'.encode()).decode()
    print(f'::add-mask::{auth}', flush=True)
    env = dict(os.environ, GIT_CONFIG_COUNT='1', GIT_CONFIG_KEY_0='http.extraheader', GIT_CONFIG_VALUE_0=f'AUTHORIZATION: basic {auth}')
    repo = os.path.join(work, 'lab')
    for cmd in (['git', 'clone', '--quiet', '--no-checkout', f'https://github.com/{LAB}.git', repo], ['git', '-C', repo, 'checkout', '--quiet', sha]):
        if subprocess.run(cmd, env=env, capture_output=True).returncode:
            return 0, [], 1
    clean = {k: os.environ[k] for k in SAFE_ENV if k in os.environ}
    log = os.path.join(work, 'out.txt')
    with open(log, 'w') as f:
        code = subprocess.run([sys.executable, '-m', 'unittest', 'discover', '-s', 'tests'], cwd=repo, env=clean, stdout=f, stderr=subprocess.STDOUT).returncode
    ran, names = parse_summary(open(log).read())
    return ran, names, code


def main():
    token, event, pr = os.environ['LAB_TOKEN'], os.environ['LAB_EVENT'], os.environ.get('LAB_PR', '')
    bad = 0
    for label, sha in targets(token, event, pr):
        try:
            post_status(token, sha, 'pending', 'running the lab tests')
        except Exception as e:
            print(f'{CONTEXT}: the CI App cannot post a status on the lab ({getattr(e, "code", "error")}); it needs statuses: write')
            return 1
        with tempfile.TemporaryDirectory() as work:
            ran, names, code = run_tests(token, sha, work)
        state, text = describe(ran, names, code)
        post_status(token, sha, state, text)
        print(f'{label} {sha[:7]}: ran {ran}, failed {len(names)}, {state}')   # the whole public log: counts, no names
        bad += state != 'success'
        try:
            laid_out = post_description(token, label, sha)
            print(f'{label} description: {"laid out" if laid_out else "missing parts"}')
            bad += not laid_out
        except Exception as e:
            print(f'{DESCRIPTION}: could not check {label} ({getattr(e, "code", "error")})')
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())
