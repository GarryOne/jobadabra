"""The `cli` engine: the user's own signed-in Claude Code (`claude -p`), on their Claude plan. Shared CLI rules: cli_base.py.

It drops the API key and the credit relay's address the app gives Python, so Claude Code can't bill them, and never signs in for the
user: when it isn't signed in, the user is told to run `claude` and sign in themselves. Guarded by tests/test_ai_engine.py.
"""
import json
import os
import re
import shutil
import subprocess
from pathlib import Path

from ..slots import Slots
from .cli_base import CliAdapter, CliError, CliLimitError
from .contract import Usage, SUBSCRIPTION

# Claude Code's model aliases for our model ids (the alias follows Claude Code's own latest model of that family).
ALIASES = (('claude-haiku', 'haiku'), ('claude-sonnet', 'sonnet'), ('claude-opus', 'opus'))
PARALLEL = 4     # Claude Code processes at once, whatever a module's thread pool (score.py runs 5); served by priority (src/ai/slots.py)
# Why (#first-press-slots, owner, 27 Oct 2026: "more AI slots"): with 2, a first press's calls waited 13-24 s each (rerun 40450152414); cost: up to ~1.2 GB (~300 MB a process, measured) and 4 calls at once on the person's plan
# Tools a text call never needs, for a Claude Code too old for --tools.
DENY = ('Bash', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'WebFetch', 'WebSearch', 'Task', 'Glob', 'Grep', 'Read')
_help = {}

LIMIT = re.compile(r'usage limit|hit your (?:usage )?limit|limit reached|limit will reset|rate.?limit|out of (?:extra )?usage'
                   r'|too many requests|\b429\b', re.I)
SIGNED_OUT = re.compile(r'not logged in|please run /login|run /login|invalid api key|authentication_error|oauth token'
                        r'|not authenticated|login required|/login'
                        # 7 Oct 2026: "Failed to authenticate: OAuth session expired and could not be refreshed": a search then failed 40 calls in a row
                        r'|failed to authenticate|session expired|could not be refreshed', re.I)
LIMIT_TEXT = ('Claude Code: your Claude usage window is exhausted (the plan\'s usage limit), so this AI step is paused; '
              'try again later, when the limit resets.')
SIGNED_OUT_TEXT = ('Claude Code is not signed in on this computer: open Terminal, run `claude` '
                   'and sign in with your Claude account, then try again. Or switch to an API key in Settings → Connections → AI.')
NOT_ANSWERING_TEXT = ('Claude Code did not answer twice in a row (each waited {seconds} s), so this AI step stops instead of waiting for every job. '
                      'It may be signed out or waiting for you: open Terminal, run `claude`, check it answers, then run again. '
                      'Or switch to an API key in Settings → Connections → AI.')
MISSING_TEXT = ('Claude Code was not found on this computer: install it from '
                'claude.com/claude-code and sign in, or switch to an API key in Settings → Connections → AI.')


def find_binary(env=None, exists=os.path.exists):
    """The user's `claude`: as the app found it (JOB_PILOTTO_CLAUDE_BIN), else on PATH, else where the installers put
    it (an app opened from the Finder has no shell PATH)."""
    env = os.environ if env is None else env
    given = env.get('JOB_PILOTTO_CLAUDE_BIN')
    if given and exists(given):
        return given
    on_path = shutil.which('claude', path=env.get('PATH'))
    if on_path:
        return on_path
    home = Path(env.get('HOME') or Path.home())
    for place in (home / '.local' / 'bin' / 'claude', home / '.claude' / 'local' / 'claude',
                  Path('/opt/homebrew/bin/claude'), Path('/usr/local/bin/claude')):
        if exists(str(place)):
            return str(place)
    return ''


def flags(binary, run=subprocess.run):
    """The flags this Claude Code offers (from `claude --help`, once per binary)."""
    if binary not in _help:
        try:
            out = run([binary, '--help'], capture_output=True, text=True, timeout=30, env=cli_env())
            text = (out.stdout or '') + (out.stderr or '')
        except (OSError, subprocess.SubprocessError):
            text = ''
        _help[binary] = set(re.findall(r'(--[a-z][a-z-]+)', text))
    return _help[binary]


def cli_env(parent=None):
    """The environment Claude Code runs in: the user's own, minus what the app added for Python's API calls (the
    API key and the credit relay's address), so it runs on the user's Claude sign-in. Nothing is added."""
    env = dict(os.environ if parent is None else parent)
    for name in ('ANTHROPIC_API_KEY', 'ANTHROPIC_BASE_URL'):
        env.pop(name, None)
    return env


def call_env(args, parent=None):
    """cli_env for one call. Haiku answers without extended thinking: through the API the engine keeps Haiku's thinking short too
    (effort_for: low). Claude Code turns thinking on by default: on 7 Oct 2026 sorting 100 job titles spent 8,656 of 9,110 output
    tokens thinking and took 84 s; without it 8 s, with comparable answers (a later step scores each job)."""
    env = cli_env(parent)
    if '--model' in args and args[args.index('--model') + 1] == 'haiku':
        env['MAX_THINKING_TOKENS'] = '0'
    return env


def alias(model):
    for prefix, name in ALIASES:
        if str(model).startswith(prefix):
            return name
    return model


def classify(text):
    """A Claude Code failure as the error to raise."""
    if SIGNED_OUT.search(text or ''):
        return CliLimitError(SIGNED_OUT_TEXT)
    if LIMIT.search(text or ''):
        return CliLimitError(LIMIT_TEXT)
    return CliError(f'Claude Code failed: {(text or "no output").strip()[:300]}')


