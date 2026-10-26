"""Every action our workflows use runs on Node 24 (or is composite/Docker): GitHub retires Node 20 for actions, and each job on a Node 20 action printed
"Node.js 20 is deprecated" (22 warnings in one e2e run, actions/create-github-app-token@v2; owner via the coordinator, 26 Oct 2026: "fix the whole class").
A new action, or a new major, is checked once by hand (its action.yml `runs.using`) and added to RUNTIME below: the test fails until it is."""
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# action -> the first major that runs on Node 24 (0: composite or Docker, any major). Checked 26 Oct 2026 from each action.yml at that tag.
RUNTIME = {
    'actions/checkout': 5,
    'actions/setup-node': 5,
    'actions/setup-python': 6,
    'actions/upload-artifact': 6,
    'actions/download-artifact': 7,
    'actions/cache': 5,
    'actions/cache/save': 5,
    'actions/cache/restore': 5,
    'actions/create-github-app-token': 3,
    'actions/attest-build-provenance': 0,
    'anthropics/claude-code-action': 0,
    'google-github-actions/auth': 3,   # node24 since v3 (checked 26 Oct 2026)
}
USES = re.compile(r"^\s*(?:-\s+)?uses:\s*['\"]?([^'\"\s#]+)", re.M)


def uses(root=ROOT):
    """-> [(file, action, ref)] for every remote action in .github (workflows and our own composite actions)."""
    out = []
    for path in sorted((root / '.github').rglob('*.y*ml')):
        for target in USES.findall(path.read_text(encoding='utf-8')):
            if target.startswith(('./', 'docker://')) or '@' not in target:
                continue
            action, ref = target.rsplit('@', 1)
            out.append((path.relative_to(root).as_posix(), action, ref))
    return out


def problems(found):
    bad = []
    for file, action, ref in found:
        if action not in RUNTIME:
            bad.append(f'{file}: {action}@{ref} is not in RUNTIME: check its action.yml runs.using and add it')
            continue
        major = re.match(r'v(\d+)', ref)
        if not major:
            bad.append(f'{file}: {action}@{ref} is not pinned to a major (vN)')
        elif int(major.group(1)) < RUNTIME[action]:
            bad.append(f'{file}: {action}@{ref} runs on Node 20: use v{RUNTIME[action]} or later')
    return bad


class Node24Actions(unittest.TestCase):
    def test_every_action_runs_on_node_24(self):
        found = uses()
        self.assertGreater(len(found), 50, 'the workflows were read')
        self.assertEqual(problems(found), [])

    def test_a_node_20_major_or_an_unchecked_action_is_caught(self):
        self.assertEqual(len(problems([('x.yml', 'actions/create-github-app-token', 'v2'), ('x.yml', 'someone/new-action', 'v1'),
                                       ('x.yml', 'actions/checkout', 'main'), ('x.yml', 'actions/checkout', 'v5')])), 3)

    def test_our_own_actions_are_composite(self):
        for path in (ROOT / '.github' / 'actions').rglob('action.y*ml'):
            self.assertRegex(path.read_text(encoding='utf-8'), r'(?m)^\s+using:\s*[\'"]?(composite|node24|docker)', path)


if __name__ == '__main__':
    unittest.main()
