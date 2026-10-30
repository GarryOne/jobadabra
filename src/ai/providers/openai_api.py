"""The `openai` engine: OpenAI's Responses API with the user's OPENAI_API_KEY (the official `openai` SDK). Billed per token.

It translates the contract's Request (written once, Anthropic-shaped, by every AI module) into a Responses call and the answer back:
  system → instructions; text/images/PDFs → input_text / input_image / input_file (data URLs); a JSON schema → text.format json_schema
  strict (schema.strict: every property listed, optional ones nullable, nulls dropped again on the way back); effort → reasoning.effort;
  the web search tool → {'type': 'web_search'}; a refusal → stop_reason 'refusal'; the output cap → 'max_tokens'.
Prompt caching needs nothing (OpenAI caches long prompts itself; cache_control is Anthropic's). `store=False`: OpenAI keeps no copy.
Its errors become the contract's (AiUnavailable, AiLimit, AiError). The model is the same tier in OpenAI's family (models.for_family).
Guarded by tests/test_ai_providers.py (recorded responses, no network).
"""
import json
import os

from .contract import API, Adapter, AiError, AiLimit, AiUnavailable, Attachment, Response, TextBlock, Usage
from .schema import drop_nulls, parse_json, strict

EFFORTS = {'low': 'low', 'medium': 'medium', 'high': 'high', 'max': 'high'}
# Reasoning counts towards OpenAI's output cap; a call's max_tokens was sized for Claude's answer: headroom on top (a cap, not a charge).
HEADROOM = {None: 2000, 'low': 2000, 'medium': 6000, 'high': 12000}
LIMIT_TEXT = ('OpenAI: your API account has no credit left or reached its spend limit (platform.openai.com → Billing), so this AI step '
              'is paused. Add credit there, or switch engines in Settings → Connections → AI.')
KEY_TEXT = 'OpenAI refused the API key (Settings → Connections → AI): check it, or switch engines there.'


def sdk(action=''):
    import openai
    return openai.OpenAI()   # OPENAI_API_KEY from the environment, as the app passes it


def code_of(error):
    """The error's code ('insufficient_quota': no credit left), wherever this SDK version keeps it."""
    body = getattr(error, 'body', None)
    body = body.get('error', body) if isinstance(body, dict) else {}
    return str(getattr(error, 'code', None) or (body.get('code') if isinstance(body, dict) else '') or '')


UNREACHABLE = ('APIConnectionError', 'APITimeoutError')


def is_sdk_error(error):
    """An error the OpenAI SDK raised (any version: read by its package, so nothing here needs the SDK installed)."""
    return type(error).__module__.split('.')[0] == 'openai'


def _with(contract_error, status, error):
    """The contract's error keeps OpenAI's own status and code for the log (contract.error_facts)."""
    contract_error.ai_status, contract_error.code = status, code_of(error)
    return contract_error


def error_of(error):
    """An OpenAI SDK error as the contract's, by its HTTP status and name (stable across SDK versions). A limit keeps OpenAI's own status and
    code ("OpenAI said: 429 insufficient_quota"), never its message text: 9 Oct 2026, "no credit left" on an account showing $10 could not be told
    apart from a model the key may not use."""
    text, name, status = str(error), type(error).__name__, getattr(error, 'status_code', None)
    if status in (401, 403):
        return _with(AiLimit(f'{KEY_TEXT} (OpenAI said: {status} {code_of(error) or name})', final=True), status, error)
    if status == 429 and ('insufficient_quota' in text or code_of(error) == 'insufficient_quota'):
        return _with(AiLimit(f'{LIMIT_TEXT} (OpenAI said: {status} {code_of(error) or name})', final=True), status, error)
    if name in UNREACHABLE or status == 429 or (status or 0) >= 500:
        return _with(AiUnavailable(f'OpenAI unavailable ({name})'), status, error)
    return _with(AiError(f'OpenAI refused the call ({name}): {text[:300]}'), status, error)


