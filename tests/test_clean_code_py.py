"""tools/clean-code-py.py: new Python code that is too tangled, imports what it never uses or hides a loop variable is refused on the lines a change adds,
and an old function a change makes more complex while over the limit is refused; old code left as it was never is (the Python half of the clean-code checks, docs/superpowers/plans/2026-10-28-clean-code-checks.md)."""
import importlib.util
import subprocess
import tempfile
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

    def found(self, source, added, base=None):
        return tool.check([{'path': 'src/x.py', 'source': source, 'added': added, 'base': base}], self.ruff)

    def test_a_new_function_over_the_complexity_limit_is_refused_with_its_line(self):
        source = tangled(tool.MAX_COMPLEXITY + 3)
        found = self.found(source, all_lines(source))
        self.assertEqual([(f['rule'], f['line']) for f in found], [('C901', 1)], found)

    def test_an_old_function_over_the_limit_that_the_change_does_not_make_more_complex_passes(self):
        source = tangled(tool.MAX_COMPLEXITY + 3)
        self.assertEqual(self.found(source, {5}, {'source': source, 'line_of': lambda line: line}), [])

    def test_an_old_function_the_change_pushes_over_the_limit_is_refused_and_one_it_simplifies_passes(self):
        grown = tangled(tool.MAX_COMPLEXITY + 3)
        over = self.found(grown, {5}, {'source': tangled(3), 'line_of': lambda line: line})
        self.assertEqual([(f['rule'], f['line']) for f in over], [('C901', 1)], over)
        self.assertIn(f'raised it from at most {tool.MAX_COMPLEXITY}', over[0]['message'])
        self.assertEqual(self.found(tangled(tool.MAX_COMPLEXITY + 2), {5}, {'source': grown, 'line_of': lambda line: line}), [])

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


class ChangedFilesTest(unittest.TestCase):
    """What is checked is what is committed: the pushed HEAD against the merge base, renames counted as new files."""

    def setUp(self):
        self.dir = Path(tempfile.mkdtemp())
        self.git('init', '-q', '-b', 'main')
        (self.dir / 'src').mkdir()
        (self.dir / 'src' / 'old.py').write_text('def keep():\n    return 1\n' * 3)
        self.git('add', '.'); self.git('commit', '-q', '-m', 'base')
        self.base = self.git('rev-parse', 'HEAD').strip()

    def git(self, *args):
        return subprocess.run(['git', '-c', 'user.name=t', '-c', 'user.email=t@t', *args], cwd=self.dir, capture_output=True, text=True, check=True).stdout

    def test_an_uncommitted_edit_neither_adds_a_finding_nor_hides_one(self):
        (self.dir / 'src' / 'new.py').write_text('import os\n')
        self.git('add', '.'); self.git('commit', '-q', '-m', 'adds an unused import')
        (self.dir / 'src' / 'new.py').write_text('print(1)\n')   # a local fix that is not in the commit
        (self.dir / 'src' / 'wip.py').write_text('import sys\n')   # untracked work in progress
        files = tool.changed_files(self.base, self.dir)
        self.assertEqual([f['path'] for f in files], ['src/new.py'])
        self.assertEqual(files[0]['source'], 'import os\n')

    # Why (29 Oct 2026, owner: "do we have PR CI guardrails to not get back again in this situation"): desktop.py main (64) and daily_search
    # search (84) grew a few lines at a time; each change passed because C901 is reported on the def line, which none of them touched.
    def test_an_old_function_that_a_commit_makes_more_complex_is_refused_though_its_def_line_is_unchanged(self):
        ruff = tool.ruff_command()
        if ruff is None:
            self.skipTest('ruff cannot be installed here (offline)')
        (self.dir / 'src' / 'search.py').write_text('TOP = 1\n' + tangled(tool.MAX_COMPLEXITY + 3))
        self.git('add', '.'); self.git('commit', '-q', '-m', 'an old tangled function')
        base = self.git('rev-parse', 'HEAD').strip()
        (self.dir / 'src' / 'search.py').write_text('TOP = 1\n' + tangled(tool.MAX_COMPLEXITY + 4))
        self.git('commit', '-q', '-am', 'one more branch')
        found = tool.check(tool.changed_files(base, self.dir), ruff)
        self.assertEqual([(f['path'], f['line'], f['rule']) for f in found], [('src/search.py', 2, 'C901')], found)
        self.assertIn(f'raised it from {tool.MAX_COMPLEXITY + 4}', found[0]['message'])

    def test_a_line_keeps_its_base_line_number_across_added_changed_and_removed_lines(self):
        before = [f'line {i}' for i in range(1, 31)]
        after = list(before)
        del after[19:21]                      # remove base lines 20-21
        after[9] = 'changed 10'               # change base line 10
        after[3:3] = ['new a', 'new b']       # add two lines after base line 3
        (self.dir / 'a').write_text('\n'.join(before) + '\n'); (self.dir / 'b').write_text('\n'.join(after) + '\n')
        diff = subprocess.run(['git', 'diff', '--no-index', '-U0', 'a', 'b'], cwd=self.dir, capture_output=True, text=True).stdout
        line_of = tool.base_line_of(diff)
        for number, text in enumerate(after, 1):
            self.assertEqual(line_of(number), int(text[5:]) if text.startswith('line ') else None, f'new line {number}: {text}')

    def test_a_renamed_and_edited_file_is_checked_with_its_added_lines(self):
        self.git('mv', 'src/old.py', 'src/moved.py')
        (self.dir / 'src' / 'moved.py').write_text((self.dir / 'src' / 'moved.py').read_text() + 'import os\n')
        self.git('add', '.'); self.git('commit', '-q', '-m', 'moves and edits')
        files = tool.changed_files(self.base, self.dir)
        self.assertEqual([f['path'] for f in files], ['src/moved.py'])
        self.assertIn(7, files[0]['added'])


class RuffFailureTest(unittest.TestCase):
    def test_a_ruff_error_fails_the_gate_instead_of_passing_it(self):
        broken = ['python3', '-c', 'import sys; sys.stderr.write("bad config"); sys.exit(2)']
        with self.assertRaises(SystemExit) as raised:
            tool.check([{'path': 'src/x.py', 'source': 'x = 1\n', 'added': {1}}], broken)
        self.assertIn('bad config', str(raised.exception))


if __name__ == '__main__':
    unittest.main()
