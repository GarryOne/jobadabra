"""The signed-in CLI's slots serve the search's main thread first (src/ai/providers/slots.py): 27 Oct 2026, a first press's background board
reads took both of Claude Code's slots and its set-up calls in the main thread waited behind them, ending at 69 s instead of 28 s."""
import threading
import time
import unittest

from src.ai.providers.claude_code import ClaudeCode
from src.ai.providers.codex_cli import Codex
from src.ai.providers.slots import Slots


class SlotsTest(unittest.TestCase):
    def test_a_main_thread_call_takes_the_next_free_slot_before_waiting_background_calls(self):
        slots, order, lock = Slots(2), [], threading.Lock()
        held = threading.Event()

        def background(name, hold):
            with slots:
                with lock:
                    order.append(name)
                if hold:
                    held.wait(2)
                else:
                    time.sleep(0.05)
        busy = [threading.Thread(target=background, args=(f'busy{n}', True)) for n in range(2)]
        for thread in busy:
            thread.start()
        time.sleep(0.1)   # both slots held
        waiting = [threading.Thread(target=background, args=(f'later{n}', False)) for n in range(3)]
        for thread in waiting:
            thread.start()
        time.sleep(0.1)   # three background calls queued before the main thread asks
        threading.Timer(0.1, held.set).start()
        with slots:
            with lock:
                order.append('main')
        for thread in busy + waiting:
            thread.join(3)
        self.assertEqual(order[:3], ['busy0', 'busy1', 'main'], order)
        self.assertEqual(len(order), 6)

    def test_never_more_than_n_at_once(self):
        slots, running, peak, lock = Slots(2), [0], [0], threading.Lock()

        def call():
            with slots:
                with lock:
                    running[0] += 1
                    peak[0] = max(peak[0], running[0])
                time.sleep(0.02)
                with lock:
                    running[0] -= 1
        threads = [threading.Thread(target=call) for _ in range(10)]
        for thread in threads:
            thread.start()
        call()
        for thread in threads:
            thread.join(3)
        self.assertEqual(peak[0], 2)

    def test_both_cli_engines_use_them(self):
        for engine in (ClaudeCode, Codex):
            self.assertIsInstance(engine._slots, Slots, engine.__name__)


if __name__ == '__main__':
    unittest.main()
