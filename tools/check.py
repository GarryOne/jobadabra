"""Run consistent fast, area or full project verification with supported runtimes and actionable failures."""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time
import tempfile

ROOT = Path(__file__).resolve().parents[1]
# Why (1 Nov 2026, owner: jobadabra is desktop + extension only): the `worker` suite's code moved to app-core/; the area key keeps its name so check names, caches and
# required checks stay (renaming it is parked in Linear).
AREA_DIR = {'worker': 'app-core'}
AREAS = ('python', 'worker', 'site', 'desktop') if (ROOT / 'admin').is_dir() else ('python', 'worker', 'desktop')   # the website is in the private repo jobadabra-web: its CI lays web/, admin/, api/, test/ … over this tree


def node_supported(version):
    parts = tuple(int(part) for part in version.strip().lstrip('v').split('.')[:3])
    return (parts[0] == 22 and parts >= (22, 13, 0)) or parts[0] >= 24


def find_node(env=None):
    env = os.environ if env is None else env
    candidates = [env.get('JOB_PILOTTO_CHECK_NODE'), shutil.which('node')]
    nvm = Path(env.get('NVM_DIR', str(Path.home() / '.nvm'))) / 'versions/node'
    if nvm.exists():
        candidates += [str(path / 'bin/node') for path in sorted(nvm.glob('v*'), reverse=True)]
    for candidate in candidates:
        if not candidate:
            continue
        try:
            version = subprocess.check_output([candidate, '--version'], text=True, stderr=subprocess.DEVNULL)
            if node_supported(version):
                return str(Path(candidate).resolve()), version.strip()
        except (OSError, ValueError, subprocess.CalledProcessError):
            continue
    raise RuntimeError('Node 22.13+ or 24+ is required. Use nvm use 22 or set JOB_PILOTTO_CHECK_NODE.')


def affected(base):
    """The tests a change can break (tools/affected-tests.py), or None: run everything. Local pushes only; CI never passes --affected-from."""
    if not base:
        return None
    listed = os.environ.get('JOB_PILOTTO_AFFECTED_FILES', '').splitlines()   # the Stop hook: the changed files incl. uncommitted ones (a commit-only diff misses them)
    out = subprocess.run([sys.executable, str(ROOT / 'tools/affected-tests.py'), *(['--files', *listed] if listed else ['--base', base])], capture_output=True, text=True, check=False)
    try:
        return json.loads(out.stdout)
    except ValueError:
        return None


