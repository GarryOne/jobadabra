"""Keep the beta's copied suite jobs in step with their standalone workflows."""
from pathlib import Path
import re
import unittest

from tests.test_workflow_paths import starts

WORKFLOWS = Path(__file__).resolve().parent.parent / '.github/workflows'
PAIRS = {'mac': ('e2e.yml', 'test-mac'), 'windows': ('e2e-windows.yml', 'test-windows')}

# Invariant: every exception is a current difference with a reviewed reason, never a blanket opt-out.
DIFFERENT = {
    'mac': {
        'E2E_AI_ANSWERS': 'Only standalone first attempts can record or force burn-in; the common replay mode is checked separately below.',
        'E2E_AI_FAMILY': 'Only standalone manual dispatches pin a family; the gate uses engine.mjs run-number rotation.',
        'E2E_STORE': 'plan-run.mjs documents GATE_STORE_LEGS=one: the gate keeps one alternating store until both stores run in one job.',
        'E2E_STEP_NAMES': 'runner.mjs selects PR steps; the beta runs the whole suite.',
        'E2E_FALLBACK_SUITES': 'red-steps.mjs caps renamed PR picks; the beta has no picked steps to fall back from.',
        'E2E_FALLBACK_SUITE': 'red-steps.mjs identifies a reserved PR leg; the beta runs full suites.',
        'E2E_FULL': 'The gate enables paid judges only for a nightly beta under budget; standalone dispatches may also request them.',
        'E2E_QUALITY_JUDGE_HISTORY': 'quality-rate.mjs treats old nights as information on PRs only; the beta keeps the default history verdict.',
        'E2E_RUN_KIND': 'replay.mjs always labels this release job gate; standalone runs use gate only when given a release tag.',
        'E2E_SEED': 'variation.mjs uses a fixed path for every beta; standalone non-gate runs can vary by run id.',
        'E2E_COVERAGE': 'coverage.mjs records current-code PR/main runs, never release builds.',
        'E2E_COVERAGE_SHA': 'coverage.mjs stamps that current-code coverage; the beta does not collect it.',
        'JOB_PILOTTO_E2E_EXPECTS_FAILURES': 'sentry.js tags intentional mutant failures; the beta never mutates the build.',
        'PR_RUN': 'The standalone first try skips paid report-only retries on PRs; the beta keeps retries.',
    },
    'windows': {
        'E2E_FULL': 'The beta omits duplicate paid Windows judges (owner, 7 Oct); standalone runs accept inputs.full.',
        'E2E_SEED': 'variation.mjs fixes every beta path; standalone Windows can follow a Mac run seed.',
        'E2E_RUN_KIND': 'replay.mjs always labels this release job gate; standalone Windows accepts an optional release tag.',
        'E2E_STEP_NAMES': 'runner.mjs selects standalone PR smoke steps; the beta runs the whole suite.',
        'E2E_FALLBACK_SUITES': 'red-steps.mjs reserves renamed PR picks; the beta has no picked steps.',
        'E2E_FALLBACK_SUITE': 'red-steps.mjs identifies a reserved PR leg; the beta runs full suites.',
        'E2E_STORE': 'Standalone PR smoke uses fresh SQLite; the beta keeps the default store rotation (store.mjs).',
        'E2E_AI_REPLAY': 'desktop.yml keeps the qualityai-live expression on every replay line (tests/test_quality_replay_gate.py); qualityai is sameOnEveryOs, so the Windows value is 1 either way.',
    },
}
DIFFERENT_NAMES = {
    'mac': {
        'first try': 'The beta labels the suite; standalone labels matrix.key, including shard/store/burn-in suffixes.',
        'second try': 'The beta labels the suite; standalone labels matrix.key, including shard/store/burn-in suffixes.',
    },
    'windows': {},
}


def job(text, name):
    """Extract one top-level job, using the same section boundaries as test_workflow_ai_answers."""
    match = re.search(rf'(?ms)^  {re.escape(name)}:\n.*?(?=^  [a-z][\w-]*:|\Z)', text)
    if not match:
        raise AssertionError(f'missing suite job {name}')
    return match.group()


def steps(section):
    """Split the workflow's fixed-indentation step list without parsing shell bodies as YAML."""
    return re.split(r'(?m)^      - ', section)[1:]


def one_step(section, pattern):
    """Require exactly one step matching a structural marker, so removed steps cannot pass silently."""
    found = [step for step in steps(section) if re.search(pattern, step, re.M)]
    if len(found) != 1:
        raise AssertionError(f'expected one step matching {pattern!r}, found {len(found)}')
    return found[0]


