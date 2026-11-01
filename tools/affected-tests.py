"""Which tests a change can break: the local push check runs only these. Guarded by tests/test_affected_tests.py. CI does not use it: GitHub's `paths:` decides there (tests/test_workflow_paths.py).

  python3 tools/affected-tests.py --base origin/main            (JSON on stdout: per area a list of test files, or "all")
  python3 tools/affected-tests.py --files src/store.py desktop/lib/x.js

A test is selected when (1) its transitive imports reach a changed file, (2) its text names a changed file (path, file name or a
Python dotted name: covers fs reads, subprocess calls and fixtures), or (3) it scans the whole tree (always run). The e2e harness's own tests (desktop/e2e/test) are an area too ("e2e"); their reach also
comes from desktop/e2e/lib/test-reach.mjs (new URL(...) folder reads, "// Reaches:" lines), through tools/e2e-test-reach.mjs. A change nothing
maps (dependency files, config, unknown top-level paths, an unreadable source) selects "all" for that area: when in doubt, run it.
"""
import argparse
import ast
import functools
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SKIP = {'node_modules', '.git', '.claude', 'dist', 'build', '__pycache__', '.venv', 'shared'}
JS_EXT = ('.js', '.mjs', '.cjs')
IMPORT_RE = re.compile(r"""(?:require\(\s*|\bfrom\s+|\bimport\s*\(\s*|\bimport\s+)['"](\.[^'"]*)['"]""")
SCANNER_RE = re.compile(r'''readdirSync|globSync|git ls-files|git ls-tree|['"]ls-(?:files|tree)['"]''')   # the last: execFileSync('git', ['ls-files', ...]) (15 Oct 2026)
ENGINE_RE = re.compile(r'python|(?:^|[^A-Za-z])src[/.]')
NODE_AREAS = {'desktop': 'desktop/test', 'worker': 'worker/test', 'site': 'test', 'e2e': 'desktop/e2e/test'}   # site: the website's tests, only in the joined tree of jobadabra-web; e2e: the harness's own tests (c27, 1 Nov 2026)
AREAS = ('python', 'desktop', 'worker', 'site', 'e2e')
# Why (c27, 1 Nov 2026, owner "Yes, via affected-tests"): ~70 harness tests scan every suite (ratchets, step lists, guards); #2767 found them one CI round at a time (4 rounds).
# They are picked as scanners only for a change the harness can read (the app, the extension, the Worker, the workflows); a Python-only edit picks them by reach or mention alone.
E2E_SCAN_FOR = ('desktop/', 'extension/', 'worker/', '.github/')
PREFIX = {'e2e': 'desktop/e2e/'}   # the folder a picked test path is printed relative to (default: the area name + '/')
ALL_TRIGGERS = re.compile(r'(^|/)(package(-lock)?\.json|requirements[^/]*\.txt|pyproject\.toml|eslint\.config\.mjs)$|^\.github/workflows/build\.yml$')
# A dependency file inside one JS area (desktop/e2e/package.json) makes THAT area run whole; the other areas still pick by imports and mentions (11 Oct 2026: 1 of 150 commits, the e2e
# harness's package.json, ran Python, worker and site whole for nothing). A root-level file (package.json, requirements, pyproject) still runs everything.
SCOPED_DEPS = re.compile(r'^(desktop|worker|workers/www)/(.+/)?package(-lock)?\.json$')
NO_TEST_EFFECT = re.compile(r'\.md$|^docs/|^LICENSE|\.gitignore$')
KNOWN = ('src/', 'tests/', 'tools/', 'config/', 'templates/', 'desktop/', 'extension/', 'worker/', 'site/', 'web/', 'admin/', 'api/', 'shared/', 'workers/', 'db/', 'test/', 'jobs/', 'media/', 'preview/', '.github/', 'docs/', '.gitattributes')   # .gitattributes: the tests that name it (test_ship, merge-baseline) are picked by mention


def walk(suffixes):
    out = []
    for p in ROOT.rglob('*'):
        if p.is_file() and p.suffix in suffixes and not (set(p.relative_to(ROOT).parts) & SKIP):
            out.append(p)
    return out


def read(p):
    try:
        return p.read_text(errors='replace')
    except OSError:
        return ''


def rel(p):
    return p.relative_to(ROOT).as_posix()


# --- Python import graph -------------------------------------------------------------------------------------------------------------
def py_module_name(p):
    r = p.relative_to(ROOT)
    parts = list(r.with_suffix('').parts)
    if parts[0] == 'tests':        # tests/ is on sys.path as a top-level folder
        parts = parts[1:]
    if parts and parts[-1] == '__init__':
        parts = parts[:-1]
    return '.'.join(parts)



