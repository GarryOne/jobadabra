"""The search tape (src/search_tape.py): a search's web and AI answers recorded once, replayed offline with nothing leaving the computer."""
import email.message
import io
import json
import os
import socket
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src import search_tape  # noqa: E402
from src.ai.providers import contract  # noqa: E402


class FakeReply(io.BytesIO):
    status = 200
    headers = email.message.Message()

    def __init__(self, body, url):
        super().__init__(body)
        self.url = url

    def geturl(self):
        return self.url


class TapeTest(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.env = {'JOBADABRA_SEARCH_TAPE': folder.name, 'JOBADABRA_TAPE_WAIT_SCALE': '0'}
        search_tape._index.clear()
        self.addCleanup(search_tape._index.clear)
        for key in search_tape.counts:
            search_tape.counts[key] = 0

    def mode(self, mode):
        search_tape._index.clear()   # a new process reads the tape again
        return mock.patch.dict(os.environ, {**self.env, 'JOBADABRA_SEARCH_TAPE_MODE': mode})


class WaitScaleTest(TapeTest):
    def slept(self, scale, seconds=10):
        with mock.patch.dict(os.environ, {'JOBADABRA_TAPE_WAIT_SCALE': scale}), mock.patch.object(search_tape.time, 'sleep') as sleep:
            search_tape._wait(seconds)
        return [call.args[0] for call in sleep.call_args_list]

    def test_the_scale_multiplies_the_recorded_wait(self):
        """1 = as recorded, 0.1 = ten times faster, 0 = no wait (18 Oct 2026: --speed 20 slept 20x the recorded time, hours)."""
        self.assertEqual(self.slept('1'), [10])
        self.assertEqual(self.slept('0.1'), [1.0])
        self.assertEqual(self.slept('0'), [])

    def test_the_old_speed_flag_is_refused(self):
        run = (Path(__file__).resolve().parents[1] / 'tools' / 'persona-search' / 'run.mjs').read_text()
        self.assertIn("includes('--speed')", run)
        self.assertNotIn('TAPE_SPEED', run)


class VirtualClockTest(TapeTest):
    """The replay's clock reads the recorded time at any wait scale (src/search_tape.py virtual_now)."""
    def advanced(self, scale, waits):
        with mock.patch.dict(os.environ, {'JOBADABRA_TAPE_WAIT_SCALE': scale}), mock.patch.object(search_tape.time, 'sleep'), \
                mock.patch.object(search_tape, '_skipped', [0.0]):
            before = search_tape.virtual_now()
            for wait in waits:
                search_tape._wait(wait)
            return search_tape.virtual_now() - before

    def test_scale_0_reads_the_same_time_as_the_recording(self):
        for scale in ('0', '0.1'):
            with self.subTest(scale=scale):
                self.assertAlmostEqual(self.advanced(scale, [2, 3, 10]), 15, delta=0.5)

    def test_waits_that_run_together_are_not_added_up(self):
        # real (short) sleeps so the threads overlap; at scale 0 nothing waits, so threads cannot overlap and their waits add up (a known limit)
        with mock.patch.dict(os.environ, {'JOBADABRA_TAPE_WAIT_SCALE': '0.1'}), mock.patch.object(search_tape, '_skipped', [0.0]):
            before = search_tape.virtual_now()
            threads = [threading.Thread(target=search_tape._wait, args=(w,)) for w in (3, 3, 3)]
            [t.start() for t in threads]
            [t.join() for t in threads]
            self.assertAlmostEqual(search_tape.virtual_now() - before, 3, delta=0.4)

    def test_replay_installs_the_virtual_clock_as_the_process_clock(self):
        source = (Path(__file__).resolve().parents[1] / 'src' / 'search_tape.py').read_text()
        self.assertIn('time.monotonic = virtual_now', source)


class WebTest(TapeTest):
    def test_a_recorded_page_is_replayed_without_the_web(self):
        sites = {'https://jobs.test/a': b'<html>job a</html>'}
        calls = []

        def real(request, data=None, *args, **kwargs):
            url = request.full_url if isinstance(request, urllib.request.Request) else request
            calls.append(url)
            if url not in sites:
                raise urllib.error.HTTPError(url, 404, 'Not Found', {}, None)
            return FakeReply(sites[url], url)
        urlopen = search_tape._web(real)
        with self.mode('record'):
            self.assertEqual(urlopen('https://jobs.test/a', timeout=5).read(), b'<html>job a</html>')
            with self.assertRaises(urllib.error.HTTPError):
                urlopen(urllib.request.Request('https://jobs.test/gone'))
        self.assertEqual(len(calls), 2)
        with self.mode('replay'):
            with urlopen('https://jobs.test/a') as reply:
                self.assertEqual((reply.read(), reply.status, reply.geturl()), (b'<html>job a</html>', 200, 'https://jobs.test/a'))
            with self.assertRaises(urllib.error.HTTPError) as gone:
                urlopen('https://jobs.test/gone')
            self.assertEqual(gone.exception.code, 404)
            with self.assertRaisesRegex(urllib.error.URLError, 'not on the search tape'):
                urlopen('https://jobs.test/never-seen')
        self.assertEqual(len(calls), 2, 'replay never reaches the web')
        self.assertEqual((search_tape.counts['web_tape'], search_tape.counts['web_missing']), (2, 1))
        missing = [json.loads(line) for line in (Path(self.env['JOBADABRA_SEARCH_TAPE']) / 'missing.jsonl').read_text().splitlines()]
        self.assertEqual([(item['web'], item['method'], item['url']) for item in missing], [(True, 'GET', 'https://jobs.test/never-seen')], 'the page the tape lacked is kept: method and address')

    def test_a_post_with_the_installs_own_id_is_answered_whatever_the_id_but_a_changed_purpose_misses(self):
        real = lambda request, data=None, *a, **k: FakeReply(b'{"token": "t"}', request.full_url)
        urlopen = search_tape._web(real)
        post = lambda install, purpose='index': urllib.request.Request('https://site.test/api/install-token', method='POST',
                                                                     data=('{"install": "%s", "purpose": "%s"}' % (install, purpose)).encode())
        with self.mode('record'):
            urlopen(post('0fd5bf0c475b07a7095d5e44')).read()
        with self.mode('replay'):
            for install in ('aaaaaaaaaaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbbbbbbbbbb'):
                self.assertEqual(urlopen(post(install)).read(), b'{"token": "t"}', 'two other installs, the same answer')
            with self.assertRaises(urllib.error.URLError):
                urlopen(post('aaaaaaaaaaaaaaaaaaaaaaaa', 'something-else'))
        self.assertEqual((search_tape.counts['web_tape'], search_tape.counts['web_missing']), (2, 1))

    def test_a_tape_recorded_before_norm_existed_answers_an_install_post_by_its_address(self):
        urlopen = search_tape._web(lambda *a, **k: None)
        folder = Path(self.env['JOBADABRA_SEARCH_TAPE'])
        (folder / 'bodies').mkdir(parents=True)
        (folder / 'bodies' / 'k1').write_bytes(b'{"token": "old"}')
        (folder / 'web.jsonl').write_text(json.dumps({'key': 'k1', 'url': 'https://site.test/api/install-token', 'method': 'POST', 'status': 200, 'type': 'application/json', 'seconds': 0}) + '\n')
        with self.mode('replay'):
            request = urllib.request.Request('https://site.test/api/install-token', method='POST', data=b'{"install": "cccccccccccccccccccccccc"}')
            self.assertEqual(urlopen(request).read(), b'{"token": "old"}')

    def test_a_replayed_page_reads_like_a_real_one_for_every_reader(self):
        """18 Oct 2026: headers were a dict, so careers.get_text raised on get_content_charset and no job board was read in any recorded search."""
        from src.sources import careers
        real = lambda request, data=None, *a, **k: FakeReply('Caf\u00e9 Stelle'.encode('latin-1'), 'https://jobs.test/b')
        reply_type = {'Content-Type': 'text/html; charset=latin-1'}
        def typed(request, data=None, *a, **k):
            reply = real(request)
            reply.headers['Content-Type'] = reply_type['Content-Type']
            return reply
        urlopen = search_tape._web(typed)
        for mode in ('record', 'replay'):
            with self.mode(mode), mock.patch.object(urllib.request, 'urlopen', urlopen), mock.patch.object(careers, '_public', return_value=True):
                self.assertEqual(careers.get_text('https://jobs.test/b'), 'Caf\u00e9 Stelle', mode)

    def test_the_apps_page_browser_on_another_port_is_the_same_request(self):
        real = lambda request, data=None, *a, **k: FakeReply(b'{"html": "<p>x</p>"}', request.full_url)
        urlopen = search_tape._web(real)
        ask = lambda port: urllib.request.Request(f'http://127.0.0.1:{port}/render', data=b'{"url": "https://jobs.test/a"}')
        with self.mode('record'):
            urlopen(ask(51234))
        with self.mode('replay'):
            self.assertEqual(urlopen(ask(60001)).read(), b'{"html": "<p>x</p>"}')


class OutcomeTest(TapeTest):
    """Every outcome of a request that is not a 200 is on the tape too (19 Oct 2026, proof 3: 73 web requests missing, all careers subdomains that never resolved
    when recorded: the search does not ask a host that does not exist, but the replay's stand-in lookup said every host exists)."""
    def lookup(self, known):
        def real(host, *args, **kwargs):
            if host not in known:
                raise socket.gaierror(-2, 'Name or service not known')
            return [(socket.AF_INET, socket.SOCK_STREAM, 6, '', ('93.184.216.34', 0))]
        return real

    def test_a_host_that_did_not_resolve_when_recorded_does_not_resolve_in_the_replay(self):
        for host in ('jobs.test', 'careers.nowhere.test'):
            with self.mode('record'):
                lookup = search_tape._lookup(self.lookup({'jobs.test'}))
                try:
                    lookup(host, None)
                except socket.gaierror:
                    pass
        with self.mode('replay'):
            lookup = search_tape._lookup(lambda *a, **k: self.fail('replay never looks a host up'))
            self.assertEqual(lookup('jobs.test', None)[0][4][0], '93.184.216.34')
            with self.assertRaises(socket.gaierror):
                lookup('careers.nowhere.test', None)
            self.assertEqual(lookup('never-looked-up.test', None)[0][4][0], '93.184.216.34', 'a host the recording never asked about is left to the web check, which counts it missing')

    def test_the_replays_public_host_check_agrees_with_the_recording(self):
        """careers._public is the search's own question: a host that did not resolve is not public, on the tape as when recorded."""
        from src.sources import careers
        results = {}
        for mode in ('record', 'replay'):
            with self.mode(mode), mock.patch.object(search_tape.socket, 'getaddrinfo', search_tape._lookup(self.lookup({'jobs.test'}))), \
                    mock.patch.object(careers.socket, 'getaddrinfo', search_tape.socket.getaddrinfo):
                results[mode] = [careers._public('jobs.test'), careers._public('careers.nowhere.test')]
        self.assertEqual(results['record'], results['replay'])
        self.assertEqual(results['replay'], [True, False])

    def test_a_host_that_resolved_to_a_private_address_stays_private_in_the_replay(self):
        private = lambda host, *a, **k: [(socket.AF_INET, socket.SOCK_STREAM, 6, '', ('10.0.0.7', 0))]
        with self.mode('record'):
            search_tape._lookup(private)('intranet.test', None)
        with self.mode('replay'):
            self.assertEqual(search_tape._lookup(None)('intranet.test', None)[0][4][0], '10.0.0.7')

    def test_every_failed_answer_replays_as_the_same_failure_with_no_live_call(self):
        """HTTP 404 and 500, a refusal, a timeout, an unreachable host: the replay raises the same class, never reaches the web."""
        failures = {'https://a.test/404': urllib.error.HTTPError('https://a.test/404', 404, 'Not Found', {}, None),
                    'https://a.test/500': urllib.error.HTTPError('https://a.test/500', 500, 'Server Error', {}, None),
                    'https://a.test/refused': ConnectionRefusedError(111, 'Connection refused'),
                    'https://a.test/timeout': TimeoutError('timed out'),
                    'https://a.test/dns': urllib.error.URLError(socket.gaierror(-2, 'Name or service not known'))}
        calls = []

        def real(request, data=None, *args, **kwargs):
            calls.append(request if isinstance(request, str) else request.full_url)
            raise failures[calls[-1]]
        urlopen = search_tape._web(real)
        raised = {}
        with self.mode('record'):
            for url in failures:
                try:
                    urlopen(url)
                except Exception as error:   # noqa: BLE001: the class is the point
                    raised[url] = type(error)
        self.assertEqual(len(calls), len(failures))
        with self.mode('replay'):
            for url, kind in raised.items():
                with self.assertRaises(kind, msg=url):
                    urlopen(url)
        self.assertEqual(len(calls), len(failures), 'replay never reaches the web')
        self.assertEqual((search_tape.counts['web_tape'], search_tape.counts['web_missing']), (len(failures), 0))


class AiTest(TapeTest):
    def client(self, answers):
        def build():
            def create(**params):
                answers.append(params)
                return contract.Response(content=[contract.TextBlock(f'answer {len(answers)}')], usage=contract.Usage(10, 2), model='m')
            return mock.Mock(messages=mock.Mock(create=create))
        return search_tape._Client(build)

    def test_an_answer_is_replayed_and_a_new_question_goes_live_and_is_kept(self):
        asked = []
        question = {'model': 'm', 'max_tokens': 5, 'messages': [{'role': 'user', 'content': 'score job 1, today is 2026-10-18'}]}
        with self.mode('record'):
            self.assertEqual(self.client(asked).messages.create(**question).content[0].text, 'answer 1')
        with self.mode('replay'):
            later_day = {**question, 'messages': [{'role': 'user', 'content': 'score job 1, today is 2026-11-02'}]}
            answer = self.client(asked).messages.create(**later_day)
            self.assertEqual((answer.content[0].text, answer.usage.input_tokens, len(asked)), ('answer 1', 10, 1))
            other = {**question, 'messages': [{'role': 'user', 'content': 'score job 2'}]}
            self.assertEqual(self.client(asked).messages.create(**other).content[0].text, 'answer 2')
        self.assertEqual((search_tape.counts['ai_tape'], search_tape.counts['ai_live']), (1, 1))
        with self.mode('replay'):
            self.assertEqual(self.client(asked).messages.create(**other).content[0].text, 'answer 2')
        self.assertEqual(len(asked), 2, 'the live answer was kept on the tape')


    def test_with_live_off_a_question_the_tape_lacks_is_counted_and_raises_never_asked(self):
        asked = []
        question = {'model': 'm', 'max_tokens': 5, 'messages': [{'role': 'user', 'content': 'score job 1'}]}
        with self.mode('record'):
            self.client(asked).messages.create(**question)
        other = {**question, 'messages': [{'role': 'user', 'content': 'score job 2'}]}
        with mock.patch.dict(os.environ, {'JOBADABRA_TAPE_LIVE': '0'}), self.mode('replay'):
            self.assertEqual(self.client(asked).messages.create(**question).content[0].text, 'answer 1', 'what is on the tape still replays')
            with self.assertRaises(RuntimeError):
                self.client(asked).messages.create(**other)
        self.assertEqual(len(asked), 1, 'the live client was never built or asked')
        kept = [json.loads(line) for line in (Path(self.env['JOBADABRA_SEARCH_TAPE']) / 'missing.jsonl').read_text().splitlines()]
        self.assertEqual([item['user'] for item in kept], ['score job 2'], 'the question the tape lacked is kept, to see what differs')
        self.assertEqual((search_tape.counts['ai_tape'], search_tape.counts['ai_missing'], search_tape.counts['ai_live']), (1, 1, 0))


class InstallTest(unittest.TestCase):
    def test_a_normal_run_never_loads_the_tape(self):
        self.assertFalse(getattr(urllib.request.urlopen, 'search_tape', False))
        init = (Path(__file__).resolve().parents[1] / 'src' / '__init__.py').read_text()
        self.assertIn("if _os.getenv('JOBADABRA_SEARCH_TAPE'):", init)


if __name__ == '__main__':
    unittest.main()
