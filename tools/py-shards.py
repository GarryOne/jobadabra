"""Run the Python unit tests in parallel shards (one `unittest` process per shard); guarded by tests/test_py_shards.py.

Same tests as `python -m unittest discover -s tests`, split by module so wall time drops from the sum to roughly the slowest shard.
  python3 tools/py-shards.py [--jobs N] [--app-only] [module ...]   (no module = every tests/test_*.py)
Modules are balanced by measured seconds (tools/py-shard-weights.json, modules over 1.5 s; the rest count 0.5 s), slowest first; a stale weight only costs speed, never coverage.
Width: cores / push-check slots, +2 while free memory is over 3 GB (default_jobs; 6 here, 11 Oct 2026: 52 s -> 39 s; base 4: two push checks at once, each with the journey gate and the other suites beside it; 8 wide drove the load to 124-152, 11 Oct 2026). The slow modules (test_ship, test_heavy_lock, test_pre_push_check) are sleep- and git-bound, so they overlap well (11 Oct 2026: 4 shards ~84 s, the longest module 50 s).
Exit 0 when every shard passed (exit 0 and unittest's own summary); otherwise 1 with each failing shard's output on stderr.
"""
import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TESTS = ROOT / 'tests'
BOOTSTRAP = 'test_0_notion_ids'
# Tests of this repo's own scripts and hooks (git, bash, the push hook, ship, worktrees): not the desktop app. The release run's Build box leaves them out with --app-only
# (owner, 10 Oct 2026: "unit tests only related to the desktop app"); CI · Tests, without the flag, still runs them on every push.
DEV_TOOLING = ('test_affected_tests', 'test_check', 'test_check_slot', 'test_commit_subject', 'test_pre_push_areas', 'test_pre_push_budget', 'test_pre_push_check',
               'test_release_stable_guard', 'test_ship', 'test_ship_background', 'test_stop_means_stop', 'test_worktree')


# The lock family (owner, 12 Oct 2026): the heavy lock's, landing queue's and check slot's own tests (~150 s of shard time and the day's top flake) run on a PR only when it touches
# a lock path; CI · Tests passes the PR's changed files in JOB_PILOTTO_PY_CHANGED_FILE. A push to main, a local run or an unreadable list runs everything. Guarded by tests/test_lock_test_scope.py,
# which also fails when a lock test starts using a tools/ file that is not a lock path here.
LOCK_MODULES = ('test_red_fix_first', 'test_landing_lock', 'test_check_slot')
LOCK_PATHS = ('tools/heavy-lock', 'tools/check-slot.sh', 'tools/landing-lock.sh', 'tools/ship', 'tools/pr-body.sh', 'tools/pr-title.sh', 'tools/pr-conflict-fix.sh', 'tools/pr-rest-lib.sh', 'tools/pr-comments-lib.sh', 'tools/pr-body-format.py', 'tools/pr-screens.py', 'tools/red-main.sh', 'tools/revert-red.sh', 'tools/worktree.sh', 'tools/session-name.sh',
              'tools/recheck-needed.py', 'tools/pre-push-check.sh', 'tools/affected-tests.py', 'tools/wait-build-tag.sh', 'tools/py-shards.py', 'desktop/e2e/lib/heavy.mjs',
              'tests/test_heavy_lock', 'tests/heavy_wait.py', 'tests/heavy_lock_fixture.py', 'tests/ship_fixture.py', 'tests/test_lock_test_scope.py',
              *(f'tests/{m}.py' for m in LOCK_MODULES))


def is_lock_module(name):
    return name.startswith('test_heavy_lock') or name in LOCK_MODULES


def lock_tests_needed(changed):
    """changed: the PR's changed paths, or None when unknown. Only a known, non-empty list without a lock path leaves the lock tests out."""
    return not changed or any(path.replace('\\', '/').startswith(LOCK_PATHS) for path in changed)