def commands(area, fast, node, npm, picked='all', app_only=False):
    """picked: 'all' or the list of this area's test files/modules to run (everything else is left to CI)."""
    if area == 'python':
        if picked != 'all':
            return [(ROOT, [sys.executable, 'tools/py-shards.py', *picked])] if picked else []
        if os.environ.get('JOB_PILOTTO_PY_SERIAL'):      # the old single-process run, to compare with the shards
            return [(ROOT, [sys.executable, '-m', 'unittest', 'discover', '-s', 'tests', '-q'])]
        return [(ROOT, [sys.executable, 'tools/py-shards.py', *(['--app-only'] if app_only else [])])]
    if area == 'site':   # the website's tests sit in test/ at the top level of the joined tree (jobadabra-web, 21 Oct 2026)
        return [(ROOT, [node, '--test', *(picked if picked != 'all' else ['test/**/*.test.js'])])]
    folder = ROOT / AREA_DIR.get(area, area)
    if picked != 'all':
        pre = {'desktop': [(folder, [node, 'scripts/stage.mjs']), (folder, [npm, 'run', 'lint'])],
               'worker': [(folder, [node, 'scripts/stage-shared.mjs'])]}.get(area, [])
        return pre + ([(folder, [node, '--test', *picked])] if picked else [])
    if fast and area == 'desktop':
        return [(folder, [node, 'scripts/stage.mjs']),
                (folder, [npm, 'run', 'lint']),
                (folder, [node, '--test', 'test/lifecycle.test.js', 'test/app-scenarios.test.js', 'test/session-contracts.test.js', 'test/ipc.test.js', 'test/codemap.test.js'])]
    return [(folder, [npm, 'test'])]


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--area', choices=AREAS, action='append', help='repeat to select suites; default: all')
    parser.add_argument('--app-only', action='store_true', help='python: leave out the tests of the repo\'s own dev tooling (the release run\'s Build box); other areas ignore it')
    parser.add_argument('--fast', action='store_true', help='desktop lint and focused lifecycle/contract checks (default area: desktop)')
    parser.add_argument('--affected-from', metavar='REF', help='local pushes: run only the tests this change (HEAD vs REF) can break; without it everything runs, as on CI')
    parser.add_argument('--clean-install', action='store_true', help='verify desktop/Worker/site lockfiles in temporary folders before checks')
    args = parser.parse_args(argv)
    areas = args.area or (['desktop'] if args.fast else list(AREAS))
    if sys.version_info < (3, 12):
        print('check: Python 3.12+ is required.', file=sys.stderr)
        return 2
    env = dict(os.environ)
    env['JOB_PILOTTO_DISABLE'] = 'mail,notion,telegram,google_jobs'
    # Match CI even when the developer's global npm config skips peer dependencies.
    env['npm_config_legacy_peer_deps'] = 'false'
    node = npm = None
    try:
        if args.clean_install or any(area != 'python' for area in areas):
            node, version = find_node()
            env['PATH'] = str(Path(node).parent) + os.pathsep + env.get('PATH', '')
            npm = shutil.which('npm', path=env['PATH'])
            if not npm:
                raise RuntimeError('npm is missing beside the supported Node runtime.')
            print(f'check: Node {version}', flush=True)
        print(f'check: Python {sys.version.split()[0]}', flush=True)
        for area in areas:
            package = json.loads((ROOT / ('workers/www' if area == 'site' else AREA_DIR.get(area, area)) / 'package.json').read_text()) if area != 'python' else {}
            needs_modules = bool(package.get('dependencies') or package.get('devDependencies'))
            if needs_modules and not (ROOT / area / 'node_modules').is_dir():
                raise RuntimeError(f'{area}/node_modules is missing. Use tools/worktree.sh or run npm ci in {area}/.')
            if area == 'desktop' and not (ROOT / 'desktop/node_modules/eslint').exists():
                raise RuntimeError('Desktop dependencies are outdated: run npm ci in desktop/.')
    except RuntimeError as error:
        print(f'check: {error}', file=sys.stderr)
        return 2
    if args.clean_install:
        for area in [a for a in ('desktop', 'worker') if (ROOT / AREA_DIR.get(a, a)).is_dir()]:
            folder = ROOT / AREA_DIR.get(area, area)
            with tempfile.TemporaryDirectory(prefix='job-pilotto-check-') as scratch:
                for name in ('package.json', 'package-lock.json'):
                    shutil.copyfile(folder / name, Path(scratch) / name)
                print(f'check: {area} clean npm ci', flush=True)
                result = subprocess.run([npm, 'ci', '--ignore-scripts', '--no-audit', '--no-fund'], cwd=scratch, env=env, check=False)
                if result.returncode:
                    print(f'check: {area} clean install failed', file=sys.stderr)
                    return 1
    failed = []
    plan = affected(args.affected_from)
    for area in dict.fromkeys(areas):
        started = time.monotonic()
        picked = plan.get(area, 'all') if plan else 'all'
        print(f'check: {area} started' + ('' if picked == 'all' else f' ({len(picked)} affected test files; the full suite runs on CI)'), flush=True)
        for folder, command in commands(area, args.fast, node, npm, picked, args.app_only):
            try:
                result = subprocess.run(command, cwd=folder, env=env, check=False)
            except OSError as error:
                print(f'check: could not launch {area}: {error}', file=sys.stderr)
                failed.append(area)
                break
            if result.returncode:
                failed.append(area)
                break
        print(f'check: {area} {"FAILED" if area in failed else "passed"} ({time.monotonic() - started:.1f}s)', flush=True)
    if failed:
        print('check: reproduce with tools/check.sh ' + ' '.join(f'--area {area}' for area in failed), file=sys.stderr)
        return 1
    print('check: all selected checks passed', flush=True)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