@functools.lru_cache(maxsize=None)   # one parse of the tree per process: select() is called 13x by its tests (21 s -> 9 s); the tree does not change during a run
def py_graph():
    files = [p for p in walk({'.py'}) if p.relative_to(ROOT).parts[0] in ('src', 'tests', 'tools')]
    names = {py_module_name(p): p for p in files}
    edges = {}
    for p in files:
        deps = set()
        try:
            tree = ast.parse(read(p))
        except SyntaxError:
            edges[p] = None        # unreadable: the caller treats it as "reaches everything"
            continue
        me = py_module_name(p).split('.')
        pkg = me if p.name == '__init__.py' else me[:-1]
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                targets = [a.name for a in node.names]
            elif isinstance(node, ast.ImportFrom):
                base = '.'.join(pkg[:len(pkg) - node.level + 1]) if node.level else ''
                mod = '.'.join(x for x in (base, node.module or '') if x)
                targets = [mod] + [f'{mod}.{a.name}'.lstrip('.') for a in node.names]
            else:
                continue
            for t in targets:
                parts = t.split('.')
                for i in range(1, len(parts) + 1):     # a.b.c reaches a, a.b and a.b.c
                    if '.'.join(parts[:i]) in names:
                        deps.add(names['.'.join(parts[:i])])
        edges[p] = deps
    return edges


@functools.lru_cache(maxsize=None)   # called once per file a test reaches (85k times with the e2e area: 10 of 12 s); a path's answer never changes
def is_tree_reader(f):
    """A module a guard test imports to read the repo (scripts/, tools/, test helpers). App code under lib/ scans the user's data folders, not the repo."""
    parts = f.relative_to(ROOT).parts if f.is_relative_to(ROOT) else ()
    return bool(parts) and ('scripts' in parts or 'tools' in parts or 'test' in parts or 'e2e' in parts)


def closure(start, edges):
    seen, stack = set(), [start]
    while stack:
        p = stack.pop()
        if p in seen:
            continue
        seen.add(p)
        deps = edges.get(p, set())
        if deps is None:
            return None
        stack.extend(deps)
    return seen


# --- JavaScript import graph ---------------------------------------------------------------------------------------------------------
def resolve_js(base, spec):
    target = (base.parent / spec).resolve()
    for cand in [target] + [Path(str(target) + e) for e in JS_EXT] + [target / f'index{e}' for e in JS_EXT]:
        if cand.is_file():
            return cand
    return None


@functools.lru_cache(maxsize=None)
def js_graph():
    files = walk(set(JS_EXT))
    edges = {}
    for p in files:
        edges[p.resolve()] = {r for spec in IMPORT_RE.findall(read(p)) if (r := resolve_js(p, spec))}
    return edges


# --- selection -----------------------------------------------------------------------------------------------------------------------
WORKFLOW_DIR_RE = re.compile(r"\.github['\"]?\s*[/,]\s*['\"]?workflows")   # a test that scans the workflows folder (path or pathlib pieces) without naming a file


def mentions(text, changed, py_names):
    """Does the test's text name a changed file: its path, its file name (6+ characters), or its Python dotted name?"""
    if WORKFLOW_DIR_RE.search(text) and any(f.startswith('.github/workflows/') for f in changed):
        return True
    for f in changed:
        base = Path(f).name
        dotted = py_names.get(f)
        if f in text or (len(base) >= 6 and base in text) or (dotted and dotted in text):
            return True
    return False


@functools.lru_cache(maxsize=None)
def e2e_reach():
    """{harness test path: [repo paths it reaches; a folder read ends with '/']} from the harness's own parser; {} when node or the helper is missing (the Python import graph still applies)."""
    helper, node = ROOT / 'tools/e2e-test-reach.mjs', shutil.which('node')
    if not node or not helper.is_file():
        return {}
    out = subprocess.run([node, str(helper)], cwd=ROOT, capture_output=True, text=True, check=False)
    try:
        return json.loads(out.stdout)
    except ValueError:
        return {}


def reaches_changed(paths, changed):
    """Does a test's reach hold a changed file, or a folder it reads whole (a trailing '/') that holds one?"""
    folders = [p for p in paths if p.endswith('/')]
    return any(f in paths or any(f.startswith(d) for d in folders) for f in changed)


