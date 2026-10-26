"""The offline replay of the pool rows (.github/workflows/site-replays.yml; owner, 14 Oct 2026): never on a PR, started on time by the Worker (GitHub's schedule as
the backup, which stops on a commit already replayed), compared with the last green run (replay-gate.mjs, with a retry), its results kept as the next baseline,
red when a counted row got worse, Telegram on failure, only main updates /admin/lab-form-filling, and it never asks an AI."""
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WORKFLOW = (ROOT / '.github' / 'workflows' / 'site-replays.yml').read_text()
TRIGGER = re.search(r'(?m)^on:\n((?:  .*\n|\n)+?)(?=^\S)', WORKFLOW).group(1)


class ReplayOfflineWorkflow(unittest.TestCase):
    def test_never_on_a_pr_and_on_no_schedule_by_hand_or_the_nightly_gate(self):
        self.assertNotIn('pull_request', TRIGGER)
        self.assertIn('workflow_dispatch:', TRIGGER)
        self.assertNotIn('schedule:', TRIGGER, 'owner, 17 Oct 2026: replays are for debugging, the daily check is live')
        self.assertIn("'Replay check · on time (Worker cron)'", WORKFLOW)
        self.assertIn('Anything changed since the last green replay?', WORKFLOW)
        self.assertIn("':!desktop/test'", WORKFLOW, 'a change to the tests alone replays nothing')

    def test_the_gate_compares_with_the_last_green_run_and_keeps_its_results(self):
        self.assertIn('--status success', WORKFLOW)
        self.assertIn('node replay-gate.mjs', WORKFLOW)
        self.assertIn('--retry', WORKFLOW)
        self.assertIn('name: replay-results-linux-${{ github.run_id }}', WORKFLOW)
        self.assertRegex(WORKFLOW, r"if: steps\.gate\.outputs\.red == '1'\n\s+run: .*exit 1")

    def test_only_main_publishes_and_alerts(self):
        send = re.search(r'- name: Send the rows[^\n]*\n\s+if: ([^\n]+)', WORKFLOW)
        self.assertIn("github.ref == 'refs/heads/main'", send.group(1))
        self.assertIn('node ci-alert.mjs failure', WORKFLOW)
        self.assertIn('secrets.CI_ALERTS_TELEGRAM_BOT_TOKEN', WORKFLOW)

    def test_it_never_asks_an_ai(self):
        for word in ('ANTHROPIC', 'OPENAI', 'claude -p', 'secrets: inherit'):
            self.assertNotIn(word, WORKFLOW)

    def test_the_nightly_no_longer_waits_for_a_replay(self):
        desktop = (ROOT / '.github' / 'workflows' / 'desktop.yml').read_text()
        self.assertNotIn('nightly-replay-gate', desktop, 'owner, 17 Oct 2026: the beta is gated by the e2e suites, page cases and unit tests')
        self.assertFalse((ROOT / 'tools' / 'nightly-replay-gate.sh').exists())


    def test_the_mac_records_come_from_the_private_repo_with_a_read_only_token(self):
        # owner, 14 Oct 2026: the encrypted recordings move to jobadabra-lab; one fetch script for both replay workflows
        fetch = (ROOT / 'desktop' / 'e2e' / 'net-records-fetch.sh').read_text()
        self.assertIn('GarryOne/jobadabra-lab', fetch)
        self.assertIn('NET_RECORDS_READ_TOKEN', fetch)
        for name in ('site-replays.yml',):
            flow = (ROOT / '.github' / 'workflows' / name).read_text()
            self.assertIn('bash net-records-fetch.sh', flow, name)
            self.assertIn('secrets.NET_RECORDS_READ_TOKEN', flow, name)
            self.assertNotIn('gh release download net-records', flow, f'{name}: one fetch, in net-records-fetch.sh')
        self.assertIn("'GarryOne/jobadabra-lab'", (ROOT / 'desktop' / 'e2e' / 'records-publish.mjs').read_text())


