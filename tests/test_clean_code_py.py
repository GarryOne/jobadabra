"""tools/clean-code-py.py: new Python code that is too tangled, imports what it never uses or hides a loop variable is refused on the lines a change adds,
never on old code (the Python half of the clean-code checks, docs/superpowers/plans/2026-10-28-clean-code-checks.md)."""
import importlib.util
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('clean_code_py', ROOT / 'tools' / 'clean-code-py.py')
tool = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tool)

# `n` nested ifs, each holding a statement: McCabe complexity n + 1.
def tangled(n):
    lines = ['def tangled(x):']
    for i in range(n):
        lines.append('    ' * (i + 1) + f'if x > {i}:')
        lines.append('    ' * (i + 2) + 'x += 1')
    lines.append('    return x')
    return '\n'.join(lines) + '\n'


def all_lines(source):
    return set(range(1, source.count('\n') + 2))


class AddedLinesTest(unittest.TestCase):
    def test_a_diff_gives_the_lines_it_adds(self):
        diff = '@@ -3,0 +4,2 @@ def f():\n+a\n+b\n@@ -10 +12 @@\n-c\n+d\n@@ -20,2 +22,0 @@\n-e\n-f\n'
        self.assertEqual(tool.added_lines(diff), {4, 5, 12})


class CheckTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.ruff = tool.ruff_command()
        if cls.ruff is None:
            raise unittest.SkipTest('ruff cannot be installed here (offline): the tool skips with a note, CI installs it')

    def found(self, source, added):
        return tool.check([{'path': 'src/x.py', 'source': source, 'added': added}], self.ruff)

    def test_a_new_function_over_the_complexity_limit_is_refused_with_its_line(self):
        source = tangled(tool.MAX_COMPLEXITY + 3)
        found = self.found(source, all_lines(source))
        self.assertEqual([(f['rule'], f['line']) for f in found], [('C901', 1)], found)

    def test_the_same_function_in_old_code_is_not_refused(self):
        source = tangled(tool.MAX_COMPLEXITY + 3)
        self.assertEqual(self.found(source, {5}), [])

    def test_a_small_function_passes(self):
        source = tangled(3)
        self.assertEqual(self.found(source, all_lines(source)), [])

    def test_an_unused_import_and_an_unused_local_on_added_lines_are_refused(self):
        source = 'import os\n\n\ndef f():\n    unused = 1\n    return 2\n'
        self.assertEqual(sorted(f['rule'] for f in self.found(source, all_lines(source))), ['F401', 'F841'])

    def test_a_lambda_that_does_not_bind_its_loop_variable_is_refused(self):
        source = 'def f(items):\n    out = []\n    for item in items:\n        out.append(lambda: item)\n    return out\n'
        self.assertEqual([f['rule'] for f in self.found(source, all_lines(source))], ['B023'])

    def test_a_noqa_with_a_reason_keeps_a_deliberate_re_export(self):
        source = 'from os import path  # noqa: F401 (re-exported for tests)\n'
        self.assertEqual(self.found(source, all_lines(source)), [])


if __name__ == '__main__':
    unittest.main()
