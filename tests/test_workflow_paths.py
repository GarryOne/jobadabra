"""Which CI workflows a pull request starts: GitHub's `on: pull_request: paths:` alone decides (owner, 14 Oct 2026: "drop your shared pick logic, rely fully on gh
workflow paths"; a PR that changed only a recorded case ran the harness tests, a PR that changed the pick ran every job). Pins the class: no required check in a
workflow paths can skip (it would never report and block the PR), no step asks a pick, main still runs every suite on each push, and the real PR shapes."""
import re
import shlex
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WORKFLOWS = ROOT / '.github/workflows'


def on_block(name):
    return (WORKFLOWS / name).read_text().split('\njobs:')[0]


def pr_paths(name):
    """-> the patterns of a workflow's `pull_request: paths:`, or None (no filter)."""
    on = on_block(name)
    pr = re.search(r'(?ms)^  pull_request:.*?(?=^  \w|\Z)', on)
    if not pr or '    paths:' not in pr.group(0):
        return None
    return re.findall(r"(?m)^      - '([^']+)'", pr.group(0).split('    paths:', 1)[1])


def starts(name, files):
    """Does a pull request changing these files start this workflow? GitHub's rule: per file, the last pattern that matches wins; `!` excludes."""
    patterns = pr_paths(name)
    if patterns is None:
        return True
    def regex(glob):
        return re.compile('^' + re.escape(glob).replace(r'\*\*', '\0').replace(r'\*', '[^/]*').replace('\0', '.*') + '$')
    rules = [(p.startswith('!'), regex(p.lstrip('!'))) for p in patterns]
    def takes(file):
        verdict = False
        for negated, rule in rules:
            if rule.match(file):
                verdict = not negated
        return verdict
    return any(takes(f) for f in files)


def pr_workflows():
    return sorted(p.name for p in WORKFLOWS.glob('*.yml') if re.search(r'(?m)^  pull_request:', on_block(p.name)))


def required():
    text = (ROOT / 'tools/pr-settings.sh').read_text()
    return shlex.split(re.search(r"^checks='(.*)'$", text, re.M).group(1))


class TheClass(unittest.TestCase):
    def test_the_one_required_check_is_written_on_every_pr_and_no_paths_workflow_claims_it(self):
        checks = required()
        self.assertEqual(checks, ['All checks passed'], 'one required check (15 Oct 2026): four jobs took four runner slots per PR')
        self.assertIsNone(pr_paths('pr-gate.yml'), 'the gate starts on every pull request, so the verdict always has a run to read')
        verdict = (ROOT / 'tools' / 'pr-verdict.py').read_text()
        self.assertRegex(verdict, r"(?m)^CONTEXT = 'All checks passed'$", 'pr-verdict.yml writes it as a status (26 Oct 2026: no job waits on a runner for it)')
        self.assertRegex((WORKFLOWS / 'pr-verdict.yml').read_text(), r"(?m)^  workflow_run:", 'written when a PR workflow ends')
        for name in pr_workflows():
            text = (WORKFLOWS / name).read_text()
            self.assertEqual([c for c in checks if re.search(rf'(?m)^    name: {re.escape(c)}$', text)], [], f'{name}: a job of that name would pass the required check before the others end')

    def test_the_gate_runs_again_when_a_pr_is_retargeted_and_never_skips_its_job(self):
        gate = (WORKFLOWS / 'pr-gate.yml').read_text()
        self.assertRegex(gate, r'types: \[opened, synchronize, reopened, edited\]')
        self.assertNotRegex(gate, r'(?m)^    if: .*github\.event', 'a skipped required job counts as green and would hide an earlier red')

    def test_a_description_edit_never_cancels_the_run_of_a_push_or_a_retarget(self):
        gate = (WORKFLOWS / 'pr-gate.yml').read_text()
        self.assertIn("github.event.action == 'edited' && !github.event.changes.base && 'text' || 'code'", gate)
        self.assertIn('cancel-in-progress: true', gate)

    def test_no_workflow_asks_a_pick(self):
        for path in WORKFLOWS.glob('*.yml'):
            text = path.read_text()
            self.assertNotIn('ci-needed', text, path.name)
            self.assertNotIn('affected-jobs', text, path.name)
        for name in pr_workflows():
            self.assertNotRegex((WORKFLOWS / name).read_text(), r'git diff --name-only[^\n]*\|\s*grep', f'{name}: a second list of paths')
        self.assertFalse((ROOT / 'tools/ci-needed.sh').exists())
        self.assertFalse((ROOT / 'tools/affected-jobs.py').exists())

    def test_a_suite_starts_on_every_file_its_tests_read(self):
        # 14 Oct 2026: worker tests read extension/ files, but tests-worker.yml had no extension/** path; #731 changed extension/combo-click.js,
        # its worker test never ran on the PR, and main went red. Every '../..' file a suite's tests name must start that suite.
        for area in ('worker', 'site', 'desktop'):
            missing = set()
            for test in (ROOT / area / 'test').rglob('*'):
                if test.suffix not in ('.js', '.mjs') or 'node_modules' in test.parts:
                    continue
                for ref in re.findall(r"""['"`]((?:\.\./)+[\w.-][^'"`$]*)['"`]""", test.read_text(errors='ignore')):
                    for base in (test.parent, ROOT / area / 'test'):
                        target = (base / ref).resolve()
                        if target.exists() and ROOT in target.parents:
                            break
                    else:
                        continue
                    rel = target.relative_to(ROOT).as_posix()
                    probe = f'{rel}/x.js' if target.is_dir() else rel
                    if not rel.startswith(f'{area}/') and not starts(f'tests-{area}.yml', [probe]):
                        missing.add(rel)
            self.assertEqual(sorted(missing), [], f'tests-{area}.yml: files its tests read but its paths never start on')

    def test_every_file_a_suite_watches_starts_the_pr_suites(self):
        # #2043 (26 Oct 2026) changed src/ai/score.py and enrich.py, which the quality suite watches; pr-suites.yml had no src/ path, so it never started
        # and quality never ran on the PR it was meant to judge. A suite's `watches` (lib/plan.mjs) only works when the file also starts the workflow.
        missing = []
        for suite in sorted((ROOT / 'desktop' / 'e2e' / 'suites').glob('*.mjs')):
            found = re.search(r'(?m)^export const watches = \[([^\]]*)\]', suite.read_text())
            for path in re.findall(r"'([^']+)'", found.group(1)) if found else []:
                probe = f'{path}x.js' if path.endswith('/') else path
                if not starts('pr-suites.yml', [probe]):
                    missing.append(f'{suite.stem}: {path}')
        self.assertTrue(any('quality' in line for line in missing) or starts('pr-suites.yml', ['src/ai/score.py']), 'positive control')
        self.assertEqual(missing, [], 'pr-suites.yml paths: add these files its suites watch')

    def test_ship_waits_for_every_check_the_pr_started(self):
        # With one required check, a "green" that read only them would hand the owner a PR whose suites still run.
        self.assertNotIn('--required', (ROOT / 'tools/ship-pr.sh').read_text())

    def test_main_runs_every_suite_on_each_push(self):
        # one Linux job with a step per suite and the Windows job (tests/test_main_one_job.py has the full list)
        build = (WORKFLOWS / 'build.yml').read_text()
        self.assertNotIn('pull_request', on_block('build.yml'), 'a pull request runs each area by itself')
        for area in ('python', 'worker', 'desktop'):
            self.assertIn(f'--area {area}', build, area)
        self.assertIn('uses: ./.github/workflows/tests-desktop-windows.yml', build)
        self.assertIn('workflow_call:', on_block('tests-desktop-windows.yml'))
        for name in ('page-cases.yml', 'control-tests.yml'):
            self.assertNotIn('\n  push:', on_block(name), f'{name}: main runs it as a step of build.yml')