def changed_files():
    listing = os.environ.get('JOB_PILOTTO_PY_CHANGED_FILE')
    try:
        return [line.strip() for line in Path(listing).read_text().splitlines() if line.strip()] if listing else None
    except OSError:
        return None


def all_modules():
    return sorted(p.stem for p in TESTS.glob('test_*.py'))


WEIGHTS = ROOT / 'tools' / 'py-shard-weights.json'


def weights():
    try:
        return json.loads(WEIGHTS.read_text())
    except (OSError, ValueError):
        return {}


DURATIONS = ['--durations', '0'] if sys.version_info >= (3, 12) else []   # unittest prints every test's time (3.12+): the shards name their slow tests


def ended_badly(out, code):
    """Why a shard failed, or None: a non-zero exit, or no unittest summary ("Ran N tests" then OK) even with exit 0. 26 Oct 2026: a test
    reached the scout's os._exit(0), the process ended halfway with exit 0, and the tests after it never ran while the shard passed."""
    if code:
        return f'exit {code}'
    if not re.search(r'^Ran \d+ tests?', out, re.M) or not re.search(r'^OK\b', out, re.M):
        return "ended without unittest's summary (an os._exit in the code a test ran?)"
    return None


def slowest(outputs):
    """From unittest --durations output: ([(module, seconds)], [(test, seconds)]), slowest first; a module is the test id's first test_* part."""
    modules, tests = {}, []
    for out in outputs:
        for secs, test_id in re.findall(r'^\s*([\d.]+)s\s+\S+ \(([\w.]+)\)\s*$', out, re.M):
            module = next((p for p in test_id.split('.') if p.startswith('test_')), test_id)
            modules[module] = modules.get(module, 0) + float(secs)
            tests.append((test_id.split('.', 1)[-1] if test_id.startswith(module) else test_id, float(secs)))
    return sorted(modules.items(), key=lambda kv: -kv[1]), sorted(tests, key=lambda kv: -kv[1])


def split(modules, jobs):
    """Greedy: slowest module first into the lightest shard. Every module lands in exactly one shard."""
    seconds = weights()
    shards = [[] for _ in range(max(1, min(jobs, len(modules))))]
    load = [0] * len(shards)
    for name in sorted(modules, key=lambda m: (-seconds.get(m, 0.5), m)):
        i = load.index(min(load))
        shards[i].append(name)
        load[i] += seconds.get(name, 0.5)
    return [s for s in shards if s]


def free_gb_from_vm_stat(text):
    """Free + inactive memory in GB from `vm_stat` text (the measure tools/heavy-lock.sh uses); None when the text is not vm_stat's."""
    size = re.search(r'page size of (\d+)', text)
    pages = re.findall(r'^Pages (?:free|inactive):\s+(\d+)', text, re.M)
    return sum(int(n) for n in pages) * int(size.group(1)) / 1073741824 if size and pages else None


def free_gb():
    try:
        return free_gb_from_vm_stat(subprocess.run(['vm_stat'], capture_output=True, text=True, timeout=5).stdout)
    except (OSError, subprocess.SubprocessError):
        return None