def select(changed, base_ref=None):
    changed = sorted(set(changed))
    result = {'python': [], 'desktop': [], 'worker': [], 'site': [], 'e2e': [], 'reasons': {}}
    why = result['reasons']
    if not changed:
        return result
    relevant = [f for f in changed if not NO_TEST_EFFECT.search(f)]
    if not relevant:
        return result
    scoped = [f for f in relevant if SCOPED_DEPS.match(f)]
    everything = [f for f in relevant if (ALL_TRIGGERS.search(f) and f not in scoped) or f == 'tests/test_0_notion_ids.py']
    areas = {'python': (lambda f: f.startswith(('src/', 'tests/', 'tools/', 'config/', 'templates/', '.github/workflows/')) or f == '.gitattributes'),
             'desktop': (lambda f: f.startswith(('desktop/', 'extension/')) or f == '.gitattributes'),
             'worker': (lambda f: f.startswith(('worker/', 'extension/'))),
             'site': (lambda f: f.startswith(('site/', 'web/', 'admin/', 'api/', 'shared/', 'workers/', 'db/', 'test/', 'jobs/', 'media/', 'preview/'))),
             'e2e': (lambda f: True)}   # any file may be read by a harness test: reach and mention decide
    unknown = [f for f in relevant if not f.startswith(KNOWN)]
    if everything or unknown:
        why['all'] = everything + unknown
        return {**{k: 'all' for k in AREAS}, 'reasons': why}

    # Python
    py_changed = [f for f in relevant if areas['python'](f)]
    if py_changed:
        edges = py_graph()
        changed_paths = {ROOT / f for f in py_changed}
        non_py_src = [f for f in py_changed if not f.endswith('.py') and f.startswith(('src/', 'config/', 'templates/'))]
        if non_py_src:
            result['python'] = 'all'; why['python'] = f'non-code input read by the engine: {non_py_src[0]}'
        else:
            names = {f: py_module_name(ROOT / f) for f in py_changed if f.endswith('.py')}
            picked = []
            for t in sorted((ROOT / 'tests').glob('test_*.py')):
                reach = closure(t, edges)
                if reach is None or reach & changed_paths or mentions(read(t), py_changed, names):
                    picked.append(t.stem)
            result['python'] = picked
            orphans = [f for f in names if f.startswith('src/') and not any(
                (ROOT / f) in (closure(t, edges) or {ROOT / f}) for t in (ROOT / 'tests').glob('test_*.py'))]
            if orphans and not picked:   # an engine file no test reaches: nothing could fail, so run the lot rather than nothing
                result['python'] = 'all'; why['python'] = f'no test reaches {orphans[0]}'
    # Node areas
    graph = None
    # An engine edit (src/) or a fixture/helper under tests/ (a desktop test may read it) counts; an edit to a Python test file itself (tests/test_*.py) cannot change what the app does (11 Oct 2026: it started ~130 desktop tests).
    engine_changed = any(f.startswith('src/') or (f.startswith('tests/') and not re.fullmatch(r'tests/test_[^/]+\.py', f)) for f in relevant)
    for area, folder in NODE_AREAS.items():
        if not any(areas[area](f) for f in relevant) and not (area == 'desktop' and engine_changed):
            continue
        graph = graph or js_graph()
        changed_js = {(ROOT / f).resolve() for f in relevant}
        tests = sorted((ROOT / folder).glob('*.test.*')) if (ROOT / folder).is_dir() else []
        reached = e2e_reach() if area == 'e2e' else {}
        scan_ok = area != 'e2e' or any(f.startswith(E2E_SCAN_FOR) for f in relevant)
        picked, scans = [], {}   # scans: file -> does its text scan the tree (a guard may scan through a module it imports, 10 Oct 2026)
        for t in tests:
            text = read(t)
            reach = closure(t.resolve(), graph)
            # e2e: not through desktop/e2e/lib (254 of 411 tests import a lib that lists a runtime folder: artifacts, logs, traces; c27, 1 Nov 2026); a lib that reads the repo is caught by reach
            via = [f for f in reach if is_tree_reader(f) and not (area == 'e2e' and '/e2e/lib/' in f.as_posix())]
            scanner = bool(SCANNER_RE.search(text)) or any(scans.setdefault(f, bool(SCANNER_RE.search(read(f)))) for f in via)
            if (reach & changed_js) or mentions(text, relevant, {}) or (scanner and scan_ok) \
                    or reaches_changed(reached.get(rel(t), ()), relevant) \
                    or (area == 'desktop' and engine_changed and ENGINE_RE.search(text)):
                picked.append(rel(t)[len(PREFIX.get(area, area + '/')):])
        result[area] = picked
    for f in scoped:
        result[f.split('/')[0]] = 'all'; why[f.split('/')[0]] = f'dependency file: {f}'
        if f.startswith('desktop/e2e/'):
            result['e2e'] = 'all'; why['e2e'] = f'dependency file: {f}'
    return result


def commands(result):
    """A ready command per area that has picked tests (run from the repo root); an area picked whole is left to CI, so it gets none."""
    out = {}
    for area, picked in result.items():
        if area == 'reasons' or not picked or picked == 'all':
            continue
        files = ' '.join(picked)
        out[area] = {'python': f'python3 tools/py-shards.py {files}',
                     'desktop': f'cd desktop && node --test {files}',
                     'worker': f'cd worker && node --test {files}',
                     'site': f'node --test {files}',
                     'e2e': f'cd desktop/e2e && node --import ./test/stdout-to-stderr.mjs --test {files}'}[area]
    return out


def git_changed(base):
    for spec in (f'{base}...HEAD', f'{base}..HEAD'):
        out = subprocess.run(['git', 'diff', '--name-only', spec], cwd=ROOT, capture_output=True, text=True)
        if out.returncode == 0:
            return [l for l in out.stdout.splitlines() if l]
    return None


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--base', help='compare HEAD with this ref (merge base)')
    ap.add_argument('--files', nargs='*', help='changed files, instead of git')
    args = ap.parse_args(argv)
    changed = args.files if args.files is not None else git_changed(args.base or 'origin/main')
    if changed is None:       # no way to know what changed: everything
        print(json.dumps({**{k: 'all' for k in AREAS}, 'reasons': {'all': ['git diff failed']}}))
        return 0
    picked = select(changed)
    print(json.dumps({**picked, 'commands': commands(picked)}))
    return 0


if __name__ == '__main__':
    sys.exit(main())
