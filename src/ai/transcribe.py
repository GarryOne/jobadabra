#!/usr/bin/env python3
"""Interview recording -> transcript with speakers, on this machine, free (no API).

Open-source parts, run through sherpa-onnx (k2-fsa, Apache-2.0: ONNX Runtime, no PyTorch, no tokens):
- Silero VAD cuts the audio at pauses into pieces of at most MAX_PIECE seconds;
- NVIDIA Parakeet-TDT 0.6B v2 (English) transcribes each piece with a time for every token;
- pyannote segmentation 3.0 + the 3D-Speaker ERes2Net voice embedding (English VoxCeleb) find who spoke when;
- each word goes to the speaker talking at its time, and consecutive words of one speaker make a turn;
- in the app's stereo recordings (microphone left, the call's audio right) the speaker heard on the
  microphone and not in the call is labelled "You".
This is the WhisperX recipe (ASR + diarization, aligned by word time) without the heavy stack.

Audio is decoded by PyAV (bundled FFmpeg), so webm/opus from the app's recorder, m4a, mp3, wav, mp4
and Telegram voice notes all work. The libraries (~115 MB) and the models (~520 MB) download once, on the first recording.

The output is plain text that interviews.run() reads like any transcript:
    [00:00:03] Speaker 1: Thanks for joining. Could you ...
    [00:00:11] Speaker 2: Sure. Last year ...

Usage: python -m src.ai.transcribe <audio> [--speakers N] [--out file.txt]
Progress goes to stderr as lines "progress <stage> <0-100>", for the desktop app's bar.
"""
import argparse
import bisect
import os
import subprocess
import sys
import tarfile
import urllib.request
from pathlib import Path

RATE = 16_000
MAX_PIECE = 20          # seconds of speech per ASR piece; Parakeet is accurate and light at this size
AUDIO_TYPES = ('.webm', '.m4a', '.mp3', '.wav', '.ogg', '.oga', '.opus', '.mp4', '.mov', '.aac', '.flac', '.aiff', '.mkv')
RELEASES = 'https://github.com/k2-fsa/sherpa-onnx/releases/download'
# English for now. For German/French etc. switch to sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8 (25 languages).
ASR_MODEL = os.getenv('JOBADABRA_ASR_MODEL', 'sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8')
MODELS = {
    'vad': (f'{RELEASES}/asr-models/silero_vad.onnx', 'silero_vad.onnx'),
    'segmentation': (f'{RELEASES}/speaker-segmentation-models/sherpa-onnx-pyannote-segmentation-3-0.tar.bz2',
                     'sherpa-onnx-pyannote-segmentation-3-0/model.onnx'),
    'embedding': (f'{RELEASES}/speaker-recongition-models/3dspeaker_speech_eres2net_sv_en_voxceleb_16k.onnx',
                  '3dspeaker_speech_eres2net_sv_en_voxceleb_16k.onnx'),
    'asr': (f'{RELEASES}/asr-models/{ASR_MODEL}.tar.bz2', f'{ASR_MODEL}/tokens.txt'),
}


def models_dir():
    if os.getenv('JOBADABRA_MODELS_DIR'):
        return Path(os.environ['JOBADABRA_MODELS_DIR'])
    return Path.home() / ('Library/Caches' if sys.platform == 'darwin' else '.cache') / 'jobadabra' / 'models'


def addon_dir():
    """Where the app puts the transcription libraries (av, numpy, sherpa-onnx, ~115 MB) the first time they're needed:
    the installer doesn't carry them. Next to the models, so JOBADABRA_MODELS_DIR moves both."""
    return models_dir().parent / 'addon'


def use_addon():
    folder = addon_dir()
    if folder.is_dir() and str(folder) not in sys.path:
        sys.path.insert(0, str(folder))


def libraries():
    use_addon()
    try:
        import av, numpy, sherpa_onnx  # noqa: F401
        return True
    except ImportError:
        return False


def install_addon(run=subprocess.run):
    """pip-install requirements-transcribe.txt into addon_dir() (wheels exist for the Mac and Windows builds)."""
    requirements = Path(__file__).resolve().parents[2] / 'requirements-transcribe.txt'
    progress('addon', 0)
    done = run([sys.executable, '-m', 'pip', 'install', '--quiet', '--disable-pip-version-check', '--no-input',
                '--upgrade', '--target', str(addon_dir()), '-r', str(requirements)], capture_output=True, text=True)
    if done.returncode != 0:
        raise RuntimeError(f'Installing the transcription add-on failed (is this Mac online?): {(done.stderr or "").strip()[-300:]}')
    progress('addon', 100)


