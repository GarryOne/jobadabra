"""Every workflow_run trigger names a top-level workflow: GitHub never fires workflow_run for one that is only called by another (workflow_call).

24 Oct 2026: changelog-kick.yml listened for 'CI · Release to beta' (beta-approve.yml, a called workflow); beta 0.8.28 was approved and started no run.
"""
import pathlib
import re
import unittest

WORKFLOWS = pathlib.Path(__file__).resolve().parent.parent / '.github' / 'workflows'


def triggers(text):
    """The keys directly under `on:` (a mapping written with two-space indent)."""
    match = re.search(r'^on:\s*\n((?:[ \t]+.*\n|\s*\n|#.*\n)+)', text, re.M)
    return re.findall(r'^  ([\w-]+):', match.group(1), re.M) if match else re.findall(r'^on:\s*\[?([\w, -]+)', text, re.M)


def names():
    top, called = set(), set()
    for path in WORKFLOWS.glob('*.yml'):
        text = path.read_text(encoding='utf-8')
        name = re.search(r'^name:\s*(.+?)\s*$', text, re.M).group(1).strip('\'"')
        keys = [k.strip() for chunk in triggers(text) for k in chunk.split(',')]
        (top if set(keys) - {'workflow_call'} else called).add(name)
    return top, called


def listened():
    for path in sorted(WORKFLOWS.glob('*.yml')):
        text = path.read_text(encoding='utf-8')
        for block in re.findall(r'workflow_run:\s*\n\s*workflows:\s*\[(.*?)\]', text, re.S):
            for name in re.findall(r"'([^']+)'|\"([^\"]+)\"", block):
                yield path.name, name[0] or name[1]


class WorkflowRunTriggers(unittest.TestCase):
    def test_every_listened_name_is_a_top_level_workflow(self):
        top, called = names()
        self.assertIn('Release · Build, test, beta', top)
        self.assertIn('CI · Release to beta', called)
        bad = [f'{file}: {name}' for file, name in listened() if name not in top]
        self.assertEqual(bad, [], 'workflow_run names that never fire (called or unknown workflow): ' + '; '.join(bad))

    def test_changelog_kick_listens(self):
        self.assertTrue([1 for f, _ in listened() if f == 'changelog-kick.yml'])


if __name__ == '__main__':
    unittest.main()