def timing_line(args, data, queued_s, ran_s):
    """Where a Claude Code answer's time went (7 Oct 2026: Haiku took 40-128 s to choose a page's filters, and nothing said whether the model or
    Claude Code was slow): the model's own time (its API calls), the rest (Claude Code starting, its turns, a rate limit's wait), and the wait for a
    free slot in this process. Counts only, never the prompt or the answer."""
    model = args[args.index('--model') + 1] if '--model' in args else '?'
    api_s = (data.get('duration_api_ms') or 0) / 1000
    output = int((data.get('usage') or {}).get('output_tokens') or 0)
    total_s = (data.get('duration_ms') or ran_s * 1000) / 1000
    return (f'Claude Code {model}: answered in {ran_s:.0f} s (model {api_s:.0f} s, Claude Code itself {max(0, ran_s - api_s):.0f} s'
            f'{f", waited {queued_s:.0f} s for a free slot" if queued_s >= 1 else ""}; turns {data.get("num_turns", "?")}; reported {total_s:.0f} s'
            f'{f"; thinking {thinking:,} of {output:,} output tokens" if (thinking := thinking_tokens(data)) else ""})')


def thinking_tokens(data):
    """Output tokens the model spent thinking (Claude Code's usage.output_tokens_details), so a slow answer says whether thinking took it."""
    usage = data.get('usage') or {}
    return int((usage.get('output_tokens_details') or {}).get('thinking_tokens') or 0)


def usage_of(data):
    usage = data.get('usage') or {}
    number = lambda key: int(usage.get(key) or 0)
    return Usage(number('input_tokens'), number('output_tokens'), number('cache_read_input_tokens'),
                 number('cache_creation_input_tokens'), SUBSCRIPTION, 'anthropic')


class ClaudeCode(CliAdapter):
    """A drop-in for anthropic.Anthropic() (messages.create only) that runs the user's own Claude Code."""
    name, family, tool, folder = 'cli', 'claude', 'Claude Code', 'claude'
    label = 'Claude Code (your plan)'
    fallback_label = 'your Anthropic API key'
    missing_text, not_answering_text = MISSING_TEXT, NOT_ANSWERING_TEXT
    _slots = Slots(PARALLEL)

    def __init__(self, binary=None, fallback=None, run=subprocess.run, timeout=None, log=None):
        super().__init__(binary if binary is not None else find_binary(), fallback=fallback, run=run, timeout=timeout, log=log)

    def command(self, model, system, schema=None, effort=None, with_files=False, web_search=False):
        offered = flags(self.binary, self.run)
        args = [self.binary, '-p', '--output-format', 'json', '--model', alias(model)]
        if system:
            args += ['--system-prompt', system]
        if with_files:  # Read only, and only this call's own folder (the working directory); nothing asks
            args += ['--tools', 'Read'] if '--tools' in offered else ['--disallowedTools', ','.join(d for d in DENY if d != 'Read')]
            args += ['--allowedTools', 'Read(./**)']
        elif web_search:  # web search only (src/sources/web_search.py): no files, no shell, no page fetches; nothing asks
            args += ['--tools', 'WebSearch'] if '--tools' in offered else ['--disallowedTools', ','.join(d for d in DENY if d != 'WebSearch')]
            args += ['--allowedTools', 'WebSearch']
        else:
            args += ['--tools', ''] if '--tools' in offered else ['--disallowedTools', ','.join(DENY)]
        if '--permission-mode' in offered:
            args += ['--permission-mode', 'dontAsk']  # anything not allowed above is refused, never asked
        if schema is not None and '--json-schema' in offered:
            args += ['--json-schema', json.dumps(schema)]
        if effort and '--effort' in offered:
            args += ['--effort', effort]
        if '--max-turns' in offered:
            # One turn for a plain answer; reading files or a structured answer takes Claude Code a few steps.
            args += ['--max-turns', '8' if web_search else '1' if not with_files and schema is None else str(3 + 2 * with_files)]
        for flag in ('--no-session-persistence', '--strict-mcp-config', '--safe-mode'):
            if flag in offered:
                args.append(flag)
        return args

    def build(self, request, folder, files):
        prompt = self.conversation(request, files)
        if files:
            prompt = ('First read each attached file with the Read tool, in this order: '
                      + ', '.join(f'./{name}' for name in files) + '. Then answer.\n\n' + prompt)
        args = self.command(request.model, request.system, request.schema, request.effort, with_files=bool(files),
                            web_search=bool(request.web_search))
        return args, prompt, request.schema is not None and '--json-schema' in args

    @staticmethod
    def conversation(request, files):
        from .cli_base import conversation
        return conversation(request, files)

    def reads_files(self, args):
        return '--allowedTools' in args

    def env(self, args):
        return call_env(args)

    def parse(self, out, args, queued_s, ran_s):
        try:
            data = json.loads(out.stdout)
            if isinstance(data, list):  # a stream of events: the result is the last one
                data = next(item for item in reversed(data) if item.get('type') == 'result')
        except (ValueError, StopIteration, AttributeError):
            raise classify(f'{out.stdout}\n{out.stderr}'.strip() or f'exit code {out.returncode}') from None
        self.log(timing_line(args, data, queued_s, ran_s))
        if data.get('is_error') or out.returncode != 0 or str(data.get('subtype', 'success')).startswith('error'):
            if data.get('subtype') == 'error_max_turns':
                return data, 'max_turns'
            raise classify(f"{data.get('result') or ''}\n{out.stderr or ''}\n{data.get('subtype') or ''}")
        return data, 'end_turn'

    def answer(self, data, schema):
        return self._answer(data, schema)

    @staticmethod
    def _answer(data, schema):
        if schema is not None and data.get('structured_output') is not None:
            return json.dumps(data['structured_output'], ensure_ascii=False)
        return str(data.get('result') or '')

    def usage(self, data):
        return usage_of(data)
