"""Every use of the records read/write token goes through the GitHub App's own token, with the old secret as the fallback (16 Oct 2026).

19:06Z that day the token belonged to the owner's account, so every local session and every CI fetch drew on one 5,000/h; it ran out and PR journeys went red as "no record".
The App (job-pilotto-ci-records, installed on jobadabra-lab only) has its own limit: a job that reads jobadabra-lab mints its token first
(`id: records_app`, continue-on-error, only when CI_APP_PRIVATE_KEY is set) and uses `steps.records_app.outputs.token || secrets.NET_RECORDS_*_TOKEN`.
A workflow job that names the old secret alone, or mints it wrongly, fails here with its file:line.
"""
import pathlib
import re
import unittest

WORKFLOWS = pathlib.Path(__file__).resolve().parent.parent / '.github' / 'workflows'
OLD = re.compile(r'secrets\.NET_RECORDS_(READ|WRITE)_TOKEN')
GOOD = re.compile(r'\$\{\{ steps\.records_app\.outputs\.token \|\| secrets\.NET_RECORDS_(READ|WRITE)_TOKEN \}\}')


def jobs(text):
    """-> [(first line number, [lines])] per job under `jobs:`."""
    lines, found, start = text.split('\n'), [], None
    in_jobs = False
    for number, line in enumerate(lines):
        if line.startswith('jobs:'):
            in_jobs = True
        elif in_jobs and re.match(r'^  [A-Za-z0-9_-]+:\s*$', line):
            if start is not None:
                found.append((start, lines[start:number]))
            start = number
    if start is not None:
        found.append((start, lines[start:]))
    return found


class RecordsTokenApp(unittest.TestCase):
    def test_every_use_of_the_records_token_goes_through_the_app_with_the_old_secret_as_fallback(self):
        bad, seen = [], 0
        for path in sorted(WORKFLOWS.glob('*.yml')):
            for start, block in jobs(path.read_text(encoding='utf-8')):
                uses = [number for number, line in enumerate(block) if OLD.search(line)]
                if not uses:
                    continue
                seen += len(uses)
                body = '\n'.join(block)
                mint = body.find('id: records_app\n')
                where = f'{path.name}:{start + 1 + uses[0]}'
                for number in uses:
                    if not GOOD.search(block[number]):
                        bad.append(f'{path.name}:{start + 1 + number} names the old secret alone: use steps.records_app.outputs.token || secrets.<old>')
                if mint < 0 or mint > body.find(block[uses[0]]):
                    bad.append(f'{where}: no `id: records_app` step before the first use in this job')
                    continue
                step = body[body.rfind('      - ', 0, mint):]
                step = step[:step.find('\n      - ', 5)] if '\n      - ' in step[5:] else step
                for want in ('uses: actions/create-github-app-token@', 'client-id: ${{ vars.CI_APP_CLIENT_ID }}', 'private-key: ${{ secrets.CI_APP_PRIVATE_KEY }}',
                             'owner: GarryOne', 'repositories: jobadabra-lab', 'continue-on-error: true', "steps.records_app_key.outputs.set == 'true'"):
                    if want not in step:
                        bad.append(f'{where}: the records_app step lacks `{want}`')
                if 'id: records_app_key' not in body[:mint]:
                    bad.append(f'{where}: no records_app_key step (the key-set check) before the mint')
        self.assertGreater(seen, 8, 'the lint saw the workflows that read jobadabra-lab')
        self.assertEqual(bad, [], '\n'.join(bad))

    def test_the_lint_catches_a_job_that_kept_the_old_secret_alone(self):
        sample = "jobs:\n  fetch:\n    steps:\n      - name: x\n        env:\n          NET_RECORDS_READ_TOKEN: ${{ secrets.NET_RECORDS_READ_TOKEN }}\n"
        (start, block), = jobs(sample)
        line = next(one for one in block if OLD.search(one))
        self.assertFalse(GOOD.search(line))
        self.assertTrue(GOOD.search('NET_RECORDS_READ_TOKEN: ${{ steps.records_app.outputs.token || secrets.NET_RECORDS_READ_TOKEN }}'))


if __name__ == '__main__':
    unittest.main()
