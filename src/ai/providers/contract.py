"""The contract every AI provider adapter meets: one neutral request in, one SDK-shaped response out, one set of errors.

Callers keep calling `client.messages.create(**params)` with the Anthropic-shaped params they always sent (model, max_tokens,
system, messages, output_config, tools, extra_headers). `Adapter.create` turns them into a `Request` (refusing any parameter it does not know,
so nothing is dropped in silence), hands it to the provider's `complete`, and returns a `Response` shaped like the Anthropic
SDK's (`.content[0].text`, `.usage`, `.stop_reason`, `.model`): the ~30 AI modules work the same whatever the engine.

Errors are the contract's too: `AiUnavailable` (transient: the provider is down or busy), `AiLimit` (`ai_limit`: a plan or spend
limit, not signed in, not installed; every other call would fail the same way), `AiError` (anything else). The app mirrors
this file in desktop/lib/ai/contract.js. Guarded by tests/test_ai_providers.py.
"""
from dataclasses import dataclass, field
import re
import sys

API, SUBSCRIPTION = 'api', 'subscription'
STOP_REASONS = ('end_turn', 'max_tokens', 'refusal', 'max_turns')
PARAMS = ('model', 'max_tokens', 'system', 'messages', 'output_config', 'tools', 'extra_headers')


# ---------- errors ----------

class AiError(RuntimeError):
    """The AI gave no usable answer for this call."""


class AiUnavailable(AiError):
    """Transient: the provider is down, overloaded or rate-limited after its own retries. The run stops; the next one continues."""


class AiLimit(AiError):
    """The user's plan or spend limit, or an engine that cannot run (not signed in, not installed). `final`: no fallback can help."""
    ai_limit = True

    def __init__(self, text, final=False):
        super().__init__(text)
        self.final = final


def error_facts(error):
    """What the log needs to tell a limit from a bad key or a wrong model, from any provider's error: "HTTP 429 insufficient_quota, model gpt-x, engine openai".
    The status, the code, the model asked for, the engine (stamped by Adapter.create) and, for a refusal with a status, the API's own message cut to 160 characters
    with anything key-shaped removed (17 Oct 2026: a bare "400 invalid_request_error" could not be told from a spent limit or a bad request)."""
    body = getattr(error, 'body', None)
    body = body.get('error', body) if isinstance(body, dict) else {}
    code = getattr(error, 'code', None) or (body.get('code') or body.get('type') if isinstance(body, dict) else '')
    status = getattr(error, 'status_code', None) or getattr(error, 'ai_status', None)
    said = (body.get('message') if isinstance(body, dict) else '') or (str(error) if status else '')
    said = re.sub(r'sk-[\w-]{6,}|Bearer\s+\S+|\b[A-Za-z0-9_-]{32,}\b', '…', ' '.join(str(said).split()))[:160] if status else ''
    parts = [f'HTTP {status}' + (f' {code}' if code else '') if status else (str(code) if code else ''),
             f'model {error.ai_model}' if getattr(error, 'ai_model', '') else '', f'engine {error.ai_engine}' if getattr(error, 'ai_engine', '') else '',
             f'said "{said}"' if said else '']
    return ', '.join(part for part in parts if part)


def named(error):
    """The error for a log line: its class name, then its facts: "AiLimit (HTTP 401 invalid_api_key, model gpt-x, engine openai)"."""
    facts = error_facts(error)
    return f'{type(error).__name__} ({facts})' if facts else type(error).__name__


def reason(error):
    """Why an AI call failed, as a sentence for the person (warnings are read by people; the class name and facts go to detail())."""
    if isinstance(error, AiLimit):
        return 'the AI limit was reached'
    if isinstance(error, AiUnavailable):
        return 'the AI service is busy or unavailable'
    return 'the AI call failed'


def detail(what, error):
    """The technical line behind a plain warning: what was asked and named(error), for the technical log only."""
    print(f'Technical: {what}: {named(error)}', flush=True)


# ---------- the request ----------

@dataclass(frozen=True)
class Attachment:
    kind: str          # 'image' or 'pdf'
    media_type: str
    data: str          # base64


@dataclass(frozen=True)
class Message:
    role: str
    parts: tuple       # str (text) or Attachment, in order


@dataclass(frozen=True)
class Request:
    model: str
    messages: tuple
    system: str = ''
    max_tokens: int = 0
    schema: dict = None
    effort: str = None
    web_search: int = 0            # the most searches allowed (0: none)
    params: dict = field(default_factory=dict, repr=False)   # the caller's params, untouched (the Anthropic API sends these)

    @property
    def attachments(self):
        return [part for message in self.messages for part in message.parts if isinstance(part, Attachment)]


def text_of(content):
    """The text blocks of an Anthropic-shaped content (a string, or a list of blocks)."""
    if isinstance(content, str):
        return content
    return '\n\n'.join(block.get('text', '') for block in content or [] if isinstance(block, dict) and block.get('type') == 'text')


