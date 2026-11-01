"""The AI contract (src/ai/providers/contract.py): every engine takes the same Anthropic-shaped params and answers in the same shape.

No network, no key, no CLI: adapters are fed recorded answers. A new engine in providers.ENGINES fails `test_every_engine_is_covered`
until it has a case in ENGINE_CASES here.
"""
import json
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src.ai import engine, providers  # noqa: E402
from src.ai.providers import contract, schema  # noqa: E402
from src.ai.providers.anthropic_api import AnthropicApi  # noqa: E402
from src.ai.providers.schema import without_limits  # noqa: E402

SCHEMA = {'type': 'object', 'additionalProperties': False, 'required': ['answer'],
          'properties': {'answer': {'type': 'string', 'enum': ['yes', 'no']}, 'why': {'type': 'string'},
                         'items': {'type': 'array', 'maxItems': 3, 'items': {'type': 'object', 'required': ['n'],
                                                                            'properties': {'n': {'type': 'integer'}, 'note': {'type': 'string'}}}}}}
PNG = 'iVBORw0KGgo='
PARAMS = dict(model='claude-haiku-5-5', max_tokens=500,
              system=[{'type': 'text', 'text': 'Rules.'}, {'type': 'text', 'text': 'Profile.', 'cache_control': {'type': 'ephemeral'}}],
              messages=[{'role': 'user', 'content': [{'type': 'text', 'text': 'Is this a job page?'},
                                                     {'type': 'image', 'source': {'type': 'base64', 'media_type': 'image/png', 'data': PNG}}]}],
              output_config={'format': {'type': 'json_schema', 'schema': SCHEMA}, 'effort': 'low'})


class RequestTests(unittest.TestCase):
    def test_the_callers_params_become_one_neutral_request(self):
        request = contract.request_from(PARAMS)
        self.assertEqual((request.model, request.max_tokens, request.system, request.effort), ('claude-haiku-5-5', 500, 'Rules.\n\nProfile.', 'low'))
        self.assertEqual(request.schema, SCHEMA)
        self.assertEqual(request.messages[0].parts[0], 'Is this a job page?')
        self.assertEqual(request.attachments, [contract.Attachment('image', 'image/png', PNG)])
        self.assertEqual(request.params, PARAMS)   # kept untouched for the Anthropic API

    def test_nothing_is_dropped_in_silence(self):
        for extra in ({'temperature': 0}, {'tools': [{'type': 'bash', 'name': 'bash'}]}, {'output_config': {'task_budget': 1}},
                      {'output_config': {'format': {'type': 'text'}}},
                      {'messages': [{'role': 'user', 'content': [{'type': 'tool_result', 'content': 'x'}]}]}):
            with self.subTest(extra=extra), self.assertRaises(TypeError):
                contract.request_from(dict(PARAMS, **extra))

    def test_web_search_and_a_pdf_are_part_of_it(self):
        request = contract.request_from(dict(PARAMS, tools=[{'type': 'web_search_20250305', 'name': 'web_search', 'max_uses': 2}],
                                             messages=[{'role': 'user', 'content': [{'type': 'document', 'source': {
                                                 'type': 'base64', 'media_type': 'application/pdf', 'data': 'JVBERi0='}}]}]))
        self.assertEqual(request.web_search, 2)
        self.assertEqual(request.attachments[0].kind, 'pdf')