def env(section, indent):
    """Read scalar env values at one scope, ignoring comments but preserving expression text."""
    padding = ' ' * indent
    block = re.search(rf'(?ms)^{padding}env:\n(.*?)(?=^{padding}\S|\Z)', section)
    if not block:
        return {}
    return {key: re.split(r'\s+#', value, maxsplit=1)[0].strip()
            for key, value in re.findall(r'(?m)^' + padding + r'  ([A-Za-z_][A-Za-z0-9_]*): *(.*)$', block[1])}


def first_try(section, pair):
    """Locate the Mac first try by id and Windows' single main suite invocation by command."""
    return one_step(section, r'^        id: suite_run$' if pair == 'mac'
                    else r'^          node suite\.mjs \$\{\{ matrix\.suite \}\}')


def suite_env(section, pair):
    """Compare the environment the first suite process receives, including step overrides."""
    values = env(section.split('    steps:', 1)[0], 4)
    if not values:
        raise AssertionError('missing job-level suite env')
    return values | env(first_try(section, pair), 8)


def suite_names(section, pair):
    """Read names of the suite attempts and AI cache steps (save is deliberately unnamed)."""
    selected = {'first try': first_try(section, pair)}
    if pair == 'mac':
        selected['second try'] = one_step(section, r'^          export .*E2E_RERUN=1')
    for action in ('restore', 'save'):
        selected[f'AI cache {action}'] = one_step(
            section, rf'(?s)^.*        uses: actions/cache/{action}@[^\n]+\n.*          path: desktop/e2e/\.ai-cache\n')
    names = {}
    for role, step in selected.items():
        name = re.search(r'(?m)^(?:name:|        name:) (.+)$', step)
        names[role] = name[1].strip('\"\'') if name else None
    return names


class BetaSuiteJobInStep(unittest.TestCase):
    def pairs(self):
        """Load the actual copied jobs and require the Mac copy's documented origin to remain visible."""
        desktop = (WORKFLOWS / 'desktop.yml').read_text(encoding='utf-8')
        self.assertRegex(desktop, r"The suite job of e2e\.yml with the gate's settings[^\n]*\n[^\n]*\n  test-mac:")
        for pair, (source, copy) in PAIRS.items():
            yield pair, job((WORKFLOWS / source).read_text(encoding='utf-8'), 'suite'), job(desktop, copy)

    def assert_in_step(self, source, copy, different):
        """Reject new drifts and stale exceptions, with the key and both values in the failure."""
        changed = {key for key in source.keys() | copy.keys()
                   if key not in source or key not in copy or source[key] != copy[key]}
        self.assertEqual(set(different) - changed, set(), 'stale DIFFERENT entries: remove equal or gone keys')
        for key in sorted(changed):
            with self.subTest(key=key):
                self.assertIn(key, different, f'unreviewed drift: {source.get(key)!r} -> {copy.get(key)!r}')
                if key in different:
                    self.assertTrue(different[key].strip(), 'every exception needs a reason')

    def test_first_try_environments_stay_in_step(self):
        for pair, source, copy in self.pairs():
            with self.subTest(pair=pair):
                self.assert_in_step(suite_env(source, pair), suite_env(copy, pair), DIFFERENT[pair])

    def test_beta_answer_mode_matches_the_standalone_replay_mode(self):
        for pair, source, copy in self.pairs():
            if pair != 'mac':
                continue
            retry = one_step(source, r'^          export .*E2E_RERUN=1')
            mode = env(retry, 8)['E2E_AI_ANSWERS']
            self.assertEqual(suite_env(copy, pair)['E2E_AI_ANSWERS'], mode)
            self.assertTrue(suite_env(source, pair)['E2E_AI_ANSWERS'].endswith(mode.removeprefix('${{ ')),
                            'standalone first try must fall back to the same replay mode')

    def test_suite_and_ai_cache_step_names_stay_in_step(self):
        for pair, source, copy in self.pairs():
            with self.subTest(pair=pair):
                self.assert_in_step(suite_names(source, pair), suite_names(copy, pair), DIFFERENT_NAMES[pair])

    def test_python_ci_starts_on_every_workflow_this_guard_reads(self):
        for path in ('desktop.yml', 'e2e.yml', 'e2e-windows.yml'):
            with self.subTest(workflow=path):
                self.assertTrue(starts('tests-python.yml', [f'.github/workflows/{path}']))
        self.assertTrue(starts('tests-python.yml', ['tests/test_beta_suite_job_in_step.py']))


if __name__ == '__main__':
    unittest.main()