def available():
    """True when the transcription libraries are installed (they're optional: the core doesn't need them)
    and JOBADABRA_DISABLE doesn't list "transcribe"."""
    from .. import features
    return not features.disabled('transcribe') and libraries()


def progress(stage, percent):
    print(f'progress {stage} {int(percent)}', file=sys.stderr, flush=True)


def ensure_models(folder=None, opener=urllib.request.urlopen):
    """Download any missing model (once) and return {name: path}."""
    folder = Path(folder or models_dir())
    folder.mkdir(parents=True, exist_ok=True)
    paths = {}
    for name, (url, relative) in MODELS.items():
        target = folder / relative
        if not target.exists():
            progress(f'download-{name}', 0)
            partial = folder / (url.rsplit('/', 1)[-1] + '.part')
            with opener(url, timeout=60) as response, open(partial, 'wb') as out:
                total = int(getattr(response, 'headers', {}).get('Content-Length') or 0)
                done, shown = 0, 0
                while chunk := response.read(1 << 20):
                    out.write(chunk)
                    done += len(chunk)
                    if total and done * 100 // total > shown:  # real bytes, so the app's bar moves while it downloads
                        shown = done * 100 // total
                        progress(f'download-{name}', min(shown, 99))
            progress(f'download-{name}', 100)
            if url.endswith('.tar.bz2'):
                progress(f'extract-{name}', 0)  # unpacking a bz2 is one slow CPU thread: say so instead of looking stuck
                with tarfile.open(partial, 'r:bz2') as archive:
                    archive.extractall(folder, filter='data')
                partial.unlink()
            else:
                partial.rename(target)
        paths[name] = target
    return paths


def load_audio(path):
    """(mono, channels) at 16 kHz from any audio/video file: mono float32 samples, and for a stereo file
    its two channels as a (2, n) array (the app records your microphone left and the call right), else None."""
    import av
    import numpy as np
    chunks = []
    with av.open(str(path)) as container:
        stream = next(s for s in container.streams if s.type == 'audio')
        stereo = stream.codec_context.channels == 2
        # Packed 32-bit float: stereo frames come interleaved (L R L R ...), one row per frame.
        resampler = av.AudioResampler(format='flt', layout='stereo' if stereo else 'mono', rate=RATE)
        for frame in list(container.decode(stream)) + [None]:
            chunks += [f.to_ndarray().reshape(-1) for f in resampler.resample(frame)]
    samples = np.concatenate(chunks).astype(np.float32) if chunks else np.zeros(0, np.float32)
    if not stereo:
        return samples, None
    channels = samples.reshape(-1, 2).T
    return channels.mean(axis=0), channels


def load_raw(path):
    """AudioTee's output (the app's call audio): raw 16-bit little-endian mono PCM at 16 kHz."""
    import numpy as np
    return np.fromfile(str(path), dtype='<i2').astype(np.float32) / 32768.0


def load_pair(mic_path, call_path, offset=0.0):
    """(mono, channels) from the app's two recordings: your microphone (left) and the call's audio (right,
    captured by AudioTee). offset = seconds the call recording started after the microphone one."""
    import numpy as np
    mic, _ = load_audio(mic_path)
    call = load_raw(call_path) if str(call_path).endswith('.pcm') else load_audio(call_path)[0]
    shift = int(round(offset * RATE))
    call = np.concatenate([np.zeros(shift, np.float32), call]) if shift > 0 else call[-shift:]
    length = max(len(mic), len(call))
    channels = np.zeros((2, length), np.float32)
    channels[0, :len(mic)], channels[1, :len(call)] = mic, call
    return np.clip(channels.sum(axis=0), -1, 1), channels


def find_you(channels, segments, ratio=4.0):
    """The speaker index heard mostly on the microphone channel (left) and hardly in the call (right),
    or None. A normal stereo file has both channels alike, so nobody passes the ratio."""
    import numpy as np
    if channels is None:
        return None
    energy = {}
    for start, end, speaker in segments:
        a, b = int(start * RATE), int(end * RATE)
        left, right = (float(np.mean(np.square(c[a:b]))) if b > a else 0.0 for c in channels)
        mic, call = energy.get(speaker, (0.0, 0.0))
        energy[speaker] = (mic + left * (end - start), call + right * (end - start))
    scored = {s: mic / max(call, 1e-9) for s, (mic, call) in energy.items() if mic > 0}
    best = max(scored, key=scored.get, default=None)
    return best if best is not None and scored[best] >= ratio else None


