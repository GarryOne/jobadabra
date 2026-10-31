"""Every rule of the e2e design names the test that enforces it, and that test exists.

Why (31 Oct 2026, owner: "let's close this gap"): the design said AI suites are tolerant and the backbone has no live AI, but nothing enforced it; qualityai's
job still failed betas (desktop.yml read `matrix.outside`, not lanes.json), 3 of 29 suites had no "0 live AI asks" ceiling, and a 28 Oct rule (a capped AI
step fails a release gate) contradicted "AI credit is grey". A rule without a guard is a promise nobody checks: each rule section carries `Guard:` with its
test files, or `Guard: none: <why>` so the gap is visible.
"""
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SPEC = ROOT / 'docs/superpowers/specs/2026-10-28-e2e-reliability-design.md'
RULE = re.compile(r'^\*\*([A-Z]\d?) · ', re.M)


def rule_sections(text):
    """The text of each rule under "## The rules", keyed by its letter, up to the next rule or section."""
    body = re.split(r'^## The rules\n', text, maxsplit=1, flags=re.M)[1].split('\n## ', 1)[0]
    starts = [(m.group(1), m.start()) for m in RULE.finditer(body)]
    return {letter: body[start:(starts[i + 1][1] if i + 1 < len(starts) else len(body))] for i, (letter, start) in enumerate(starts)}


def guard_problems(text, root=ROOT):
    """Each problem as one line: a rule with no Guard line, a Guard naming a missing file, or an empty `none` reason."""
    problems = [f'rule {letter} has no Guard: line' for letter, section in rule_sections(text).items() if not re.search(r'^Guard: ', section, re.M)]
    for line in re.findall(r'(?:^|\s)Guard: (.*)$', text, re.M):
        if line.startswith('none'):
            if not re.match(r'none: \S', line):
                problems.append(f'"Guard: {line}" needs a reason after "none:"')
            continue
        paths = re.findall(r'`([^`]+)`', line)
        if not paths:
            problems.append(f'"Guard: {line}" names no file')
        problems += [f'Guard names a missing file: {path}' for path in paths if not (root / path).is_file()]
    return problems


class E2eDesignGuards(unittest.TestCase):
    def test_every_rule_names_an_existing_guard(self):
        self.assertEqual(guard_problems(SPEC.read_text(encoding='utf-8')), [])

    def test_a_rule_without_a_guard_is_named(self):
        spec = '## The rules\n**A · One.** text\nGuard: `tests/test_e2e_design_guards.py`.\n\n**B · Two.** text\n\n## Constraints\n'
        self.assertEqual(guard_problems(spec), ['rule B has no Guard: line'])

    def test_a_missing_file_and_an_empty_reason_are_named(self):
        spec = '## The rules\n**A · One.** text\nGuard: `tests/no_such_test.py`.\n\n**B · Two.** text\nGuard: none:\n\n## Constraints\n'
        self.assertEqual(guard_problems(spec), ['Guard names a missing file: tests/no_such_test.py', '"Guard: none:" needs a reason after "none:"'])

    def test_a_guard_inside_a_bullet_counts(self):
        spec = '## States\n- **Beta:** text. Guard: `tests/test_e2e_design_guards.py`.\n## The rules\n**A · One.** x\nGuard: none: private repo.\n## End\n'
        self.assertEqual(guard_problems(spec), [])


if __name__ == '__main__':
    unittest.main()
