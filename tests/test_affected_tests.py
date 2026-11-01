"""tools/affected-tests.py (9 Oct 2026): the local push check runs only the tests a change can break. These tests pin the rules that keep that
safe: imports (direct and through another module), text mentions, tree-scanning tests always, and "run everything" when nothing maps."""
import importlib.util
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('affected_tests', ROOT / 'tools/affected-tests.py')
affected = importlib.util.module_from_spec(spec)
spec.loader.exec_module(affected)


class AffectedTests(unittest.TestCase):
    def test_docs_alone_select_nothing(self):
        got = affected.select(['docs/x.md', 'README.md'])
        self.assertEqual([got[a] for a in ('python', 'desktop', 'worker', 'site')], [[], [], [], []])

    def test_dependency_and_unknown_files_run_everything(self):
        for f in ('package.json', 'requirements.txt', 'tests/test_0_notion_ids.py', 'something/new.bin', '.github/workflows/build.yml'):
            got = affected.select([f])
            self.assertEqual([got[a] for a in ('python', 'desktop', 'worker', 'site')], ['all'] * 4, f)

    def test_a_dependency_file_inside_one_area_runs_that_area_whole_and_the_others_by_mention(self):
        # 11 Oct 2026: desktop/e2e/package.json ran Python, worker and site whole for nothing
        for f, area in (('desktop/package.json', 'desktop'), ('desktop/e2e/package.json', 'desktop'), ('worker/package-lock.json', 'worker')):
            got = affected.select([f])
            self.assertEqual(got[area], 'all', f)
            self.assertTrue(all(got[other] != 'all' for other in ('python', 'desktop', 'worker', 'site') if other != area), f)

    def test_gitattributes_picks_the_tests_that_name_it_instead_of_everything(self):
        got = affected.select(['.gitattributes'])
        named = sorted(path.stem for path in (ROOT / 'tests').glob('test_*.py') if '.gitattributes' in path.read_text(encoding='utf-8') and path.stem != 'test_affected_tests')
        self.assertTrue(named, 'some test names .gitattributes')   # test_ship_background today; a module move must not break this test
        for name in named:
            self.assertIn(name, got['python'], name)
        self.assertTrue(all(got[a] != 'all' for a in ('python', 'desktop', 'worker', 'site')))

    def test_a_workflow_file_selects_the_tests_that_scan_the_workflows_folder(self):
        # 11 Oct 2026: page-cases.yml went in unclassified; a test that reads the folder, names no file, was not picked: main went red
        picked = affected.select(['.github/workflows/page-cases.yml'])['python']
        for test in ('test_workflow_runners', 'test_workflow_node24'):
            self.assertIn(test, picked, test)

    def test_an_edit_to_a_python_test_file_picks_no_desktop_tests_but_engine_and_fixture_edits_still_do(self):
        # 11 Oct 2026: a tests/test_*.py edit was counted as an engine change and started ~130 desktop tests (29 s) for a change the app cannot feel
        self.assertEqual(affected.select(['tests/test_ship.py', 'tests/test_ship_background.py'])['desktop'], [])
        self.assertTrue(affected.select(['src/ai/kit.py'])['desktop'], 'an engine edit still picks the desktop tests that call the engine')
        self.assertTrue(affected.select(['tests/fixtures/x.json'])['desktop'], 'a fixture or helper under tests/ may be read by them: still picked')

    def test_a_tool_script_selects_the_test_that_names_it(self):
        self.assertIn('test_ship', affected.select(['tools/ship.sh'])['python'])
        self.assertIn('test_pre_push_check', affected.select(['tools/pre-push-check.sh'])['python'])

    def test_an_engine_module_selects_every_test_that_imports_it_directly_or_through_another_module(self):
        got = set(affected.select(['src/ai/kit.py'])['python'])
        self.assertIn('test_kit', got)                      # imports it directly
        daily_tests = {p.stem for p in (ROOT / 'tests').glob('test_*.py') if re.search(r'^from src import daily\b|^import src\.daily\b', p.read_text(), re.M)}
        self.assertTrue(daily_tests, 'no test imports src.daily any more: pick another module that imports kit')
        self.assertLessEqual(daily_tests, got)              # daily imports kit, so the tests of daily are reached through it

    def test_a_desktop_lib_file_selects_the_tests_that_require_it_and_every_tree_scanner(self):
        picked = set(affected.select(['desktop/lib/files.js'])['desktop'])
        self.assertIn('test/files.test.js', picked)
        scanners = {f'test/{p.name}' for p in (ROOT / 'desktop/test').glob('*.test.js') if re.search(r'readdirSync|globSync', p.read_text())}
        self.assertTrue(scanners)
        self.assertLessEqual(scanners, picked)              # they read the whole tree: any change can break them

    def test_an_extension_change_selects_the_guards_that_scan_the_tree_through_an_imported_module(self):
        # 10 Oct 2026: 73ebe2b changed extension/ only; the version and page-words guards read the tree through an imported module
        # (then scripts/extension-fingerprint.mjs; tools/hardcoded-page-words.mjs), were not picked, and main went red.
        picked = set(affected.select(['extension/fill-flow.js'])['desktop'])
        self.assertLessEqual({'test/hardcoded-page-words.test.js'}, picked)

    def test_a_worker_change_runs_worker_tests_only(self):
        got = affected.select(['worker/src/report.js'])
        self.assertTrue(got['worker'])
        self.assertEqual((got['python'], got['site']), ([], []))

    def test_an_engine_file_no_test_reaches_runs_the_whole_python_suite(self):
        # The changed path alone, no file written: a temporary src/zz_... raced the shards that walk src/ (9 Oct 2026: red main twice).
        name = 'zz_' + 'orphan_nobody_names.py'          # built at run time: this file's own text must not name it
        self.assertFalse((ROOT / 'src' / name).exists())
        self.assertEqual(affected.select([f'src/{name}'])['python'], 'all')

    def test_no_test_writes_into_the_shared_src_folder(self):
        # Other shards read src/ while this one runs: a test that needs a file there makes it in a temporary copy instead.
        found = []
        for test in sorted((ROOT / 'tests').glob('test_*.py')):
            lines = test.read_text(encoding='utf-8').splitlines()
            src_vars = {m.group(1) for line in lines for m in [re.match(r"\s*(\w+)\s*=\s*ROOT\s*/\s*'src'", line)] if m}
            for number, line in enumerate(lines, 1):
                direct = re.search(r"ROOT\s*/\s*'src'.*\.(write_text|write_bytes|touch|mkdir)\(", line)
                via = any(re.search(rf"\b{var}\.(write_text|write_bytes|touch|mkdir)\(", line) for var in src_vars)
                if direct or via:
                    found.append(f'{test.name}:{number}')
        self.assertEqual(found, [])

    def test_the_import_graphs_are_read_once_per_process(self):
        # 11 Oct 2026: every select() re-parsed the whole tree (~1.5 s); the module's own tests took 21 s of the push gate's Python step.
        affected.py_graph.cache_clear(); affected.js_graph.cache_clear()
        first = affected.select(['src/store.py', 'desktop/lib/ladder/index.js'])
        again = affected.select(['src/store.py', 'desktop/lib/ladder/index.js'])
        self.assertEqual(first, again)
        self.assertGreaterEqual(affected.py_graph.cache_info().hits, 1)
        self.assertEqual(affected.py_graph.cache_info().misses, 1)

    # --- the e2e harness's own tests (desktop/e2e/test) are an area (c27, 1 Nov 2026) --------------------------------------------------
    # #2767 deleted three suites and edited two more, hang-caps.json and timing-baseline.json: every harness test that scans the suites went red one CI round at a time (4 rounds).
    PR_2767 = ['desktop/e2e/suites/focus.mjs', 'desktop/e2e/suites/cardstates.mjs', 'desktop/e2e/suites/foryou.mjs', 'desktop/e2e/suites/activity.mjs',
               'desktop/e2e/suites/settings.mjs', 'desktop/e2e/hang-caps.json', 'desktop/e2e/timing-baseline.json']

    def test_a_suite_and_baseline_change_like_2767_picks_the_harness_tests_that_scan_the_suites(self):
        picked = set(affected.select(self.PR_2767)['e2e'])
        for test in ('app-words-ratchet', 'timing-ratchet', 'suite-ai-mode', 'owns-step', 'suite-hang-caps'):   # the last two read every literal ctx.run step
            self.assertIn(f'test/{test}.test.mjs', picked, test)

    def test_a_harness_test_that_reads_a_folder_by_new_url_is_picked_for_a_file_inside_it(self):
        # timing-ratchet reads ../suites/ by new URL(..., import.meta.url) and ../lanes.json: no import, no scanner call that names the file
        for changed in ('desktop/e2e/suites/zz_not_there.mjs', 'desktop/e2e/lanes.json'):
            self.assertIn('test/timing-ratchet.test.mjs', affected.select([changed])['e2e'], changed)

    def test_a_python_only_edit_picks_no_scanning_harness_test(self):
        self.assertEqual(affected.select(['tests/test_ship.py'])['e2e'], [])
        self.assertLess(len(affected.select(['src/ai/kit.py'])['e2e']), 10)    # by reach or mention only

    def test_a_harness_dependency_file_runs_the_harness_whole_and_nothing_else_whole(self):
        got = affected.select(['desktop/e2e/package.json'])
        self.assertEqual((got['e2e'], got['desktop']), ('all', 'all'))
        self.assertTrue(all(got[a] != 'all' for a in ('python', 'worker', 'site')))

    def test_every_area_with_picked_tests_prints_a_ready_command_and_e2e_runs_from_its_folder(self):
        got = affected.select(self.PR_2767)
        cmds = affected.commands(got)
        self.assertTrue(cmds['e2e'].startswith('cd desktop/e2e && node --import ./test/stdout-to-stderr.mjs --test test/'), cmds['e2e'])
        self.assertIn('test/timing-ratchet.test.mjs', cmds['e2e'].split())
        self.assertTrue(cmds['desktop'].startswith('cd desktop && node --test test/'))
        self.assertEqual(affected.commands({'python': 'all', 'e2e': [], 'reasons': {}}), {})   # a whole area is CI's; an empty pick runs nothing
        for path in cmds['e2e'].split()[8:]:
            self.assertTrue((ROOT / 'desktop/e2e' / path).is_file(), path)

    def test_a_failing_reach_helper_runs_the_harness_whole_but_a_missing_one_does_not(self):
        # Gitar on #2774: a present helper that exits non-zero must not silently drop the tests picked only by reach
        class Failed: returncode, stdout = 1, 'not json'
        real_run, real_which = affected.subprocess.run, affected.shutil.which
        try:
            affected.subprocess.run = lambda *a, **k: Failed()
            affected.e2e_reach.cache_clear()
            got = affected.select(['desktop/e2e/lanes.json'])
            self.assertEqual(got['e2e'], 'all')
            self.assertIn('e2e', got['reasons'])
            affected.shutil.which = lambda name: None          # no node: the Python import graph and mentions still pick
            affected.e2e_reach.cache_clear()
            self.assertEqual(affected.e2e_reach(), {})
            self.assertNotEqual(affected.select(['desktop/e2e/lanes.json'])['e2e'], 'all')
        finally:
            affected.subprocess.run, affected.shutil.which = real_run, real_which
            affected.e2e_reach.cache_clear()

    def test_the_site_command_names_the_test_folder(self):
        self.assertEqual(affected.commands({'site': ['x.test.js'], 'reasons': {}}), {'site': 'node --test test/x.test.js'})


if __name__ == '__main__':
    unittest.main()