def speech_pieces(samples, vad_model):
    """[(start_second, samples)] of speech, split at pauses, each at most MAX_PIECE seconds."""
    import sherpa_onnx
    config = sherpa_onnx.VadModelConfig()
    config.silero_vad.model = str(vad_model)
    config.silero_vad.min_silence_duration = 0.4
    config.silero_vad.max_speech_duration = MAX_PIECE
    config.sample_rate = RATE
    vad = sherpa_onnx.VoiceActivityDetector(config, buffer_size_in_seconds=MAX_PIECE * 3)
    pieces, window = [], config.silero_vad.window_size
    for i in range(0, len(samples), window):
        vad.accept_waveform(samples[i:i + window])
        while not vad.empty():
            pieces.append((vad.front.start / RATE, vad.front.samples))
            vad.pop()
    vad.flush()
    while not vad.empty():
        pieces.append((vad.front.start / RATE, vad.front.samples))
        vad.pop()
    return pieces


def recognize(pieces, asr_folder, threads=4):
    """[(time, word)] over the whole recording, from the pieces' token timestamps."""
    import sherpa_onnx
    folder = Path(asr_folder)
    recognizer = sherpa_onnx.OfflineRecognizer.from_transducer(
        encoder=str(folder / 'encoder.int8.onnx'), decoder=str(folder / 'decoder.int8.onnx'),
        joiner=str(folder / 'joiner.int8.onnx'), tokens=str(folder / 'tokens.txt'),
        model_type='nemo_transducer', num_threads=threads)
    words = []
    for n, (start, samples) in enumerate(pieces):
        stream = recognizer.create_stream()
        stream.accept_waveform(RATE, samples)
        recognizer.decode_stream(stream)
        words += tokens_to_words(stream.result.tokens, stream.result.timestamps, start)
        progress('transcribe', 100 * (n + 1) / len(pieces))
    return words


def tokens_to_words(tokens, timestamps, offset=0.0):
    """Sentencepiece tokens (a leading space starts a new word) -> [(time of first token, word)]."""
    words = []
    for token, time in zip(tokens, timestamps):
        if token.startswith((' ', '▁')) or not words:
            words.append([offset + time, token.replace('▁', ' ').strip()])
        else:
            words[-1][1] += token
    return [(round(t, 2), w) for t, w in words if w]


def diarize(samples, segmentation, embedding, speakers=0, threads=4):
    """[(start, end, speaker index)] sorted by start. speakers=0 lets clustering decide how many."""
    import sherpa_onnx
    config = sherpa_onnx.OfflineSpeakerDiarizationConfig(
        segmentation=sherpa_onnx.OfflineSpeakerSegmentationModelConfig(
            pyannote=sherpa_onnx.OfflineSpeakerSegmentationPyannoteModelConfig(model=str(segmentation)),
            num_threads=threads),
        embedding=sherpa_onnx.SpeakerEmbeddingExtractorConfig(model=str(embedding), num_threads=threads),
        clustering=sherpa_onnx.FastClusteringConfig(num_clusters=speakers or -1, threshold=0.6),
        min_duration_on=0.3, min_duration_off=0.5)
    engine = sherpa_onnx.OfflineSpeakerDiarization(config)

    def report(done, total):
        progress('speakers', 100 * done / max(total, 1))
        return 0
    result = engine.process(samples, callback=report).sort_by_start_time()
    return [(s.start, s.end, s.speaker) for s in result]


def assign(words, segments):
    """Each word to the speaker whose segment covers its time (else the nearest segment)."""
    if not segments:
        return [(t, 0, w) for t, w in words]
    starts = [s[0] for s in segments]
    out = []
    for time, word in words:
        i = bisect.bisect_right(starts, time) - 1
        near = [segments[j] for j in (i, i + 1) if 0 <= j < len(segments)]
        covering = [s for s in near if s[0] <= time <= s[1]]
        best = covering[0] if covering else min(near, key=lambda s: min(abs(time - s[0]), abs(time - s[1])))
        out.append((time, best[2], word))
    return out