class AdapterTests(unittest.TestCase):
    def test_the_anthropic_api_gets_the_params_untouched(self):
        sent = []
        sdk = SimpleNamespace(messages=SimpleNamespace(create=lambda **p: sent.append(p) or 'the sdk response'))
        self.assertEqual(AnthropicApi(client=sdk).messages.create(**PARAMS), 'the sdk response')
        # cache_control, effort, the image: as the caller wrote them; only the schema's maxItems/minItems are gone (the API refuses them)
        expected = dict(PARAMS, output_config=dict(PARAMS['output_config'], format={'type': 'json_schema', 'schema': without_limits(SCHEMA)}))
        self.assertEqual(sent, [expected])

    def test_the_anthropic_api_never_gets_maxitems_or_minitems(self):
        # The API refuses them in structured output (400, 3 Oct 2026): callers write them to cap their own lists, and the one place every
        # API ask passes through takes them out, nested too (rejection.py and inbox_reading.py build output_config by hand).
        schema = {'type': 'object', 'properties': {'list': {'type': 'array', 'minItems': 1, 'maxItems': 3, 'items': {
            'type': 'object', 'properties': {'inner': {'type': 'array', 'maxItems': 2, 'items': {'type': 'string'}}}}}}}
        sent = []
        sdk = SimpleNamespace(messages=SimpleNamespace(create=lambda **p: sent.append(p) or 'ok'))
        ask = dict(PARAMS, output_config={'format': {'type': 'json_schema', 'schema': schema}, 'effort': 'low'})
        AnthropicApi(client=sdk).messages.create(**ask)
        self.assertNotRegex(repr(sent[0]['output_config']), 'maxItems|minItems')
        self.assertEqual(sent[0]['output_config']['effort'], 'low')
        self.assertEqual(sent[0]['system'], PARAMS['system'])
        self.assertIn('maxItems', repr(ask['output_config']), "the caller's own schema is not changed")

    def test_a_plan_limit_goes_to_the_users_fallback_once_and_stays_there(self):
        calls, logged = [], []

        class Plan(contract.Adapter):
            name, fallback_label = 'plan', 'your API key'

            def complete(self, request):
                calls.append('plan')
                raise contract.AiLimit('Plan limit reached.')

        api = SimpleNamespace(messages=SimpleNamespace(create=lambda **p: calls.append('api') or 'api answer'))
        client = Plan(fallback=lambda: api, log=logged.append)
        self.assertEqual([client.messages.create(**PARAMS) for _ in range(2)], ['api answer'] * 2)
        self.assertEqual(calls, ['plan', 'api', 'api'])
        self.assertTrue(client.fell_back)
        self.assertIn('Using your API key for the rest of this run', logged[0])

    def test_a_final_limit_never_falls_back(self):
        class Missing(contract.Adapter):
            def complete(self, request):
                raise contract.AiLimit('Not installed.', final=True)

        with self.assertRaises(contract.AiLimit):
            Missing(fallback=lambda: self.fail('no fallback for a missing engine')).messages.create(**PARAMS)

    def test_limits_count_as_the_ai_limit_everywhere(self):
        from src.ai import cost
        self.assertTrue(cost.limit_reached(contract.AiLimit('x')))
        self.assertTrue(cost.limit_reached(engine.CliLimitError('x')))
        self.assertFalse(cost.limit_reached(contract.AiUnavailable('x')))
        self.assertIn(contract.AiUnavailable, engine.transient_errors())



class ErrorFactsTests(unittest.TestCase):
    """A failed call says what the provider said (status, code), the model asked for and the engine, in every provider: 17 Oct 2026, "AI limit reached:
    OpenAI API cannot go on" could not be told from a refused key. Never the message text (it can echo a key or a prompt)."""

    def adapters(self):
        from src.ai.providers.claude_code import ClaudeCode
        from src.ai.providers.codex_cli import Codex
        from src.ai.providers.openai_api import OpenAIApi
        return [AnthropicApi(client=object()), OpenAIApi(client=object()), ClaudeCode(binary='x'), Codex(binary='x')]

    def test_every_engine_is_checked(self):
        self.assertEqual(sorted(adapter.name for adapter in self.adapters()), sorted(providers.ENGINES))

    def test_every_provider_error_names_status_code_model_and_engine_and_never_the_message(self):
        for adapter in self.adapters():
            class Refused(Exception):
                status_code, code = 401, 'invalid_api_key'
            def complete(request, _error=Refused('Incorrect API key provided: sk-secret-1234')):
                raise _error
            adapter.complete = complete
            with self.assertRaises(Refused) as caught:
                adapter.create(**PARAMS)
            said = contract.named(caught.exception)
            for part in ('HTTP 401', 'invalid_api_key', 'model claude-haiku-5-5', f'engine {adapter.name}'):
                self.assertIn(part, said, adapter.name)
            self.assertIn('Incorrect API key provided', said, adapter.name)   # the API's own words are in the line, cut to 160 characters
            self.assertNotIn('sk-secret', said)
            self.assertLessEqual(len(said.split('said "')[1]), 161)

    def test_a_key_in_the_api_message_never_reaches_the_line(self):
        error = Exception('Error code: 400 - {"message": "credit balance is too low. key=sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789ABCDEF"}')
        error.status_code = 400
        said = contract.named(error)
        self.assertIn('credit balance is too low', said)
        self.assertNotIn('abcdefghijkl', said)
        self.assertNotIn('sk-ant', said)

    def test_openai_contract_errors_keep_the_status_and_code(self):
        from src.ai.providers import openai_api
        sdk = type('PermissionDeniedError', (Exception,), {'__module__': 'openai.errors'})
        for status, code, kind in ((401, 'invalid_api_key', contract.AiLimit), (403, 'model_not_found', contract.AiLimit),
                                   (429, 'insufficient_quota', contract.AiLimit), (429, 'rate_limit_exceeded', contract.AiUnavailable),
                                   (400, 'invalid_prompt', contract.AiError)):
            error = sdk('text')
            error.status_code, error.code = status, code
            mapped = openai_api.error_of(error)
            self.assertIsInstance(mapped, kind)
            self.assertIn(f'HTTP {status} {code}', contract.named(mapped))
    def test_the_limit_line_carries_the_facts(self):
        from src.ai import cost
        error = contract.AiLimit('Your OpenAI key was refused.', final=True)
        error.ai_status, error.code, error.ai_model, error.ai_engine = 401, 'invalid_api_key', 'gpt-x', 'openai'
        self.assertIn('HTTP 401 invalid_api_key, model gpt-x, engine openai', cost.limit_reason(error))


