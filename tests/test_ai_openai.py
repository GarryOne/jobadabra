"""The OpenAI engines behind the AI contract: the OpenAI API (providers/openai_api.py) and Codex (providers/codex_cli.py).

Recorded answers only (the SDK's own response types; Codex's JSONL events): no network, no key, no Codex run. Each case checks what
the adapter sends (model tier, strict schema, images, effort, tools off) and that the answer reads exactly like Claude's would.
"""
import json
import os
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src.ai import cost, engine, models  # noqa: E402
from src.ai.providers import codex_cli, contract  # noqa: E402
from src.ai.providers.openai_api import OpenAIApi  # noqa: E402
from tests.test_ai_providers import PARAMS, PNG, SCHEMA  # noqa: E402


def ns(value):
    """A recorded JSON answer as attribute objects, the way the SDK's response reads (no SDK needed: CI runs without it)."""
    if isinstance(value, dict):
        return SimpleNamespace(**{k: ns(v) for k, v in value.items()})
    if isinstance(value, list):
        return [ns(v) for v in value]
    return value


def recorded(output, status='completed', usage=None, model='gpt-6-luna', incomplete=None):
    """A Responses API answer as the API returns it (fields as documented; the SDK's own types checked these on 9 Oct 2026)."""
    return ns({
        'id': 'resp_1', 'object': 'response', 'created_at': 1760000000, 'model': model, 'status': status, 'output': output,
        'incomplete_details': incomplete,
        'usage': usage or {'input_tokens': 1200, 'input_tokens_details': {'cached_tokens': 1000, 'cache_write_tokens': 0}, 'output_tokens': 40,
                           'output_tokens_details': {'reasoning_tokens': 12}, 'total_tokens': 1240}})


def message(*parts):
    return [{'type': 'message', 'id': 'msg_1', 'role': 'assistant', 'status': 'completed', 'content': list(parts)}]


def text(value):
    return {'type': 'output_text', 'text': value, 'annotations': []}


class FakeOpenAI:
    def __init__(self, answer=None, error=None):
        self.sent, self.answer, self.error = [], answer, error
        self.responses = SimpleNamespace(create=self.create)

    def create(self, **params):
        self.sent.append(params)
        if self.error:
            raise self.error
        return self.answer


def sdk_error(kind, status, body=None):
    """An error shaped like the SDK's (its package, name, status_code and body), so the mapping is tested without the SDK installed."""
    error = type(kind, (Exception,), {'__module__': 'openai._exceptions'})('Error code: %s - %s' % (status, body or {}))
    error.status_code, error.body = status, (body or {}).get('error', body)
    return error


