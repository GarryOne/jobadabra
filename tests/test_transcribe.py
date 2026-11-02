import io
import sys
import tarfile
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src.ai import transcribe

try:
    import numpy
except ImportError:  # the add-on isn't installed (CI): the pure-Python parts are still tested
    numpy = None


class TranscribeTests(unittest.TestCase):
    def test_tokens_become_words_with_their_start_time(self):
        words = transcribe.tokens_to_words([' Hi', ' Ig', 'or', ',', ' thanks'], [0.1, 0.4, 0.5, 0.6, 0.9], offset=10)
        self.assertEqual(words, [(10.1, 'Hi'), (10.4, 'Igor,'), (10.9, 'thanks')])
        self.assertEqual(transcribe.tokens_to_words(['▁So', '▁we'], [0, 0.2]), [(0.0, 'So'), (0.2, 'we')])

    def test_words_go_to_the_speaker_talking_then_or_the_nearest(self):
        segments = [(0.0, 4.0, 7), (4.5, 9.0, 3), (9.2, 12.0, 7)]
        words = [(0.5, 'Hello'), (4.2, 'um'), (5.0, 'Sure'), (8.9, 'done'), (9.1, 'Next'), (15.0, 'bye')]
        self.assertEqual([s for _, s, _ in transcribe.assign(words, segments)], [7, 7, 3, 3, 3, 7])
        self.assertEqual(transcribe.assign([(1.0, 'x')], []), [(1.0, 0, 'x')])

    def test_turns_are_numbered_by_first_speaker_and_you_is_named(self):
        labelled = [(0, 7, 'Hi'), (1, 7, 'there.'), (3, 3, 'Hello.'), (5, 7, 'Question?'), (8, 5, 'Me'), (9, 5, 'too.')]
        turns = transcribe.turns(labelled)
        self.assertEqual(transcribe.render(turns), '[00:00:00] Speaker 1: Hi there.\n[00:00:03] Speaker 2: Hello.\n'
                                                   '[00:00:05] Speaker 1: Question?\n[00:00:08] Speaker 3: Me too.')
        turns = transcribe.turns(labelled, you=3)
        self.assertEqual([s for _, s, _ in turns], [1, 0, 1, 2])
        self.assertIn('[00:00:03] You: Hello.', transcribe.render(turns))
        self.assertEqual(transcribe.clock(3725), '01:02:05')

    @unittest.skipUnless(numpy, 'numpy not installed')
    def test_you_is_the_voice_on_the_microphone_channel(self):
        rate = transcribe.RATE
        left, right = numpy.zeros(rate * 6, numpy.float32), numpy.zeros(rate * 6, numpy.float32)
        left[:rate * 2] = 0.03; right[:rate * 2] = 0.2      # the interviewer: in the call, a little echo on the mic
        left[rate * 2:rate * 4] = 0.3                        # the candidate: on the mic only
        right[rate * 4:] = 0.2                               # a second interviewer
        segments = [(0, 2, 5), (2, 4, 1), (4, 6, 2)]
        self.assertEqual(transcribe.find_you(numpy.stack([left, right]), segments), 1)
        same = numpy.stack([left + right, left + right])     # an ordinary stereo file: nobody is "you"
        self.assertIsNone(transcribe.find_you(same, segments))
        self.assertIsNone(transcribe.find_you(None, segments))

    @unittest.skipUnless(numpy, 'numpy not installed')
    def test_the_call_audio_is_lined_up_with_the_microphone(self):
        with tempfile.TemporaryDirectory() as folder:
            call = Path(folder) / 'call.pcm'
            (numpy.ones(transcribe.RATE, numpy.int16) * 16384).astype('<i2').tofile(call)
            mic = numpy.full(transcribe.RATE * 2, 0.25, numpy.float32)
            with mock.patch.object(transcribe, 'load_audio', return_value=(mic, None)):
                mono, channels = transcribe.load_pair('mic.webm', call, offset=0.5)
        self.assertEqual(channels.shape, (2, transcribe.RATE * 2))
        half = transcribe.RATE // 2
        self.assertEqual((channels[1, half - 1], channels[1, half]), (0.0, 0.5))  # the call starts 0.5 s in
        self.assertAlmostEqual(float(mono[half]), 0.75)

    @unittest.skipUnless(numpy, 'numpy not installed')
    def test_words_on_the_microphone_are_yours_the_rest_go_to_the_interviewer_then(self):
        rate = transcribe.RATE
        mic, call = numpy.zeros(rate * 6, numpy.float32), numpy.zeros(rate * 6, numpy.float32)
        call[:rate * 2] = 0.2; mic[:rate * 2] = 0.02          # interviewer A (a little echo on the mic)
        mic[rate * 2:rate * 4] = 0.3                          # you
        call[rate * 4:] = 0.2                                 # interviewer B
        words = [(0.5, 'Why'), (2.5, 'Because'), (4.5, 'And')]
        labelled = transcribe.by_channel(words, numpy.stack([mic, call]), [(0, 2, 0), (4, 6, 1)])
        self.assertEqual([s for _, s, _ in labelled], [0, transcribe.YOU, 1])
        text = transcribe.render(transcribe.turns(labelled, transcribe.YOU))
        self.assertEqual(text.splitlines()[1], '[00:00:02] You: Because')

    def test_models_download_once(self):
        def archive(url):  # each release archive holds its model folder
            data = io.BytesIO()
            with tarfile.open(fileobj=data, mode='w:bz2') as tar:
                name = next(rel for u, rel in transcribe.MODELS.values() if u == url)
                info = tarfile.TarInfo(name); info.size = 2
                tar.addfile(info, io.BytesIO(b'ok'))
            return data.getvalue()
        fetched = []

        def opener(url, timeout=None):
            fetched.append(url)
            return io.BytesIO(archive(url) if url.endswith('.tar.bz2') else b'onnx')
        with tempfile.TemporaryDirectory() as folder, mock.patch('sys.stderr', io.StringIO()):
            paths = transcribe.ensure_models(folder, opener)
            self.assertTrue(all(path.exists() for path in paths.values()))
            self.assertEqual(len(fetched), 4)
            transcribe.ensure_models(folder, opener)
            self.assertEqual(len(fetched), 4)
            self.assertFalse(list(Path(folder).glob('*.part')))

    def test_download_reports_real_percent_and_unpacking(self):
        class Response(io.BytesIO):
            headers = {'Content-Length': str(4 << 20)}
        out = io.StringIO()
        with tempfile.TemporaryDirectory() as folder, mock.patch('sys.stderr', out), \
                mock.patch.dict(transcribe.MODELS, {'vad': ('https://x/v.onnx', 'v.onnx')}, clear=True):
            transcribe.ensure_models(folder, lambda url, timeout=None: Response(b'x' * (4 << 20)))
        lines = out.getvalue().splitlines()
        self.assertIn('progress download-vad 25', lines)
        self.assertIn('progress download-vad 75', lines)
        self.assertEqual(lines[-1], 'progress download-vad 100')

    def test_unpacking_is_reported_after_the_download_finishes(self):
        out = io.StringIO()
        with tempfile.TemporaryDirectory() as folder, mock.patch('sys.stderr', out):
            def opener(url, timeout=None):
                data = io.BytesIO()
                with tarfile.open(fileobj=data, mode='w:bz2') as tar:
                    info = tarfile.TarInfo('m/model.onnx'); info.size = 2
                    tar.addfile(info, io.BytesIO(b'ok'))
                return io.BytesIO(data.getvalue())
            with mock.patch.dict(transcribe.MODELS, {'m': ('https://x/m.tar.bz2', 'm/model.onnx')}, clear=True):
                transcribe.ensure_models(folder, opener)
        lines = out.getvalue().splitlines()
        self.assertEqual(lines[-2:], ['progress download-m 100', 'progress extract-m 0'])

    def test_available_follows_the_switch(self):
        with mock.patch.dict(transcribe.os.environ, {'JOBADABRA_DISABLE': 'transcribe'}):
            self.assertFalse(transcribe.available())

    def test_addon_installs_into_its_own_folder_and_reports_failure(self):
        with tempfile.TemporaryDirectory() as folder, mock.patch.dict(transcribe.os.environ, {'JOBADABRA_MODELS_DIR': f'{folder}/models'}), \
                mock.patch('sys.stderr', io.StringIO()) as err:
            calls = []
            transcribe.install_addon(lambda cmd, **kw: calls.append(cmd) or mock.Mock(returncode=0, stderr=''))
            self.assertIn(str(Path(folder) / 'addon'), calls[0])
            self.assertIn('progress addon 100', err.getvalue())
            with self.assertRaisesRegex(RuntimeError, 'is this Mac online'):
                transcribe.install_addon(lambda cmd, **kw: mock.Mock(returncode=1, stderr='no network'))

    def test_use_addon_puts_the_folder_on_the_path_once(self):
        with tempfile.TemporaryDirectory() as folder, mock.patch.dict(transcribe.os.environ, {'JOBADABRA_MODELS_DIR': f'{folder}/models'}):
            (Path(folder) / 'addon').mkdir()
            with mock.patch.object(sys, 'path', list(sys.path)):
                transcribe.use_addon()
                transcribe.use_addon()
                self.assertEqual(sys.path.count(str(Path(folder) / 'addon')), 1)


if __name__ == '__main__':
    unittest.main()
