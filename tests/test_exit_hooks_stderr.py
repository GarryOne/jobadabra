"""Nothing an exit hook says goes to stdout: it prints after the command's answer, and a JSON command's answer is its last stdout line
(desktop/lib/pipeline-commands.js). The class guard for tests/test_decide_exit_lines.py: every function registered with atexit, and every function
of the same file it calls, prints with file=sys.stderr (the run log and the Notion run row read stderr too).
26 Oct 2026, #2118's PR run: decide's end-of-run lines (#2099) came after src.focus's JSON and Focus said "Could not read your Notion"."""
import ast
import pathlib
import unittest

SRC = pathlib.Path(__file__).resolve().parent.parent / 'src'
# The run row's own lines: commands that log a run (--log-run) answer through run_result.py, never a JSON stdout line, and the app reads
# "Cronjob run logged: <link>" from either stream (desktop/lib/pipeline-run.js).
RUN_ROW = {('src/run_log.py', 'log_run'), ('src/run_log.py', 'details_of'), ('src/notion/cron_runs.py', 'log_run')}


def _hooks(tree):
    """Names of the functions this file registers with atexit (atexit.register(f) or @atexit.register)."""
    names = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Call) and getattr(node.func, 'attr', '') == 'register' and getattr(node.func.value, 'id', '') == 'atexit':
            names.update(arg.id for arg in node.args if isinstance(arg, ast.Name))
        if isinstance(node, ast.FunctionDef) and any(getattr(d, 'attr', '') == 'register' and getattr(getattr(d, 'value', None), 'id', '') == 'atexit'
                                                     for d in node.decorator_list):
            names.add(node.name)
    return names


def _stdout_prints(tree):
    """{function name: [line of each print() with no file= argument]} for the file's top-level functions."""
    functions = {node.name: node for node in tree.body if isinstance(node, ast.FunctionDef)}
    reached, todo = set(), list(_hooks(tree) & functions.keys())
    while todo:   # the hooks and the same-file functions they call
        name = todo.pop()
        if name in reached:
            continue
        reached.add(name)
        todo += [n.func.id for n in ast.walk(functions[name]) if isinstance(n, ast.Call) and isinstance(n.func, ast.Name) and n.func.id in functions]
    return {name: [n.lineno for n in ast.walk(functions[name]) if isinstance(n, ast.Call) and getattr(n.func, 'id', '') == 'print'
                   and not any(k.arg == 'file' for k in n.keywords)] for name in reached}


class ExitHooksStderr(unittest.TestCase):
    def test_exit_hooks_print_to_stderr(self):
        seen, bad = 0, []
        for path in sorted(SRC.rglob('*.py')):
            tree = ast.parse(path.read_text(encoding='utf-8'))
            for name, lines in _stdout_prints(tree).items():
                seen += 1
                if (str(path.relative_to(SRC.parent)).replace('\\', '/'), name) in RUN_ROW:
                    continue
                bad += [f'{path.relative_to(SRC.parent)}:{line} ({name})' for line in lines]
        self.assertGreaterEqual(seen, 4, 'positive control: the exit hooks are found (decide, notify, run_log, cron_runs…)')
        self.assertEqual(bad, [], 'print(..., file=sys.stderr) in an exit hook: stdout ends with the command\'s answer')


if __name__ == '__main__':
    unittest.main()
