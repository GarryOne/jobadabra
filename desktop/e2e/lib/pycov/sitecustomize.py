"""e2e Python step map: records which repo src/ lines this Python process ran, for desktop/e2e/lib/coverage.mjs (owner's yes, 26 Oct 2026: a scoring PR ran
the whole quality suite, 10-22 min, because Python had no per-step map).
Loaded only through PYTHONPATH in a coverage run (E2E_PY_COVERAGE_DIR set: main's scheduled e2e with E2E_COVERAGE=1); does nothing otherwise, or before Python 3.12.
Each process writes <dir>/py-<pid>.json = {start, end, files: {"src/x.py": {body: [[a, b]], load: [[a, b]]}}}: start/end = the e2e step named in <dir>/step
when the process began and at its last write. body = lines run inside a function (that step's); load = lines run at import (module and class level, def lines),
which every step depends on. A statement over several lines counts whole. Written at most every 2 s while new lines run, and at exit (os._exit too).
Tests: tests/test_e2e_pycov.py"""
import ast
import atexit
import json
import os
import sys
import time


def _ranges(lines):
    out = []
    for n in sorted(lines):
        if out and n <= out[-1][1] + 1:
            out[-1][1] = max(out[-1][1], n)
        else:
            out.append([n, n])
    return out


def _first_lines(node):
    for field in ('body', 'orelse', 'finalbody', 'handlers'):
        for child in getattr(node, field, None) or []:
            if hasattr(child, 'lineno'):
                yield child.lineno
    for case in getattr(node, 'cases', None) or []:
        yield case.pattern.lineno


def kinds(path):
    """-> {line: (kind, first, last)}: the statement header a line belongs to, and whether it runs at import ("load") or inside a function ("body")."""
    out = {}
    try:
        with open(path, 'rb') as f:
            tree = ast.parse(f.read())
    except (OSError, SyntaxError, ValueError):
        return out

    def mark(first, last, kind):
        for n in range(first, last + 1):
            out.setdefault(n, (kind, first, last))

    def visit(stmts, kind):
        for s in stmts:
            first = min([s.lineno] + [d.lineno for d in getattr(s, 'decorator_list', None) or []])
            inner = list(_first_lines(s))
            mark(first, max(s.lineno, min(inner) - 1) if inner else s.end_lineno, kind)
            deeper = 'body' if isinstance(s, (ast.FunctionDef, ast.AsyncFunctionDef)) else kind
            for field in ('body', 'orelse', 'finalbody'):
                visit(getattr(s, field, None) or [], deeper)
            for handler in getattr(s, 'handlers', None) or []:
                mark(handler.lineno, max(handler.lineno, handler.body[0].lineno - 1), deeper)
                visit(handler.body, deeper)
            for case in getattr(s, 'cases', None) or []:
                mark(case.pattern.lineno, max(case.pattern.lineno, case.body[0].lineno - 1), deeper)
                visit(case.body, deeper)

    visit(tree.body, 'load')
    return out


def _install():
    out = os.environ.get('E2E_PY_COVERAGE_DIR', '')
    mon = getattr(sys, 'monitoring', None)
    if not out or mon is None:
        return
    root = os.path.realpath(os.environ.get('E2E_PY_COVERAGE_ROOT') or os.getcwd())
    src = os.path.join(root, 'src') + os.sep
    try:
        mon.use_tool_id(mon.COVERAGE_ID, 'e2e-step-map')
    except ValueError:   # another coverage tool runs in this process
        return

    def step():
        try:
            with open(os.path.join(out, 'step'), encoding='utf-8') as f:
                return f.read().strip()
        except OSError:
            return ''

    start, ran, real, parsed, state = step(), {}, {}, {}, {'last': 0.0, 'busy': False}

    def flush():
        if not ran or state['busy']:
            return
        state['busy'], state['last'] = True, time.monotonic()
        try:
            files = {}
            for path, lines in list(ran.items()):
                shapes = parsed.get(path)
                if shapes is None:
                    shapes = parsed[path] = kinds(path)
                body, load = set(), set()
                for n in list(lines):
                    kind, first, last = shapes.get(n, ('load', n, n))
                    (body if kind == 'body' else load).update(range(first, last + 1))
                files[os.path.relpath(path, root).replace(os.sep, '/')] = {'body': _ranges(body - load), 'load': _ranges(load)}
            target = os.path.join(out, f'py-{os.getpid()}.json')
            with open(target + '.tmp', 'w', encoding='utf-8') as f:
                json.dump({'start': start, 'end': step(), 'files': files}, f)
            os.replace(target + '.tmp', target)
        except Exception:   # never a reason for the engine to fail
            pass
        finally:
            state['busy'] = False

    def line(code, lineno):
        name = code.co_filename
        path = real.get(name)
        if path is None:
            path = real[name] = os.path.realpath(name) if name.endswith('.py') else ''
        if lineno > 0 and path.startswith(src):
            ran.setdefault(path, set()).add(lineno)
            if time.monotonic() - state['last'] > 2:
                flush()
        return mon.DISABLE   # each line once: the step map needs where, not how often

    mon.register_callback(mon.COVERAGE_ID, mon.events.LINE, line)
    mon.set_events(mon.COVERAGE_ID, mon.events.LINE)
    atexit.register(flush)
    real_exit = os._exit

    def _exit(code):   # src/run_exit.py and the signal timers leave through os._exit, which skips atexit
        flush()
        real_exit(code)
    os._exit = _exit


try:
    _install()
except Exception:
    pass