class RegistryTests(unittest.TestCase):
    def test_every_engine_is_covered(self):
        self.assertEqual(set(providers.ENGINES), set(ENGINE_CASES), 'a new engine needs a case in ENGINE_CASES')

    def test_each_engine_is_built_from_the_environment(self):
        for name, (env, kind) in ENGINE_CASES.items():
            with self.subTest(engine=name):
                import unittest.mock as mock
                with mock.patch('src.ai.providers.anthropic_api.sdk', lambda action='': 'sdk'), \
                        mock.patch('src.ai.providers.openai_api.sdk', lambda action='': 'sdk'):
                    client = engine.client(env)
                self.assertEqual(type(client).__name__, kind)
                self.assertEqual(client.name, name)
                self.assertEqual(client.family, providers.ENGINES[name].family)
                self.assertEqual(client.billing, providers.ENGINES[name].billing)

    def test_nothing_is_chosen_for_the_user(self):
        self.assertEqual(providers.choice({}), 'api')
        self.assertEqual(providers.choice({'JOBADABRA_AI_ENGINE': 'auto'}), 'api')

    def test_a_fallback_stays_in_its_family(self):
        for item in providers.ENGINES.values():
            if item.fallback:
                with self.subTest(engine=item.name):
                    self.assertEqual(providers.ENGINES[item.fallback].family, item.family)
                    self.assertEqual(providers.ENGINES[item.fallback].billing, contract.API)


class SchemaTests(unittest.TestCase):
    def test_strict_lists_every_property_and_makes_the_optional_ones_nullable(self):
        out = schema.strict(SCHEMA)
        self.assertEqual(out['required'], ['answer', 'why', 'items'])
        self.assertEqual(out['properties']['answer']['type'], 'string')            # required: unchanged
        self.assertEqual(out['properties']['why']['type'], ['string', 'null'])
        self.assertNotIn('maxItems', json.dumps(out))
        inner = out['properties']['items']['items']
        self.assertEqual((inner['required'], inner['additionalProperties']), (['n', 'note'], False))

    def test_an_answer_to_the_strict_schema_reads_like_one_to_the_original(self):
        answer = {'answer': 'yes', 'why': None, 'items': [{'n': 1, 'note': None}]}
        back = schema.drop_nulls(answer, SCHEMA)
        self.assertEqual(back, {'answer': 'yes', 'items': [{'n': 1}]})
        self.assertEqual(schema.problems(back, SCHEMA), [])


# Each engine: the environment that picks it, and the adapter class it builds.
ENGINE_CASES = {
    'api': ({'ANTHROPIC_API_KEY': 'k'}, 'AnthropicApi'),
    'cli': ({'JOBADABRA_AI_ENGINE': 'cli', 'JOBADABRA_CLAUDE_BIN': sys.executable}, 'ClaudeCode'),
    'openai': ({'JOBADABRA_AI_ENGINE': 'openai', 'OPENAI_API_KEY': 'sk-test-not-real'}, 'OpenAIApi'),
    'codex': ({'JOBADABRA_AI_ENGINE': 'codex', 'JOBADABRA_CODEX_BIN': sys.executable}, 'Codex'),
}

if __name__ == '__main__':
    unittest.main()
