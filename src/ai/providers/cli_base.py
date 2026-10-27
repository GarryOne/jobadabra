"""What every engine that runs the user's own signed-in CLI shares (Claude Code `claude -p`, Codex `codex exec`).

The user's OWN, unmodified, already signed-in binary runs on this computer exactly as the user could run it themselves, on their plan's
usage limits, not API credits. It never reads, copies, stores, logs or forwards the CLI's credentials, never sets auth variables for it
(each subclass drops the API keys the app gives Python), and never signs in for the user. Each call gets a fresh temp folder (its working
directory and the only place the CLI may read: attached images/PDFs are written there), a hard timeout, a cap on processes at once, and
one repair when a structured answer does not match its schema. Subclasses say how to call their binary (`command`, `parse`, `answer`,
`usage`, `env`). Guarded by tests/test_ai_engine.py (Claude Code) and tests/test_ai_providers.py (both).
"""
import base64
import json
import os
import subprocess
import tempfile
import time
from pathlib import Path

from ..slots import Slots
from .contract import Adapter, AiError, AiLimit, Attachment, Response, SUBSCRIPTION, TextBlock, plus
from .schema import parse_json, problems

TIMEOUT_S = 240        # a hard stop per call; a call that reads files gets at least FILES_TIMEOUT_S
FILES_TIMEOUT_S = 600
TIMEOUTS_BEFORE_STOP = 2  # in a row: the CLI is not answering at all, so the run stops instead of waiting for every job
EXT = {'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'application/pdf': 'pdf'}


class CliError(AiError):
    """The CLI didn't give an answer (timeout, a crash, unreadable output)."""


class CliLimitError(CliError, AiLimit):
    """The user's plan limit is reached, or the CLI can't run (not signed in, not installed). Like the API's spend limit
    (cost.limit_reached): every other call would fail too, so the run stops and says why."""


def write_files(request, folder):
    """The request's images/PDFs written into folder, in order: their names."""
    names = []
    for part in request.attachments:
        name = f"{'image' if part.kind == 'image' else 'document'}-{len(names) + 1}.{EXT.get(part.media_type, 'bin')}"
        (Path(folder) / name).write_bytes(base64.b64decode(part.data))
        names.append(name)
    return names


def conversation(request, names=()):
    """The messages as one prompt; an attachment becomes `[attached file: ./<name>]` where it was."""
    many, parts, files = len(request.messages) > 1, [], iter(names)
    for message in request.messages:
        texts = [part if isinstance(part, str) else f'[attached file: ./{next(files)}]' for part in message.parts
                 if isinstance(part, Attachment) or part]
        text = '\n\n'.join(texts)
        parts.append(f'{message.role.upper()}:\n{text}' if many else text)
    return '\n\n'.join(parts)


class CliAdapter(Adapter):
    billing = SUBSCRIPTION
    tool = ''                  # the CLI's name, in words ("Claude Code")
    folder = ''                # the call folders' name: job-pilotto-<folder>-…
    timeout_env = 'JOB_PILOTTO_CLI_TIMEOUT'
    missing_text = not_answering_text = ''
    _slots = Slots(2)   # a subclass sets its own (served by priority: src/ai/slots.py)

    def __init__(self, binary='', fallback=None, run=subprocess.run, timeout=None, log=None):
        super().__init__(fallback=fallback, log=log)
        self.binary, self.run = binary, run
        self.timeout = timeout or int(os.getenv(self.timeout_env) or TIMEOUT_S)
        self._timeouts = 0  # consecutive calls that timed out

    # ----- what a subclass says -----
    def build(self, request, folder, files):
        """(args, prompt, native): the command line, the prompt on stdin, and whether the CLI enforces the schema itself."""
        raise NotImplementedError

    def parse(self, out, args, queued_s, ran_s):
        """(data, stop) from a finished process, or raise the contract's error."""
        raise NotImplementedError

    def answer(self, data, schema):
        raise NotImplementedError

    def usage(self, data):
        raise NotImplementedError

    def env(self, args):
        return dict(os.environ)

    def reads_files(self, args):
        return False

    # ----- shared -----
    def call(self, args, prompt, folder):
        if not self.binary:
            raise CliLimitError(self.missing_text, final=True)
        if self._timeouts >= TIMEOUTS_BEFORE_STOP:  # it already failed to answer: nothing waits again in this run
            raise CliLimitError(self.not_answering_text.format(seconds=self.timeout))
        wait = max(self.timeout, FILES_TIMEOUT_S) if self.reads_files(args) and not os.getenv(self.timeout_env) else self.timeout
        asked = time.monotonic()
        with self._slots:
            began = time.monotonic()
            try:
                out = self.run(args, input=prompt, capture_output=True, text=True, timeout=wait, cwd=folder, env=self.env(args))
            except subprocess.TimeoutExpired:
                self._timeouts += 1
                if self._timeouts >= TIMEOUTS_BEFORE_STOP:
                    raise CliLimitError(self.not_answering_text.format(seconds=wait)) from None
                raise CliError(f'{self.tool} did not answer within {wait} s') from None
            except OSError as error:
                raise CliLimitError(self.missing_text, final=True) from error
        self._timeouts = 0
        return self.parse(out, args, began - asked, time.monotonic() - began)

    def complete(self, request):
        schema = request.schema
        with tempfile.TemporaryDirectory(prefix=f'job-pilotto-{self.folder or self.name}-') as folder:
            files = write_files(request, folder)
            args, prompt, native = self.build(request, folder, files)
            if schema is not None and not native:
                prompt += ('\n\nAnswer with only one JSON object (no prose, no code fence) that matches this JSON '
                           f'schema:\n{json.dumps(schema)}')
            data, stop = self.call(args, prompt, folder)
            usage = self.usage(data)
            text = self.answer(data, schema)
            if schema is not None and stop == 'end_turn':
                try:
                    found = problems(parse_json(text), schema)
                except ValueError:
                    found = ['not JSON']
                if found:  # repaired once: the same question, with what was wrong
                    self.log(f'Warning: {self.tool} answer did not match the schema ({"; ".join(found[:3])}); asking once more')
                    again = (f'{prompt}\n\nYour previous answer was not valid ({"; ".join(found[:5])}):\n{text[:6000]}\n\n'
                             'Answer again with only the corrected JSON object.')
                    data, stop = self.call(args, again, folder)
                    usage = plus(usage, self.usage(data))
                    text = self.answer(data, schema)
                    try:
                        if problems(parse_json(text), schema):
                            raise ValueError('schema')
                    except ValueError:
                        raise CliError(f'{self.tool} gave no valid JSON answer for this step (twice)') from None
                text = json.dumps(parse_json(text), ensure_ascii=False)
        return Response(content=[TextBlock(text)], usage=usage, model=request.model, stop_reason=stop, engine=self.name,
                        raw=data if isinstance(data, dict) else {})