class OpenAIApiTests(unittest.TestCase):
    def test_per_call_action_overrides_the_shared_mail_client_for_counting(self):
        fake = FakeOpenAI(recorded(message(text('{"answer":"yes"}'))))
        client = OpenAIApi(client=fake, action='mail')
        client.messages.create(**dict(PARAMS, extra_headers={'x-jp-action': 'opportunity'}))
        self.assertEqual(fake.sent[0]['extra_headers'], {'x-jp-action': 'opportunity'})
        self.assertEqual(fake.sent[0]['prompt_cache_key'], 'jobadabra-opportunity')
        client.messages.create(**PARAMS)
        self.assertEqual(fake.sent[1]['prompt_cache_key'], 'jobadabra-mail')
        self.assertNotIn('extra_headers', fake.sent[1])

    def test_a_structured_call_with_an_image_reads_like_claudes(self):
        fake = FakeOpenAI(recorded(message(text('{"answer": "yes", "why": null, "items": null}'))))
        response = OpenAIApi(client=fake, action='decide').messages.create(**PARAMS)
        sent = fake.sent[0]
        self.assertEqual(sent['model'], 'gpt-6-luna')                       # Haiku's tier on OpenAI
        self.assertEqual(sent['instructions'], 'Rules.\n\nProfile.')
        self.assertEqual(sent['reasoning'], {'effort': 'low'})
        self.assertFalse(sent['store'])                                     # OpenAI keeps no copy
        self.assertEqual(sent['prompt_cache_key'], 'jobadabra-decide')
        fmt = sent['text']['format']
        self.assertEqual((fmt['type'], fmt['strict'], fmt['schema']['required']), ('json_schema', True, ['answer', 'why', 'items']))
        self.assertEqual(sent['input'][0]['content'][1], {'type': 'input_image', 'image_url': f'data:image/png;base64,{PNG}'})
        self.assertEqual(json.loads(response.content[0].text), {'answer': 'yes'})   # the nulls of "not given" are gone
        self.assertEqual((response.stop_reason, response.content[0].type), ('end_turn', 'text'))
        usage = response.usage
        self.assertEqual((usage.input_tokens, usage.cache_read_input_tokens, usage.output_tokens), (200, 1000, 40))
        self.assertEqual((usage.billing, usage.provider, usage.model), ('api', 'openai', 'gpt-6-luna'))

    def test_cost_is_openais_price_of_the_model_that_answered(self):
        usage = contract.Usage(1_000_000, 1_000_000, 1_000_000, 0, 'api', 'openai', 'gpt-6.1-sol')
        self.assertAlmostEqual(cost.usd('claude-sonnet-5-5', usage), 2.00 + 10.00 + 0.10)
        stats = {}
        cost.add(stats, 'claude-sonnet-5-5', usage)
        self.assertEqual((stats['model'], stats['provider'], stats['api_calls']), ('gpt-6.1-sol', 'openai', 1))
        self.assertEqual(engine.label(stats), 'OpenAI API')
        self.assertEqual(engine.label(contract.Usage(billing='subscription', provider='openai')), 'Codex (your ChatGPT plan)')
        self.assertEqual(engine.label({'cli_calls': 1}), 'Claude Code (your plan)')

    def test_a_refusal_and_a_cut_answer_are_said_like_claudes(self):
        refused = OpenAIApi(client=FakeOpenAI(recorded(message({'type': 'refusal', 'refusal': 'I cannot help with that.'}))))
        self.assertEqual(refused.messages.create(**PARAMS).stop_reason, 'refusal')
        cut = OpenAIApi(client=FakeOpenAI(recorded(message(text('{"ans')), status='incomplete',
                                                   incomplete={'reason': 'max_output_tokens'})))
        self.assertEqual(cut.messages.create(**PARAMS).stop_reason, 'max_tokens')

    def test_big_is_the_main_model_thinking_harder_and_a_named_effort_wins(self):
        self.assertEqual(models.for_family('claude-opus-5-5', 'openai'), ('gpt-6.1-sol', 'high'))
        self.assertEqual(models.for_family('claude-opus-5-5', 'openai', 'low'), ('gpt-6.1-sol', 'low'))
        self.assertEqual(models.for_family('claude-sonnet-5-5', 'openai', None, {'JOBADABRA_OPENAI_MAIN_MODEL': 'gpt-x'}), ('gpt-x', None))
        self.assertEqual(models.for_family('gpt-6-luna', 'openai'), ('gpt-6-luna', None))   # already OpenAI's: kept

    def test_web_search_a_pdf_and_no_schema(self):
        fake = FakeOpenAI(recorded(message(text('https://jobs.example/'))))
        params = dict(PARAMS, tools=[{'type': 'web_search_20250305', 'name': 'web_search', 'max_uses': 2}],
                      messages=[{'role': 'user', 'content': [{'type': 'document', 'source': {'type': 'base64', 'media_type': 'application/pdf', 'data': 'JVBERi0='}}]}])
        params.pop('output_config')
        response = OpenAIApi(client=fake).messages.create(**params)
        sent = fake.sent[0]
        self.assertEqual((sent['tools'], sent['max_tool_calls']), ([{'type': 'web_search'}], 2))
        self.assertEqual(sent['input'][0]['content'][0]['type'], 'input_file')
        self.assertNotIn('text', sent)
        self.assertEqual(response.content[0].text, 'https://jobs.example/')

    def test_sdk_errors_become_the_contracts(self):
        cases = [(sdk_error('RateLimitError', 429, {'error': {'code': 'insufficient_quota'}}), contract.AiLimit),
                 (sdk_error('APIConnectionError', None), contract.AiUnavailable),
                 (sdk_error('AuthenticationError', 401), contract.AiLimit),
                 (sdk_error('RateLimitError', 429), contract.AiUnavailable),
                 (sdk_error('InternalServerError', 500), contract.AiUnavailable),
                 (sdk_error('BadRequestError', 400), contract.AiError)]
        for error, kind in cases:
            with self.subTest(error=type(error).__name__):
                with self.assertRaises(kind) as caught:
                    OpenAIApi(client=FakeOpenAI(error=error)).messages.create(**PARAMS)
                self.assertIs(type(caught.exception), kind)
        with self.assertRaises(ValueError):   # not the SDK's: not translated, not hidden
            OpenAIApi(client=FakeOpenAI(error=ValueError('a bug'))).messages.create(**PARAMS)
        self.assertTrue(cost.limit_reached(contract.AiLimit('x')))