def default_jobs(cores, slots, free):
    """cores / push-check slots, two wider while free+inactive memory is over 3 GB (the slow modules sleep and wait on git, so extra shards overlap well; ~150 MB each); never over three quarters of the cores."""
    base = max(2, cores // (slots or 1))
    return min(max(base, cores * 3 // 4), base + 2) if free is not None and free > 3 and slots else base


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('modules', nargs='*', help='test modules to run (default: all)')
    parser.add_argument('--app-only', action='store_true', help='leave out the tests of this repo\'s own dev tooling (DEV_TOOLING)')
    parser.add_argument('--jobs', type=int, default=int(os.environ.get('JOB_PILOTTO_PY_JOBS', 0)) or default_jobs(os.cpu_count() or 4, int(os.environ.get('JOB_PILOTTO_CHECK_SLOTS', 2) or 0), free_gb()))   # JOB_PILOTTO_PY_JOBS=4 (or --jobs 4) is the old width; JOB_PILOTTO_PY_SERIAL=1 (tools/check.py) one process
    args = parser.parse_args(argv)
    modules = args.modules or all_modules()
    if args.app_only:
        modules = [m for m in modules if m not in DEV_TOOLING]
    if not args.modules and not lock_tests_needed(changed_files()):
        left = [m for m in modules if is_lock_module(m)]
        modules = [m for m in modules if not is_lock_module(m)]
        print(f'py-shards: lock tests left out: this change touches no lock path ({len(left)} modules; tools/py-shards.py LOCK_PATHS)', flush=True)
    if os.environ.get('JOB_PILOTTO_PY_DRY_RUN'):
        print('py-shards: dry run, modules: ' + ', '.join(modules))
        return 0
    if not modules:
        print('py-shards: no test modules found', file=sys.stderr)
        return 2
    env = dict(os.environ)
    env['PYTHONPATH'] = os.pathsep.join([str(TESTS), env.get('PYTHONPATH', '')]).rstrip(os.pathsep)
    started = time.monotonic()
    # test_0_notion_ids sets the fake IDs the whole suite imports against; discovery loads it first, so every shard does too.
    # Each shard writes to a file, never a pipe: a process a test starts (Node does this) can leave a shared pipe non-blocking, and a print meeting a
    # full pipe then raises BlockingIOError and Python exits 120 with every test passed (#2136, 26 Oct 2026). Guard: tests/test_py_shards.py.
    shard_list = split(modules, args.jobs)
    logs = [tempfile.TemporaryFile() for _ in shard_list]
    procs = [(shard, subprocess.Popen([sys.executable, '-m', 'unittest', '-q', '-b', *DURATIONS, BOOTSTRAP, *[m for m in shard if m != BOOTSTRAP]], cwd=ROOT, env=env,
                                      stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT))
             for shard, log in zip(shard_list, logs)]
    results = [None] * len(procs)
    def collect(i, proc):   # each shard's own end time, said the moment it ends (a live CI log is not blank until the last shard)
        proc.wait()
        logs[i].seek(0)
        out = logs[i].read().decode('utf-8', 'replace').replace('\r\n', '\n')
        logs[i].close()
        results[i] = (out, time.monotonic() - started)
        shard = procs[i][0]
        print(f'py-shards: shard {"FAILED" if ended_badly(out, proc.returncode) else "done"} {results[i][1]:.1f}s, {len(shard)} modules ({", ".join(shard[:3])}{", ..." if len(shard) > 3 else ""})', flush=True)
    print(f'py-shards: {len(procs)} shards started ({len(modules)} modules)', flush=True)
    threads = [threading.Thread(target=collect, args=(i, proc)) for i, (_, proc) in enumerate(procs)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    failed = ran = 0
    for (shard, proc), (out, _) in zip(procs, results):
        ran += sum(int(n) for n in re.findall(r'^Ran (\d+) tests?', out, re.M))
        why = ended_badly(out, proc.returncode)
        if why:
            failed += 1
            print(f'py-shards: shard FAILED, {why} ({len(shard)} modules: {", ".join(shard[:4])}...)\n{out}', file=sys.stderr)
    by_module, by_test = slowest([out for out, _ in results])
    if by_module:
        print('py-shards: slowest modules: ' + ', '.join(f'{m} {s:.0f}s' for m, s in by_module[:8]))
        print('py-shards: slowest tests: ' + ', '.join(f'{t} {s:.0f}s' for t, s in by_test[:5]))
    ran -= len(procs) - 1   # the bootstrap module's one test runs in every shard
    print(f'py-shards: {len(modules)} modules, {ran} tests, {len(procs)} shards, {"FAILED" if failed else "passed"} ({time.monotonic() - started:.1f}s)')
    return 1 if failed else 0


if __name__ == '__main__':
    raise SystemExit(main())
