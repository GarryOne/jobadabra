"""Grey never ends red: a workflow that marks a job grey lets it end green, and every reader of red or green knows grey.

Why (31 Oct 2026, owner: "Should be gray, or green"; "Why there were no guardrails to prevent this. Let's fix the workflow/guardrail"): #2661 marked a
slow-runner job grey with an `::error` annotation and then `exit 1`, so the job showed red, main's Telegram said "failed on main" and the PR verdict counted
it red. The design says grey is health, never red (docs/superpowers/specs/2026-10-28-e2e-reliability-design.md, the grey line), but no test held it.
"""
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WORKFLOWS = ROOT / '.github/workflows'
# Every place that turns a job's conclusion into red or green for the owner: the PR verdict, main's Telegram alert, main's state (red-main gate), the beta
# release gate and the revert of a backbone red. A new one joins this list in the PR that adds it (Gitar rule S).
READERS = ['tools/pr-verdict.py', 'desktop/e2e/ci-alert.mjs', 'tools/main_e2e_state.py', 'tools/beta_rate_gate.py', 'tools/backbone_red.py']
GREY_LINE = re.compile(r'::(error|warning|notice)[^:]*title=Grey\b')
SHARED_CHECK = re.compile(r'\b(is_grey|isGrey|GREY_TITLE)\b')


def grey_problems(name, text):
    """Each grey annotation that is an error, or that a nonzero exit follows on its own branch (up to the next else/elif or the end of its run block)."""
    problems = []
    lines = text.splitlines()
    for at, line in enumerate(lines):
        found = GREY_LINE.search(line)
        if not found:
            continue
        if found.group(1) == 'error':
            problems.append(f'{name}:{at + 1}: a grey annotation is ::error; grey is health, use ::warning')
        branch = [line[found.end():]]
        indent = len(line) - len(line.lstrip())
        for later in lines[at + 1:]:
            if later.strip() and len(later) - len(later.lstrip()) < indent - 2 and not later.strip().startswith(('fi', 'done', 'esac', '}')):
                break   # left the run block
            branch.append(later)
        if re.search(r'\bexit\s+[1-9]', own_branch('\n'.join(branch))):
            problems.append(f'{name}:{at + 1}: a grey job exits nonzero after its grey annotation, so it ends red')
    return problems


def own_branch(text):
    """The shell text that runs after a line inside an if-branch: its own branch, then whatever follows the closing fi (other branches left out)."""
    kept, depth, skipping, start = [], 0, False, 0
    for token in re.finditer(r'(?<![\w-])(if|elif|else|fi)(?![\w:-])', text):
        word = token.group(1)
        if word == 'if':
            depth += 1
        elif word == 'fi' and depth:
            depth -= 1
        elif word == 'fi':
            if skipping:
                skipping, start = False, token.end()
        elif depth == 0 and not skipping:
            kept.append(text[start:token.start()])
            skipping = True
    if not skipping:
        kept.append(text[start:])
    return '\n'.join(kept)


def workflows():
    return {path.name: path.read_text(encoding='utf-8') for path in sorted(WORKFLOWS.glob('*.yml'))}


class GreyNeverRed(unittest.TestCase):
    def test_no_workflow_ends_a_grey_job_red(self):
        problems = [problem for name, text in workflows().items() for problem in grey_problems(name, text)]
        self.assertEqual(problems, [])

    def test_every_reader_knows_grey_once_a_workflow_marks_it(self):
        if not any(GREY_LINE.search(text) for text in workflows().values()):
            self.skipTest('no workflow marks a job grey yet')
        missing = [reader for reader in READERS if not SHARED_CHECK.search((ROOT / reader).read_text(encoding='utf-8'))]
        self.assertEqual(missing, [], 'these readers would show a grey job as red: use the one grey check (is_grey / GREY_TITLE)')

    def test_the_2661_shape_is_refused(self):
        run = ('        run: |\n'
               '          if node flaky-proof.mjs --grey a b; then\n'
               '            echo "::error title=Grey: the runner, not the app::apply: both tries stopped on time"\n'
               '          else\n'
               '            echo "Failed again on the same commit: a real failure."\n'
               '          fi\n'
               '          exit 1   # keep failure so gh run rerun --failed picks grey jobs\n')
        self.assertEqual(grey_problems('e2e.yml', run), [
            'e2e.yml:3: a grey annotation is ::error; grey is health, use ::warning',
            'e2e.yml:3: a grey job exits nonzero after its grey annotation, so it ends red'])

    def test_a_grey_branch_that_ends_green_passes(self):
        run = ('        run: |\n'
               '          if node flaky-proof.mjs --grey a b; then\n'
               '            echo "::warning title=Grey: the runner, not the app::apply: both tries stopped on time"\n'
               '            exit 0\n'
               '          else\n'
               '            echo "Failed again on the same commit: a real failure."\n'
               '            exit 1\n'
               '          fi\n')
        self.assertEqual(grey_problems('e2e.yml', run), [])


if __name__ == '__main__':
    unittest.main()
