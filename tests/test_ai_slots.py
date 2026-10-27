"""A first press's local boards get Claude's slots first, the board web search last, and there are 4 slots (owner, 27 Oct 2026: "I'd like all of
them in parallel. Web search, combined with more AI slots, combined with local boards first..."). Rerun 40450152414: with 2 slots the board reads'
AI calls waited 13-24 s each while the web search held one slot for ~25 s, and jobup.ch (p4's only local jobs) was still open at the 67 s cut."""
import re
import threading
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from src.ai import slots
from src.ai.providers import claude_code
from src.sources import careers

ROOT = Path(__file__).resolve().parents[1]
_READER = careers.READER


def setUpModule():   # the guard in tests/test_found_boards_ai.py: no page read reaches a real model from this file
    careers.READER = None


def tearDownModule():
    careers.READER = _READER


def _queue(gate, levels):
    """The order in which callers at these levels get the one slot, all of them queued while it is held."""
    got, threads, lock = [], [], threading.Lock()
    with gate:
        for n, level in enumerate(levels):
            def take(level=level, n=n):
                with slots.priority(level), gate:
                    with lock:
                        got.append(n)
            thread = threading.Thread(target=take)
            thread.start()
            threads.append(thread)
            deadline = time.monotonic() + 2
            while gate.waiting() < n + 1 and time.monotonic() < deadline:   # queued in this order
                time.sleep(0.005)
    for thread in threads:
        thread.join(5)
    return got


class TheSlotsServeTheFirstPressFirst(unittest.TestCase):
    def test_a_local_board_read_goes_before_an_ordinary_call_and_the_web_search_last(self):
        order = _queue(slots.Slots(1), [slots.LATER, slots.NORMAL, slots.FIRST, slots.NORMAL])
        self.assertEqual(order, [2, 1, 3, 0], 'FIRST, then NORMAL in arrival order, the web search (LATER) last')

    def test_no_slot_is_held_by_a_caller_that_raised(self):
        gate = slots.Slots(1)
        with self.assertRaises(ValueError), gate:
            raise ValueError
        with gate:
            pass

    def test_a_pool_thread_keeps_the_level_of_the_caller_that_carried_it(self):
        with slots.priority(slots.FIRST), ThreadPoolExecutor(1) as pool:
            self.assertEqual(pool.submit(slots.carry(slots.level)).result(), slots.FIRST)
            self.assertEqual(pool.submit(slots.level).result(), slots.NORMAL, 'not carried: an ordinary call')

    def test_claude_code_has_four_slots_and_the_reason(self):
        self.assertEqual(claude_code.PARALLEL, 4)
        line = next(line for line in (ROOT / 'src/ai/providers/claude_code.py').read_text().splitlines() if line.startswith('PARALLEL ='))
        self.assertIn('Why (', line + ' ' + (ROOT / 'src/ai/providers/claude_code.py').read_text().split(line)[1].splitlines()[1])
        self.assertIsInstance(claude_code.ClaudeCode._slots, slots.Slots)


class TheFirstPressMarksItsCalls(unittest.TestCase):
    """The call sites: the slice's board reader and its proposal FIRST (with every board read's pool thread), the board web search LATER."""
    def source(self, name):
        return (ROOT / 'src' / name).read_text()

    def test_the_slices_board_reader_and_proposal_go_first(self):
        text = self.source('first_jobs.py')
        self.assertRegex(text, r'def read_boards\(\):.*\n(.*\n){0,3}.*slots\.priority\(slots\.FIRST\)')
        self.assertRegex(text, r'pool\.submit\(slots\.carry\(.*board_ideas\.ideas')

    def test_a_board_reads_pool_threads_carry_the_callers_level(self):
        self.assertIn('pool.submit(slots.carry(one_or_spare), read_item)', self.source('sources/found_boards.py'))

    def test_the_web_search_waits_behind_every_other_call(self):
        self.assertIn("slots.carry(search, slots.LATER)", self.source("sources/board_web.py"))

    def test_the_web_search_starts_with_the_proposal_before_the_employers_are_picked(self):
        body = self.source('daily_search.py')
        body = body[body.index('def search('):]
        early, proposal, employers = body.index('board_web.early('), body.index('first_jobs.propose_early('), body.index('scout.active_sources(')
        self.assertLess(max(early, proposal), employers)
        self.assertEqual(len(re.findall(r'board_web\.early\(', body)), 1, 'started once')


