"""The `api` engine: the Anthropic SDK with the user's ANTHROPIC_API_KEY (or Free AI's address). Billed per token.

The caller's params go to the SDK as written (only a schema's maxItems/minItems come out, for_api; prompt caching's cache_control, effort, the web search tool) and its response comes back as
it is: the Anthropic path is the contract's reference shape, so nothing is translated. Guarded by tests/test_ai_providers.py.
"""
import os

from .contract import Adapter
from .schema import without_limits

ACTIONS = ('enrich', 'score', 'kit', 'prep', 'insight', 'mail', 'inbox', 'review', 'interview', 'opportunity', 'added', 'import', 'scout', 'decide', 'tailor', 'cover_letter', 'answer', 'answer_review', 'web_search')


def sdk(action=''):
    """The SDK client. `action` names the AI step (one of ACTIONS) in a header Free AI's route reads, so what each step costs can be
    told apart there (site/src/trial.js); Anthropic itself ignores it. Nothing about the job or the user is in it."""
    import anthropic
    options = {}
    if os.environ.get('JOB_PILOTTO_AI_BASE_URL'):   # an Always on run on Free AI: the repo variable the app sets (an empty ANTHROPIC_BASE_URL would break the SDK)
        options['base_url'] = os.environ['JOB_PILOTTO_AI_BASE_URL']
    if action in ACTIONS:
        options['default_headers'] = {'x-jp-action': action}
    return anthropic.Anthropic(**options)


def transient_errors():
    """The SDK's errors that mean "down or busy, try the next run" (after its own retries)."""
    try:
        import anthropic
    except ImportError:
        return ()
    return (anthropic.APIConnectionError, anthropic.RateLimitError, anthropic.InternalServerError)


def permanent_errors():
    try:
        import anthropic
    except ImportError:
        return ()
    return (anthropic.APIStatusError,)


def for_api(params):
    """The one place every ask to the API passes through: the schema without maxItems/minItems, which the API refuses in structured output (400).
    Callers write them to cap their own lists and check the answer themselves; everything else in the params stays as written."""
    shape = (params.get('output_config') or {}).get('format')
    if not shape or not shape.get('schema'):
        return params
    return dict(params, output_config=dict(params['output_config'], format=dict(shape, schema=without_limits(shape['schema']))))


class AnthropicApi(Adapter):
    name, family = 'api', 'claude'
    label = 'Anthropic API'

    def __init__(self, client=None, action='', log=None):
        super().__init__(log=log)
        self.client = client if client is not None else sdk(action)   # made now, as before: a missing SDK says so at once

    def complete(self, request):
        return self.client.messages.create(**for_api(request.params))