def codex_run(events, returncode=0, seen=None, features='shell_tool stable true\nbrowser_use stable true\ncomputer_use stable true\n'):
    def run(args, **kwargs):
        if args[1:] == ['features', 'list']:
            return SimpleNamespace(stdout=features, stderr='', returncode=0)
        if seen is not None:
            folder = Path(kwargs['cwd'])
            seen.append({'args': args, 'prompt': kwargs['input'], 'env': kwargs['env'], 'files': sorted(p.name for p in folder.iterdir()),
                         'schema': json.loads((folder / 'answer-schema.json').read_text()) if (folder / 'answer-schema.json').exists() else None,
                         'instructions': (folder / 'instructions.md').read_text() if (folder / 'instructions.md').exists() else None})
        return SimpleNamespace(stdout='\n'.join(json.dumps(e) for e in events), stderr='', returncode=returncode)
    return run


DONE = [{'type': 'thread.started', 'thread_id': 't1'}, {'type': 'turn.started'},
        {'type': 'item.completed', 'item': {'id': 'i1', 'type': 'agent_message', 'text': '{"answer": "no", "why": null, "items": null}'}},
        {'type': 'turn.completed', 'usage': {'input_tokens': 900, 'cached_input_tokens': 800, 'output_tokens': 30}}]


class CodexTests(unittest.TestCase):
    def setUp(self):
        codex_cli._features.clear()

    def test_a_structured_call_reads_like_claudes_and_costs_nothing(self):
        seen = []
        client = codex_cli.Codex(binary='/fake/codex', run=codex_run(DONE, seen=seen), log=lambda t: None)
        with mock.patch.dict('os.environ', {'OPENAI_API_KEY': 'sk-app', 'CODEX_API_KEY': 'k'}):
            response = client.messages.create(**PARAMS)
        call = seen[0]
        args = call['args']
        self.assertEqual(args[:3], ['/fake/codex', 'exec', '--json'])
        for flag in ('--ephemeral', '--ignore-user-config', '--ignore-rules', '--skip-git-repo-check'):
            self.assertIn(flag, args)
        self.assertEqual((args[args.index('-s') + 1], args[args.index('-m') + 1]), ('read-only', 'gpt-6-luna'))
        disabled = {args[i + 1] for i, a in enumerate(args) if a == '--disable'}
        self.assertEqual(disabled, {'shell_tool', 'browser_use', 'computer_use'})   # only what this Codex has, the shell included
        self.assertIn('web_search="disabled"', args)
        self.assertIn('model_reasoning_effort="low"', args)
        self.assertEqual(call['schema']['required'], ['answer', 'why', 'items'])     # strict, as OpenAI requires
        self.assertIn('image-1.png', call['files'])
        self.assertEqual(os.path.basename(args[args.index('-i') + 1]), 'image-1.png')
        self.assertEqual(call['instructions'], 'Rules.\n\nProfile.')                       # Codex's own instructions, from a file
        self.assertIn(f'model_instructions_file={json.dumps(str(Path(args[args.index("-C") + 1]) / "instructions.md"))}', args)
        self.assertNotIn('Rules.', call['prompt'])                                           # never on stdin in front of the question
        for key in ('OPENAI_API_KEY', 'CODEX_API_KEY'):
            self.assertNotIn(key, call['env'])                                  # the user's own sign-in, never the app's key
        self.assertEqual(json.loads(response.content[0].text), {'answer': 'no'})
        self.assertEqual(response.stop_reason, 'end_turn')
        self.assertEqual((response.usage.input_tokens, response.usage.cache_read_input_tokens, response.usage.billing),
                         (100, 800, 'subscription'))
        self.assertEqual(cost.usd('claude-haiku-5-5', response.usage), 0.0)

    def test_a_pdf_is_refused_never_answered_unread(self):
        """Live check 9 Oct 2026: Codex said a CV with 9 years of experience had none, without opening the PDF."""
        params = dict(PARAMS, messages=[{'role': 'user', 'content': [{'type': 'document', 'source': {'type': 'base64', 'media_type': 'application/pdf', 'data': 'JVBERi0='}}]}])
        seen = []
        with self.assertRaises(contract.AiError) as caught:
            codex_cli.Codex(binary='/fake/codex', run=codex_run(DONE, seen=seen), log=lambda t: None).messages.create(**params)
        self.assertIn('page images', str(caught.exception))
        self.assertEqual(seen, [])   # nothing ran

    def test_limits_and_sign_in_stop_the_run_with_what_to_do(self):
        for message, words in (('You\'ve hit your usage limit. Try again later.', 'usage limit'),
                               ('401 Unauthorized: please run codex login', 'codex login')):
            with self.subTest(message=message):
                failed = [{'type': 'turn.failed', 'error': {'message': message}}]
                with self.assertRaises(contract.AiLimit) as caught:
                    codex_cli.Codex(binary='/fake/codex', run=codex_run(failed, returncode=1), log=lambda t: None).messages.create(**PARAMS)
                self.assertIn(words, str(caught.exception))

    def test_the_plan_limit_falls_back_to_the_users_openai_key_only_on_their_tick(self):
        failed = [{'type': 'turn.failed', 'error': {'message': 'usage limit reached'}}]
        api = FakeOpenAI(recorded(message(text('{"answer": "yes"}'))))
        with mock.patch('src.ai.providers.openai_api.sdk', lambda action='': api), \
                mock.patch('src.ai.providers.codex_cli.find_binary', lambda env=None: '/fake/codex'), \
                mock.patch('subprocess.run', codex_run(failed, returncode=1)):
            ticked = engine.client({'JOBADABRA_AI_ENGINE': 'codex', 'JOBADABRA_AI_FALLBACK': 'openai', 'OPENAI_API_KEY': 'k'})
            ticked.run, ticked.log = codex_run(failed, returncode=1), (lambda t: None)
            self.assertEqual(json.loads(ticked.messages.create(**PARAMS).content[0].text), {'answer': 'yes'})
            self.assertTrue(ticked.fell_back)
            self.assertIsNone(engine.client({'JOBADABRA_AI_ENGINE': 'codex', 'JOBADABRA_AI_FALLBACK': 'api', 'ANTHROPIC_API_KEY': 'k'}).fallback)
            self.assertIsNone(engine.client({'JOBADABRA_AI_ENGINE': 'codex', 'OPENAI_API_KEY': 'k'}).fallback)   # no tick, no fallback

    def test_a_wrong_answer_is_repaired_once(self):
        bad = [{'type': 'item.completed', 'item': {'type': 'agent_message', 'text': 'Sure!'}}, {'type': 'turn.completed', 'usage': {}}]
        answers = iter([bad, DONE])
        run = codex_run([])

        def twice(args, **kwargs):
            if args[1:] == ['features', 'list']:
                return run(args, **kwargs)
            return SimpleNamespace(stdout='\n'.join(json.dumps(e) for e in next(answers)), stderr='', returncode=0)
        response = codex_cli.Codex(binary='/fake/codex', run=twice, log=lambda t: None).messages.create(**PARAMS)
        self.assertEqual(json.loads(response.content[0].text), {'answer': 'no'})


