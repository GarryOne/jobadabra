"""A PR is red only when a backbone check its diff reaches fails (owner, 28 Oct 2026, the e2e reliability design #2336, lanes table): a suite in the lane registry
(desktop/e2e/lanes.json) as tolerant or suspended shows grey on a PR, named with its lane, never red. A suite not listed is backbone. Why a first cut with two
suites: of the week's 21 e2e reds no gate caught (28 Oct 2026, tools/e2e_weekly.py --dry-run) about half depended on an AI answer, Notion or the clock; `quality`
(golden postings, 4 of its 7 rows) and `notion-real` (real Notion) are the two plainly outside the backbone. Any read that fails keeps every red red."""
import importlib.util
import json
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('pr_verdict', ROOT / 'tools' / 'pr-verdict.py')
pv = importlib.util.module_from_spec(spec); spec.loader.exec_module(pv)
from tools import main_e2e_state  # noqa: E402

REGISTRY = {'v': 1, 'suites': {'quality': {'lane': 'tolerant', 'input': 'ai', 'why': 'golden postings: the AI answers'},
                               'stores': {'lane': 'suspended', 'why': 'flips red, then green on one commit'}}}


def run(id, title='E2E for PR · quality,settings · a-branch'):
    return {'databaseId': id, 'workflowName': 'CI · End-to-end on Mac + Linux', 'status': 'completed', 'conclusion': 'failure', 'event': 'workflow_dispatch',
            'createdAt': '2026-10-28T11:00:00Z', 'updatedAt': '2026-10-28T11:20:00Z', 'displayTitle': title}


def job(id, name, conclusion='success', status='completed'):
    return {'id': id, 'name': name, 'status': status, 'conclusion': conclusion, 'steps': []}


PR = {'databaseId': 1, 'workflowName': 'CI · Pull request', 'status': 'completed', 'conclusion': 'success', 'event': 'pull_request',
      'createdAt': '2026-10-28T11:00:00Z', 'updatedAt': '2026-10-28T11:01:00Z', 'displayTitle': 'CI · Pull request'}


class LaneGreys(unittest.TestCase):
    def test_a_red_tolerant_suite_is_grey_named_with_its_lane_and_never_red(self):
        jobs = {7: [job(70, 'plan'), job(71, 'quality-1of2', 'failure'), job(72, 'quality-2of2'), job(73, 'HTML report')]}
        greys = pv.lane_greys('o/r', [PR, run(7)], jobs, read_lanes=lambda: REGISTRY)
        self.assertEqual(greys, {71: 'tolerant'}, 'a slice of a sharded suite counts as its suite')
        state, why, *_ = pv.verdict([PR, run(7)], jobs=jobs, greys=greys)
        self.assertEqual(state, 'success', why)
        self.assertTrue(why.startswith('tolerant: quality-1of2 ('), why)

    def test_a_suspended_suite_never_blocks_either_and_says_so(self):
        jobs = {7: [job(71, 'stores', 'failure')]}
        greys = pv.lane_greys('o/r', [PR, run(7)], jobs, read_lanes=lambda: REGISTRY)
        self.assertEqual(greys, {71: 'suspended'})
        self.assertTrue(pv.verdict([PR, run(7)], jobs=jobs, greys=greys)[1].startswith('suspended: stores ('))

    def test_a_backbone_red_beside_a_tolerant_one_still_fails_the_pr_and_names_only_it(self):
        jobs = {7: [job(71, 'quality', 'failure'), job(72, 'settings', 'failure')]}
        greys = pv.lane_greys('o/r', [PR, run(7)], jobs, read_lanes=lambda: REGISTRY)
        self.assertEqual(greys, {71: 'tolerant'}, 'settings is not in the registry: backbone')
        state, why, *_ = pv.verdict([PR, run(7)], jobs=jobs, greys=greys)
        self.assertEqual((state, why), ('failure', 'red: e2e settings'))

    def test_main_greys_and_lane_greys_read_together_and_a_plain_set_still_means_main(self):
        jobs = {7: [job(71, 'quality', 'failure'), job(72, 'focus', 'failure')]}
        state, why, *_ = pv.verdict([PR, run(7)], jobs=jobs, greys={71: 'tolerant', 72: 'main'})
        self.assertEqual(state, 'success', why)
        self.assertIn('tolerant: quality', why)
        self.assertIn('grey: focus (red on main too, not this PR)', why)
        only_focus = {7: [job(72, 'focus', 'failure')]}
        self.assertTrue(pv.verdict([PR, run(7)], jobs=only_focus, greys={72})[1].startswith('grey: focus (red on main too'), 'a plain set of ids means main, as before')

    def test_any_failed_read_keeps_every_red_red(self):
        jobs = {7: [job(71, 'quality', 'failure')]}

        def broken():
            raise OSError('no registry at this ref')
        self.assertEqual(pv.lane_greys('o/r', [PR, run(7)], jobs, read_lanes=broken), {})
        self.assertEqual(pv.lane_greys('o/r', [PR, run(7)], jobs, read_lanes=lambda: {'v': 1}), {}, 'a registry with no suites greys nothing')
        self.assertEqual(pv.lane_greys('o/r', [PR, run(7)], jobs, read_lanes=lambda: ['not', 'a', 'registry']), {})
        running = {7: [job(71, 'quality', '', 'in_progress')]}
        self.assertEqual(pv.lane_greys('o/r', [PR, run(7)], running, read_lanes=lambda: REGISTRY), {}, 'a job still running is not red')
        self.assertEqual(pv.lane_greys('o/r', [PR, run(7, title='Bisect quality abc')], jobs, read_lanes=lambda: REGISTRY), {}, "only the PR's own e2e run")

    def test_this_file_and_main_e2e_state_cut_a_sharded_name_the_same_way(self):
        for name in ('quality', 'quality-1of2', 'applyflows-2of2', 'recorded-5of5', 'wander'):
            self.assertEqual(pv.suite_of(name), main_e2e_state.suite_of(name), name)


class RegistryFile(unittest.TestCase):
    registry = json.loads((ROOT / 'desktop' / 'e2e' / 'lanes.json').read_text(encoding='utf-8'))
    suites = {p.stem for p in (ROOT / 'desktop' / 'e2e' / 'suites').glob('*.mjs')}

    def test_every_listed_suite_exists_and_says_why_it_is_not_backbone(self):
        self.assertEqual(self.registry['v'], 1)
        for name, entry in self.registry['suites'].items():
            self.assertIn(name, self.suites, f'{name}: no such suite in desktop/e2e/suites')
            self.assertIn(entry['lane'], ('tolerant', 'suspended', 'retired'), f'{name}: a suite not listed is backbone; listed it is one of the other three')
            if entry['lane'] == 'tolerant':
                self.assertIn(entry.get('input'), ('ai', 'clock', 'outside'), f'{name}: tolerance names the non-deterministic input (rule E)')
            self.assertGreater(len(re.sub(r'\W', '', entry.get('why', ''))), 24, f'{name}: why it is not backbone, in words')
            self.assertRegex(entry.get('since', ''), r'^2026-\d\d-\d\d$', f'{name}: the date it left the backbone')

    def test_the_first_cut_lists_the_two_suites_the_weeks_data_names(self):
        listed = {name: entry['lane'] for name, entry in self.registry['suites'].items()}
        self.assertEqual(listed, {'quality': 'tolerant', 'notion-real': 'tolerant'})


if __name__ == '__main__':
    unittest.main()
