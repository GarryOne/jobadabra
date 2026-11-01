"""After a refused push: do the commits that just landed on main touch anything this landing's push checks read? Guarded by tests/test_recheck_needed.py.

  python3 tools/recheck-needed.py --mine <file>... --incoming <file>...    exit 0 and one line "recheck: <why>", or exit 1 and "skip: <why>"

The push checks run the suites a change can break (tools/affected-tests.py) plus gates that read named paths. A refused push used to re-run all of them on the new
main (11 Oct 2026: 18 refusals, median 78 s, max 719 s). The rule keeps the net where a clash is possible and drops it where none is:
  recheck when both sides touched the same file, when the incoming files change the checks themselves, when an incoming file is a dependency or workflow file,
  when a test the incoming change picks is also picked by mine (or either side picks "all" in an area the other touches), or when the incoming commits
  touch a path the slow gates read and so does mine; otherwise skip, and CI is the net (a bad combination shows as a red main).
Doubt means recheck: an unreadable picker answer rechecks. ship.sh calls this; SHIP_RECHECK=1 there rechecks every time.
"""
import argparse
import importlib.util
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
# What the checks are made of: their own scripts, the picker, the gate cache, the hook config.
CHECKS_OWN = re.compile(r'^(tools/(pre-push-check|affected-tests|gate-cache|check-slot|heavy-lock|gate-cache-ignore|file-size|journey-gate)[^/]*|\.claude/settings\.json|\.github/workflows/.*)$')
DEPENDENCY = re.compile(r'(^|/)(package(-lock)?\.json|requirements[^/]*\.txt|pyproject\.toml)$')
# The paths the journey and ladder gates read (ship.sh slow_gate_paths).
SLOW_GATE = ('extension', 'desktop/lib', 'desktop/test', 'desktop/e2e', 'desktop/scripts', 'app-core/src', 'docs/flows')


def picker():
    spec = importlib.util.spec_from_file_location('affected_tests', HERE / 'affected-tests.py')
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.select


def under(f, prefixes):
    return any(f == p or f.startswith(p.rstrip('/') + '/') for p in prefixes)


def decide(mine, incoming, select=None):
    """(recheck?, why). `select` maps a file list to the picker's {area: [tests] | 'all'} answer (injected by the tests)."""
    if not incoming:
        return False, 'nothing came in'
    both = sorted(set(mine) & set(incoming))
    if both:
        return True, f'both sides touched {both[0]}'
    own = [f for f in incoming if CHECKS_OWN.match(f) or DEPENDENCY.search(f)]
    if own:
        return True, f'the incoming commits change the checks or a dependency file: {own[0]}'
    gate = [f for f in incoming if under(f, SLOW_GATE)]
    if gate and any(under(f, SLOW_GATE) for f in mine):
        return True, f'both sides touch paths the slow gates read ({gate[0]})'
    try:
        select = select or picker()
        theirs, ours = select(list(incoming)), select(list(mine))
    except Exception as exc:   # in doubt: check
        return True, f'the picker failed ({type(exc).__name__})'
    for area in ('python', 'desktop', 'worker', 'site'):
        a, b = theirs.get(area, []), ours.get(area, [])
        if not a or not b:
            continue
        if a == 'all' or b == 'all':
            return True, f'{area}: one side runs the whole suite'
        shared = sorted(set(a) & set(b))
        if shared:
            return True, f'{area}: both sides run {shared[0]}'
    return False, 'the incoming files reach none of the tests this landing runs'


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--mine', nargs='*', default=[])
    ap.add_argument('--incoming', nargs='*', default=[])
    args = ap.parse_args(argv)
    recheck, why = decide(args.mine, args.incoming)
    print(('recheck: ' if recheck else 'skip: ') + why)
    return 0 if recheck else 1


if __name__ == '__main__':
    sys.exit(main())
