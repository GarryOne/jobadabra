"""The signed-in CLI's slots serve the search's own work before background reads (src/ai/providers/slots.py): 27 Oct 2026, a first press's
background board reads took both of Claude Code's slots; its set-up and the sorting of 552 employer jobs waited up to 49 s a call: 0 found."""
import contextlib
import re
import threading
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from src.ai.providers import slots as slots_module
from src.ai.providers.claude_code import ClaudeCode
from src.ai.providers.codex_cli import Codex
from src.ai.providers.slots import Slots

ROOT = Path(__file__).resolve().parents[1]


class SlotsTest(unittest.TestCase):
    def test_a_search_call_takes_the_next_free_slot_before_waiting_background_calls(self):
        slots, order, lock, held = Slots(2), [], threading.Lock(), threading.Event()

        def call(name, hold=False):
            with slots:
                with lock:
                    order.append(name)
                held.wait(2) if hold else time.sleep(0.05)

        def background(name, hold=False):
            with slots_module.background():
                call(name, hold)
        busy = [threading.Thread(target=background, args=(f'busy{n}', True)) for n in range(2)]
        for thread in busy:
            thread.start()
        time.sleep(0.1)   # both slots held by background reads
        later = [threading.Thread(target=background, args=(f'later{n}',)) for n in range(3)]
        for thread in later:
            thread.start()
        time.sleep(0.1)   # three background calls queued first
        mine = threading.Thread(target=call, args=('search',))   # the search's own call, from a pool thread (not the main one)
        mine.start()
        time.sleep(0.1)
        held.set()
        for thread in busy + later + [mine]:
            thread.join(3)
        self.assertEqual(order[:3], ['busy0', 'busy1', 'search'], order)
        self.assertEqual(len(order), 6)

    def test_a_pool_started_in_the_background_works_in_the_background(self):
        with slots_module.background(), ThreadPoolExecutor(2) as pool:
            self.assertEqual(list(pool.map(slots_module.carry(lambda _: slots_module.low()), range(3))), [True] * 3)
        with ThreadPoolExecutor(2) as pool:
            self.assertEqual(list(pool.map(slots_module.carry(lambda _: slots_module.low()), range(3))), [False] * 3)
        self.assertFalse(slots_module.low())

    def test_never_more_than_n_at_once(self):
        slots, running, peak, lock = Slots(2), [0], [0], threading.Lock()

        def call(low):
            with slots_module.background() if low else contextlib.nullcontext():
                with slots:
                    with lock:
                        running[0] += 1
                        peak[0] = max(peak[0], running[0])
                    time.sleep(0.02)
                    with lock:
                        running[0] -= 1
        threads = [threading.Thread(target=call, args=(n % 2 == 0,)) for n in range(10)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(3)
        self.assertEqual(peak[0], 2)

    def test_both_cli_engines_use_them(self):
        for engine in (ClaudeCode, Codex):
            self.assertIsInstance(engine._slots, Slots, engine.__name__)

    def test_every_pool_a_board_read_reaches_carries_its_background(self):
        """A new pool in these files runs its work with slots.carry, or its AI calls would jump ahead of the search's own."""
        for name in ('src/geo.py', 'src/ai/title_triage.py', 'src/ai/place_triage.py', 'src/sources/found_boards.py',
                     'src/sources/board_routes.py', 'src/sources/board_web.py', 'src/sources/careers.py'):
            source = (ROOT / name).read_text()
            for call in re.findall(r'pool\.(?:map|submit)\(([^,]+)', source):
                with self.subTest(name, call=call):
                    self.assertTrue(call.startswith('slots.carry(') or call in ('run',), call)


if __name__ == '__main__':
    unittest.main()