POOL_CALL = re.compile(r'\b(pool|executor|_worker)\.(submit|map)\(\s*(?!slots\.carry\()([\w.]+)')
# Pools whose work never reaches a slot, or never runs under a FIRST or LATER caller: (file, the function handed to the pool) -> why.
NO_CARRY = {
    ('src/scout.py', 'check'): 'the scout runs after the slice, always at NORMAL (at its 500-line limit)',
    ('src/scout_index.py', 'check'): 'the central scout, on CI, always at NORMAL',
    ('src/scout_notion.py', 'check'): 'Notion feed rows, no AI',
    ('src/doctor.py', '_safe'): 'the doctor screen, no search',
    ('src/stores/job_page.py', 'stores.applications.sections'): 'store reads, no AI',
    ('src/stores/job_page.py', 'stores.events.list'): 'store reads, no AI',
    ('src/stores/job_page.py', 'stores.interviews.list'): 'store reads, no AI',
    ('src/notion/client.py', 'call'): 'Notion API calls, no AI',
    ('src/sources/render.py', 'stop'): 'the page renderer thread, no AI',
    ('src/sources/render.py', '_render'): 'the page renderer thread, no AI',
}


class EveryPoolCarriesItsCallersLevel(unittest.TestCase):
    """gitar on #2235: a board read's title and place calls ran in title_triage's and place_triage's own pools, whose threads start at NORMAL,
    so the slice's FIRST was lost for most of its AI calls. A pool thread takes its caller's level only through slots.carry()."""
    def test_every_pool_on_the_search_path_carries_the_level(self):
        found = {}
        for path in sorted((ROOT / 'src').rglob('*.py')):
            for n, line in enumerate(path.read_text().splitlines(), 1):
                for match in POOL_CALL.finditer(line):
                    found[(path.relative_to(ROOT).as_posix(), match.group(3))] = n
        self.assertIn(('src/scout.py', 'check'), found, 'positive control: the pattern sees a pool call')
        missing = sorted(f'{path}:{n} {fn}' for (path, fn), n in found.items() if (path, fn) not in NO_CARRY)
        self.assertEqual(missing, [], "wrap the pool's function in slots.carry(...), or list it in NO_CARRY with why it never needs the level")
        self.assertEqual(sorted(set(NO_CARRY) - set(found)), [], 'a NO_CARRY entry whose pool is gone')

    def test_a_board_reads_title_calls_keep_first_in_triages_pool(self):
        import json
        import tempfile
        from types import SimpleNamespace
        from unittest import mock

        from src.ai import title_triage
        levels = []

        def create(**kwargs):
            levels.append(slots.level())
            return SimpleNamespace(content=[SimpleNamespace(type='text', text=json.dumps({'fit': [1]}))], usage=SimpleNamespace(input_tokens=1, output_tokens=1))
        client = SimpleNamespace(messages=SimpleNamespace(create=create))
        with mock.patch.object(title_triage, 'STORE', Path(tempfile.mkdtemp()) / 't.json'), slots.priority(slots.FIRST):
            title_triage.decide(['Lagerist', 'Staplerfahrer'], {'role_keywords': ['warehouse']}, client)
        self.assertTrue(levels, 'positive control: the AI was asked')
        self.assertEqual(set(levels), {slots.FIRST}, "each batch, in triage's own pool thread, asks at the board read's level")

if __name__ == '__main__':
    unittest.main()
