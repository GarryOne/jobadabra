"""record-sites.yml's last step opens the daily discovery batch's PR: the push names the repo, and the App token is minted for the permission that PR needs.
Incident (1 Nov 2026, owner: "let's fix this"): the Recording row of the pool card was red every day from 28 Oct (runs 40685727812 ... 41307862744): `git push ... github.com/$REPO.git`
died with "fatal: repository 'https://github.com/.git/' not found", exit 128, because no `REPO` was defined for the step (since b175668, 19 Oct); it only runs on days the batch finds new shapes."""
import re
import unittest
from pathlib import Path

WORKFLOW = (Path(__file__).resolve().parent.parent / '.github/workflows/record-sites.yml').read_text()


def step(name):
    """The text of one step of the pool-pr job, from its `- name:` line to the next step."""
    job = WORKFLOW.split('\n  pool-pr:\n', 1)[1]
    return next(part for part in re.split(r'\n      - name: ', job) if part.startswith(name))


class PoolPr(unittest.TestCase):
    def test_the_push_step_defines_the_repo_it_pushes_to(self):
        text = step('Add them to smoke-sites.json and open the PR')
        self.assertIn('@github.com/$REPO.git', text, 'the push still names $REPO (this test follows it)')
        env = text.split('run: |', 1)[0]
        self.assertRegex(env, r'\n\s+REPO: \$\{\{ github\.repository \}\}', 'REPO comes from the workflow, never a hardcoded owner (the repo moves into an org)')
        self.assertNotRegex(text, r'GarryOne/jobadabra', 'no hardcoded owner in the step')

    def test_the_app_token_is_asked_for_what_the_pr_needs(self):
        text = step('The App token, so the PR')
        self.assertIn('permission-contents: write', text)
        self.assertIn('permission-pull-requests: write', text)
        self.assertIn('continue-on-error: true', text, 'a failed mint falls back to the workflow token: the push still succeeds')
        push = step('Add them to smoke-sites.json and open the PR')
        self.assertIn('${PR_TOKEN:-$GH_TOKEN}@github.com/$REPO.git', push, 'the push falls back to the workflow token')
        self.assertRegex(push, r'\[ -n "\$PR_TOKEN" \] \|\| echo "::warning title=Pool PR opened without checks', 'and says so when the App token is missing')


if __name__ == '__main__':
    unittest.main()