class WordsTests(unittest.TestCase):
    """A run on an OpenAI engine is billed and worded as OpenAI's, never as Claude's."""
    def test_billed_to_and_cost_words_follow_the_provider(self):
        from src.notion import cron_report
        stage = cron_report.STAGES[0][0]
        self.assertEqual(cron_report.billed_to({stage: {'cli_calls': 2, 'provider': 'openai'}}), 'ChatGPT plan')
        self.assertEqual(cron_report.billed_to({stage: {'api_calls': 2, 'provider': 'openai'}}), 'OpenAI API credits')
        self.assertEqual(cron_report.billed_to({stage: {'cli_calls': 2}}), 'Claude subscription')
        self.assertEqual(cron_report.cost_text({stage: {'cli_calls': 1, 'provider': 'openai'}}), 'Codex, your ChatGPT plan')

    def test_limits_and_plan_lines_name_the_chosen_engine(self):
        from src import daily_helpers, scout
        from src.ai import providers
        with mock.patch.dict('os.environ', {'JOBADABRA_AI_ENGINE': 'codex'}):
            self.assertIn('Codex', daily_helpers.left_out({'pending': 2, 'done': 0, 'limit': 'cli'}, 'scored')[0])
            self.assertIn('ChatGPT plan (Codex', scout.ai_cost_line('scout run', 0.0, 0, 3, 3))
            self.assertEqual(cost.limit_reason(contract.AiLimit('x')), 'Codex (your ChatGPT plan) cannot go on')
        with mock.patch.dict('os.environ', {'JOBADABRA_AI_ENGINE': 'openai'}):
            self.assertIn('OpenAI API', daily_helpers.left_out({'pending': 1, 'done': 0, 'limit': 'cli'}, 'read by AI')[0])
        self.assertEqual(set(providers.ENGINES), {'api', 'cli', 'openai', 'codex'})


if __name__ == '__main__':
    unittest.main()
