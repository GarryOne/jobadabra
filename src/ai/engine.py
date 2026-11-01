"""The AI engine every AI step calls through: one factory, `client()`, over the engines in src/ai/providers/.

JOBADABRA_AI_ENGINE picks it, as the user chose it (Settings → Connections → AI in the app):
  api    (default; GitHub / Always on, the Telegram worker, Free AI)  the Anthropic SDK, their key (providers/anthropic_api.py)
  cli    (the app, on the user's Mac)                                           their own Claude Code, Claude plan (providers/claude_code.py)
  openai (the app or Always on)                                                  OpenAI's Responses API, their key (providers/openai_api.py)
  codex  (the app, on the user's Mac)                                           their own Codex CLI, ChatGPT plan (providers/codex_cli.py)
Nothing is chosen for the user: no automatic switch. JOBADABRA_AI_FALLBACK=api|openai (the user's own tick, "If my plan's limit is hit,
use my API key") lets a plan engine hand the rest of a run to the API key of the SAME family; never Claude to OpenAI or back.

Every engine is an adapter behind one contract (providers/contract.py): `client().messages.create(**the SDK's arguments)` returns an
object shaped like the Anthropic SDK's response (`.content[0].type/.text`, `.usage`, `.stop_reason`, `.model`), so the AI modules work
unchanged. A plan's usage carries `billing = 'subscription'`: cost.py counts its tokens at $0, and the budget guard never sees it as API dollars.
This file keeps the names the modules and tests import; the engines' own code lives in providers/.
"""
import os

from . import providers
from .providers import choice, fallback_allowed, ready  # noqa: F401 (the engine's public names)
from .providers.anthropic_api import ACTIONS, sdk as _api  # noqa: F401
from .providers.cli_base import CliError, CliLimitError, EXT, FILES_TIMEOUT_S, TIMEOUT_S, TIMEOUTS_BEFORE_STOP  # noqa: F401
from .providers.claude_code import (  # noqa: F401
    ALIASES, DENY, LIMIT, LIMIT_TEXT, MISSING_TEXT, NOT_ANSWERING_TEXT, PARALLEL, SIGNED_OUT, SIGNED_OUT_TEXT,
    ClaudeCode as CliClient, _help, alias, call_env, classify, cli_env, find_binary, flags, thinking_tokens, timing_line, usage_of)
from .providers.contract import (  # noqa: F401
    API, SUBSCRIPTION, AiError, AiLimit, AiUnavailable, Response, TextBlock, Usage)
from .providers.schema import parse_json, problems, without_limits  # noqa: F401

ENGINES = tuple(providers.ENGINES)


def missing_text(env=None):
    return providers.spec(env).missing


def client(env=None, action=''):
    """The AI client for this run, as the user chose it."""
    return providers.build(os.environ if env is None else env, action)


def transient_errors():
    """Errors after which the run stops and the next one continues (the provider is down or busy), whatever the engine."""
    return providers.transient_errors()


def permanent_errors():
    """A provider's refusal of this one call (a bad request): the job is skipped, the run goes on."""
    return providers.permanent_errors()


def effort_for(model, effort='medium'):
    """The effort a call sends, or None to send none. Haiku 4.5 rejects the setting with a 400. Haiku 5.5 thinks by default
    (Haiku 4.5 never did), and the thinking counts towards a call's small max_tokens: it always runs at low (8 Oct 2026)."""
    if model.startswith('claude-haiku-4'):
        return None
    return 'low' if model.startswith('claude-haiku') else effort


def structured(schema, model, effort='medium'):
    """The `output_config` of a schema-constrained call: the JSON schema, and the effort setting (effort_for)."""
    config = {'format': {'type': 'json_schema', 'schema': without_limits(schema)}}
    if effort_for(model, effort):
        config['effort'] = effort_for(model, effort)
    return config


def label(usage_or_stats):
    """How a call or a stage was paid for, in words."""
    if isinstance(usage_or_stats, dict):
        billing, provider = SUBSCRIPTION if usage_or_stats.get('cli_calls') else API, usage_or_stats.get('provider', '')
    else:
        billing, provider = getattr(usage_or_stats, 'billing', None) or API, getattr(usage_or_stats, 'provider', '')
    family = 'openai' if provider == 'openai' else 'claude'
    return next(item.label for item in providers.ENGINES.values() if item.family == family and item.billing == billing)