class BaselineReadsOldRuns(unittest.TestCase):
    def test_the_baseline_reads_runs_of_the_old_file_name_too_until_28_oct_2026(self):
        import os, subprocess, tempfile
        fake = '#!/usr/bin/env bash\n' \
               'if [ "$1 $2" = "run list" ]; then case "$*" in *"--workflow replay-offline.yml"*) echo 55;; esac; exit 0; fi\n' \
               'if [ "$1 $2" = "run download" ]; then exit 0; fi\nexit 1\n'
        with tempfile.TemporaryDirectory() as tmp:
            (Path(tmp) / 'gh').write_text(fake); os.chmod(Path(tmp) / 'gh', 0o755)
            env = {**os.environ, 'PATH': f"{tmp}{os.pathsep}{os.environ['PATH']}", 'GITHUB_REPOSITORY': 'o/r', 'GH_TOKEN': 'x'}
            out = subprocess.run(['bash', str(ROOT / 'desktop' / 'e2e' / 'replay-baseline.sh'), str(Path(tmp) / 'dir')], capture_output=True, text=True, env=env, timeout=30)
            self.assertTrue(out.stdout.strip().endswith('results.json'), out.stdout + out.stderr)
        self.assertIn('replay-offline.yml', (ROOT / '.github' / 'workflows' / 'site-replays.yml').read_text(), 'the workflow\'s own baseline step reads the old name too')


class DailyOnlyNotOnPrs(unittest.TestCase):
    """Owner, 17 Oct 2026: site replays and journeys are off PRs and run by hand (debugging); the daily check is a live run elsewhere."""
    WF = ROOT / '.github' / 'workflows'

    def test_no_replay_or_journey_workflow_starts_on_a_pull_request(self):
        self.assertFalse((self.WF / 'site-replays-pr.yml').exists())
        self.assertFalse((self.WF / 'site-replays-accept.yml').exists())
        for name in ('site-replays.yml', 'journeys.yml', 'replay-refill.yml'):
            on = (self.WF / name).read_text().split('\npermissions:')[0].split('\njobs:')[0]
            self.assertNotRegex(on, r'(?m)^  (pull_request|pull_request_target):', name)

    def test_the_replays_and_journeys_run_by_hand_only_with_no_schedule_and_no_refill_trigger(self):
        for name in ('site-replays.yml', 'journeys.yml', 'replay-refill.yml'):
            on = (self.WF / name).read_text().split('\njobs:')[0]
            self.assertNotRegex(on, r'(?m)^  (schedule|push):', f'{name}: replays are for debugging (owner, 17 Oct 2026)')
            self.assertIn('workflow_dispatch:', on, name)
        scheduler = (ROOT / 'worker' / 'src' / 'scheduler.js').read_text()
        self.assertNotIn("workflow: 'site-replays.yml'", scheduler, 'the Worker starts no replay')
        self.assertNotIn('gh workflow run replay-refill', (self.WF / 'site-replays.yml').read_text(), 'no refill trigger from the replay')


if __name__ == '__main__':
    unittest.main()


class ReplayOfflineShards(unittest.TestCase):
    """Owner, 14 Oct 2026 ("can we add more parallelization here? It runs for 25m already"): the rows go to 5 runners at once, one gate after them."""

    def test_five_shards_then_one_gate_that_merges_them(self):
        self.assertRegex(WORKFLOW, r'matrix:\n\s+shard: \[0, 1, 2, 3, 4\]')
        self.assertIn('JP_REPLAY_SHARD: ${{ matrix.shard }}/5', WORKFLOW)
        self.assertRegex(WORKFLOW, r'gate:\n\s+needs: \[check, replay, prejudge, retry\]\n\s+if: always\(\)')
        self.assertIn('pattern: replay-shard-${{ github.run_id }}-*', WORKFLOW)
        self.assertIn('rows from the shards', WORKFLOW)

    def test_every_job_runs_on_linux(self):
        # owner, 15 Oct 2026: the shards and the retry moved from macOS (queued for hours) to Linux; the PR gate had replayed Mac-made rows there as same as live
        jobs = dict(re.findall(r'\n  ([\w-]+):\n(?:(?!\n  \w).)*?runs-on: ([\w.-]+)', WORKFLOW, re.S))
        self.assertEqual({name: jobs[name] for name in ('check', 'replay', 'prejudge', 'retry', 'gate')},
                         {name: 'ubuntu-24.04' for name in ('check', 'replay', 'prejudge', 'retry', 'gate')})

    def test_each_row_keeps_what_the_extension_asked_the_ai(self):
        # 14 Oct 2026: coreweave misses its first ask on the runner only; ai-calls.json holds what the page sent (url, title, headings, text) to compare with the Mac.
        # (#708's misses.jsonl never reached the app, whose env is a fixed list, and held only part names: removed.)
        self.assertIn('replay-out/replays/*/ai-calls.json', WORKFLOW)
        self.assertNotIn('misses.jsonl', WORKFLOW)

    def test_a_broken_shard_is_told_on_telegram(self):
        self.assertIn("needs.replay.result }}\" != success", WORKFLOW)