def input_of(request):
    items, files = [], 0
    for message in request.messages:
        if message.role == 'assistant':
            items.append({'role': 'assistant', 'content': [{'type': 'output_text', 'text': '\n\n'.join(p for p in message.parts if isinstance(p, str))}]})
            continue
        content = []
        for part in message.parts:
            if isinstance(part, Attachment):
                url = f'data:{part.media_type};base64,{part.data}'
                if part.kind == 'image':
                    content.append({'type': 'input_image', 'image_url': url})
                else:
                    files += 1
                    content.append({'type': 'input_file', 'filename': f'document-{files}.pdf', 'file_data': url})
            elif part:
                content.append({'type': 'input_text', 'text': part})
        items.append({'role': message.role, 'content': content})
    return items


def params_of(request, model, effort, action=''):
    params = {'model': model, 'input': input_of(request), 'store': False,
              'max_output_tokens': (request.max_tokens or 4000) + HEADROOM.get(effort, 2000)}
    if request.system:
        params['instructions'] = request.system
    if effort:
        params['reasoning'] = {'effort': effort}
    if request.schema is not None:
        params['text'] = {'format': {'type': 'json_schema', 'name': 'answer', 'schema': strict(request.schema), 'strict': True}}
    if request.web_search:
        params['tools'] = [{'type': 'web_search'}]
        params['max_tool_calls'] = request.web_search
    # Why (30 Oct 2026, owner; #2632): per-call action headers override a shared client's cost and replay identity in both families.
    headers = request.params.get('extra_headers')
    if headers:
        params['extra_headers'] = headers
        action = headers.get('x-jp-action') or action
    if action:
        params['prompt_cache_key'] = f'job-pilotto-{action}'   # the AI step only: calls of one step share a cache
    return params


def answer_of(raw, request):
    """(text, stop_reason) from a Responses result."""
    texts, refused = [], False
    for item in getattr(raw, 'output', None) or []:
        if getattr(item, 'type', '') != 'message':
            continue
        for part in getattr(item, 'content', None) or []:
            if getattr(part, 'type', '') == 'output_text':
                texts.append(part.text)
            elif getattr(part, 'type', '') == 'refusal':
                refused = True
    reason = getattr(getattr(raw, 'incomplete_details', None), 'reason', None)
    if refused or reason == 'content_filter':
        return '', 'refusal'
    if getattr(raw, 'status', 'completed') == 'incomplete':
        return ''.join(texts), 'max_tokens'
    text = ''.join(texts)
    if request.schema is not None:
        try:
            text = json.dumps(drop_nulls(parse_json(text), request.schema), ensure_ascii=False)
        except ValueError:
            raise AiError('OpenAI gave no valid JSON answer for this step') from None
    return text, 'end_turn'


def usage_of(raw, model):
    usage = getattr(raw, 'usage', None)
    number = lambda obj, key: int(getattr(obj, key, 0) or 0) if obj is not None else 0
    cached = number(getattr(usage, 'input_tokens_details', None), 'cached_tokens')
    # Anthropic counts cache reads apart from input_tokens; OpenAI includes them: split, so cost.py prices both alike.
    return Usage(max(0, number(usage, 'input_tokens') - cached), number(usage, 'output_tokens'), cached, 0, API, 'openai', model)


class OpenAIApi(Adapter):
    name, family = 'openai', 'openai'
    label = 'OpenAI API'

    def __init__(self, client=None, action='', log=None, models=None):
        super().__init__(log=log)
        self.client = client if client is not None else sdk(action)
        self.action = action
        from .. import models as default_models
        self.models = models or default_models

    def complete(self, request):
        model, effort = self.models.for_family(request.model, 'openai', request.effort)
        effort = EFFORTS.get(effort) if effort else None
        try:
            raw = self.client.responses.create(**params_of(request, model, effort, self.action))
        except Exception as error:
            if is_sdk_error(error):   # every SDK error becomes the contract's
                raise error_of(error) from error
            raise
        text, stop = answer_of(raw, request)
        return Response(content=[TextBlock(text)], usage=usage_of(raw, getattr(raw, 'model', '') or model),
                        model=getattr(raw, 'model', '') or model, stop_reason=stop, engine=self.name)