class TheShapes(unittest.TestCase):
    def started(self, files):
        return {name for name in pr_workflows() if pr_paths(name) is not None and starts(name, files)}

    def test_a_recorded_case_only_starts_the_recorded_replays(self):
        # #700 (14 Oct 2026): a new case.json and form.html ran the harness tests
        self.assertEqual(self.started(['desktop/e2e/recorded/combo-never-opens-late-answers-1/case.json', 'desktop/e2e/recorded/combo-never-opens-late-answers-1/form.html']),
                         {'page-cases.yml'})

    def test_docs_and_tools_start_python_only(self):
        self.assertEqual(self.started(['docs/HOW-IT-RUNS.md', 'tools/ship.sh', 'CLAUDE.md']), {'tests-python.yml'})

    def test_the_apply_flow_starts_its_replays_and_desktop(self):
        self.assertEqual(self.started(['extension/fill-flow.js']), {'tests-desktop.yml', 'tests-worker.yml', 'page-cases.yml', 'control-tests.yml', 'pr-suites.yml'})   # worker tests read extension/ (14 Oct 2026); pr-suites.yml names the suites the extension points at
        self.assertNotIn('site-replays-pr.yml', self.started(['desktop/lib/server.js']), 'owner, 17 Oct 2026: site replays are off PRs, scheduled only')
        self.assertFalse((WORKFLOWS / 'site-replays-pr.yml').exists())

    def test_the_harness_code_starts_the_harness(self):
        started = self.started(['desktop/e2e/lib/forms.mjs'])
        self.assertLessEqual({'harness.yml', 'tests-desktop.yml', 'page-cases.yml', 'control-tests.yml'}, started)

    def test_a_worker_change_starts_only_its_suite(self):
        self.assertEqual(self.started(['worker/src/index.js']), {'tests-worker.yml'})
        self.assertEqual(self.started(['worker/src/report.js']), {'tests-worker.yml', 'tests-desktop.yml'}, 'a desktop test reads it')

    def test_a_workflow_change_starts_that_workflow(self):
        for name in pr_workflows():
            if pr_paths(name) is not None:
                self.assertTrue(starts(name, [f'.github/workflows/{name}']), name)


if __name__ == '__main__':
    unittest.main()