def request_from(params):
    """The neutral Request for Anthropic-shaped params. Raises TypeError for anything the contract does not carry."""
    unknown = sorted(set(params) - set(PARAMS))
    if unknown:
        raise TypeError(f'not part of the AI contract (src/ai/providers/contract.py): {", ".join(unknown)}')
    if not params.get('model'):
        raise TypeError('model is required')
    searches = 0
    for tool in params.get('tools') or []:
        if not str((tool or {}).get('type', '')).startswith('web_search'):
            raise TypeError(f'only the web search tool is part of the AI contract, not {tool.get("type")!r}')
        searches = max(searches, int(tool.get('max_uses') or 1))
    config = params.get('output_config') or {}
    unknown = sorted(set(config) - {'format', 'effort'})
    if unknown:
        raise TypeError(f'output_config: not part of the AI contract: {", ".join(unknown)}')
    shape = config.get('format') or {}
    if shape and shape.get('type') != 'json_schema':
        raise TypeError(f'output_config.format: only json_schema is part of the AI contract, not {shape.get("type")!r}')
    messages = []
    for message in params.get('messages') or []:
        content = message.get('content')
        blocks = [{'type': 'text', 'text': content}] if isinstance(content, str) else list(content or [])
        parts = []
        for block in blocks:
            kind, source = block.get('type'), block.get('source') or {}
            if kind == 'text':
                parts.append(block.get('text', ''))
            elif kind in ('image', 'document') and source.get('type') == 'base64':
                parts.append(Attachment('image' if kind == 'image' else 'pdf', source.get('media_type', ''), source.get('data', '')))
            else:
                raise TypeError(f'a message block of type {kind!r} ({source.get("type")!r}) is not part of the AI contract')
        messages.append(Message(message.get('role', 'user'), tuple(parts)))
    system = params.get('system')
    return Request(model=params['model'], messages=tuple(messages), system=text_of(system) if system else '',
                   max_tokens=int(params.get('max_tokens') or 0), schema=shape.get('schema') if shape else None,
                   effort=config.get('effort'), web_search=searches, params=dict(params))


# ---------- the response, shaped like the Anthropic SDK's ----------

@dataclass
class TextBlock:
    text: str
    type: str = 'text'


@dataclass
class Usage:
    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_input_tokens: int = 0
    cache_creation_input_tokens: int = 0
    billing: str = SUBSCRIPTION
    provider: str = ''
    model: str = ''      # the model that answered, when another family's adapter mapped it (cost.py prices this one)


def plus(a, b):
    return Usage(a.input_tokens + b.input_tokens, a.output_tokens + b.output_tokens,
                 a.cache_read_input_tokens + b.cache_read_input_tokens,
                 a.cache_creation_input_tokens + b.cache_creation_input_tokens, a.billing, a.provider, a.model)


@dataclass
class Response:
    content: list
    usage: Usage
    model: str
    stop_reason: str = 'end_turn'
    engine: str = ''
    raw: dict = field(default_factory=dict, repr=False)


# ---------- the adapter ----------

class Adapter:
    """One provider behind the contract. A subclass sets the class attributes and implements `complete(request) -> Response`.

    `fallback`: a function returning another client of the same family (the user's own tick, e.g. "If Claude Code hits my plan
    limit, use my API key"); after an `AiLimit` that is not final, the rest of the run goes there."""
    name = ''            # the engine's name: 'api', 'cli', 'openai', 'codex'
    family = ''          # 'claude' or 'openai'
    billing = API
    label = ''           # how a call was paid for, in words ("Claude Code (your plan)")
    fallback_label = ''  # the fallback, in words ("your Anthropic API key")
    reads_pdf = True     # a PDF attachment is read as Claude reads it; False: refused with a clear error, never a guessed answer

    def __init__(self, fallback=None, log=None):
        self.fallback = fallback
        self.log = log or (lambda text: print(text, file=sys.stderr, flush=True))
        self._fallen = None
        self.messages = self

    @property
    def fell_back(self):
        """The plan's limit was hit in this run and the user's fallback took over (its calls are billed)."""
        return self._fallen is not None

    def create(self, **params):
        request = request_from(params)
        if not self.reads_pdf and any(part.kind == 'pdf' for part in request.attachments):
            raise AiError(f'{self.label or self.name} cannot read PDF attachments: the caller must send the PDF as page images '
                          'and its text (the app does, desktop/lib/ai), or choose another engine in Settings → Connections → AI.')
        if self._fallen is not None:
            return self._fallen.messages.create(**params)
        try:
            try:
                return self.complete(request)
            except Exception as error:   # every provider's error leaves with the model and engine it was asked on (named() in the log lines)
                try:
                    error.ai_model, error.ai_engine = request.model, self.name
                except Exception:   # noqa: BLE001 — an error that takes no attributes is logged without them
                    pass
                raise
        except AiLimit as error:
            if not self.fallback or error.final:
                raise
            self.log(f'Warning: {error} Using {self.fallback_label} for the rest of this run (Settings → Connections → AI).')
            self._fallen = self.fallback()
            return self._fallen.messages.create(**params)

    def complete(self, request):
        raise NotImplementedError