YOU = -1  # speaker index for "You" in channel-based labelling


def by_channel(words, channels, call_segments, window=0.4, ratio=3.0):
    """With your microphone and the call's audio recorded apart (the app's AudioTee recordings), a word
    loud on the microphone and quiet in the call is yours; the others go to the interviewer speaking then,
    from diarizing the call's audio alone. More reliable than clustering every voice together."""
    import numpy as np
    labelled = []
    for time, word in words:
        a, b = int(time * RATE), int((time + window) * RATE)
        mic, call = (float(np.mean(np.square(c[a:b]))) if b > a and a < c.shape[0] else 0.0 for c in channels)
        if mic > ratio * call and mic > 1e-6:
            labelled.append((time, YOU, word))
        else:
            labelled.append(assign([(time, word)], call_segments)[0])
    return labelled


def turns(labelled, you=None):
    """[(start, speaker, text)]: consecutive words of one speaker joined. Speakers are renumbered 1, 2, ...
    in the order they first speak, so "Speaker 1" is whoever opened the call; `you` (a diarization index)
    becomes speaker 0, shown as "You"."""
    order, result = ({you: 0} if you is not None else {}), []
    for time, speaker, word in labelled:
        number = order.setdefault(speaker, len(order) + (1 if you is None else 0))
        if result and result[-1][1] == number:
            result[-1][2].append(word)
        else:
            result.append((time, number, [word]))
    return [(t, s, ' '.join(ws)) for t, s, ws in result]


def clock(seconds):
    seconds = int(seconds)
    return f'{seconds // 3600:02d}:{seconds % 3600 // 60:02d}:{seconds % 60:02d}'


def render(turn_list, names=None):
    names = {0: 'You', **(names or {})}
    return '\n'.join(f'[{clock(t)}] {names.get(s, f"Speaker {s}")}: {text}' for t, s, text in turn_list)


def transcribe(path, speakers=0, models=None, threads=None, call=None, call_offset=0.0):
    """Speaker-labelled transcript text of one recording (plus, from the app, the call's audio recorded
    separately: `call`, starting `call_offset` seconds after `path`)."""
    threads = threads or max(1, min(8, (os.cpu_count() or 4) - 2))
    models = models or ensure_models()
    progress('decode', 0)
    samples, channels = load_pair(path, call, call_offset) if call else load_audio(path)
    if len(samples) < RATE:
        raise ValueError(f'{Path(path).name}: less than a second of audio')
    progress('decode', 100)
    pieces = speech_pieces(samples, models['vad'])
    if not pieces:
        raise ValueError(f'{Path(path).name}: no speech found')
    words = recognize(pieces, models['asr'].parent, threads)
    if call:  # the other people only: one fewer voice to cluster, and yours comes from the microphone
        segments = diarize(channels[1], models['segmentation'], models['embedding'], max(0, speakers - 1), threads)
        return render(turns(by_channel(words, channels, segments), YOU))
    segments = diarize(samples, models['segmentation'], models['embedding'], speakers, threads)
    return render(turns(assign(words, segments), find_you(channels, segments)))


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('audio', type=Path, nargs='?')
    parser.add_argument('--speakers', type=int, default=0, help='number of people on the call, if known (0 = detect)')
    parser.add_argument('--out', type=Path, help='write the transcript here (default: print it)')
    parser.add_argument('--call', type=Path, help="the call's audio recorded separately (AudioTee .pcm or any audio file)")
    parser.add_argument('--call-offset', type=float, default=0.0, help='seconds the call recording started after the main one')
    parser.add_argument('--download-only', action='store_true', help='install the add-on, fetch the models and stop (no audio needed: the app does this when Interviews opens)')
    args = parser.parse_args(argv)
    if not libraries():
        install_addon()
        if not libraries():
            raise RuntimeError('The transcription add-on installed but cannot be loaded')
    if args.download_only:
        ensure_models()
        return 0
    if not args.audio:
        parser.error('an audio file is needed unless --download-only')
    text = transcribe(args.audio, args.speakers, call=args.call, call_offset=args.call_offset)
    if args.out:
        args.out.write_text(text + '\n', encoding='utf-8')
        print(args.out)
    else:
        print(text)
    return 0


if __name__ == '__main__':
    sys.exit(main())
