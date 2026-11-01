# Every Telegram send of a run goes through telegram.deliver: a refused send is one plain line, never a traceback or a home-folder path.
# Why (1 Nov 2026, issue #2908; owner via the coordinator: "route them all through ONE shared guarded send"): a46307b guarded only the daily search's send,
# so the employer finder (src/scout.py) ended in a traceback with the person's paths on any 401/403/500, and ten more sites could do the same.
import ast
import contextlib
import io
import pathlib
import unittest
import urllib.error
from unittest import mock

from src import telegram

SRC = pathlib.Path(__file__).resolve().parent.parent / 'src'
# The one place that must see the refusal itself: it keeps the run's new jobs unshown when Telegram did not take them (src/daily_search_reporting.py send_messages).
KEEPS_THE_ERROR = {('daily_search_reporting.py', 'send_messages')}


def raw_send_calls():
    """Every use of Telegram's raw send in src/ outside telegram.py, as (file, enclosing function, line): `telegram.send` as a call or a callback, or `from .telegram import send`."""
    found = []
    for path in sorted(SRC.rglob('*.py')):
        if path.name == 'telegram.py' and path.parent == SRC:
            continue
        tree = ast.parse(path.read_text(encoding='utf-8'))
        for function in [tree, *[n for n in ast.walk(tree) if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))]]:
            for node in ast.iter_child_nodes(function):
                for inner in ast.walk(node):
                    raw = (isinstance(inner, ast.Attribute) and inner.attr == 'send' and isinstance(inner.value, ast.Name) and inner.value.id == 'telegram') \
                        or (isinstance(inner, ast.ImportFrom) and (inner.module or '').split('.')[-1] == 'telegram' and any(alias.name == 'send' for alias in inner.names))
                    if raw and not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                        found.append((path.name, getattr(function, 'name', ''), inner.lineno))
    return found


class EverySendSiteIsGuardedTest(unittest.TestCase):
    def test_no_site_calls_the_raw_send(self):
        raw = [site for site in raw_send_calls() if site[:2] not in KEEPS_THE_ERROR]
        self.assertEqual(raw, [], 'these sites crash a run when Telegram refuses; call telegram.deliver instead')

    def test_the_one_site_that_keeps_the_error_turns_it_into_words(self):
        source = (SRC / 'daily_search_reporting.py').read_text(encoding='utf-8')
        self.assertIn('telegram.failure_words(error)', source)

    def test_the_exception_is_still_a_raw_send(self):
        self.assertIn(('daily_search_reporting.py', 'send_messages'), {site[:2] for site in raw_send_calls()}, 'the exception list names a function that no longer sends')

    def test_there_are_send_sites_to_guard(self):
        used = {path.name for path in SRC.rglob('*.py') if 'telegram.deliver' in path.read_text(encoding='utf-8')}
        self.assertTrue({'scout.py', 'focus.py', 'trial.py', 'doctor.py', 'daily_modes.py', 'mail.py', 'rejection.py'} <= used, sorted(used))


class RefusedSendTest(unittest.TestCase):
    """Telegram's own answers, through the real send: each refusal is one plain line and the run goes on."""

    def refused(self, error):
        out = io.StringIO()
        with mock.patch('urllib.request.urlopen', side_effect=error), mock.patch('src.telegram.notify') as notify, \
                mock.patch.dict('os.environ', {}, clear=False), contextlib.redirect_stdout(out):
            notify.wants_telegram.return_value = True
            result = telegram.deliver('hello', 'token', '1')
        return result, out.getvalue()

    def test_every_refusal_is_one_plain_line(self):
        cases = [urllib.error.HTTPError('https://api.telegram.org/bot1/sendMessage', code, 'x', {}, None) for code in (401, 403, 404, 429, 500)]
        for error in cases + [OSError('/Users/someone/secret/path: no network')]:
            with self.subTest(error=str(error)):
                result, out = self.refused(error)
                self.assertIsNone(result)
                self.assertEqual(len(out.strip().splitlines()), 1, out)
                self.assertTrue(out.startswith('Warning: Telegram'), out)
                for leak in ('Traceback', '/Users/', 'HTTPError', 'File "'):
                    self.assertNotIn(leak, out)

    def test_the_words_fit_a_message_that_is_not_the_digest(self):
        for error in (urllib.error.HTTPError('u', 500, 'x', {}, None), RuntimeError('Bad Request: chat not found'), OSError('down')):
            with self.subTest(error=type(error).__name__):
                _, out = self.refused(error)
                self.assertNotIn('digest', out)
                self.assertNotIn('listed again', out)
        _, out = self.refused(RuntimeError('Bad Request: chat not found'))
        self.assertIn('did not accept', out, 'Telegram answered, so it was reached')

    def test_an_accepted_send_returns_what_telegram_answered(self):
        class Answer:
            def __enter__(self): return self
            def __exit__(self, *exc): return False
            def read(self): return b'{"ok": true, "result": {}}'
        with mock.patch('urllib.request.urlopen', return_value=Answer()), mock.patch('src.telegram.notify') as notify:
            notify.wants_telegram.return_value = True
            self.assertEqual(telegram.deliver('hello', 'token', '1')['ok'], True)


if __name__ == '__main__':
    unittest.main()
