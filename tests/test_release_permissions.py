"""Every workflow job that runs a release script can do all of it: tools/beta-approve.sh, tools/release-stable.sh and
tools/sync_release_labels.py rewrite the pinned Release channels issue, so the job needs `issues: write`. The release gate's
promote job had `issues: read`: alpha.254 was approved, then the label sync failed (3 Oct 2026)."""
import re
import unittest
from pathlib import Path

WORKFLOWS = Path(__file__).resolve().parents[1] / '.github' / 'workflows'
RELEASE_SCRIPTS = re.compile(r'beta-approve\.sh|release-stable\.sh|sync_release_labels\.py')


def permissions(block):
    """{scope: level} of the first `permissions:` mapping in `block` (indented lines under it)."""
    match = re.search(r'^( *)permissions:[ \t]*\n((?:\1  +[\w-]+: *[\w-]+.*\n)+)', block, re.M)
    return dict(re.findall(r'^ +([\w-]+): *([\w-]+)', match.group(2), re.M)) if match else None


def jobs(text):
    """(name, text) of each job: the two-space keys under `jobs:`."""
    body = text.split('\njobs:\n', 1)[1]
    parts = re.split(r'^  ([\w-]+):[ \t]*(?:#.*)?\n', body, flags=re.M)
    return list(zip(parts[1::2], parts[2::2]))


class ReleaseJobsMayWriteIssues(unittest.TestCase):
    def test_every_job_that_runs_a_release_script_has_issues_write(self):
        # Since 26 Oct 2026 the review runs in one place, .github/actions/e2e-review (all of a lane's pages in one batch), used by every lane.
        action = (WORKFLOWS.parent / 'actions' / 'e2e-review' / 'action.yml').read_text()
        self.assertIn('node review-ui.mjs', action)
        self.assertIn('--job e2e-screenshot-review', action, 'the screenshot review reports its cost')
        users = [f'{path.name}:{name}' for path in sorted(WORKFLOWS.glob('*.yml')) if '\njobs:\n' in path.read_text()
                 for name, job in jobs(path.read_text()) if 'uses: ./.github/actions/e2e-review' in job]
        self.assertGreaterEqual(len(users), 4, users)   # e2e.yml, e2e-windows.yml and both release lanes of desktop.yml
